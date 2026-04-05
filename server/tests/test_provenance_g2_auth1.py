"""
G2-Auth-1：运行档案 GET /api/models/{id}/provenance 与训练写入一致性。
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
    return dataset_id, rs.json()["split_id"]


def test_provenance_after_training_matches_model_record(client):
    _, split_id = _titanic_split_id(client)
    rt = client.post(
        "/api/training/start",
        json={
            "split_id": split_id,
            "params": {
                "n_estimators": 6,
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
    mid = rr.json()["model_id"]
    assert mid

    pr = client.get(f"/api/models/{mid}/provenance")
    assert pr.status_code == 200, pr.text
    body = pr.json()
    assert body.get("schema_version") == "1.0"
    assert body.get("source") == "training"
    assert body.get("split_id") == split_id
    assert body.get("split_random_seed") == 42
    assert body.get("training_task_id") == task_id
    pkgs = body.get("packages") or {}
    assert "xgboost" in pkgs and pkgs["xgboost"] != "unknown"
    assert "sklearn" in pkgs and pkgs["sklearn"] != "unknown"
    assert "pandas" in pkgs

    md = client.get(f"/api/models/{mid}")
    assert md.status_code == 200
    params_m = md.json().get("params") or {}
    params_p = body.get("params_final") or {}
    assert params_m == params_p

    m_m = md.json().get("metrics") or {}
    m_p = body.get("metrics") or {}
    assert m_m == m_p


def test_provenance_404_unknown_model(client):
    r = client.get("/api/models/999999999/provenance")
    assert r.status_code == 404
