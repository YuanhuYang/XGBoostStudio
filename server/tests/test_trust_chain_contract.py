"""
G1 信任链：quick-config → validate → 训练 → 评估 API 与模型记录一致；叙事行数与划分一致。
对齐 docs/迭代章程-G1-信任链与权威数据.md
"""
from __future__ import annotations

from pathlib import Path

from schemas.narrative import DataNarrativeResponse

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


def _titanic_dataset_split(client):
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
    return dataset_id, rs.json()["split_id"], rs.json().get("train_rows", 0)


def test_trust_titanic_split_for_quick_config(client):
    """AC-3-05：划分成功且返回训练行数。"""
    _ds, split_id, train_rows = _titanic_dataset_split(client)
    assert split_id and train_rows > 0


def test_trust_quick_config_params_pass_validate_api(client):
    """AC-4-03：向导推荐参数可通过 /api/params/validate。"""
    _, split_id, _ = _titanic_dataset_split(client)
    qc = client.post("/api/wizard/quick-config", json={"split_id": split_id})
    assert qc.status_code == 200, qc.text
    body = qc.json()
    params = body.get("params") or {}
    assert isinstance(params, dict)
    assert "n_estimators" in params or "max_depth" in params
    for key, val in params.items():
        vr = client.post("/api/params/validate", json={key: val})
        assert vr.status_code == 200, vr.text
        assert vr.json().get("valid") is True, (key, val, vr.json())
    whole = client.post("/api/params/validate", json=params)
    assert whole.status_code == 200
    assert whole.json().get("valid") is True, whole.json()


def test_trust_recommend_params_endpoint_matches_quick_config_shape(client):
    """GET /api/params/recommend 与 quick-config 的 params 结构一致（同源 recommend_params）。"""
    _, split_id, _ = _titanic_dataset_split(client)
    qc = client.post("/api/wizard/quick-config", json={"split_id": split_id})
    gr = client.get("/api/params/recommend", params={"split_id": split_id})
    assert qc.status_code == 200 and gr.status_code == 200
    p1 = qc.json().get("params") or {}
    p2 = gr.json().get("params") or {}
    assert p1.keys() == p2.keys()
    assert p1 == p2


def test_eval_api_matches_model_metrics_after_train(client):
    """AC-6-01：评估 API metrics 与模型库 metrics 一致（同源 metrics_json）。"""
    _, split_id, _ = _titanic_dataset_split(client)
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
    assert rr.status_code == 200
    assert rr.json().get("status") == "completed"
    mid = rr.json()["model_id"]

    ev = client.get(f"/api/models/{mid}/evaluation")
    md = client.get(f"/api/models/{mid}")
    assert ev.status_code == 200 and md.status_code == 200
    em = ev.json().get("metrics") or {}
    mm = md.json().get("metrics") or {}
    assert mm
    for k, v in mm.items():
        if k in em and isinstance(v, (int, float)) and isinstance(em[k], (int, float)):
            assert abs(float(em[k]) - float(v)) < 1e-9, (k, em[k], v)


def test_evaluation_stable_after_report_generate(client):
    """信任链：生成 PDF 后不改变已存模型指标（评估 API 前后一致）。"""
    _, split_id, _ = _titanic_dataset_split(client)
    rt = client.post(
        "/api/training/start",
        json={
            "split_id": split_id,
            "params": {"n_estimators": 6, "max_depth": 3, "learning_rate": 0.2},
        },
    )
    assert rt.status_code == 200, rt.text
    tid = rt.json()["task_id"]
    _drain_training_sse(client, tid)
    rr = client.get(f"/api/training/{tid}/result")
    mid = rr.json()["model_id"]

    before = client.get(f"/api/models/{mid}/evaluation").json()
    rg = client.post(
        "/api/reports/generate",
        json={
            "model_id": mid,
            "title": "trust_chain_eval_stable",
            "include_sections": ["executive_summary", "evaluation", "data_overview"],
        },
    )
    assert rg.status_code == 200, rg.text
    after = client.get(f"/api/models/{mid}/evaluation").json()
    assert before.get("metrics") == after.get("metrics")


def test_trust_narrative_row_count_bounded_by_train(client):
    """叙事 profile 行数不超过训练集行数（防泄漏用 train_path；大表可能采样）。"""
    ds_id, split_id, train_rows = _titanic_dataset_split(client)
    r = client.get(
        f"/api/datasets/{ds_id}/data-narrative",
        params={"split_id": split_id, "depth": "standard"},
    )
    assert r.status_code == 200
    body = DataNarrativeResponse.model_validate(r.json())
    assert body.meta.row_count_profiled > 0
    # 叙事仅读训练集；大表可能采样，Titanic 训练子集低于采样阈值时应与划分行数一致
    assert body.meta.row_count_profiled <= train_rows
