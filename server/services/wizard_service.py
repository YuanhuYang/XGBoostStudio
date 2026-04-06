"""
智能向导业务逻辑

提供三个功能：
1. dataset_summary  - 分析数据集，返回质量报告、列信息、任务推断
2. quick_config     - 基于划分推荐参数（复用 params_service.recommend_params）
3. run_pipeline_stream - SSE：完整训练 → 评估 → 报告一键流水线
"""
from __future__ import annotations

import json
import uuid
from typing import Any, AsyncGenerator

import pandas as pd
from fastapi import HTTPException
from sqlalchemy.orm import Session

from db.database import DATA_DIR
from db.models import Dataset
from services.params_service import recommend_params as _recommend_params
from services import training_service, eval_service, report_service
from services.dataset_service import _load_df
from services.target_recommend import recommend_target_columns as _recommend_target_columns


# ── 1. 数据集摘要 ──────────────────────────────────────────────────────────────

def dataset_summary(dataset_id: int, db: Session) -> dict[str, Any]:
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="数据集不存在")

    try:
        df = _load_df(dataset)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"无法读取数据集文件: {e}") from e

    n_rows, n_cols = df.shape
    target_col = dataset.target_column

    # 列分析
    columns_info = []
    for col in df.columns:
        col_info: dict[str, Any] = {
            "name": col,
            "dtype": str(df[col].dtype),
            "null_count": int(df[col].isnull().sum()),
            "null_rate": round(float(df[col].isnull().mean()), 4),
            "is_target": col == target_col,
        }
        if pd.api.types.is_numeric_dtype(df[col]):
            col_info["min"] = round(float(df[col].min()), 4) if not df[col].isnull().all() else None
            col_info["max"] = round(float(df[col].max()), 4) if not df[col].isnull().all() else None
            col_info["mean"] = round(float(df[col].mean()), 4) if not df[col].isnull().all() else None
        else:
            col_info["n_unique"] = int(df[col].nunique())
        columns_info.append(col_info)

    # 数据质量评分（0-100）
    total_cells = n_rows * n_cols
    missing_cells = int(df.isnull().sum().sum())
    missing_rate = missing_cells / total_cells if total_cells > 0 else 0
    quality_score = max(0, round(100 - missing_rate * 100 - (1 if n_rows < 100 else 0)))

    # 任务类型推断
    task_type = "unknown"
    task_hint = ""
    if target_col and target_col in df.columns:
        y = df[target_col]
        if y.nunique() <= 20 and y.dtype in ("int64", "int32", object):
            if y.nunique() == 2:
                task_type = "binary_classification"
                task_hint = f"二分类任务（目标列 '{target_col}' 有 {y.nunique()} 个类别）"
            else:
                task_type = "multiclass_classification"
                task_hint = f"多分类任务（目标列 '{target_col}' 有 {y.nunique()} 个类别）"
        else:
            task_type = "regression"
            task_hint = f"回归任务（目标列 '{target_col}' 为连续值）"
    else:
        task_hint = "未设置目标列，请先在数据管理中设置目标列"

    # 自然语言建议
    recommendations: list[str] = []
    if missing_rate > 0.05:
        recommendations.append(f"数据集有 {missing_rate:.1%} 的缺失值，建议在特征工程中进行填充处理")
    if n_rows < 500:
        recommendations.append("数据量较少（< 500行），建议使用较小的模型复杂度（max_depth=3~4）防止过拟合")
    if n_rows >= 10000:
        recommendations.append("数据量充足，可以使用较深的树和更多的迭代次数以获得更高精度")
    if n_cols > 100:
        recommendations.append("特征数量较多，建议开启特征选择或降低 colsample_bytree 以提升训练速度")
    if quality_score >= 90:
        recommendations.append("数据质量良好，可以直接进行模型训练")

    # 目标列候选推荐（词边界匹配 + 基数信号 + softmax 归一化）
    candidate_targets = _recommend_target_columns(df)

    # 特征互信息评分（Top-10，需已设置目标列）
    feature_mi: list[dict[str, Any]] = []
    if target_col and target_col in df.columns and task_type != "unknown":
        try:
            from sklearn.feature_selection import (  # noqa: PLC0415
                mutual_info_classif,
                mutual_info_regression,
            )
            _num_cols = [
                c for c in df.columns
                if c != target_col and pd.api.types.is_numeric_dtype(df[c])
            ]
            if _num_cols:
                _X_mi = df[_num_cols].fillna(0)
                _y_mi = df[target_col]
                if task_type in ("binary_classification", "multiclass_classification"):
                    _mi_scores = mutual_info_classif(_X_mi, _y_mi, random_state=42)
                else:
                    _mi_scores = mutual_info_regression(_X_mi, _y_mi, random_state=42)
                _mi_pairs = sorted(zip(_num_cols, _mi_scores), key=lambda p: -p[1])[:10]
                feature_mi = [{"col": c, "mi": round(float(s), 4)} for c, s in _mi_pairs if s > 0]
        except (ImportError, ValueError):
            pass

    return {
        "dataset_id": dataset_id,
        "name": dataset.name,
        "n_rows": n_rows,
        "n_cols": n_cols,
        "target_column": target_col,
        "task_type": task_type,
        "task_hint": task_hint,
        "quality_score": quality_score,
        "missing_rate": round(missing_rate, 4),
        "columns": columns_info,
        "recommendations": recommendations,
        "candidate_targets": candidate_targets,
        "feature_mi": feature_mi,
    }


# ── 2. AI 预处理建议 ────────────────────────────────────────────────────────────

def preprocess_suggestions(dataset_id: int, db: Session) -> dict[str, Any]:
    """分析数据集，返回结构化的 AI 预处理建议卡片"""
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="数据集不存在")

    try:
        df = _load_df(dataset)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"无法读取数据集文件: {e}") from e

    suggestions: list[dict[str, Any]] = []
    target_col = dataset.target_column

    # 1. 缺失值检测（按列）
    for col in df.columns:
        miss_rate = float(df[col].isnull().mean())
        if miss_rate > 0.05:
            severity = "error" if miss_rate > 0.3 else "warning"
            action = "均值填充" if pd.api.types.is_numeric_dtype(df[col]) else "众数填充"
            suggestions.append({
                "type": "missing_values",
                "severity": severity,
                "title": f"列「{col}」存在缺失值",
                "description": f"缺失率 {miss_rate:.1%}（{int(df[col].isnull().sum())}/{len(df)} 行）",
                "action": action,
                "expected_improvement": "填充后模型可充分利用该列信息，减少样本丢失",
                "potential_risk": "均值填充可能引入偏差，缺失率 > 30% 时效果有限",
                "learn_why": (
                    "缺失值（Missing Values）是数据中未被记录的观测。"
                    "XGBoost 虽原生支持稀疏特征，但提前填充通常能提升模型稳定性。"
                    "统计学上，缺失机制分为 MCAR（完全随机缺失）、MAR（随机缺失）和 MNAR（非随机缺失），"
                    "不同机制需要不同处理策略。"
                ),
            })

    # 2. 重复行检测
    dup_count = int(df.duplicated().sum())
    if dup_count > 0:
        suggestions.append({
            "type": "duplicates",
            "severity": "info" if dup_count / len(df) < 0.05 else "warning",
            "title": f"检测到 {dup_count} 条重复行",
            "description": f"重复行占总数据 {dup_count / len(df):.1%}",
            "action": "删除重复行",
            "expected_improvement": "去重后可避免模型对特定样本的过度拟合",
            "potential_risk": "若重复行代表真实高频事件（如订单记录），删除可能丢失有效信息",
            "learn_why": (
                "重复样本会使模型对某些数据点的权重偏高。"
                "在树模型中，每次子采样都更可能选到重复样本，导致过拟合。"
                "建议先查看重复明细再决定是否删除。"
            ),
        })

    # 3. 类别不平衡检测
    if target_col and target_col in df.columns:
        y = df[target_col]
        if 2 <= y.nunique() <= 20:
            counts = y.value_counts()
            imb_ratio = float(counts.iloc[0] / counts.iloc[-1])
            if imb_ratio > 3:
                spw = round(float(counts.iloc[-1] / counts.iloc[0]), 2)
                suggestions.append({
                    "type": "class_imbalance",
                    "severity": "warning",
                    "title": "检测到类别不平衡",
                    "description": f"最多类/最少类样本比 = {imb_ratio:.1f}:1，少数类仅 {int(counts.iloc[-1])} 个",
                    "action": f"设置 scale_pos_weight = {spw}",
                    "expected_improvement": "自动调整类别权重，提升模型对少数类的识别能力（召回率）",
                    "potential_risk": "权重设置过大可能导致对少数类过度拟合，建议结合交叉验证",
                    "learn_why": (
                        "XGBoost 的 scale_pos_weight 参数用于处理类别不平衡，"
                        "最优值通常设为「多数类样本数 / 少数类样本数」。"
                        "不处理时，模型倾向于预测多数类，导致少数类召回率偏低。"
                    ),
                })

    # 4. 高基数类别特征
    for col in df.columns:
        if col == target_col:
            continue
        if not pd.api.types.is_numeric_dtype(df[col]):
            n_unique = int(df[col].nunique())
            if n_unique > 50:
                suggestions.append({
                    "type": "high_cardinality",
                    "severity": "info",
                    "title": f"列「{col}」有 {n_unique} 个唯一值（高基数）",
                    "description": "直接 One-Hot 编码会大幅增加特征维度",
                    "action": "建议使用频率编码或 Label 编码",
                    "expected_improvement": "减少特征维度、降低内存占用、提升训练速度",
                    "potential_risk": "频率编码会丢失类别的语义顺序关系",
                    "learn_why": (
                        "高基数类别特征若使用 One-Hot 编码会产生大量稀疏列，增加树分裂计算量。"
                        "对于 XGBoost，Label 编码通常更好，树模型可自主学习类别分界点。"
                    ),
                })

    has_blockers = any(s["severity"] in ("warning", "error") for s in suggestions)
    return {
        "dataset_id": dataset_id,
        "suggestions": suggestions,
        "skip_allowed": not has_blockers,
    }


# ── 3. 快速参数推荐 ────────────────────────────────────────────────────────────

def quick_config(split_id: int, db: Session) -> dict[str, Any]:
    """复用 params_service 的推荐逻辑，增加向导友好字段"""
    result = _recommend_params(split_id, db)

    # 构建用于展示的简要说明
    summary_lines: list[str] = []
    params = result.get("params", {})
    if "n_estimators" in params:
        summary_lines.append(f"训练 {params['n_estimators']} 棵树")
    if "max_depth" in params:
        summary_lines.append(f"树深度 {params['max_depth']}")
    if "learning_rate" in params:
        summary_lines.append(f"学习率 {params['learning_rate']}")
    if "scale_pos_weight" in params:
        summary_lines.append(f"已自动处理类不平衡（权重比 {params['scale_pos_weight']}）")

    result["summary"] = "，".join(summary_lines) + "。"
    result["split_id"] = split_id
    return result


# ── 3. 一键流水线 SSE ─────────────────────────────────────────────────────────

async def run_pipeline_stream(
    split_id: int,
    params: dict[str, Any],
    db: Session,
    report_title: str = "智能向导自动生成报告",
) -> AsyncGenerator[str, None]:
    """
    SSE 产生进度事件，格式：data: <json>\n\n
    事件类型（type 字段）：
      progress  - 百分比进度
      log       - 自然语言日志
      done      - 完成，携带 model_id / report_id / summary
      error     - 错误
    """

    def _emit(event_type: str, payload: dict[str, Any]) -> str:
        return f"data: {json.dumps({'type': event_type, **payload}, ensure_ascii=False)}\n\n"

    try:
        # Step 1: 创建训练任务
        yield _emit("log", {"message": "正在准备训练任务…"})
        yield _emit("progress", {"percent": 5})

        task_id = training_service.create_task(
            split_id=split_id,
            params=params,
            db=db,
            model_name=f"wizard_{uuid.uuid4().hex[:6]}",
        )

        # Step 2: 流式训练
        yield _emit("log", {"message": "开始训练 XGBoost 模型，请稍候…"})

        model_id: int | None = None
        async for chunk in training_service.training_stream(task_id, db):
            # 解析 SSE chunk（training_service 直接 yield "data: {...}\n\n"）
            if not chunk.startswith("data: "):
                continue  # 跳过 "event: done\ndata: {}\n\n" 等非数据行
            try:
                inner = json.loads(chunk[6:])
            except json.JSONDecodeError:
                continue

            if inner.get("completed"):
                # 训练成功完成
                model_id = inner.get("model_id")
                yield _emit("log", {"message": "✅ 模型训练完成！"})
                yield _emit("progress", {"percent": 72})
            elif inner.get("round") is not None:
                # 逐步训练进度：{"round": 20, "total": 100, "val_logloss": 0.45}
                r: int = inner["round"]
                t: int = inner.get("total", 1) or 1
                mapped = 10 + int((r / t) * 60)
                val_logloss = inner.get("val_logloss")
                val_rmse = inner.get("val_rmse")
                if val_logloss is not None:
                    nl_msg = f"已完成第 {r}/{t} 轮，验证集 logloss = {val_logloss:.4f}"
                elif val_rmse is not None:
                    nl_msg = f"已完成第 {r}/{t} 轮，验证集 RMSE = {val_rmse:.4f}"
                else:
                    nl_msg = f"已完成第 {r}/{t} 轮"
                yield _emit("progress", {"percent": mapped})
                # 每 20% 里程碑输出一条自然语言日志
                step = max(1, t // 5)
                if r % step == 0 or r >= t:
                    yield _emit("log", {"message": nl_msg})
            elif inner.get("stopped"):
                yield _emit("error", {"message": "训练已被用户停止"})
                return
            elif inner.get("error"):
                yield _emit("error", {"message": str(inner["error"])})
                return

        if model_id is None:
            yield _emit("error", {"message": "模型训练失败，未能获取模型 ID"})
            return

        # Step 3: 生成评估（同步）
        yield _emit("log", {"message": "正在计算模型评估指标…"})
        yield _emit("progress", {"percent": 80})

        try:
            eval_result = eval_service.get_evaluation(model_id, db)
        except (HTTPException, ValueError, KeyError) as e:
            eval_result = {}
            yield _emit("log", {"message": f"评估计算遇到问题（已跳过）: {e}"})

        yield _emit("progress", {"percent": 88})

        # Step 4: 生成报告
        yield _emit("log", {"message": "正在撰写分析报告…"})
        try:
            report_dict = report_service.generate_report(
                model_id=model_id,
                title=report_title,
                notes="由智能向导自动生成",
                db=db,
            )
            report_id = report_dict["id"]
            yield _emit("log", {"message": "✅ 报告生成完成！"})
        except (HTTPException, OSError, ValueError) as e:
            report_id = None
            yield _emit("log", {"message": f"报告生成遇到问题（已跳过）: {e}"})

        yield _emit("progress", {"percent": 100})

        # 构建自然语言摘要（含 AUC 评级 + 基线对比）
        metrics = eval_result.get("metrics", {}) if eval_result else {}
        metric_lines: list[str] = []
        auc_val: float | None = metrics.get("auc")
        level = ""
        baseline_note = ""

        if auc_val is not None:
            metric_lines.append(f"AUC {auc_val:.3f}")
            if auc_val >= 0.9:
                level = "优秀"
            elif auc_val >= 0.8:
                level = "良好"
            elif auc_val >= 0.7:
                level = "尚可"
            else:
                level = "待提升"
            baseline_note = "（参考：随机猜测 = 0.50）"
        if "accuracy" in metrics:
            metric_lines.append(f"准确率 {metrics['accuracy']:.3f}")
        if "f1" in metrics:
            metric_lines.append(f"F1 {metrics['f1']:.3f}")
        if "rmse" in metrics:
            metric_lines.append(f"RMSE {metrics['rmse']:.4f}")
        if "r2" in metrics:
            r2_val = metrics["r2"]
            metric_lines.append(f"R² {r2_val:.3f}")
            if not level:
                level = "优秀" if r2_val >= 0.9 else ("良好" if r2_val >= 0.7 else ("尚可" if r2_val >= 0.5 else "待提升"))

        level_str = f"（{level}水平）" if level else ""
        natural_summary = (
            "🎉 恭喜！您的模型训练成功。"
            + (f"主要指标：{', '.join(metric_lines)}{level_str}{baseline_note}。" if metric_lines else "")
            + ("已自动生成完整分析报告，您可前往报告页面查看。" if report_id else "")
        )

        yield _emit("done", {
            "model_id": model_id,
            "report_id": report_id,
            "metrics": metrics,
            "natural_summary": natural_summary,
        })

    except HTTPException as e:
        yield _emit("error", {"message": e.detail})
    except (OSError, ValueError) as e:
        yield _emit("error", {"message": f"流水线执行出错: {str(e)}"})


# ── 4. 参数对比实验 SSE ────────────────────────────────────────────────────────

async def run_lab_stream(
    split_id: int,
    params: dict[str, Any],
    db: Session,
) -> AsyncGenerator[str, None]:
    """
    简化版训练流（用于参数对比实验）：只做训练，不生成评估报告。
    SSE 事件：
      round  - 每轮进度 {round, total, val_loss}
      done   - 完成    {model_id, metrics}
      error  - 错误    {message}
    """

    def _emit(event_type: str, payload: dict[str, Any]) -> str:
        return f"data: {json.dumps({'type': event_type, **payload}, ensure_ascii=False)}\n\n"

    try:
        task_id = training_service.create_task(
            split_id=split_id,
            params=params,
            db=db,
            model_name=f"lab_{uuid.uuid4().hex[:6]}",
        )

        model_id: int | None = None
        async for chunk in training_service.training_stream(task_id, db):
            if not chunk.startswith("data: "):
                continue
            try:
                inner = json.loads(chunk[6:])
            except json.JSONDecodeError:
                continue

            if inner.get("completed"):
                model_id = inner.get("model_id")
            elif inner.get("round") is not None:
                r: int = inner["round"]
                t: int = inner.get("total", 1) or 1
                val_loss = inner.get("val_logloss") or inner.get("val_rmse") or 0.0
                yield _emit("round", {"round": r, "total": t, "val_loss": round(float(val_loss), 6)})
            elif inner.get("stopped"):
                yield _emit("error", {"message": "训练已停止"})
                return
            elif inner.get("error"):
                yield _emit("error", {"message": str(inner["error"])})
                return

        if model_id is None:
            yield _emit("error", {"message": "训练失败，未获取到模型 ID"})
            return

        try:
            eval_result = eval_service.get_evaluation(model_id, db)
            metrics = eval_result.get("metrics", {})
        except (HTTPException, ValueError, KeyError):
            metrics = {}

        yield _emit("done", {"model_id": model_id, "metrics": metrics})

    except HTTPException as e:
        yield _emit("error", {"message": e.detail})
    except (OSError, ValueError) as e:
        yield _emit("error", {"message": f"实验训练出错: {str(e)}"})
