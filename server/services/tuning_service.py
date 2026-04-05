"""
超参数调优业务逻辑（Optuna）
G2-Auth-3：trial 失败可审计、诊断 JSON、禁止静默吞异常。
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
    "learning_rate": "学习率（eta） shrinkage；通常与 n_estimators 权衡。",
    "subsample": "行采样比例，降低过拟合。",
    "colsample_bytree": "列采样比例，降低过拟合与特征共线性影响。",
    "reg_alpha": "L1 正则（alpha）。",
    "reg_lambda": "L2 正则（lambda）。",
}


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
) -> dict[str, Any]:
    return {
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

        best_score = float("inf") if task_type == "regression" else 0.0
        start_time = time.time()
        trial_points: list[dict[str, Any]] = []
        n_failed = 0
        n_completed = 0

        sampler = {
            "tpe": optuna.samplers.TPESampler(seed=42),
            "random": optuna.samplers.RandomSampler(seed=42),
            "grid": optuna.samplers.GridSampler(
                {k: v if isinstance(v, list) else [v]
                 for k, v in search_space.items()}
            ) if strategy == "grid" else optuna.samplers.TPESampler(seed=42),
        }.get(strategy, optuna.samplers.TPESampler(seed=42))

        study = optuna.create_study(
            direction=direction,
            sampler=sampler,
        )

        def objective(trial: optuna.Trial) -> float:
            params = _default_params(task_type).copy()
            ss = search_space or {}
            params["n_estimators"] = trial.suggest_int("n_estimators", ss.get("n_estimators", [50, 200])[0],
                                                        ss.get("n_estimators", [50, 200])[-1])
            params["max_depth"] = trial.suggest_int("max_depth", *ss.get("max_depth", [3, 10]))
            params["learning_rate"] = trial.suggest_float("learning_rate", *ss.get("learning_rate", [0.01, 0.3]), log=True)
            params["subsample"] = trial.suggest_float("subsample", *ss.get("subsample", [0.5, 1.0]))
            params["colsample_bytree"] = trial.suggest_float("colsample_bytree", *ss.get("colsample_bytree", [0.5, 1.0]))
            params["reg_alpha"] = trial.suggest_float("reg_alpha", *ss.get("reg_alpha", [0.0, 1.0]))
            params["reg_lambda"] = trial.suggest_float("reg_lambda", *ss.get("reg_lambda", [0.5, 2.0]))

            model = xgb.XGBClassifier(**params) if task_type == "classification" else xgb.XGBRegressor(**params)
            model.fit(X_train, y_train, verbose=False)

            if y_test is not None:
                if task_type == "classification":
                    from sklearn.metrics import f1_score  # type: ignore
                    y_pred = model.predict(X_test)
                    return float(f1_score(y_test, y_pred, average="weighted", zero_division=0))
                else:
                    from sklearn.metrics import mean_squared_error  # type: ignore
                    y_pred = model.predict(X_test)
                    return float(np.sqrt(mean_squared_error(y_test, y_pred)))
            return 0.0

        ss_keys = list(search_space.keys()) if search_space else ["n_estimators", "max_depth", "learning_rate", "subsample", "colsample_bytree", "reg_alpha", "reg_lambda"]

        for i in range(n_trials):
            db.refresh(task)
            if task.status == "stopped":
                yield f"data: {json.dumps({'stopped': True})}\n\n"
                yield "event: done\ndata: {}\n\n"
                return

            try:
                study.optimize(objective, n_trials=1, show_progress_bar=False)
            except Exception as ex:  # noqa: BLE001 — 须记录并展示，不可静默
                n_failed += 1
                err = str(ex)[:500]
                trial_points.append({
                    "trial": i + 1,
                    "trial_failed": True,
                    "error": err,
                    "best_so_far": round(float(best_score), 4) if best_score not in (float("inf"), float("-inf")) else None,
                })
                yield f"data: {json.dumps({'trial': i + 1, 'total': n_trials, 'trial_failed': True, 'error': err[:280], 'n_failed': n_failed, 'best_score': _json_friendly_best(best_score, task_type), 'elapsed_s': round(time.time() - start_time, 1)})}\n\n"
                continue

            if not study.trials:
                n_failed += 1
                continue

            last_trial = study.trials[-1]
            if last_trial.state != TrialState.COMPLETE:
                n_failed += 1
                trial_points.append({
                    "trial": i + 1,
                    "trial_failed": True,
                    "error": f"trial_state={last_trial.state}",
                    "best_so_far": round(float(best_score), 4) if task_type == "classification" else round(float(best_score), 4),
                })
                yield f"data: {json.dumps({'trial': i + 1, 'total': n_trials, 'trial_failed': True, 'error': 'trial not complete', 'n_failed': n_failed, 'best_score': _json_friendly_best(best_score, task_type), 'elapsed_s': round(time.time() - start_time, 1)})}\n\n"
                continue

            score = float(last_trial.value or 0.0)
            is_better = score < best_score if task_type == "regression" else score > best_score
            if is_better:
                best_score = score
            n_completed += 1

            progress = {
                "trial": i + 1,
                "total": n_trials,
                "score": round(float(score), 4),
                "params": last_trial.params,
                "best_score": round(float(best_score), 4),
                "best_so_far": round(float(best_score), 4),
                "n_failed": n_failed,
                "n_completed": n_completed,
                "elapsed_s": round(time.time() - start_time, 1),
            }
            trial_points.append({
                "trial": i + 1,
                "score": round(float(score), 4),
                "best_so_far": round(float(best_score), 4),
                "params": last_trial.params,
            })
            yield f"data: {json.dumps(progress)}\n\n"

        complete_trials = [t for t in study.trials if t.state == TrialState.COMPLETE]
        diag = _build_diagnostics(
            n_trials_requested=n_trials,
            n_completed=n_completed,
            n_failed=n_failed,
            direction=direction,
            task_type=task_type,
            strategy=strategy,
            trial_points=trial_points,
            search_space_keys=ss_keys,
        )

        if not complete_trials:
            task.status = "failed"
            task.error_msg = "全部 trial 失败或未正常完成，请检查数据、搜索空间或查看 trial 错误信息"
            task.tuning_diagnostics_json = json.dumps(diag)
            task.completed_at = datetime.now(timezone.utc)
            db.commit()
            yield f"data: {json.dumps({'error': task.error_msg, 'diagnostics': diag})}\n\n"
            yield "event: done\ndata: {}\n\n"
            return

        best_params = {**_default_params(task_type), **study.best_params}
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

        task.status = "completed"
        task.best_params_json = json.dumps(study.best_params)
        task.best_score = float(best_score)
        task.model_id = final_model.id
        task.tuning_diagnostics_json = json.dumps(diag)
        task.completed_at = datetime.now(timezone.utc)
        db.commit()

        yield f"data: {json.dumps({'completed': True, 'best_params': study.best_params, 'best_score': round(float(best_score), 4), 'model_id': final_model.id, 'diagnostics': diag})}\n\n"
        yield "event: done\ndata: {}\n\n"

    except Exception as e:  # type: ignore[broad-exception-caught]  # async generator needs broad catch
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
        out["diagnostics"] = json.loads(task.tuning_diagnostics_json)
    return out
