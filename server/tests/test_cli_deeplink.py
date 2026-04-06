"""cli.deeplink 专家工作台 query 构建。"""

from __future__ import annotations

from cli.deeplink import build_expert_workbench_query


def test_build_expert_workbench_query_full() -> None:
    q = build_expert_workbench_query(
        dataset_id=1,
        split_id=2,
        model_ids=[10, 20],
        primary_model_id=20,
    )
    assert q.startswith("?")
    assert "datasetId=1" in q
    assert "splitId=2" in q
    assert "xsMode=expert" in q
    assert "xsPage=expert-hub" in q
    assert "modelIds=10,20" in q
    assert "primaryModelId=20" in q
    assert "modelId=20" in q


def test_build_expert_workbench_query_inserts_primary_when_missing_from_list() -> None:
    q = build_expert_workbench_query(
        dataset_id=5,
        split_id=None,
        model_ids=[3, 4],
        primary_model_id=99,
    )
    assert "modelIds=99,3,4" in q
    assert "primaryModelId=99" in q
