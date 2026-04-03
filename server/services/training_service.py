"""
模型训练业务逻辑
"""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

import numpy as np
import pandas as pd
import xgboost as xgb
from fastapi import HTTPException
from sqlalchemy.orm import Session

from db.database import DATA_DIR, MODELS_DIR
from db.models import Dataset, DatasetSplit, Model, TrainingTask


def _load_split(split_id: int, db: Session) -> tuple[pd.DataFrame, pd.DataFrame]:
    split = db.query(DatasetSplit).filter(DatasetSplit.id == split_id).first()
    if not split:
        raise HTTPException(status_code=404, detail=f"划分记录 {split_id} 不存在")
    train_path = DATA_DIR / split.train_path
    test_path = DATA_DIR / split.test_path
    if not train_path.exists() or not test_path.exists():
        raise HTTPException(status_code=404, detail="训练/测试文件不存在")
    return pd.read_csv(train_path, encoding="utf-8-sig"), pd.read_csv(test_path, encoding="utf-8-sig")


def _detect_task_type(y: pd.Series) -> str:
    if y.nunique() <= 20 and y.dtype in (int, "int64", "int32", object):
        return "classification"
    return "regression"


def _default_params(task_type: str) -> dict[str, Any]:
    base: dict[str, Any] = {
        "n_estimators": 100,
        "max_depth": 6,
        "learning_rate": 0.1,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "min_child_weight": 1,
        "gamma": 0,
        "reg_alpha": 0,
        "reg_lambda": 1,
        "random_state": 42,
        "tree_method": "hist",
    }
    if task_type == "classification":
        base["objective"] = "binary:logistic"
        base["eval_metric"] = "logloss"
    else:
        base["objective"] = "reg:squarederror"
        base["eval_metric"] = "rmse"
    return base


# ── 创建任务 ──────────────────────────────────────────────────────────────────

def create_task(split_id: int, params: dict[str, Any], model_name: Optional[str], db: Session) -> str:
    task_id = uuid.uuid4().hex
    task = TrainingTask(
        id=task_id,
        status="pending",
        split_id=split_id,
        params_json=json.dumps(params),
    )
    db.add(task)
    db.commit()
    return task_id


# ── SSE 训练流 ────────────────────────────────────────────────────────────────

async def training_stream(task_id: str, model_name: Optional[str], db: Session) -> AsyncGenerator[str, None]:
    task = db.query(TrainingTask).filter(TrainingTask.id == task_id).first()
    if not task:
        yield f"data: {json.dumps({'error': 'task not found'})}\n\n"
        return

    task.status = "running"
    db.commit()

    params = json.loads(task.params_json or "{}")
    split_id = task.split_id

    try:
        train_df, test_df = _load_split(split_id, db)
        split = db.query(DatasetSplit).filter(DatasetSplit.id == split_id).first()
        dataset = db.query(Dataset).filter(Dataset.id == split.dataset_id).first() if split else None
        target_col = dataset.target_column if dataset else train_df.columns[-1]

        if target_col not in train_df.columns:
            target_col = train_df.columns[-1]

        X_train = train_df.drop(columns=[target_col]).select_dtypes(include=[np.number])
        y_train = train_df[target_col]
        X_test = test_df.drop(columns=[target_col], errors="ignore").select_dtypes(include=[np.number])
        y_test = test_df[target_col] if target_col in test_df.columns else None

        # 对齐列
        common_cols = X_train.columns.intersection(X_test.columns)
        X_train = X_train[common_cols].fillna(0)
        X_test = X_test[common_cols].fillna(0)

        task_type = _detect_task_type(y_train)
        merged_params = {**_default_params(task_type), **params}
        n_estimators = int(merged_params.pop("n_estimators", 100))

        model = xgb.XGBClassifier(**merged_params) if task_type == "classification" else xgb.XGBRegressor(**merged_params)

        start_time = time.time()

        # 逐步训练，推送进度
        step = max(1, n_estimators // 20)
        for i in range(step, n_estimators + step, step):
            current_rounds = min(i, n_estimators)
            model.set_params(n_estimators=current_rounds)
            model.fit(X_train, y_train, eval_set=[(X_test, y_test)] if y_test is not None else None, verbose=False)

            elapsed = round(time.time() - start_time, 1)
            progress: dict[str, Any] = {
                "round": current_rounds,
                "total": n_estimators,
                "elapsed_s": elapsed,
            }
            # 计算当前指标
            if task_type == "classification":
                from sklearn.metrics import log_loss  # type: ignore
                train_pred = model.predict_proba(X_train)
                progress["train_logloss"] = round(float(log_loss(y_train, train_pred)), 4)
                if y_test is not None:
                    test_pred = model.predict_proba(X_test)
                    progress["val_logloss"] = round(float(log_loss(y_test, test_pred)), 4)
            else:
                from sklearn.metrics import mean_squared_error  # type: ignore
                train_pred = model.predict(X_train)
                progress["train_rmse"] = round(float(np.sqrt(mean_squared_error(y_train, train_pred))), 4)
                if y_test is not None:
                    test_pred = model.predict(X_test)
                    progress["val_rmse"] = round(float(np.sqrt(mean_squared_error(y_test, test_pred))), 4)

            yield f"data: {json.dumps(progress)}\n\n"

            # 检查是否被停止
            db.refresh(task)
            if task.status == "stopped":
                yield f"data: {json.dumps({'stopped': True})}\n\n"
                yield "event: done\ndata: {}\n\n"
                return

        # 最终训练完成 - 计算全量指标并保存模型
        training_time = round(time.time() - start_time, 2)
        metrics = _compute_metrics(model, X_train, y_train, X_test, y_test, task_type)

        # 保存模型文件
        model_filename = f"model_{uuid.uuid4().hex[:12]}.ubj"
        model_path = MODELS_DIR / model_filename
        model.save_model(str(model_path))

        # 写入数据库
        final_model = Model(
            name=model_name or f"Model_{task_id[:8]}",
            path=model_filename,
            task_type=task_type,
            metrics_json=json.dumps(metrics),
            params_json=json.dumps({**merged_params, "n_estimators": n_estimators}),
            dataset_id=dataset.id if dataset else None,
            split_id=split_id,
            training_time_s=training_time,
        )
        db.add(final_model)
        db.commit()
        db.refresh(final_model)

        task.status = "completed"
        task.model_id = final_model.id
        db.commit()

        yield f"data: {json.dumps({'completed': True, 'model_id': final_model.id, 'metrics': metrics})}\n\n"
        yield "event: done\ndata: {}\n\n"

    except Exception as e:
        task.status = "failed"
        task.error_msg = str(e)
        db.commit()
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "event: done\ndata: {}\n\n"


def _compute_metrics(model: Any, X_train: pd.DataFrame, y_train: pd.Series,
                     X_test: Optional[pd.DataFrame], y_test: Optional[pd.Series],
                     task_type: str) -> dict[str, Any]:
    from sklearn.metrics import (  # type: ignore
        accuracy_score, precision_score, recall_score, f1_score,
        roc_auc_score, mean_squared_error, mean_absolute_error, r2_score
    )

    metrics: dict[str, Any] = {}
    if y_test is None or X_test is None:
        return metrics

    if task_type == "classification":
        y_pred = model.predict(X_test)
        y_prob = model.predict_proba(X_test)
        metrics["accuracy"] = round(float(accuracy_score(y_test, y_pred)), 4)
        metrics["precision"] = round(float(precision_score(y_test, y_pred, average="weighted", zero_division=0)), 4)
        metrics["recall"] = round(float(recall_score(y_test, y_pred, average="weighted", zero_division=0)), 4)
        metrics["f1"] = round(float(f1_score(y_test, y_pred, average="weighted", zero_division=0)), 4)
        try:
            auc = roc_auc_score(y_test, y_prob if y_prob.shape[1] > 2 else y_prob[:, 1],
                                multi_class="ovr", average="weighted")
            metrics["auc"] = round(float(auc), 4)
        except Exception:
            pass
    else:
        y_pred = model.predict(X_test)
        mse = mean_squared_error(y_test, y_pred)
        metrics["mse"] = round(float(mse), 4)
        metrics["rmse"] = round(float(np.sqrt(mse)), 4)
        metrics["mae"] = round(float(mean_absolute_error(y_test, y_pred)), 4)
        metrics["r2"] = round(float(r2_score(y_test, y_pred)), 4)
        non_zero = y_test != 0
        if non_zero.any():
            metrics["mape"] = round(float(np.mean(np.abs((y_test[non_zero] - y_pred[non_zero]) / y_test[non_zero])) * 100), 4)

    return metrics


def stop_task(task_id: str, db: Session) -> None:
    task = db.query(TrainingTask).filter(TrainingTask.id == task_id).first()
    if task and task.status == "running":
        task.status = "stopped"
        db.commit()


def get_task_result(task_id: str, db: Session) -> dict[str, Any]:
    task = db.query(TrainingTask).filter(TrainingTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    result: dict[str, Any] = {
        "task_id": task.id,
        "status": task.status,
        "error_msg": task.error_msg,
    }
    if task.model_id:
        model = db.query(Model).filter(Model.id == task.model_id).first()
        if model:
            result["model_id"] = model.id
            result["metrics"] = json.loads(model.metrics_json or "{}")
    return result
