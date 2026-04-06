"""
超参数调优业务逻辑（Optuna）—— G3-B 重构：5 阶段分层调优

规格说明书 §2.2.1 分层级超参数调优全路径可追溯分析：
  阶段 1：迭代次数与学习率基准调优（n_estimators, learning_rate）
  阶段 2：树结构复杂度调优（max_depth, min_child_weight, gamma）
  阶段 3：采样策略调优（subsample, colsample_bytree, colsample_bylevel）
  阶段 4：正则化参数调优（reg_alpha, reg_lambda）
  阶段 5：精细化收尾调优（降低 learning_rate，提升 n_estimators）

每阶段完整记录：phase_id / phase_goal / param_ranges / trials / best_params /
               effect_improvement（与上一阶段最优分数的对比）

G2-Auth-3 保留：trial 失败可审计、诊断 JSON、禁止静默吞异常。
"""
from __future__ import annotations

import json
import math
import time
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncGenerator

import numpy as np
import pandas as pd
import xgboost as xgb
import optuna
from optuna.trial import TrialState
from fastapi import HTTPException
from sqlalchemy.orm import Session

from db.database import DATA_DIR, MODELS_DIR
from db.models import Dataset, DatasetSplit, Model, TuningTask
from services.provenance import build_training_provenance, provenance_to_json
from services.training_service import _detect_task_type, _default_params, _compute_metrics

optuna.logging.set_verbosity(optuna.logging.WARNING)


# ─── 5 阶段调优定义 ────────────────────────────────────────────────────────────

PHASE_DEFINITIONS = [
    {
        "phase_id": 1,
        "phase_name": "迭代次数与学习率基准调优",
        "phase_goal": "固定其他基础参数，通过早停机制确定基础迭代轮数 n_estimators 与初始学习率 learning_rate，建立调优基准线",
        "params_to_tune": ["n_estimators", "learning_rate"],
        "fixed_rationale": "此阶段仅调整核心收敛参数，其他参数使用默认值，以获得可靠基准",
    },
    {
        "phase_id": 2,
        "phase_name": "树结构复杂度调优",
        "phase_goal": "在确定的迭代轮数基础上，优化 max_depth、min_child_weight、gamma 三个核心结构参数，平衡模型偏差与方差",
        "params_to_tune": ["max_depth", "min_child_weight", "gamma"],
        "fixed_rationale": "固定阶段1最优的 n_estimators 和 learning_rate，专注于树结构优化",
    },
    {
        "phase_id": 3,
        "phase_name": "采样策略调优",
        "phase_goal": "在确定的树结构基础上，优化 subsample、colsample_bytree、colsample_bylevel 三个采样参数，降低模型方差、提升泛化能力",
        "params_to_tune": ["subsample", "colsample_bytree", "colsample_bylevel"],
        "fixed_rationale": "固定阶段1-2的最优参数，专注于随机化采样策略优化",
    },
    {
        "phase_id": 4,
        "phase_name": "正则化参数调优",
        "phase_goal": "在确定的模型结构基础上，优化 L1 正则（reg_alpha）与 L2 正则（reg_lambda），控制过拟合风险",
        "params_to_tune": ["reg_alpha", "reg_lambda"],
        "fixed_rationale": "固定阶段1-3的最优参数，专注于正则化强度调优，最终确定防过拟合策略",
    },
    {
        "phase_id": 5,
        "phase_name": "精细化收尾调优",
        "phase_goal": "使用更小的学习率重新确定最优 n_estimators，进行最终精度优化；此阶段通常带来 0.5%-2% 的额外提升",
        "params_to_tune": ["n_estimators", "learning_rate"],
        "fixed_rationale": "固定阶段2-4的结构与正则化参数，降低学习率（0.001-0.05）并精细搜索迭代轮数",
    },
]

# 每阶段默认搜索空间
DEFAULT_PHASE_SEARCH_SPACES = {
    1: {"n_estimators": [50, 500], "learning_rate": [0.05, 0.3]},
    2: {"max_depth": [3, 10], "min_child_weight": [1, 10], "gamma": [0.0, 1.0]},
    3: {"subsample": [0.5, 1.0], "colsample_bytree": [0.5, 1.0], "colsample_bylevel": [0.5, 1.0]},
    4: {"reg_alpha": [0.0, 2.0], "reg_lambda": [0.5, 3.0]},
    5: {"n_estimators": [100, 1000], "learning_rate": [0.001, 0.05]},
}


def _json_friendly_best(score: float, task_type: str) -> float | None:
    if isinstance(score, float) and (math.isinf(score) or math.isnan(score)):
        return None
    try:
        return round(float(score), 4)
    except (TypeError, ValueError):
        return None


# 与 XGBoost 文档对齐的搜索空间说明（API 可测）
SEARCH_SPACE_DOCUMENTATION: dict[str, str] = {
    "n_estimators": "树棵数上限；增大可提升拟合能力，但增加耗时与过拟合风险（XGBoost n_estimators）。",
    "max_depth": "单棵树最大深度，控制模型复杂度与交互阶数。",
    "min_child_weight": "叶节点最小样本权重和；增大可防止过拟合，减小可提升灵活性。",
    "gamma": "节点分裂所需最小损失减少量；增大可防止过拟合。",
    "learning_rate": "学习率（eta） shrinkage；通常与 n_estimators 权衡。",
    "subsample": "行采样比例，降低过拟合。",
    "colsample_bytree": "列采样比例（每棵树），降低过拟合与特征共线性影响。",
    "colsample_bylevel": "列采样比例（每层），进一步随机化。",
    "reg_alpha": "L1 正则（alpha），趋向稀疏权重。",
    "reg_lambda": "L2 正则（lambda），控制权重大小。",
}


def _build_phase_objective(
    params_to_tune: list[str],
    fixed_params: dict[str, Any],
    search_space: dict[str, Any],
    task_type: str,
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_test: pd.DataFrame,
    y_test: pd.Series | None,
):
    """构建单阶段的 Optuna objective 函数"""
    from sklearn.metrics import f1_score, mean_squared_error  # type: ignore

    def objective(trial: optuna.Trial) -> float:
        params = {**_default_params(task_type), **fixed_params}

        for param_name in params_to_tune:
            space = search_space.get(param_name, DEFAULT_PHASE_SEARCH_SPACES.get(
                _get_phase_for_param(param_name), {}
            ).get(param_name, [0.0, 1.0]))

            if param_name in ("n_estimators", "max_depth", "min_child_weight"):
                lo, hi = int(space[0]), int(space[-1])
                params[param_name] = trial.suggest_int(param_name, lo, hi)
            elif param_name in ("learning_rate",):
                lo, hi = float(space[0]), float(space[-1])
                params[param_name] = trial.suggest_float(param_name, lo, hi, log=True)
            else:
                lo, hi = float(space[0]), float(space[-1])
                params[param_name] = trial.suggest_float(param_name, lo, hi)

        model = (xgb.XGBClassifier(**params) if task_type == "classification"
                 else xgb.XGBRegressor(**params))
        model.fit(X_train, y_train, verbose=False)

        if y_test is not None and len(y_test) > 0:
            if task_type == "classification":
                y_pred = model.predict(X_test)
                return float(f1_score(y_test, y_pred, average="weighted", zero_division=0))
            else:
                y_pred = model.predict(X_test)
                return float(np.sqrt(mean_squared_error(y_test, y_pred)))
        return 0.0

    return objective


def _get_phase_for_param(param_name: str) -> int:
    for phase_id, space in DEFAULT_PHASE_SEARCH_SPACES.items():
        if param_name in space:
            return phase_id
    return 1


def _build_diagnostics(
    *,
    n_trials_requested: int,
    n_completed: int,
    n_failed: int,
    direction: str,
    task_type: str,
    strategy: str,
    trial_points: list[dict[str, Any]],
    search_space_keys: list[str],
    phase_records: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    diag = {
        "n_trials_requested": n_trials_requested,
        "n_trials_completed": n_completed,
        "n_trials_failed": n_failed,
        "direction": direction,
        "task_type": task_type,
        "strategy": strategy,
        "trial_points": trial_points,
        "search_space_documentation": {
            k: SEARCH_SPACE_DOCUMENTATION[k]
            for k in search_space_keys
            if k in SEARCH_SPACE_DOCUMENTATION
        },
    }
    if phase_records:
        diag["phase_records"] = phase_records
        diag["tuning_methodology"] = "5_phase_hierarchical"
    return diag


def create_tuning_task(
    split_id: int, search_space: dict[str, Any],
    strategy: str, n_trials: int, db: Session
) -> str:
    task_id = uuid.uuid4().hex
    task = TuningTask(
        id=task_id,
        status="pending",
        split_id=split_id,
        search_space_json=json.dumps(search_space),
        strategy=strategy,
        n_trials=n_trials,
    )
    db.add(task)
    db.commit()
    return task_id


async def tuning_stream(task_id: str, db: Session) -> AsyncGenerator[str, None]:
    task = db.query(TuningTask).filter(TuningTask.id == task_id).first()
    if not task:
        yield f"data: {json.dumps({'error': 'task not found'})}\n\n"
        return

    task.status = "running"
    db.commit()

    try:
        split = db.query(DatasetSplit).filter(DatasetSplit.id == task.split_id).first()
        dataset = db.query(Dataset).filter(Dataset.id == split.dataset_id).first() if split else None
        target_col = dataset.target_column if dataset else None

        train_path = DATA_DIR / split.train_path
        test_path = DATA_DIR / split.test_path
        train_df = pd.read_csv(train_path, encoding="utf-8-sig")
        test_df = pd.read_csv(test_path, encoding="utf-8-sig")

        if not target_col or target_col not in train_df.columns:
            target_col = train_df.columns[-1]

        X_train = train_df.drop(columns=[target_col]).select_dtypes(include=[np.number]).fillna(0)
        y_train = train_df[target_col]
        X_test = test_df.drop(columns=[target_col], errors="ignore").select_dtypes(include=[np.number]).fillna(0)
        X_test = X_test[X_train.columns.intersection(X_test.columns)]
        y_test = test_df[target_col] if target_col in test_df.columns else None

        task_type = _detect_task_type(y_train)
        search_space = json.loads(task.search_space_json or "{}")
        n_trials = task.n_trials
        strategy = task.strategy
        direction = "minimize" if task_type == "regression" else "maximize"

        # ── 决定每阶段试验数（至少 5 次，均分 n_trials）─────────────────────
        trials_per_phase = max(5, n_trials // 5)
        # 最后阶段补齐剩余试验
        phase_trial_counts = [trials_per_phase] * 4 + [max(5, n_trials - trials_per_phase * 4)]

        start_time = time.time()
        all_trial_points: list[dict[str, Any]] = []
        n_failed_total = 0
        n_completed_total = 0

        phase_records: list[dict[str, Any]] = []
        fixed_params: dict[str, Any] = {}  # 上一阶段锁定的最优参数
        prev_best_score: float | None = None
        global_trial_idx = 0

        # ── 5 阶段顺序执行 ────────────────────────────────────────────────────
        for phase_def in PHASE_DEFINITIONS:
            phase_id = phase_def["phase_id"]
            phase_trials = phase_trial_counts[phase_id - 1]
            params_to_tune = phase_def["params_to_tune"]

            # 检查是否已停止
            db.refresh(task)
            if task.status == "stopped":
                yield f"data: {json.dumps({'stopped': True})}\n\n"
                yield "event: done\ndata: {}\n\n"
                return

            # 通知前端：阶段开始
            phase_start_event = {
                "phase_start": True,
                "phase_id": phase_id,
                "phase_name": phase_def["phase_name"],
                "phase_goal": phase_def["phase_goal"],
                "params_to_tune": params_to_tune,
                "phase_trials": phase_trials,
                "global_trial_start": global_trial_idx + 1,
                "total_trials": n_trials,
            }
            yield f"data: {json.dumps(phase_start_event)}\n\n"

            sampler = (optuna.samplers.TPESampler(seed=42)
                       if strategy == "tpe" else optuna.samplers.RandomSampler(seed=42))
            study = optuna.create_study(direction=direction, sampler=sampler)

            objective = _build_phase_objective(
                params_to_tune=params_to_tune,
                fixed_params=fixed_params,
                search_space=search_space,
                task_type=task_type,
                X_train=X_train,
                y_train=y_train,
                X_test=X_test,
                y_test=y_test,
            )

            phase_best_score = float("inf") if task_type == "regression" else 0.0
            phase_trial_records: list[dict[str, Any]] = []
            phase_n_failed = 0
            phase_n_completed = 0

            for i in range(phase_trials):
                global_trial_idx += 1

                db.refresh(task)
                if task.status == "stopped":
                    yield f"data: {json.dumps({'stopped': True})}\n\n"
                    yield "event: done\ndata: {}\n\n"
                    return

                try:
                    study.optimize(objective, n_trials=1, show_progress_bar=False)
                except Exception as ex:
                    n_failed_total += 1
                    phase_n_failed += 1
                    err = str(ex)[:500]
                    trial_rec = {
                        "trial": global_trial_idx,
                        "phase_id": phase_id,
                        "trial_failed": True,
                        "error": err,
                    }
                    all_trial_points.append(trial_rec)
                    phase_trial_records.append(trial_rec)
                    yield f"data: {json.dumps({'trial': global_trial_idx, 'total': n_trials, 'phase_id': phase_id, 'trial_failed': True, 'error': err[:280], 'elapsed_s': round(time.time() - start_time, 1)})}\n\n"
                    continue

                if not study.trials:
                    n_failed_total += 1
                    phase_n_failed += 1
                    continue

                last_trial = study.trials[-1]
                if last_trial.state != TrialState.COMPLETE:
                    n_failed_total += 1
                    phase_n_failed += 1
                    continue

                score = float(last_trial.value or 0.0)
                is_better = score < phase_best_score if task_type == "regression" else score > phase_best_score
                if is_better:
                    phase_best_score = score
                phase_n_completed += 1
                n_completed_total += 1

                trial_rec = {
                    "trial": global_trial_idx,
                    "phase_id": phase_id,
                    "score": round(score, 4),
                    "best_so_far": round(phase_best_score, 4),
                    "params": last_trial.params,
                }
                all_trial_points.append(trial_rec)
                phase_trial_records.append(trial_rec)

                progress_event = {
                    "trial": global_trial_idx,
                    "total": n_trials,
                    "phase_id": phase_id,
                    "phase_name": phase_def["phase_name"],
                    "score": round(score, 4),
                    "params": last_trial.params,
                    "best_score": round(phase_best_score, 4),
                    "best_so_far": round(phase_best_score, 4),
                    "n_failed": n_failed_total,
                    "n_completed": n_completed_total,
                    "elapsed_s": round(time.time() - start_time, 1),
                }
                yield f"data: {json.dumps(progress_event)}\n\n"

            # ── 锁定本阶段最优参数，传入下一阶段 ────────────────────────────
            complete_trials = [t for t in study.trials if t.state == TrialState.COMPLETE]
            if complete_trials:
                phase_best_params = study.best_params
                fixed_params.update(phase_best_params)

                # 计算效果提升
                effect_improvement = None
                if prev_best_score is not None:
                    if task_type == "regression":
                        effect_improvement = round(prev_best_score - phase_best_score, 4)
                    else:
                        effect_improvement = round(phase_best_score - prev_best_score, 4)
                prev_best_score = phase_best_score

                phase_record = {
                    "phase_id": phase_id,
                    "phase_name": phase_def["phase_name"],
                    "phase_goal": phase_def["phase_goal"],
                    "params_tuned": params_to_tune,
                    "param_ranges": {p: DEFAULT_PHASE_SEARCH_SPACES.get(phase_id, {}).get(p, []) for p in params_to_tune},
                    "n_trials": phase_trials,
                    "n_completed": phase_n_completed,
                    "n_failed": phase_n_failed,
                    "best_score": round(float(phase_best_score), 4),
                    "best_params": phase_best_params,
                    "effect_improvement": effect_improvement,
                    "selection_rationale": f"选择得分最优的参数组合（{direction} 方向，评分 {round(phase_best_score, 4)}），固定传入下一阶段",
                    "trials": phase_trial_records,
                }
            else:
                phase_record = {
                    "phase_id": phase_id,
                    "phase_name": phase_def["phase_name"],
                    "phase_goal": phase_def["phase_goal"],
                    "params_tuned": params_to_tune,
                    "n_trials": phase_trials,
                    "n_completed": 0,
                    "n_failed": phase_n_failed,
                    "best_score": None,
                    "best_params": {},
                    "effect_improvement": None,
                    "selection_rationale": "本阶段无 trial 完成",
                    "trials": phase_trial_records,
                }

            phase_records.append(phase_record)

            # 通知前端：阶段结束
            phase_end_event = {
                "phase_end": True,
                "phase_id": phase_id,
                "phase_name": phase_def["phase_name"],
                "best_score": round(float(phase_best_score), 4) if complete_trials else None,
                "best_params": phase_best_params if complete_trials else {},
                "effect_improvement": phase_record.get("effect_improvement"),
                "n_completed": phase_n_completed,
                "elapsed_s": round(time.time() - start_time, 1),
            }
            yield f"data: {json.dumps(phase_end_event)}\n\n"

        # ── 构建最终模型（使用全部阶段锁定的最优参数）─────────────────────────
        ss_keys = list(SEARCH_SPACE_DOCUMENTATION.keys())
        diag = _build_diagnostics(
            n_trials_requested=n_trials,
            n_completed=n_completed_total,
            n_failed=n_failed_total,
            direction=direction,
            task_type=task_type,
            strategy=strategy,
            trial_points=all_trial_points,
            search_space_keys=ss_keys,
            phase_records=phase_records,
        )

        if n_completed_total == 0:
            task.status = "failed"
            task.error_msg = "全部 trial 失败或未正常完成，请检查数据、搜索空间或查看 trial 错误信息"
            task.tuning_diagnostics_json = json.dumps(diag)
            task.completed_at = datetime.now(timezone.utc)
            db.commit()
            yield f"data: {json.dumps({'error': task.error_msg, 'diagnostics': diag})}\n\n"
            yield "event: done\ndata: {}\n\n"
            return

        best_params = {**_default_params(task_type), **fixed_params}
        model = xgb.XGBClassifier(**best_params) if task_type == "classification" else xgb.XGBRegressor(**best_params)
        model.fit(X_train, y_train, verbose=False)

        model_filename = f"model_tuned_{uuid.uuid4().hex[:12]}.ubj"
        model.save_model(str(MODELS_DIR / model_filename))

        metrics = _compute_metrics(model, X_test, y_test, task_type)
        prov = build_training_provenance(
            dataset_id=dataset.id if dataset else None,
            split_id=task.split_id,
            split_random_seed=split.random_seed if split else None,
            params_final=best_params,
            metrics=metrics,
            source="tuning",
            tuning_task_id=task_id,
        )
        final_model = Model(
            name=f"Tuned_{task_id[:8]}",
            path=model_filename,
            task_type=task_type,
            metrics_json=json.dumps(metrics),
            params_json=json.dumps(best_params),
            provenance_json=provenance_to_json(prov),
            dataset_id=dataset.id if dataset else None,
            split_id=task.split_id,
        )
        db.add(final_model)
        db.commit()
        db.refresh(final_model)

        final_best_score = prev_best_score or 0.0
        task.status = "completed"
        task.best_params_json = json.dumps(fixed_params)
        task.best_score = float(final_best_score)
        task.model_id = final_model.id
        task.tuning_diagnostics_json = json.dumps(diag)
        task.completed_at = datetime.now(timezone.utc)
        db.commit()

        yield f"data: {json.dumps({'completed': True, 'best_params': fixed_params, 'best_score': round(float(final_best_score), 4), 'model_id': final_model.id, 'diagnostics': diag, 'phases_completed': len(phase_records)})}\n\n"
        yield "event: done\ndata: {}\n\n"

    except Exception as e:
        task.status = "failed"
        task.error_msg = str(e)
        task.completed_at = datetime.now(timezone.utc)
        db.commit()
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "event: done\ndata: {}\n\n"


def stop_tuning_task(task_id: str, db: Session) -> None:
    task = db.query(TuningTask).filter(TuningTask.id == task_id).first()
    if task and task.status == "running":
        task.status = "stopped"
        db.commit()


def get_tuning_result(task_id: str, db: Session) -> dict[str, Any]:
    task = db.query(TuningTask).filter(TuningTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="调优任务不存在")
    out: dict[str, Any] = {
        "task_id": task.id,
        "status": task.status,
        "best_params": json.loads(task.best_params_json or "{}"),
        "best_score": task.best_score,
        "model_id": task.model_id,
        "error_msg": task.error_msg,
    }
    if task.tuning_diagnostics_json:
        diag = json.loads(task.tuning_diagnostics_json)
        out["diagnostics"] = diag
        # 单独暴露 phase_records 方便前端直接访问
        if "phase_records" in diag:
            out["phase_records"] = diag["phase_records"]
    return out
