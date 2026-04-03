"""
模型评估业务逻辑
"""
from __future__ import annotations

import json
from typing import Any

import numpy as np
import pandas as pd
import xgboost as xgb
from fastapi import HTTPException
from sqlalchemy.orm import Session

from db.database import DATA_DIR, MODELS_DIR
from db.models import Model, DatasetSplit, Dataset


def _load_model_and_data(model_id: int, db: Session):
    model_rec = db.query(Model).filter(Model.id == model_id).first()
    if not model_rec:
        raise HTTPException(status_code=404, detail="模型不存在")

    model_path = MODELS_DIR / model_rec.path
    if not model_path.exists():
        raise HTTPException(status_code=404, detail="模型文件不存在")

    if model_rec.task_type == "classification":
        model = xgb.XGBClassifier()
    else:
        model = xgb.XGBRegressor()
    model.load_model(str(model_path))

    # 加载测试集
    split = db.query(DatasetSplit).filter(DatasetSplit.id == model_rec.split_id).first() if model_rec.split_id else None
    dataset = db.query(Dataset).filter(Dataset.id == model_rec.dataset_id).first() if model_rec.dataset_id else None
    target_col = dataset.target_column if dataset else None

    X_test, y_test = None, None
    if split:
        test_path = DATA_DIR / split.test_path
        if test_path.exists():
            test_df = pd.read_csv(test_path, encoding="utf-8-sig")
            if target_col and target_col in test_df.columns:
                X_test = test_df.drop(columns=[target_col]).select_dtypes(include=[np.number]).fillna(0)
                y_test = test_df[target_col]

    return model, model_rec, X_test, y_test, target_col


def get_evaluation(model_id: int, db: Session) -> dict[str, Any]:
    from sklearn.metrics import (  # type: ignore
        confusion_matrix, roc_curve, auc,
    )

    model, model_rec, X_test, y_test, _target_col = _load_model_and_data(model_id, db)
    base_metrics = json.loads(model_rec.metrics_json or "{}")
    result: dict[str, Any] = {"metrics": base_metrics, "task_type": model_rec.task_type}

    if X_test is None or y_test is None:
        return result

    if model_rec.task_type == "classification":
        y_pred = model.predict(X_test)
        y_prob = model.predict_proba(X_test)
        classes = model.classes_

        cm = confusion_matrix(y_test, y_pred)
        result["confusion_matrix"] = {
            "labels": [str(c) for c in classes],
            "matrix": cm.tolist(),
        }

        # ROC 曲线（二分类）
        if len(classes) == 2:
            fpr, tpr, _ = roc_curve(y_test, y_prob[:, 1])
            result["roc_curve"] = {
                "fpr": [round(float(x), 4) for x in fpr],
                "tpr": [round(float(x), 4) for x in tpr],
                "auc": round(float(auc(fpr, tpr)), 4),
            }
    else:
        y_pred = model.predict(X_test)
        residuals = y_test - y_pred
        result["residuals"] = {
            "values": [round(float(r), 4) for r in residuals[:500]],
            "predicted": [round(float(p), 4) for p in y_pred[:500]],
            "actual": [round(float(a), 4) for a in y_test.values[:500]],
        }

    # SHAP 摘要（top-20）
    try:
        import shap  # type: ignore
        explainer = shap.TreeExplainer(model)
        sample = X_test if len(X_test) <= 200 else X_test.sample(200, random_state=42)
        shap_values = explainer.shap_values(sample)
        if isinstance(shap_values, list):
            shap_values = shap_values[1] if len(shap_values) > 1 else shap_values[0]
        importance = np.abs(shap_values).mean(axis=0)
        top_idx = np.argsort(importance)[::-1][:20]
        result["shap_summary"] = [
            {"feature": X_test.columns[i], "importance": round(float(importance[i]), 4)}
            for i in top_idx
        ]
    except (ImportError, ValueError, AttributeError):
        # SHAP 计算失败时用内置特征重要性
        try:
            fi = model.feature_importances_
            top_idx = np.argsort(fi)[::-1][:20]
            result["shap_summary"] = [
                {"feature": X_test.columns[i], "importance": round(float(fi[i]), 4)}
                for i in top_idx
            ]
        except (AttributeError, IndexError):
            pass

    return result


def get_shap_detail(model_id: int, db: Session) -> dict[str, Any]:
    import shap  # type: ignore

    model, _model_rec, X_test, _y_test, _ = _load_model_and_data(model_id, db)
    if X_test is None:
        raise HTTPException(status_code=400, detail="无测试数据")

    sample = X_test if len(X_test) <= 100 else X_test.sample(100, random_state=42)
    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(sample)
    if isinstance(shap_values, list):
        sv = shap_values[1] if len(shap_values) > 1 else shap_values[0]
    else:
        sv = shap_values

    return {
        "features": list(X_test.columns),
        "shap_values": sv.tolist(),
        "data": sample.values.tolist(),
        "base_value": float(explainer.expected_value) if not isinstance(explainer.expected_value, list)
                      else float(explainer.expected_value[1]),
    }
