"""
模型训练业务逻辑
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any, AsyncGenerator, Optional

import numpy as np
import pandas as pd
import xgboost as xgb
from fastapi import HTTPException
from sqlalchemy.orm import Session

from db.database import DATA_DIR, MODELS_DIR
from db.models import Dataset, DatasetSplit, Model, TrainingTask
from services.provenance import build_training_provenance, provenance_to_json


def _load_split(split_id: int, db: Session) -> tuple[pd.DataFrame, pd.DataFrame]:
    split = db.query(DatasetSplit).filter(DatasetSplit.id == split_id).first()
    if not split:
        raise HTTPException(status_code=404, detail=f"划分记录 {split_id} 不存在")
    train_path = DATA_DIR / split.train_path
    test_path = DATA_DIR / split.test_path
    if not train_path.exists() or not test_path.exists():
        raise HTTPException(status_code=404, detail="训练/测试文件不存在")
    return pd.read_csv(train_path, encoding="utf-8-sig"), pd.read_csv(test_path, encoding="utf-8-sig")


def _valid_target_mask(y: pd.Series) -> pd.Series:
    """监督学习：排除标签缺失；数值型标签同时排除 inf。"""
    ok = y.notna()
    if pd.api.types.is_numeric_dtype(y):
        arr = np.asarray(y, dtype=np.float64)
        ok = ok & np.isfinite(arr)
    return ok


def _drop_invalid_supervised_rows(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_test: pd.DataFrame,
    y_test: pd.Series | None,
) -> tuple[pd.DataFrame, pd.Series, pd.DataFrame, pd.Series | None]:
    tm = _valid_target_mask(y_train)
    X_train = X_train.loc[tm]
    y_train = y_train.loc[tm]
    if y_test is not None and len(y_test):
        vm = _valid_target_mask(y_test)
        X_test = X_test.loc[vm]
        y_test = y_test.loc[vm]
        if len(y_test) == 0:
            y_test = None
    return X_train, y_train, X_test, y_test


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

def create_task(split_id: int, params: dict[str, Any], db: Session, model_name: Optional[str] = None) -> str:
    task_id = uuid.uuid4().hex
    # model_name 存入 params_json，供 training_stream 读取命名模型
    params_with_meta = {**params, "_model_name": model_name or ""}
    task = TrainingTask(
        id=task_id,
        status="pending",
        split_id=split_id,
        params_json=json.dumps(params_with_meta),
    )
    db.add(task)
    db.commit()
    return task_id


# ── SSE 训练流 ────────────────────────────────────────────────────────────────

async def training_stream(task_id: str, db: Session, model_name: Optional[str] = None) -> AsyncGenerator[str, None]:
    task = db.query(TrainingTask).filter(TrainingTask.id == task_id).first()
    if not task:
        yield f"data: {json.dumps({'error': 'task not found'})}\n\n"
        return

    task.status = "running"
    db.commit()

    params = json.loads(task.params_json or "{}")
    # 提取内部元数据，不传给 XGBoost
    _model_name_from_task = params.pop("_model_name", None) or model_name
    use_kfold_cv = bool(params.pop("use_kfold_cv", False))
    try:
        kfold_k = int(params.pop("kfold_k", 5) or 5)
    except (TypeError, ValueError):
        kfold_k = 5
    kfold_k = max(2, min(kfold_k, 10))
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

        X_train, y_train, X_test, y_test = _drop_invalid_supervised_rows(
            X_train, y_train, X_test, y_test
        )
        if len(X_train) == 0:
            yield f"data: {json.dumps({'error': '训练集中无有效标签行（目标列缺失或无效）'})}\n\n"
            return

        task_type = _detect_task_type(y_train)
        merged_params = {**_default_params(task_type), **params}
        n_estimators = int(merged_params.pop("n_estimators", 100))
        # 提取早停参数（不传入 XGBoost sklearn API）
        early_stopping_rounds = int(merged_params.pop("early_stopping_rounds", 0))

        # ── 参数一致性修正：防止 recommend_params 将回归目标误判为多分类 ──────
        _classification_objectives = {"binary:logistic", "multi:softmax", "multi:softprob"}
        _regression_objectives = {"reg:squarederror", "reg:absoluteerror", "reg:logistic"}
        if task_type == "regression":
            # 回归任务：清除分类专用参数，确保 objective 为回归类型
            merged_params.pop("num_class", None)
            if merged_params.get("objective") in _classification_objectives:
                merged_params["objective"] = "reg:squarederror"
                merged_params["eval_metric"] = "rmse"
        elif task_type == "classification":
            n_unique_classes = int(y_train.nunique())
            if n_unique_classes > 2:
                # 多分类：确保 objective 和 num_class 正确
                if merged_params.get("objective") not in ("multi:softmax", "multi:softprob"):
                    merged_params["objective"] = "multi:softprob"
                    merged_params["eval_metric"] = "mlogloss"
                if not merged_params.get("num_class") or int(merged_params.get("num_class", 0)) < 2:
                    merged_params["num_class"] = n_unique_classes
            else:
                # 二分类：清除多分类参数
                merged_params.pop("num_class", None)
                if merged_params.get("objective") in ("multi:softmax", "multi:softprob"):
                    merged_params["objective"] = "binary:logistic"
                    merged_params["eval_metric"] = "logloss"

        cv_res_stored: dict[str, Any] | None = None
        if use_kfold_cv:
            yield f"data: {json.dumps({'cv_phase': True, 'message': '正在运行 K 折交叉验证...'})}\n\n"
            vp = {**merged_params, "n_estimators": n_estimators}
            cv_res_stored = kfold_evaluate(split_id, vp, kfold_k, db)
            yield f"data: {json.dumps({'cv_done': True, 'cv_k': cv_res_stored['k'], 'cv_summary': cv_res_stored['summary'], 'cv_fold_metrics': cv_res_stored['fold_metrics']})}\n\n"

        model = xgb.XGBClassifier(**merged_params) if task_type == "classification" else xgb.XGBRegressor(**merged_params)

        start_time = time.time()

        # 逐步训练，推送进度；同时实施早停
        step = max(1, n_estimators // 20)
        best_val_metric = float("inf")
        best_round = step
        no_improve_rounds = 0
        early_stopped = False

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
                    val_m = float(log_loss(y_test, test_pred))
                    progress["val_logloss"] = round(val_m, 4)
            else:
                from sklearn.metrics import mean_squared_error  # type: ignore
                train_pred = model.predict(X_train)
                progress["train_rmse"] = round(float(np.sqrt(mean_squared_error(y_train, train_pred))), 4)
                if y_test is not None:
                    test_pred = model.predict(X_test)
                    val_m = float(np.sqrt(mean_squared_error(y_test, test_pred)))
                    progress["val_rmse"] = round(val_m, 4)

            # 早停检测
            if early_stopping_rounds > 0 and y_test is not None:
                val_m_cur = progress.get("val_logloss") or progress.get("val_rmse", float("inf"))
                if val_m_cur is not None:
                    if float(val_m_cur) < best_val_metric - 1e-5:
                        best_val_metric = float(val_m_cur)
                        best_round = current_rounds
                        no_improve_rounds = 0
                    else:
                        no_improve_rounds += step
                    if no_improve_rounds >= early_stopping_rounds:
                        progress["early_stopping_hint"] = True
                        yield f"data: {json.dumps(progress)}\n\n"
                        early_stopped = True
                        break

            yield f"data: {json.dumps(progress)}\n\n"

            # 检查是否被停止（每步检查，而非每 10 步）
            db.refresh(task)
            if task.status == "stopped":
                yield f"data: {json.dumps({'stopped': True})}\n\n"
                yield "event: done\ndata: {}\n\n"
                return

        # 最终训练完成 - 计算全量指标（含过拟合诊断）并保存模型
        training_time = round(time.time() - start_time, 2)
        metrics = _compute_metrics(model, X_test, y_test, task_type, X_train, y_train)
        if early_stopped:
            metrics["early_stopped"] = True
            metrics["best_round"] = best_round

        # 保存模型文件
        model_filename = f"model_{uuid.uuid4().hex[:12]}.ubj"
        model_path = MODELS_DIR / model_filename
        model.save_model(str(model_path))

        final_params = {**merged_params, "n_estimators": n_estimators}
        prov = build_training_provenance(
            dataset_id=dataset.id if dataset else None,
            split_id=split_id,
            split_random_seed=split.random_seed if split else None,
            params_final=final_params,
            metrics=metrics,
            source="training",
            training_task_id=task_id,
            training_time_s=training_time,
        )
        # 写入数据库
        final_model = Model(
            name=_model_name_from_task or f"Model_{task_id[:8]}",
            path=model_filename,
            task_type=task_type,
            metrics_json=json.dumps(metrics),
            params_json=json.dumps(final_params),
            provenance_json=provenance_to_json(prov),
            dataset_id=dataset.id if dataset else None,
            split_id=split_id,
            training_time_s=training_time,
            cv_fold_metrics_json=json.dumps(cv_res_stored["fold_metrics"]) if cv_res_stored else None,
            cv_summary_json=json.dumps(cv_res_stored["summary"]) if cv_res_stored else None,
            cv_k=cv_res_stored["k"] if cv_res_stored else None,
        )
        db.add(final_model)
        db.commit()
        db.refresh(final_model)

        task.status = "completed"
        task.model_id = final_model.id
        db.commit()

        yield f"data: {json.dumps({'completed': True, 'model_id': final_model.id, 'metrics': metrics, 'early_stopped': early_stopped, 'best_round': best_round})}\n\n"
        yield "event: done\ndata: {}\n\n"

    except BaseException as e:  # pylint: disable=broad-except  # type: ignore[misc]
        task.status = "failed"
        task.error_msg = str(e)
        db.commit()
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "event: done\ndata: {}\n\n"


def _compute_metrics(
    model: Any,
    X_test: Optional[pd.DataFrame],
    y_test: Optional[pd.Series],
    task_type: str,
    X_train: Optional[pd.DataFrame] = None,
    y_train: Optional[pd.Series] = None,
) -> dict[str, Any]:
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
        except (ValueError, TypeError):  # type: ignore[misc]
            pass
        # 过拟合诊断：对比训练集与验证集准确率
        if X_train is not None and y_train is not None:
            try:
                y_train_pred = model.predict(X_train)
                train_acc = float(accuracy_score(y_train, y_train_pred))
                metrics["train_accuracy"] = round(train_acc, 4)
                gap = train_acc - metrics["accuracy"]
                metrics["overfitting_gap"] = round(gap, 4)
                metrics["overfitting_level"] = (
                    "high" if gap > 0.15 else ("medium" if gap > 0.05 else "low")
                )
            except (ValueError, TypeError):
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
        # 过拟合诊断：对比训练集与验证集 RMSE
        if X_train is not None and y_train is not None:
            try:
                y_train_pred = model.predict(X_train)
                train_rmse = float(np.sqrt(mean_squared_error(y_train, y_train_pred)))
                metrics["train_rmse"] = round(train_rmse, 4)
                ratio = metrics["rmse"] / max(train_rmse, 1e-8)
                metrics["overfitting_gap"] = round(ratio - 1, 4)
                metrics["overfitting_level"] = (
                    "high" if ratio > 1.5 else ("medium" if ratio > 1.2 else "low")
                )
            except (ValueError, TypeError):
                pass

    return metrics


def train_and_persist_sync(
    split_id: int,
    params: dict[str, Any],
    db: Session,
    *,
    model_name: Optional[str] = None,
) -> dict[str, Any]:
    """
    一次性训练并写入 Model（不产生 TrainingTask）。供 AutoML 编排等同步场景调用。
    返回 model_id、metrics、task_type、training_time_s。
    """
    params = dict(params)
    params.pop("_model_name", None)
    params.pop("use_kfold_cv", None)
    params.pop("kfold_k", None)

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

    common_cols = X_train.columns.intersection(X_test.columns)
    X_train = X_train[common_cols].fillna(0)
    X_test = X_test[common_cols].fillna(0)

    X_train, y_train, X_test, y_test = _drop_invalid_supervised_rows(
        X_train, y_train, X_test, y_test
    )
    if len(X_train) == 0:
        raise ValueError("训练集中无有效标签行（目标列缺失或无效）")

    task_type = _detect_task_type(y_train)
    merged_params = {**_default_params(task_type), **params}
    n_estimators = int(merged_params.pop("n_estimators", 100))
    early_stopping_rounds = int(merged_params.pop("early_stopping_rounds", 0) or 0)

    _classification_objectives = {"binary:logistic", "multi:softmax", "multi:softprob"}
    if task_type == "regression":
        merged_params.pop("num_class", None)
        if merged_params.get("objective") in _classification_objectives:
            merged_params["objective"] = "reg:squarederror"
            merged_params["eval_metric"] = "rmse"
    elif task_type == "classification":
        n_unique_classes = int(y_train.nunique())
        if n_unique_classes > 2:
            if merged_params.get("objective") not in ("multi:softmax", "multi:softprob"):
                merged_params["objective"] = "multi:softprob"
                merged_params["eval_metric"] = "mlogloss"
            if not merged_params.get("num_class") or int(merged_params.get("num_class", 0)) < 2:
                merged_params["num_class"] = n_unique_classes
        else:
            merged_params.pop("num_class", None)
            if merged_params.get("objective") in ("multi:softmax", "multi:softprob"):
                merged_params["objective"] = "binary:logistic"
                merged_params["eval_metric"] = "logloss"

    model = xgb.XGBClassifier(**merged_params) if task_type == "classification" else xgb.XGBRegressor(**merged_params)
    model.set_params(n_estimators=n_estimators)
    if early_stopping_rounds > 0 and y_test is not None and len(y_test) > 0:
        model.set_params(early_stopping_rounds=early_stopping_rounds)

    start_time = time.time()
    fit_kw: dict[str, Any] = {"verbose": False}
    if y_test is not None and len(y_test) > 0:
        fit_kw["eval_set"] = [(X_test, y_test)]

    model.fit(X_train, y_train, **fit_kw)
    training_time = round(time.time() - start_time, 2)

    metrics = _compute_metrics(model, X_test, y_test, task_type, X_train, y_train)
    if early_stopping_rounds > 0:
        bi = getattr(model, "best_iteration", None)
        if bi is not None:
            metrics["best_iteration"] = int(bi)

    model_filename = f"model_{uuid.uuid4().hex[:12]}.ubj"
    model_path = MODELS_DIR / model_filename
    model.save_model(str(model_path))

    final_params = {**merged_params, "n_estimators": n_estimators}
    prov = build_training_provenance(
        dataset_id=dataset.id if dataset else None,
        split_id=split_id,
        split_random_seed=split.random_seed if split else None,
        params_final=final_params,
        metrics=metrics,
        source="training",
        training_time_s=training_time,
    )
    display_name = model_name or f"Model_sync_{uuid.uuid4().hex[:8]}"
    final_model = Model(
        name=display_name,
        path=model_filename,
        task_type=task_type,
        metrics_json=json.dumps(metrics),
        params_json=json.dumps(final_params),
        provenance_json=provenance_to_json(prov),
        dataset_id=dataset.id if dataset else None,
        split_id=split_id,
        training_time_s=training_time,
    )
    db.add(final_model)
    db.commit()
    db.refresh(final_model)

    return {
        "model_id": final_model.id,
        "metrics": metrics,
        "task_type": task_type,
        "training_time_s": training_time,
    }


def stop_task(task_id: str, db: Session) -> None:
    task = db.query(TrainingTask).filter(TrainingTask.id == task_id).first()
    if task and task.status == "running":
        task.status = "stopped"
        db.commit()


def _add_cv_fold_highlights(
    fold_metrics: list[dict[str, Any]], summary: dict[str, Any]
) -> list[dict[str, Any]]:
    """AC-6-03：若某折某指标与均值的偏差 > 2×全体折该指标的标准差，则标记 outlier_highlight。"""
    if not fold_metrics:
        return []
    metric_keys = [k for k in fold_metrics[0] if k != "fold"]
    out: list[dict[str, Any]] = []
    for fm in fold_metrics:
        row = dict(fm)
        bad = False
        for mk in metric_keys:
            mu = summary.get(f"{mk}_mean")
            sd = summary.get(f"{mk}_std")
            if mu is None or sd is None:
                continue
            sigma = float(sd) if float(sd) > 1e-12 else 1e-9
            v = fm.get(mk)
            if v is None:
                continue
            if abs(float(v) - float(mu)) > 2.0 * sigma:
                bad = True
                break
        row["outlier_highlight"] = bad
        out.append(row)
    return out


def kfold_evaluate(split_id: int, params: dict[str, Any], k: int, db: Session) -> dict[str, Any]:
    """
    K-Fold 交叉验证：在训练集上进行 k 折交叉验证并返回均値指标。
    """
    from sklearn.model_selection import KFold, StratifiedKFold  # type: ignore
    from sklearn.metrics import (  # type: ignore
        accuracy_score, f1_score, roc_auc_score,
        mean_squared_error, r2_score,
    )

    split = db.query(DatasetSplit).filter(DatasetSplit.id == split_id).first()
    if not split:
        raise HTTPException(status_code=404, detail=f"划分记录 {split_id} 不存在")

    dataset = db.query(Dataset).filter(Dataset.id == split.dataset_id).first() if split.dataset_id else None
    target_col = dataset.target_column if dataset else None

    train_path = DATA_DIR / split.train_path
    if not train_path.exists():
        raise HTTPException(status_code=400, detail="训练集文件不存在")

    df = pd.read_csv(train_path, encoding="utf-8-sig")
    if not target_col or target_col not in df.columns:
        target_col = df.columns[-1]

    X = df.drop(columns=[target_col]).select_dtypes(include=[np.number]).fillna(0)
    y = df[target_col]
    task_type = _detect_task_type(y)
    merged_params = {**_default_params(task_type), **params}
    n_estimators = int(merged_params.pop("n_estimators", 100))
    merged_params.pop("early_stopping_rounds", None)
    merged_params.pop("_model_name", None)
    merged_params.pop("use_kfold_cv", None)
    merged_params.pop("kfold_k", None)

    k = max(2, min(k, 10))
    kf = StratifiedKFold(n_splits=k, shuffle=True, random_state=42) if task_type == "classification" else KFold(n_splits=k, shuffle=True, random_state=42)

    fold_metrics: list[dict[str, float]] = []
    for fold_idx, (train_idx, val_idx) in enumerate(kf.split(X, y if task_type == "classification" else None)):
        X_tr, X_val = X.iloc[train_idx], X.iloc[val_idx]
        y_tr, y_val = y.iloc[train_idx], y.iloc[val_idx]

        model = (xgb.XGBClassifier(**merged_params) if task_type == "classification"
                 else xgb.XGBRegressor(**merged_params))
        model.set_params(n_estimators=n_estimators)
        model.fit(X_tr, y_tr, verbose=False)

        fm: dict[str, float] = {"fold": fold_idx + 1}
        if task_type == "classification":
            y_pred = model.predict(X_val)
            fm["accuracy"] = round(float(accuracy_score(y_val, y_pred)), 4)
            fm["f1"] = round(float(f1_score(y_val, y_pred, average="weighted", zero_division=0)), 4)
            try:
                y_prob = model.predict_proba(X_val)
                auc = roc_auc_score(y_val, y_prob if y_prob.shape[1] > 2 else y_prob[:, 1],
                                    multi_class="ovr", average="weighted")
                fm["auc"] = round(float(auc), 4)
            except (ValueError, TypeError):
                pass
        else:
            y_pred = model.predict(X_val)
            fm["rmse"] = round(float(np.sqrt(mean_squared_error(y_val, y_pred))), 4)
            fm["r2"] = round(float(r2_score(y_val, y_pred)), 4)
        fold_metrics.append(fm)

    # 计算均値和标准差
    metric_keys = [k for k in fold_metrics[0].keys() if k != "fold"]
    summary: dict[str, Any] = {}
    for mk in metric_keys:
        vals = [f[mk] for f in fold_metrics]
        summary[f"{mk}_mean"] = round(float(np.mean(vals)), 4)
        summary[f"{mk}_std"] = round(float(np.std(vals)), 4)

    fold_out = _add_cv_fold_highlights(fold_metrics, summary)

    return {
        "task_type": task_type,
        "k": k,
        "fold_metrics": fold_out,
        "summary": summary,
    }


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
