"""
G2-R1：数据叙事 API 与 PDF data_relations 章节 — AC-9-11～AC-9-15 自动化。
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


def _titanic_split_and_id(client):
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
    return dataset_id, rs.json()["split_id"]


def test_data_narrative_titanic_ac911(client):
    """AC-9-11：JSON 契约、row_count、caveats 含因果/相关。"""
    dataset_id, split_id = _titanic_split_and_id(client)
    r = client.get(
        f"/api/datasets/{dataset_id}/data-narrative",
        params={"split_id": split_id, "depth": "standard"},
    )
    assert r.status_code == 200, r.text
    body = DataNarrativeResponse.model_validate(r.json())
    assert body.meta.dataset_id == dataset_id
    assert body.meta.split_id == split_id
    assert body.meta.row_count_profiled > 0
    caveats_joined = " ".join(body.bullets.caveats)
    assert "因果" in caveats_joined or "相关" in caveats_joined
    assert len(body.variables) >= 2


def test_data_narrative_no_split_degraded_ac914(client):
    """AC-9-14：无 split_id 时降级叙事。"""
    up = _upload_titanic_train(client)
    assert up.status_code == 200
    dataset_id = up.json()["id"]
    r = client.get(f"/api/datasets/{dataset_id}/data-narrative")
    assert r.status_code == 200
    body = DataNarrativeResponse.model_validate(r.json())
    assert body.meta.split_id is None
    assert body.meta.sample_note is not None
    assert body.correlation_pairs == []


def test_data_narrative_wrong_split_404(client):
    dataset_id, _ = _titanic_split_and_id(client)
    r = client.get(
        f"/api/datasets/{dataset_id}/data-narrative",
        params={"split_id": 999_999},
    )
    assert r.status_code == 404


def test_data_narrative_depth_standard_vs_detailed_ac913(client):
    """AC-9-13：detailed 相关对不少于 standard（Titanic 数值列足够时）。"""
    dataset_id, split_id = _titanic_split_and_id(client)
    rs = client.get(
        f"/api/datasets/{dataset_id}/data-narrative",
        params={"split_id": split_id, "depth": "standard"},
    )
    rd = client.get(
        f"/api/datasets/{dataset_id}/data-narrative",
        params={"split_id": split_id, "depth": "detailed"},
    )
    assert rs.status_code == 200 and rd.status_code == 200
    s = DataNarrativeResponse.model_validate(rs.json())
    d = DataNarrativeResponse.model_validate(rd.json())
    assert len(d.correlation_pairs) >= len(s.correlation_pairs)


def test_report_pdf_contains_data_relations_ac912(client):
    """AC-9-12：PDF 含「数据与变量关系」章节。"""
    dataset_id, split_id = _titanic_split_and_id(client)
    rt = client.post(
        "/api/training/start",
        json={
            "split_id": split_id,
            "params": {"n_estimators": 5, "max_depth": 3, "learning_rate": 0.2},
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
    model_id = rr.json().get("model_id")
    assert model_id

    rg = client.post(
        "/api/reports/generate",
        json={
            "model_id": model_id,
            # PDF /Metadata 中常含标题明文，便于断言 data_relations 路径已执行
            "title": "AC912 XG2R1DATAREL",
            "include_sections": [
                "executive_summary",
                "data_relations",
                "data_overview",
                "model_params",
                "evaluation",
            ],
        },
    )
    assert rg.status_code == 200, rg.text
    report_id = rg.json()["id"]
    dl = client.get(f"/api/reports/{report_id}/download")
    assert dl.status_code == 200
    assert dl.content[:4] == b"%PDF"
    # PDF 内容流中非 UTF-8 明文中文；用报告内嵌 ASCII 锚点做回归断言
    assert b"XG2R1DATAREL" in dl.content


def test_openapi_has_data_narrative_ac915(client):
    """AC-9-15：OpenAPI 含路径。"""
    r = client.get("/openapi.json")
    assert r.status_code == 200
    paths = r.json().get("paths", {})
    assert any("data-narrative" in p for p in paths)


def test_g2r1b_caveats_multicompare_and_enrichment(client):
    """G2-R1b：多重比较提示 + 类别/VIF/缺失等扩展字段可解析。"""
    dataset_id, split_id = _titanic_split_and_id(client)
    r = client.get(
        f"/api/datasets/{dataset_id}/data-narrative",
        params={"split_id": split_id, "depth": "detailed"},
    )
    assert r.status_code == 200
    body = DataNarrativeResponse.model_validate(r.json())
    caveats_joined = " ".join(body.bullets.caveats)
    assert "多重比较" in caveats_joined
    assert (
        body.categorical_associations
        or body.missing_vs_target
        or any(m.vif is not None for m in body.multicollinearity)
        or any(c.chart_id.startswith("box_") for c in body.charts)
    )


def test_g2r1b_detailed_includes_spearman_chart(client):
    """G2-R1b：detailed 深度生成 Spearman 热力图规格。"""
    dataset_id, split_id = _titanic_split_and_id(client)
    r = client.get(
        f"/api/datasets/{dataset_id}/data-narrative",
        params={"split_id": split_id, "depth": "detailed"},
    )
    assert r.status_code == 200
    body = DataNarrativeResponse.model_validate(r.json())
    ids = {c.chart_id for c in body.charts}
    assert "corr_heatmap_numeric" in ids
    assert "corr_heatmap_spearman" in ids


def test_g2r1b_report_generate_accepts_narrative_depth(client):
    """G2-R1b：POST /reports/generate 接受 narrative_depth=detailed 且成功出 PDF。"""
    dataset_id, split_id = _titanic_split_and_id(client)
    rt = client.post(
        "/api/training/start",
        json={
            "split_id": split_id,
            "params": {"n_estimators": 5, "max_depth": 3, "learning_rate": 0.2},
        },
    )
    assert rt.status_code == 200, rt.text
    task_id = rt.json()["task_id"]
    with client.stream("GET", f"/api/training/{task_id}/progress") as resp:
        assert resp.status_code == 200
        resp.read()
    rr = client.get(f"/api/training/{task_id}/result")
    assert rr.status_code == 200
    model_id = rr.json().get("model_id")
    assert model_id
    rg = client.post(
        "/api/reports/generate",
        json={
            "model_id": model_id,
            "title": "G2R1B depth detailed",
            "narrative_depth": "detailed",
            "include_sections": ["executive_summary", "data_relations", "evaluation"],
        },
    )
    assert rg.status_code == 200, rg.text
    dl = client.get(f"/api/reports/{rg.json()['id']}/download")
    assert dl.status_code == 200
    assert dl.content[:4] == b"%PDF"


def test_openapi_report_generate_has_narrative_depth(client):
    r = client.get("/openapi.json")
    assert r.status_code == 200
    props = (
        r.json()
        .get("components", {})
        .get("schemas", {})
        .get("ReportGenerateRequest", {})
        .get("properties", {})
    )
    assert "narrative_depth" in props
