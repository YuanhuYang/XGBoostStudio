"""全局校验与错误路径抽样（多模块 AC 的 API 侧证据）。"""
from __future__ import annotations


def test_training_start_invalid_body_type_422(client):
    """非法 JSON 类型应返回 422（RequestValidationError）。"""
    r = client.post(
        "/api/training/start",
        json={"split_id": "not-an-integer", "params": {}},
    )
    assert r.status_code == 422
    body = r.json()
    detail = body.get("detail")
    assert detail is not None


def test_report_compare_too_few_models_422(client):
    """POST /api/reports/compare 少于 2 个模型 ID 时 422。"""
    r = client.post(
        "/api/reports/compare",
        json={"model_ids": [1], "title": "x"},
    )
    assert r.status_code == 422
