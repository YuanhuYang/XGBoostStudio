"""
超参数调优业务逻辑（Optuna）
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any, AsyncGenerator

import numpy as np
import pandas as pd
import xgboost as xgb
import optuna
from fastapi import HTTPException
from sqlalchemy.orm import Session

from db.database import DATA_DIR, MODELS_DIR
from db.models import Dataset, DatasetSplit, Model, TuningTask
from services.training_service import _detect_task_type, _default_params, _compute_metrics

optuna.logging.set_verbosity(optuna.logging.WARNING)


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

        trial_history = []
        best_score = float("inf") if task_type == "regression" else 0.0
        start_time = time.time()

        sampler = {
            "tpe": optuna.samplers.TPESampler(seed=42),
            "random": optuna.samplers.RandomSampler(seed=42),
            "grid": optuna.samplers.GridSampler(
                {k: v if isinstance(v, list) else [v]
                 for k, v in search_space.items()}
            ) if strategy == "grid" else optuna.samplers.TPESampler(seed=42),
        }.get(strategy, optuna.samplers.TPESampler(seed=42))

        study = optuna.create_study(
            direction="minimize" if task_type == "regression" else "maximize",
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

        for i in range(n_trials):
            db.refresh(task)
            if task.status == "stopped":
                yield f"data: {json.dumps({'stopped': True})}\n\n"
                yield "event: done\ndata: {}\n\n"
                return

            try:
                study.optimize(objective, n_trials=1, show_progress_bar=False)
            except (RuntimeError, ValueError):
                continue

            last_trial = study.trials[-1]
            score = last_trial.value or 0.0
            is_better = score < best_score if task_type == "regression" else score > best_score
            if is_better:
                best_score = score

            progress = {
                "trial": i + 1,
                "total": n_trials,
                "score": round(float(score), 4),
                "params": last_trial.params,
                "best_score": round(float(best_score), 4),
                "elapsed_s": round(time.time() - start_time, 1),
            }
            trial_history.append(progress)
            yield f"data: {json.dumps(progress)}\n\n"

        # 完成 - 保存最优模型
        best_params = {**_default_params(task_type), **study.best_params}
        model = xgb.XGBClassifier(**best_params) if task_type == "classification" else xgb.XGBRegressor(**best_params)
        model.fit(X_train, y_train, verbose=False)

        model_filename = f"model_tuned_{uuid.uuid4().hex[:12]}.ubj"
        model.save_model(str(MODELS_DIR / model_filename))

        metrics = _compute_metrics(model, X_test, y_test, task_type)
        final_model = Model(
            name=f"Tuned_{task_id[:8]}",
            path=model_filename,
            task_type=task_type,
            metrics_json=json.dumps(metrics),
            params_json=json.dumps(best_params),
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
        db.commit()

        yield f"data: {json.dumps({'completed': True, 'best_params': study.best_params, 'best_score': round(float(best_score), 4), 'model_id': final_model.id})}\n\n"
        yield "event: done\ndata: {}\n\n"

    except Exception as e:  # type: ignore[broad-exception-caught]  # async generator needs broad catch
        task.status = "failed"
        task.error_msg = str(e)
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
    return {
        "task_id": task.id,
        "status": task.status,
        "best_params": json.loads(task.best_params_json or "{}"),
        "best_score": task.best_score,
        "model_id": task.model_id,
    }
