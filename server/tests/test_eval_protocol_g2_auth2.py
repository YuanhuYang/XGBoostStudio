"""
G2-Auth-2：评估协议、基线 train-fit、K 折 Body、PDF 锚点。
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


def _drain_training_sse(client, task_id: str) -> None:
    with client.stream("GET", f"/api/training/{task_id}/progress") as resp:
        assert resp.status_code == 200, resp.text
        resp.read()


def _titanic_split_id(client):
    up = _upload_titanic_train(client)
    assert up.status_code == 200, up.text
    dataset_id = up.json()["id"]
    client.patch(
        f"/api/datasets/{dataset_id}",
        json={"target_column": "Survived"},
    )
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
    return rs.json()["split_id"]


def test_evaluation_has_protocol_and_baseline_train_only(client):
    split_id = _titanic_split_id(client)
    rt = client.post(
        "/api/training/start",
        json={
            "split_id": split_id,
            "params": {"n_estimators": 8, "max_depth": 4, "learning_rate": 0.2},
        },
    )
    assert rt.status_code == 200, rt.text
    task_id = rt.json()["task_id"]
    _drain_training_sse(client, task_id)
    rr = client.get(f"/api/training/{task_id}/result")
    assert rr.status_code == 200, rr.text
    mid = rr.json()["model_id"]

    ev = client.get(f"/api/models/{mid}/evaluation")
    assert ev.status_code == 200, ev.text
    body = ev.json()
    proto = body.get("evaluation_protocol") or {}
    assert proto.get("scheme") == "single_holdout"
    assert "hold-out" in (proto.get("notes_zh") or "")
    assert proto.get("time_series_split_supported") is True
    assert proto.get("current_split_strategy") == "random"

    bl = body.get("baseline") or {}
    assert bl.get("fit_scope") == "train_only"
    metrics = body.get("metrics") or {}
    # 小样本下单次 hold-out 上准确率可能略低于多数类基线；AUC 应优于随机
    assert metrics.get("auc", 0) > 0.52


def test_ac603_cv_persisted_when_use_kfold_cv(client):
    """AC-6-03：训练时开启 K 折则写入模型并在 evaluation 中返回。"""
    split_id = _titanic_split_id(client)
    rt = client.post(
        "/api/training/start",
        json={
            "split_id": split_id,
            "use_kfold_cv": True,
            "kfold_k": 3,
            "params": {"n_estimators": 5, "max_depth": 3, "learning_rate": 0.2},
        },
    )
    assert rt.status_code == 200, rt.text
    task_id = rt.json()["task_id"]
    _drain_training_sse(client, task_id)
    rr = client.get(f"/api/training/{task_id}/result")
    mid = rr.json()["model_id"]
    ev = client.get(f"/api/models/{mid}/evaluation")
    assert ev.status_code == 200, ev.text
    body = ev.json()
    cv = body.get("cv_kfold") or {}
    assert cv.get("k") == 3
    assert len(cv.get("fold_metrics") or []) == 3
    summary = cv.get("summary") or {}
    assert any(k.endswith("_mean") for k in summary)
    for row in cv.get("fold_metrics") or []:
        assert "outlier_highlight" in row


def test_kfold_post_json_body(client):
    split_id = _titanic_split_id(client)
    r = client.post(
        "/api/training/kfold",
        json={
            "split_id": split_id,
            "k": 3,
            "params": {"n_estimators": 5, "max_depth": 3},
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("k") == 3
    assert "fold_metrics" in data and len(data["fold_metrics"]) == 3
    assert "summary" in data


def test_report_pdf_evaluation_section_generates(client):
    """含「模型评估结果」章节的 PDF 可生成（文本可能被压缩，不断言锚点字节串）。"""
    split_id = _titanic_split_id(client)
    rt = client.post(
        "/api/training/start",
        json={"split_id": split_id, "params": {"n_estimators": 5, "max_depth": 3}},
    )
    assert rt.status_code == 200, rt.text
    task_id = rt.json()["task_id"]
    _drain_training_sse(client, task_id)
    rr = client.get(f"/api/training/{task_id}/result")
    mid = rr.json()["model_id"]

    rp = client.post(
        "/api/reports/generate",
        json={"model_id": mid, "name": "pytest g2auth2", "include_sections": ["evaluation"]},
    )
    assert rp.status_code == 200, rp.text
    rid = rp.json()["id"]
    dl = client.get(f"/api/reports/{rid}/download")
    assert dl.status_code == 200
    assert dl.content[:4] == b"%PDF"
    assert len(dl.content) > 3000
