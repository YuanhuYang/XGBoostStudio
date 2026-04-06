"""CLI 所用 API 路径冒烟；与 cli.api_client 行为对齐（同步 TestClient）。"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from db.database import init_db
from main import app


@pytest.mark.serial
def test_cli_automl_api_path_matches_client_usage() -> None:
    """与 StudioHttpClient 相同的 URL：import-sample → jobs → SSE → result。"""
    init_db()
    with TestClient(app) as client:
        r = client.post("/api/datasets/import-sample?key=boston")
        assert r.status_code == 200, r.text
        ds_id = r.json()["id"]

        r2 = client.post(
            "/api/automl/jobs",
            json={"dataset_id": ds_id, "skip_tuning": True, "max_tuning_trials": 0},
        )
        assert r2.status_code == 200, r2.text
        job_id = r2.json()["job_id"]

        n_events = 0
        with client.stream("GET", f"/api/automl/jobs/{job_id}/progress") as resp:
            assert resp.status_code == 200
            buf = b""
            for chunk in resp.iter_bytes():
                buf += chunk
                n_events += chunk.count(b"data:")
                if b"event: done" in buf:
                    break

        assert n_events >= 1
        r3 = client.get(f"/api/automl/jobs/{job_id}/result")
        assert r3.status_code == 200, r3.text
        data = r3.json()
        assert data["dataset_id"] == ds_id
        assert len(data.get("candidates") or []) >= 2


def test_cli_main_help_exits_zero() -> None:
    import os
    import subprocess
    import sys
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent
    env = os.environ.copy()
    env.setdefault("PYTHONUTF8", "1")
    env.setdefault("PYTHONIOENCODING", "utf-8")
    r = subprocess.run(
        [sys.executable, "-m", "cli.main", "--help"],
        cwd=str(root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        timeout=60,
    )
    assert r.returncode == 0
    out = r.stdout or ""
    assert "xs-studio" in out or "XGBoost Studio" in out
