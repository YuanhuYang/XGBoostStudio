"""
数据泄露检测服务（XGBoost 专属，三类核心泄露场景）

覆盖规格说明书 §1.2.3 全链路数据泄露自动化检测：
  1. 时间穿越泄露检测（特征生成时点晚于标签生成时点）
  2. 标签泄露检测（特征包含标签的未来信息，高度相关）
  3. 特征工程拟合泄露检测（特征工程操作是否仅在训练集 fit）

所有输出：风险等级 / 风险位置 / 根因分析 / 修复方案
"""
from __future__ import annotations

from typing import Any, Optional

import numpy as np
import pandas as pd
from fastapi import HTTPException

from db.models import Dataset, DatasetSplit
from services.dataset_service import _load_df
from sqlalchemy.orm import Session


# ── 时间穿越泄露检测 ──────────────────────────────────────────────────────────

def detect_time_leakage(
    df: pd.DataFrame,
    label_time_col: str,
    feature_time_map: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    """
    检测特征生成时点是否严格早于标签生成时点（时间穿越泄露）。

    Args:
        df: 完整数据集 DataFrame
        label_time_col: 标签生成时点列名（datetime 型）
        feature_time_map: {特征列名: 对应时间戳列名}，若不提供则通过启发式方法搜索可疑列

    Returns:
        风险汇总 dict
    """
    if label_time_col not in df.columns:
        raise HTTPException(status_code=400, detail=f"标签时间列不存在: {label_time_col}")

    risks = []

    # 尝试将标签时间列转为 datetime
    try:
        label_times = pd.to_datetime(df[label_time_col])
    except Exception:
        raise HTTPException(status_code=400, detail=f"标签时间列 {label_time_col} 无法解析为日期时间")

    # 若提供了特征时间映射，逐一检验
    if feature_time_map:
        for feat_col, time_col in feature_time_map.items():
            if time_col not in df.columns:
                continue
            try:
                feat_times = pd.to_datetime(df[time_col])
                leaking_rows = int((feat_times >= label_times).sum())
                leaking_pct = round(leaking_rows / len(df) * 100, 2)
                if leaking_pct > 0:
                    risks.append({
                        "feature": feat_col,
                        "time_column": time_col,
                        "leaking_rows": leaking_rows,
                        "leaking_pct": leaking_pct,
                        "risk_level": "P0-严重" if leaking_pct > 5 else "P1-警告",
                        "root_cause": f"特征 '{feat_col}' 的时间戳列 '{time_col}' 中有 {leaking_pct}% 的记录晚于或等于标签生成时点",
                        "fix": f"过滤或重新计算特征 '{feat_col}'，确保其时间戳严格早于 '{label_time_col}'",
                    })
            except Exception:
                continue
    else:
        # 启发式：搜索所有日期时间类型列
        datetime_cols = [c for c in df.columns if c != label_time_col]
        for col in datetime_cols:
            try:
                col_dt = pd.to_datetime(df[col], errors="coerce")
                if col_dt.isna().mean() > 0.5:
                    continue
                leaking_rows = int((col_dt >= label_times).dropna().sum())
                if leaking_rows == 0:
                    continue
                leaking_pct = round(leaking_rows / len(df) * 100, 2)
                risks.append({
                    "feature": col,
                    "time_column": col,
                    "leaking_rows": leaking_rows,
                    "leaking_pct": leaking_pct,
                    "risk_level": "P0-严重" if leaking_pct > 5 else "P1-警告",
                    "root_cause": f"列 '{col}' 疑似为时间相关列，有 {leaking_pct}% 记录晚于标签时间",
                    "fix": f"核查列 '{col}' 的业务含义，确认是否为特征时间戳，若是则需重新截断",
                })
            except Exception:
                continue

    return {
        "detection_type": "time_leakage",
        "label_time_col": label_time_col,
        "total_rows": int(len(df)),
        "risks_found": len(risks),
        "overall_risk": "P0-严重" if any(r["risk_level"] == "P0-严重" for r in risks) else ("P1-警告" if risks else "通过"),
        "risks": risks,
        "summary": f"检测到 {len(risks)} 个时间穿越风险" if risks else "未检测到时间穿越泄露",
    }


# ── 标签泄露检测 ──────────────────────────────────────────────────────────────

def detect_label_leakage(
    df: pd.DataFrame,
    target_column: str,
    threshold: float = 0.9,
) -> dict[str, Any]:
    """
    检测特征是否包含标签的未来信息（标签泄露）。
    通过高度相关性（|Pearson| 或 |Spearman| > threshold）或完美预测能力识别。

    Args:
        df: 完整数据集 DataFrame
        target_column: 标签列名
        threshold: 相关性阈值，默认 0.9（超过此值视为高度疑似泄露）
    """
    from scipy import stats as sp_stats  # type: ignore

    if target_column not in df.columns:
        raise HTTPException(status_code=400, detail=f"目标列不存在: {target_column}")

    y = df[target_column].dropna()
    feature_cols = [c for c in df.select_dtypes(include=[np.number]).columns if c != target_column]

    risks = []
    checked = []

    for col in feature_cols:
        s = df[col].dropna()
        common_idx = s.index.intersection(y.index)
        s_c, y_c = s.loc[common_idx], y.loc[common_idx]
        if len(s_c) < 10:
            continue

        try:
            pearson_r, pearson_p = sp_stats.pearsonr(s_c, y_c)
            spearman_r, spearman_p = sp_stats.spearmanr(s_c, y_c)
            pearson_r = float(pearson_r)
            spearman_r = float(spearman_r)

            max_corr = max(abs(pearson_r), abs(spearman_r))
            checked.append({"column": col, "pearson_r": round(pearson_r, 4), "spearman_r": round(spearman_r, 4)})

            if max_corr >= threshold:
                risk_level = "P0-严重" if max_corr >= 0.99 else ("P0-高风险" if max_corr >= 0.95 else "P1-警告")
                risks.append({
                    "feature": col,
                    "pearson_r": round(pearson_r, 4),
                    "spearman_r": round(spearman_r, 4),
                    "max_corr": round(max_corr, 4),
                    "risk_level": risk_level,
                    "root_cause": f"特征 '{col}' 与目标变量相关性高达 {max_corr:.4f}（阈值 {threshold}），疑似包含标签信息或由标签衍生",
                    "fix": f"核查特征 '{col}' 的业务含义与生成逻辑，确认是否为标签的变体、衍生列或事后信息",
                })
        except Exception:
            continue

    # 完美预测检测（相同列名或完全重复）
    for col in df.columns:
        if col == target_column:
            continue
        try:
            if df[col].equals(df[target_column]) or (df[col].fillna(-999) == df[target_column].fillna(-999)).all():
                risks.append({
                    "feature": col,
                    "pearson_r": 1.0,
                    "spearman_r": 1.0,
                    "max_corr": 1.0,
                    "risk_level": "P0-严重",
                    "root_cause": f"特征 '{col}' 与目标列完全相同，属于直接标签泄露",
                    "fix": f"立即从特征集中删除 '{col}'",
                })
        except Exception:
            continue

    return {
        "detection_type": "label_leakage",
        "target_column": target_column,
        "threshold": threshold,
        "features_checked": len(checked),
        "risks_found": len(risks),
        "overall_risk": "P0-严重" if any("P0" in r["risk_level"] for r in risks) else ("P1-警告" if risks else "通过"),
        "risks": risks,
        "top_correlations": sorted(checked, key=lambda x: max(abs(x["pearson_r"]), abs(x["spearman_r"])), reverse=True)[:10],
        "summary": f"检测到 {len(risks)} 个标签泄露风险（阈值 {threshold}）" if risks else f"未检测到标签泄露（相关性阈值 {threshold}）",
    }


# ── 特征工程拟合泄露检测 ──────────────────────────────────────────────────────

def detect_fit_leakage(
    pipeline_steps: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    检测特征工程操作是否仅在训练集 fit（拟合泄露检测）。
    通过分析 pipeline_steps 日志中的 fit_on 字段判断是否存在全集拟合。

    Args:
        pipeline_steps: 特征工程操作日志列表，每步包含：
            - step_name: 操作名称
            - operation: 操作类型（encoding/scaling/imputation/selection等）
            - fit_on: "train_only"（合规）/ "full_dataset"（泄露）/ "unknown"
            - apply_on: 应用数据集列表
            - params: 操作参数

    Returns:
        风险汇总 dict
    """
    risks = []
    compliant = []

    for step in pipeline_steps:
        step_name = step.get("step_name", "unknown")
        operation = step.get("operation", "unknown")
        fit_on = step.get("fit_on", "unknown")

        # 仅对拟合型操作（非纯规则操作）检查
        fitting_operations = ["encoding", "scaling", "imputation", "normalization",
                              "standardization", "target_encoding", "binning_fit"]
        if operation not in fitting_operations:
            compliant.append({"step": step_name, "operation": operation, "status": "N/A（无拟合）"})
            continue

        if fit_on == "full_dataset":
            risks.append({
                "step": step_name,
                "operation": operation,
                "fit_on": fit_on,
                "risk_level": "P0-严重",
                "root_cause": f"操作 '{operation}' 在全数据集上 fit（包含验证集/测试集），导致数据窥探",
                "fix": f"修改 '{step_name}'：仅在训练集上调用 fit()，在验证集/测试集上仅调用 transform()",
            })
        elif fit_on == "train_only":
            compliant.append({"step": step_name, "operation": operation, "status": "合规"})
        else:
            risks.append({
                "step": step_name,
                "operation": operation,
                "fit_on": fit_on,
                "risk_level": "P1-警告",
                "root_cause": f"操作 '{operation}' 的 fit 范围未明确记录（fit_on=unknown），无法验证合规性",
                "fix": f"在特征工程代码中显式记录 '{step_name}' 的 fit 范围",
            })

    return {
        "detection_type": "fit_leakage",
        "total_steps": len(pipeline_steps),
        "risks_found": len(risks),
        "compliant_steps": len(compliant),
        "overall_risk": "P0-严重" if any("P0" in r["risk_level"] for r in risks) else ("P1-警告" if risks else "通过"),
        "risks": risks,
        "compliant": compliant,
        "summary": f"检测到 {len(risks)} 个拟合泄露风险" if risks else "所有特征工程操作均合规（仅在训练集 fit）",
    }


# ── 综合泄露检测（API 入口，整合三类检测）────────────────────────────────────

def run_full_leakage_detection(
    dataset: Dataset,
    target_column: str,
    label_time_col: Optional[str] = None,
    feature_time_map: Optional[dict[str, str]] = None,
    pipeline_steps: Optional[list[dict[str, Any]]] = None,
    correlation_threshold: float = 0.9,
) -> dict[str, Any]:
    """
    综合三类泄露检测，返回统一格式的风险报告。
    """
    df = _load_df(dataset)
    results: dict[str, Any] = {
        "dataset_id": dataset.id,
        "dataset_name": dataset.name,
        "target_column": target_column,
        "detections": {},
    }

    # 1. 标签泄露检测（必检）
    results["detections"]["label_leakage"] = detect_label_leakage(
        df, target_column, correlation_threshold
    )

    # 2. 时间穿越泄露检测（需提供时间列）
    if label_time_col:
        results["detections"]["time_leakage"] = detect_time_leakage(
            df, label_time_col, feature_time_map
        )
    else:
        results["detections"]["time_leakage"] = {
            "detection_type": "time_leakage",
            "overall_risk": "未检测（未提供时间列）",
            "summary": "请提供 label_time_col 参数以启用时间穿越检测",
        }

    # 3. 拟合泄露检测（需提供 pipeline 日志）
    if pipeline_steps:
        results["detections"]["fit_leakage"] = detect_fit_leakage(pipeline_steps)
    else:
        results["detections"]["fit_leakage"] = {
            "detection_type": "fit_leakage",
            "overall_risk": "未检测（未提供 pipeline 日志）",
            "summary": "请提供 pipeline_steps 参数以启用拟合泄露检测",
        }

    # 汇总整体风险等级
    all_risks = [v.get("overall_risk", "通过") for v in results["detections"].values()]
    if any("P0" in r for r in all_risks):
        overall = "P0-严重（存在高危泄露风险，禁止上线）"
    elif any("P1" in r for r in all_risks):
        overall = "P1-警告（存在潜在泄露风险，需人工核查）"
    else:
        overall = "通过（未发现明显泄露风险）"

    results["overall_risk"] = overall
    return results
