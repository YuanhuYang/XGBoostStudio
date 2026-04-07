"""
全自动建模编排：目标推断、划分、多候选训练与排序（预算内启发式，非全局最优保证）。
"""
from __future__ import annotations

import uuid
from typing import Any, Callable

from sqlalchemy.orm import Session

from db.models import Dataset
from services import automl_preprocess_service
from services.dataset_service import _load_df, split_dataset as do_split
from services.params_service import recommend_params
from services.training_service import train_and_persist_sync, _detect_task_type
from services.tuning_service import run_lite_tuning_best_params
from services import wizard_service

EmitFn = Callable[[dict[str, Any]], None]


def _resolve_target_column(dataset: Dataset, df, summary: dict[str, Any], override: str | None) -> tuple[str, list[str]]:
    warnings: list[str] = []
    if override and override in df.columns:
        return override, warnings
    if override and override not in df.columns:
        warnings.append(f"指定的目标列不存在，已忽略: {override}")
    cands = summary.get("candidate_targets") or []
    if cands:
        col = str(cands[0]["col"])
        if col in df.columns:
            warnings.append(f"目标列由启发式推荐选中: {col}（置信度 {cands[0].get('confidence', '?')}）")
            return col, warnings
    if dataset.target_column and dataset.target_column in df.columns:
        return dataset.target_column, warnings
    last = df.columns[-1]
    warnings.append(f"回退使用最后一列作为目标: {last}")
    return str(last), warnings


def _rank_score(metrics: dict[str, Any], task_type: str) -> float:
    """越大越优（回归用负 RMSE 对齐方向）。"""
    if task_type == "classification":
        base = float(metrics.get("auc") or metrics.get("accuracy") or 0.0)
    else:
        rmse = float(metrics.get("rmse") or 1e9)
        base = -rmse
    lvl = metrics.get("overfitting_level") or "low"
    if lvl == "high":
        base -= 0.12 if task_type == "classification" else 0.2
    elif lvl == "medium":
        base -= 0.04 if task_type == "classification" else 0.08
    return float(base)


def run_automl_job(
    *,
    dataset_id: int,
    db: Session,
    emit: EmitFn,
    target_column: str | None = None,
    train_ratio: float = 0.8,
    random_seed: int = 42,
    max_tuning_trials: int = 12,
    skip_tuning: bool = False,
    smart_clean: bool = True,
    split_strategy: str = "auto",
    time_column: str | None = None,
) -> dict[str, Any]:
    """
    同步执行 AutoML 全流程，通过 emit 推送事件 dict（由路由层转为 SSE）。
    返回 result 字典（含 candidates、chosen_recommendation、warnings）。
    """
    warnings: list[str] = []
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise ValueError("数据集不存在")

    smart_clean_audit: dict[str, Any] | None = None
    if smart_clean:
        emit({"step": "smart_clean", "message": "智能清洗（去重 / 填缺失 / IQR 截断）…"})
        smart_clean_audit = automl_preprocess_service.plan_and_apply_smart_clean(dataset, db)
        warnings.extend(smart_clean_audit.get("warnings") or [])
        emit({
            "step": "smart_clean_done",
            "message": "智能清洗完成",
            "quality_after": smart_clean_audit.get("quality_after"),
        })
    else:
        emit({"step": "smart_clean_skip", "message": "已跳过智能清洗"})

    emit({"step": "summary", "message": "分析数据集与目标列候选…"})
    summary = wizard_service.dataset_summary(dataset_id, db)
    df = _load_df(dataset)
    target_col, w = _resolve_target_column(dataset, df, summary, target_column)
    warnings.extend(w)

    dataset.target_column = target_col
    db.commit()
    emit({"step": "target", "message": f"目标列: {target_col}", "target_column": target_col})

    stratify = _detect_task_type(df[target_col]) == "classification"
    resolved_split, resolved_time_col = automl_preprocess_service.resolve_split_strategy(
        df, split_strategy, time_column,
    )
    if split_strategy == "time_series" and resolved_split != "time_series":
        warnings.append("请求时间序列划分但未找到可用时间列，已回退为随机划分。")

    split_msg = (
        f"划分训练/测试集（策略={resolved_split}"
        f"{f', time_column={resolved_time_col}' if resolved_time_col else ''}"
        f", stratify={stratify}）…"
    )
    emit({"step": "split", "message": split_msg})
    split = do_split(
        dataset,
        train_ratio=train_ratio,
        random_seed=random_seed,
        stratify=stratify,
        target_column=target_col,
        db=db,
        split_strategy=resolved_split,
        time_column=resolved_time_col,
    )
    split_id = split.id
    emit({"step": "split_done", "split_id": split_id, "train_rows": split.train_rows, "test_rows": split.test_rows})

    emit({"step": "recommend", "message": "规则推荐基线超参数…"})
    rec = recommend_params(split_id, db)
    base_params = dict(rec.get("params") or {})
    if not base_params:
        raise ValueError(rec.get("note") or "无法生成推荐参数")

    candidates: list[dict[str, Any]] = []

    emit({"step": "train", "message": "训练候选 A：规则基线…"})
    r_a = train_and_persist_sync(split_id, base_params, db, model_name="AutoML 规则基线")
    candidates.append({
        "model_id": r_a["model_id"],
        "name": "AutoML 规则基线",
        "metrics": r_a["metrics"],
        "task_type": r_a["task_type"],
        "rationale": "基于数据规模与任务类型的默认推荐参数。",
    })
    emit({"step": "train_done", "candidate": "A", "model_id": r_a["model_id"]})

    cons = {**base_params}
    md = int(cons.get("max_depth", 6))
    cons["max_depth"] = max(3, md - 2)
    cons["reg_lambda"] = float(cons.get("reg_lambda", 1.0)) * 2.0
    cons["reg_alpha"] = max(float(cons.get("reg_alpha", 0.0)), 0.05)
    cons["subsample"] = min(float(cons.get("subsample", 0.8)), 0.85)

    emit({"step": "train", "message": "训练候选 B：保守正则（缓解过拟合）…"})
    r_b = train_and_persist_sync(split_id, cons, db, model_name="AutoML 保守正则")
    candidates.append({
        "model_id": r_b["model_id"],
        "name": "AutoML 保守正则",
        "metrics": r_b["metrics"],
        "task_type": r_b["task_type"],
        "rationale": "更浅树、更强 L1/L2 与略低行采样，适合训练指标明显高于验证时。",
    })
    emit({"step": "train_done", "candidate": "B", "model_id": r_b["model_id"]})

    task_type = r_a["task_type"]
    if not skip_tuning and max_tuning_trials > 0:
        emit({"step": "tune", "message": f"轻量超参搜索（最多 {max_tuning_trials} 次试验）…"})
        lite = run_lite_tuning_best_params(split_id, db, max_tuning_trials)
        if lite and lite.get("params"):
            emit({"step": "tune_done", "best_score": lite.get("best_score"), "n_completed": lite.get("n_completed")})
            emit({"step": "train", "message": "训练候选 C：轻量调优结果…"})
            r_c = train_and_persist_sync(split_id, lite["params"], db, model_name="AutoML 轻量调优")
            candidates.append({
                "model_id": r_c["model_id"],
                "name": "AutoML 轻量调优",
                "metrics": r_c["metrics"],
                "task_type": r_c["task_type"],
                "rationale": (
                    f"预算内 Optuna 搜索（{lite.get('n_completed', '?')}/{lite.get('n_trials', '?')} 次有效试验）。"
                ),
            })
            emit({"step": "train_done", "candidate": "C", "model_id": r_c["model_id"]})
        else:
            warnings.append("轻量调优未产生有效试验，已跳过候选 C。")
            emit({"step": "tune_skip", "message": "调优无有效结果，跳过候选 C"})
    else:
        emit({"step": "tune_skip", "message": "已跳过调优（快速模式）"})
        warnings.append("已启用快速模式：未运行轻量调优。")

    for c in candidates:
        c["overfitting_level"] = (c.get("metrics") or {}).get("overfitting_level")
        c["score_for_rank"] = round(_rank_score(c.get("metrics") or {}, task_type), 6)

    candidates.sort(key=lambda x: x["score_for_rank"], reverse=True)
    best = candidates[0]
    chosen = {
        "model_id": best["model_id"],
        "name": best["name"],
        "reason": (
            f"按验证集主指标与过拟合惩罚排序得分最高（score_for_rank={best['score_for_rank']}）。"
            " 此为启发式推荐，非全局最优保证。"
        ),
    }

    emit({"step": "rank", "message": "候选排序完成", "chosen_model_id": chosen["model_id"]})

    pipeline_plan: dict[str, Any] = {
        "smart_clean": smart_clean_audit if smart_clean else {"applied": False, "skipped": True},
        "split": {
            "requested": split_strategy,
            "resolved": resolved_split,
            "time_column": resolved_time_col,
            "train_ratio": train_ratio,
            "random_seed": random_seed,
            "stratify": stratify,
        },
        "tuning": {
            "skip_tuning": skip_tuning,
            "max_tuning_trials": max_tuning_trials,
        },
    }

    result = {
        "dataset_id": dataset_id,
        "target_column": target_col,
        "split_id": split_id,
        "task_type": task_type,
        "candidates": candidates,
        "chosen_recommendation": chosen,
        "warnings": warnings,
        "param_notes": rec.get("notes"),
        "pipeline_plan": pipeline_plan,
    }
    emit({"step": "completed", "result_summary": {"n_candidates": len(candidates), "chosen_model_id": chosen["model_id"]}})
    return result


def new_job_id() -> str:
    return uuid.uuid4().hex
