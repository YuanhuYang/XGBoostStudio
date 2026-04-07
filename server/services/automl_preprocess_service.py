"""
AutoML 前置智能清洗：与数据工作台同一套质量口径，复用 dataset_service 持久化与审计日志。
"""
from __future__ import annotations

import re
from typing import Any

import pandas as pd
from sqlalchemy.orm import Session

from db.models import Dataset
from services.dataset_service import (
    _append_preprocessing_log,
    drop_duplicates,
    get_quality_score,
    handle_missing,
    handle_outliers_by_strategy,
    _load_df,
)

_DTIME_NAME = re.compile(r"(date|time|day|month|year|ts|timestamp|datetime)", re.I)


def plan_and_apply_smart_clean(dataset: Dataset, db: Session) -> dict[str, Any]:
    """
    顺序：去重（重复率 > 1%）→ 按列填缺失（数值 median / 非数值 mode）→ 若异常率仍 > 5% 则 IQR clip。
    写入 preprocessing_log_json；返回 quality 前后对比与步骤摘要。
    """
    quality_before = dict(get_quality_score(dataset))
    steps: list[dict[str, Any]] = []
    warnings: list[str] = []

    dup_r = quality_before.get("duplicate_rate", 0.0)
    if float(dup_r) > 0.01:
        drop_duplicates(dataset, db)
        steps.append({
            "action": "drop_duplicates",
            "applied": True,
            "duplicate_rate_before": dup_r,
        })
    else:
        steps.append({
            "action": "drop_duplicates",
            "applied": False,
            "reason": "duplicate_rate <= 0.01",
        })

    df = _load_df(dataset)
    missing_cfg: dict[str, dict[str, Any]] = {}
    for col in df.columns:
        miss = float(df[col].isnull().mean())
        if miss <= 0:
            continue
        if miss > 0.3:
            warnings.append(f"列「{col}」缺失率 {miss:.1%} 较高，智能清洗采用填充而非删列。")
        if pd.api.types.is_numeric_dtype(df[col]):
            missing_cfg[col] = {"strategy": "median"}
        else:
            missing_cfg[col] = {"strategy": "mode"}

    if missing_cfg:
        handle_missing(dataset, missing_cfg, db)
        steps.append({
            "action": "handle_missing",
            "applied": True,
            "per_column_strategy": {k: v["strategy"] for k, v in missing_cfg.items()},
        })
    else:
        steps.append({"action": "handle_missing", "applied": False, "reason": "无缺失列"})

    quality_mid = dict(get_quality_score(dataset))
    out_r = float(quality_mid.get("outlier_rate", 0.0))
    if out_r > 0.05:
        handle_outliers_by_strategy(dataset, "clip", db)
        steps.append({
            "action": "outliers_iqr_clip",
            "applied": True,
            "outlier_rate_before_clip": out_r,
        })
    else:
        steps.append({
            "action": "outliers_iqr_clip",
            "applied": False,
            "reason": "outlier_rate <= 0.05",
        })

    quality_after = dict(get_quality_score(dataset))

    audit_detail = {
        "quality_before": quality_before,
        "quality_after": quality_after,
        "steps": steps,
        "warnings": warnings,
    }
    _append_preprocessing_log(
        dataset,
        {
            "kind": "automl_smart_clean",
            "summary": "AutoML 智能清洗（去重/填缺失/IQR 截断）策略摘要",
            "detail": audit_detail,
        },
    )
    db.commit()
    db.refresh(dataset)

    return audit_detail


def resolve_split_strategy(
    df: pd.DataFrame,
    split_strategy: str,
    time_column: str | None,
) -> tuple[str, str | None]:
    """
    返回 (split_strategy_for_split_dataset, time_column_or_none)。
    split_strategy: auto | random | time_series
    """
    if split_strategy == "time_series":
        if time_column and time_column in df.columns:
            return "time_series", time_column
        dt_cols = [c for c in df.columns if pd.api.types.is_datetime64_any_dtype(df[c])]
        if len(dt_cols) == 1:
            return "time_series", dt_cols[0]
        return "random", None

    if split_strategy == "random":
        return "random", None

    # auto
    if time_column and time_column in df.columns and pd.api.types.is_datetime64_any_dtype(df[time_column]):
        return "time_series", time_column
    dt_named = [
        c for c in df.columns
        if pd.api.types.is_datetime64_any_dtype(df[c]) and _DTIME_NAME.search(str(c))
    ]
    if len(dt_named) == 1:
        return "time_series", dt_named[0]
    return "random", None
