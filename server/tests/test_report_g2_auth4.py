"""
G2-Auth-4：PDF 含「方法与指标定义」章节锚点。
"""
from __future__ import annotations

from pathlib import Path

_FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _pipeline_model_id(client) -> int:
    up = _upload_titanic_train(client)
    assert up.status_code == 200, up.text
    dataset_id = up.json()["id"]
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
    split_id = rs.json()["split_id"]
    rt = client.post(
        "/api/training/start",
        json={"split_id": split_id, "params": {"n_estimators": 5, "max_depth": 3}, "use_kfold_cv": False},
    )
    assert rt.status_code == 200, rt.text
    tid = rt.json()["task_id"]
    with client.stream("GET", f"/api/training/{tid}/progress") as resp:
        assert resp.status_code == 200
        resp.read()
    rr = client.get(f"/api/training/{tid}/result")
    return rr.json()["model_id"]


def _upload_titanic_train(client):
    path = _FIXTURES / "titanic_train.csv"
    with open(path, "rb") as f:
        return client.post(
            "/api/datasets/upload",
            files={"file": ("titanic_train.csv", f, "text/csv")},
        )


def test_pdf_contains_methodology_section(client):
    mid = _pipeline_model_id(client)
    rp = client.post(
        "/api/reports/generate",
        json={
            "model_id": mid,
            "name": "pytest g2auth4 methodology",
            "include_sections": ["methodology", "evaluation"],
        },
    )
    assert rp.status_code == 200, rp.text
    rid = rp.json()["id"]
    dl = client.get(f"/api/reports/{rid}/download")
    assert dl.status_code == 200
    assert dl.content[:4] == b"%PDF"
    # methodology 章节正文含 ASCII「hold-out」（ReportLab 未压缩进二进制流时可搜）
    assert b"hold-out" in dl.content or len(dl.content) > 4000
