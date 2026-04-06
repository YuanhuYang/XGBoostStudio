"""
模块 8：模型列表、多模型查询、对比报告 PDF（API 自动化证据）。
使用 Titanic 数值目标训练（与 test_api_core 一致），避免 Iris 字符串标签导致训练失败。
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


def _train_titanic_model(client, split_id: int, n_estimators: int = 5) -> int:
    rt = client.post(
        "/api/training/start",
        json={
            "split_id": split_id,
            "params": {
                "n_estimators": n_estimators,
                "max_depth": 3,
                "learning_rate": 0.2,
            },
        },
    )
    assert rt.status_code == 200, rt.text
    task_id = rt.json()["task_id"]
    _drain_training_sse(client, task_id)
    rr = client.get(f"/api/training/{task_id}/result")
    assert rr.status_code == 200, rr.text
    assert rr.json().get("status") == "completed", rr.text
    mid = rr.json().get("model_id")
    assert mid and isinstance(mid, int)
    return mid


def test_models_list_and_filter_after_train(client):
    split_id = _titanic_split_id(client)
    mid = _train_titanic_model(client, split_id)

    r = client.get("/api/models")
    assert r.status_code == 200
    models = r.json()
    assert isinstance(models, list)
    assert len(models) >= 1
    assert "id" in models[0]

    r2 = client.get("/api/models", params={"task_type": "classification"})
    assert r2.status_code == 200
    for m in r2.json():
        assert m["task_type"] == "classification"

    rs = client.get("/api/models", params={"split_id": split_id})
    assert rs.status_code == 200
    split_models = rs.json()
    ids = {m["id"] for m in split_models}
    assert mid in ids
    for m in split_models:
        assert m["split_id"] == split_id or m["split_id"] is None


def test_models_compare_query_and_comparison_report_pdf(client):
    split_id = _titanic_split_id(client)
    m1 = _train_titanic_model(client, split_id, n_estimators=4)
    m2 = _train_titanic_model(client, split_id, n_estimators=6)

    rc = client.get(f"/api/models/compare?ids={m1},{m2}")
    assert rc.status_code == 200
    cmp_list = rc.json()
    assert len(cmp_list) == 2
    ids = {x["id"] for x in cmp_list}
    assert ids == {m1, m2}

    rp = client.post(
        "/api/reports/compare",
        json={"model_ids": [m1, m2], "title": "pytest compare two titanic"},
    )
    assert rp.status_code == 200, rp.text
    report_id = rp.json()["id"]

    dl = client.get(f"/api/reports/{report_id}/download")
    assert dl.status_code == 200
    assert dl.content[:4] == b"%PDF"
    assert len(dl.content) > 2000


def test_patch_model_notes(client):
    split_id = _titanic_split_id(client)
    mid = _train_titanic_model(client, split_id)
    r = client.patch(f"/api/models/{mid}", json={"notes": "pytest-note"})
    assert r.status_code == 200
    assert r.json().get("notes") == "pytest-note"
