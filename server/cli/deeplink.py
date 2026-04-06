"""前端专家工作台深链 query 构建（run / urls 共用，便于单测）。"""


def build_expert_workbench_query(
    *,
    dataset_id: int,
    split_id: int | None,
    model_ids: list[int],
    primary_model_id: int | None,
) -> str:
    """生成以 ? 开头的 query 串：xsMode=expert、xsPage=expert-hub、modelIds、primaryModelId、兼容 modelId。"""
    seen: set[int] = set()
    ordered: list[int] = []
    for mid in model_ids:
        if mid not in seen:
            seen.add(mid)
            ordered.append(mid)
    pm_int: int | None = None
    if primary_model_id is not None:
        pm_int = int(primary_model_id)
        if pm_int not in seen:
            ordered.insert(0, pm_int)
            seen.add(pm_int)
    q = f"?datasetId={int(dataset_id)}&xsMode=expert&xsPage=expert-hub"
    if split_id is not None:
        q += f"&splitId={int(split_id)}"
    if ordered:
        q += "&modelIds=" + ",".join(str(x) for x in ordered)
    primary_for_param = pm_int if pm_int is not None else (ordered[0] if ordered else None)
    if primary_for_param is not None:
        q += f"&primaryModelId={primary_for_param}"
        q += f"&modelId={primary_for_param}"
    return q
