"""全自动建模 API 与编排层测试。"""
from __future__ import annotations

import time

import pytest


@pytest.mark.serial
def test_automl_job_fast_mode_produces_candidates(client):
    from fastapi.testclient import TestClient

    assert isinstance(client, TestClient)
    # 使用回归示例 boston，避免部分环境下 Titanic 标签编码与 stratify 不一致导致失败
    r = client.post("/api/datasets/import-sample?key=boston")
    assert r.status_code == 200, r.text
    ds_id = r.json()["id"]

    r2 = client.post(
        "/api/automl/jobs",
        json={"dataset_id": ds_id, "skip_tuning": True, "max_tuning_trials": 0},
    )
    assert r2.status_code == 200, r2.text
    job_id = r2.json()["job_id"]

    with client.stream("GET", f"/api/automl/jobs/{job_id}/progress") as resp:
        assert resp.status_code == 200
        buf = b""
        for chunk in resp.iter_bytes():
            buf += chunk
            if b"event: done" in buf:
                break
        # 至少应收到若干 data 行
        assert b"data:" in buf

    time.sleep(0.3)
    r3 = client.get(f"/api/automl/jobs/{job_id}/result")
    assert r3.status_code == 200, r3.text
    data = r3.json()
    assert data["dataset_id"] == ds_id
    assert data["target_column"]
    assert data["split_id"]
    assert len(data["candidates"]) >= 2
    assert "chosen_recommendation" in data
    assert data["chosen_recommendation"]["model_id"]
    assert "pipeline_plan" in data
    pp = data["pipeline_plan"]
    assert "smart_clean" in pp
    assert "split" in pp
    assert pp["split"].get("resolved") == "random"
    for c in data["candidates"]:
        assert c["model_id"]
        assert c["name"]
        assert "score_for_rank" in c


