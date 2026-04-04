"""
核心 API 回归：系统端点、数据集上传/列表、向导摘要、训练任务创建（不重跑完整训练流）。
"""
from __future__ import annotations

from pathlib import Path

_FIXTURES = Path(__file__).resolve().parent / "fixtures"


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
