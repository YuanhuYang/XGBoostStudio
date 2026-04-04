"""
核心 API 回归：系统端点、数据集上传/列表、向导摘要、训练任务创建（不重跑完整训练流）。

含 AC-0-01 的 **HTTP 等效路径**（上传 Titanic → 划分 → 训练至完成 → 生成并下载 PDF），
用于无 UI 会话时的验收证据；完整 SmartWorkflow 点选仍见 docs/验收执行记录。
"""
from __future__ import annotations

from pathlib import Path

_FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _upload_titanic_train(client):
    path = _FIXTURES / "titanic_train.csv"
    with open(path, "rb") as f:
        return client.post(
            "/api/datasets/upload",
            files={"file": ("titanic_train.csv", f, "text/csv")},
        )


def _drain_training_sse(client, task_id: str) -> bytes:
    with client.stream("GET", f"/api/training/{task_id}/progress") as resp:
        assert resp.status_code == 200, resp.text
        return resp.read()


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body.get("status") == "ok"
    assert "version" in body


def test_root(client):
    r = client.get("/")
    assert r.status_code == 200
    assert r.json().get("docs") == "/docs"


def test_system_version(client):
    r = client.get("/api/system/version")
    assert r.status_code == 200
    assert "version" in r.json()


def test_upload_rejects_non_tabular(client):
    r = client.post(
        "/api/datasets/upload",
        files={"file": ("bad.txt", b"not a csv", "text/plain")},
    )
    assert r.status_code == 400


def _upload_iris(client):
    path = _FIXTURES / "iris.csv"
    with open(path, "rb") as f:
        return client.post(
            "/api/datasets/upload",
            files={"file": ("iris.csv", f, "text/csv")},
        )


def test_upload_iris_list_and_get(client):
    r = _upload_iris(client)
    assert r.status_code == 200, r.text
    body = r.json()
    dataset_id = body["id"]

    r2 = client.get("/api/datasets")
    assert r2.status_code == 200
    ids = {d["id"] for d in r2.json()}
    assert dataset_id in ids

    r3 = client.get(f"/api/datasets/{dataset_id}")
    assert r3.status_code == 200
    assert r3.json()["id"] == dataset_id


def test_wizard_dataset_summary(client):
    up = _upload_iris(client)
    assert up.status_code == 200
    dataset_id = up.json()["id"]
    r = client.get(f"/api/wizard/dataset-summary/{dataset_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["dataset_id"] == dataset_id
    assert data["n_rows"] >= 100
    assert data["n_cols"] >= 4
    assert "quality_score" in data
    assert isinstance(data["columns"], list)


def test_report_generate_unknown_model(client):
    r = client.post(
        "/api/reports/generate",
        json={"model_id": 999_999, "title": "noop"},
    )
    assert r.status_code == 404
    assert "模型" in r.json().get("detail", "") or "不存在" in r.json().get("detail", "")


def test_report_download_unknown_report(client):
    r = client.get("/api/reports/999_999/download")
    assert r.status_code == 404


def test_prediction_batch_summary_unknown_task(client):
    r = client.get("/api/prediction/nonexistent-task-id/summary")
    assert r.status_code == 404
    assert "预测" in r.json().get("detail", "") or "不存在" in r.json().get("detail", "")


def test_split_and_training_start(client):
    up = _upload_iris(client)
    assert up.status_code == 200
    dataset_id = up.json()["id"]
    split_body = {
        "train_ratio": 0.8,
        "random_seed": 42,
        "stratify": False,
        "target_column": "species",
    }
    rs = client.post(f"/api/datasets/{dataset_id}/split", json=split_body)
    assert rs.status_code == 200, rs.text
    split_id = rs.json()["split_id"]

    rt = client.post(
        "/api/training/start",
        json={"split_id": split_id, "params": {"n_estimators": 2, "max_depth": 2}},
    )
    assert rt.status_code == 200, rt.text
    tid = rt.json().get("task_id")
    assert tid and isinstance(tid, str)


def test_titanic_ac001_api_pipeline_report_pdf(client):
    """AC-0-01 后端等效：DS-01 上传 → Survived 划分 → 快训 → PDF 报告下载。"""
    up = _upload_titanic_train(client)
    assert up.status_code == 200, up.text
    dataset_id = up.json()["id"]

    rp = client.patch(
        f"/api/datasets/{dataset_id}",
        json={"target_column": "Survived"},
    )
    assert rp.status_code == 200, rp.text

    rs = client.post(
        f"/api/datasets/{dataset_id}/split",
        json={
            "train_ratio": 0.8,
            "random_seed": 42,
            "stratify": True,
            "target_column": "Survived",
        },
    )
    assert rs.status_code == 200, rs.text
    split_id = rs.json()["split_id"]

    rt = client.post(
        "/api/training/start",
        json={
            "split_id": split_id,
            "params": {"n_estimators": 5, "max_depth": 3, "learning_rate": 0.2},
        },
    )
    assert rt.status_code == 200, rt.text
    task_id = rt.json()["task_id"]

    sse_body = _drain_training_sse(client, task_id)
    assert b"completed" in sse_body.lower() or b"model_id" in sse_body

    rr = client.get(f"/api/training/{task_id}/result")
    assert rr.status_code == 200, rr.text
    assert rr.json().get("status") == "completed"
    model_id = rr.json().get("model_id")
    assert model_id and isinstance(model_id, int)

    rg = client.post(
        "/api/reports/generate",
        json={
            "model_id": model_id,
            "title": "AC-0-01 API 等效验收",
            "include_sections": [
                "data_overview",
                "model_params",
                "evaluation",
                "shap",
            ],
        },
    )
    assert rg.status_code == 200, rg.text
    report_id = rg.json()["id"]

    dl = client.get(f"/api/reports/{report_id}/download")
    assert dl.status_code == 200, dl.text
    assert dl.headers.get("content-type", "").startswith("application/pdf")
    assert len(dl.content) > 5000
    assert dl.content[:4] == b"%PDF"
