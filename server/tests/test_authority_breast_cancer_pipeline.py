"""
权威数据集：sklearn.datasets.load_breast_cancer（Wisconsin Breast Cancer，BSD 许可）。
区间断言避免 xgboost/sklearn 小版本漂移导致脆快照。
"""
from __future__ import annotations

import io

import pandas as pd
import pytest
from sklearn.datasets import load_breast_cancer


def test_authority_breast_cancer_sklearn_pipeline(client):
    X, y = load_breast_cancer(return_X_y=True)
    feature_names = [f"f{i}" for i in range(X.shape[1])]
    df = pd.DataFrame(X, columns=feature_names)
    df["target"] = y.astype(int)

    buf = io.StringIO()
    df.to_csv(buf, index=False)
    raw = buf.getvalue().encode("utf-8")

    up = client.post(
        "/api/datasets/upload",
        files={"file": ("breast_cancer_authority.csv", raw, "text/csv")},
    )
    assert up.status_code == 200, up.text
    dataset_id = up.json()["id"]

    client.patch(f"/api/datasets/{dataset_id}", json={"target_column": "target"})
    rs = client.post(
        f"/api/datasets/{dataset_id}/split",
        json={
            "train_ratio": 0.75,
            "random_seed": 42,
            "stratify": True,
            "target_column": "target",
        },
    )
    assert rs.status_code == 200, rs.text
    split_id = rs.json()["split_id"]

    rt = client.post(
        "/api/training/start",
        json={
            "split_id": split_id,
            "params": {"n_estimators": 30, "max_depth": 4, "learning_rate": 0.15},
        },
    )
    assert rt.status_code == 200, rt.text
    task_id = rt.json()["task_id"]
    with client.stream("GET", f"/api/training/{task_id}/progress") as resp:
        assert resp.status_code == 200
        resp.read()
    rr = client.get(f"/api/training/{task_id}/result")
    assert rr.status_code == 200
    assert rr.json().get("status") == "completed"
    mid = rr.json()["model_id"]

    md = client.get(f"/api/models/{mid}")
    assert md.status_code == 200
    metrics = md.json().get("metrics") or {}
    acc = float(metrics.get("accuracy", 0))
    auc = float(metrics.get("auc", 0))
    assert 0.85 <= acc <= 1.0, f"accuracy out of band: {acc}"
    assert 0.80 <= auc <= 1.0, f"auc out of band: {auc}"
