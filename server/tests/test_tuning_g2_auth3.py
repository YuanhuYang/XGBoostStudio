"""
G2-Auth-3：调优诊断 JSON、失败可计数、结果 API。
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


def _split_titanic(client, dataset_id: int) -> int:
    client.patch(f"/api/datasets/{dataset_id}", json={"target_column": "Survived"})
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


def _drain_tuning_sse(client, task_id: str) -> bytes:
    with client.stream("GET", f"/api/tuning/{task_id}/progress") as resp:
        assert resp.status_code == 200, resp.text
        return resp.read()


def test_tuning_result_has_diagnostics_and_search_space_doc(client):
    up = _upload_titanic_train(client)
    assert up.status_code == 200, up.text
    dataset_id = up.json()["id"]
    split_id = _split_titanic(client, dataset_id)

    st = client.post(
        "/api/tuning/start",
        json={"split_id": split_id, "n_trials": 4, "strategy": "tpe", "search_space": {}},
    )
    assert st.status_code == 200, st.text
    task_id = st.json()["task_id"]
    _drain_tuning_sse(client, task_id)

    rr = client.get(f"/api/tuning/{task_id}/result")
    assert rr.status_code == 200, rr.text
    body = rr.json()
    assert body.get("status") == "completed"
    diag = body.get("diagnostics") or {}
    assert diag.get("n_trials_requested") == 4
    assert diag.get("n_trials_completed", 0) >= 1
    assert "trial_points" in diag and len(diag["trial_points"]) >= 1
    assert diag.get("direction") in ("maximize", "minimize")
    ssd = diag.get("search_space_documentation") or {}
    assert "n_estimators" in ssd or "max_depth" in ssd

    latest = client.get(f"/api/tuning/latest?split_id={split_id}")
    assert latest.status_code == 200
    lj = latest.json()
    assert lj.get("task_id") == task_id
    assert "diagnostics" in lj
