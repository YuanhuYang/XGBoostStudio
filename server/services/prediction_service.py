"""
批量预测 & 单样本预测业务逻辑
"""
from __future__ import annotations

import io
import uuid
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import xgboost as xgb
from fastapi import HTTPException
from sqlalchemy.orm import Session

from db.database import DATA_DIR, MODELS_DIR
from db.models import Model


def _load_model(model_id: int, db: Session) -> tuple[xgb.XGBModel, Model]:
    record = db.query(Model).filter(Model.id == model_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="模型不存在")
    model_path = MODELS_DIR / record.path
    if not model_path.exists():
        raise HTTPException(status_code=404, detail="模型文件不存在")
    if record.task_type == "classification":
        model = xgb.XGBClassifier()
    else:
        model = xgb.XGBRegressor()
    model.load_model(str(model_path))
    return model, record


def single_predict(model_id: int, features: dict[str, Any], db: Session) -> dict[str, Any]:
    model, record = _load_model(model_id, db)
    df = pd.DataFrame([features])
    df = df.select_dtypes(include=[np.number]).fillna(0)

    prediction = model.predict(df)[0]
    result: dict[str, Any] = {"prediction": float(prediction)}

    if record.task_type == "classification" and hasattr(model, "predict_proba"):
        proba = model.predict_proba(df)[0]
        result["probabilities"] = [round(float(p), 4) for p in proba]

    # SHAP 解释
    try:
        import shap  # type: ignore
        explainer = shap.TreeExplainer(model)
        sv = explainer.shap_values(df)
        if isinstance(sv, list):
            sv = sv[1] if len(sv) > 1 else sv[0]
        shap_vals = dict(zip(df.columns.tolist(), [round(float(v), 4) for v in sv[0]]))
        result["shap_values"] = shap_vals
    except (ImportError, ValueError, AttributeError):
        pass

    return result


def batch_predict(model_id: int, file_bytes: bytes, filename: str, db: Session) -> dict[str, Any]:
    """批量预测，返回带结果的 DataFrame，保存为 CSV"""
    model, record = _load_model(model_id, db)

    try:
        if filename.lower().endswith(".csv"):
            df_input = pd.read_csv(io.BytesIO(file_bytes), encoding="utf-8-sig")
        elif filename.lower().endswith((".xlsx", ".xls")):
            df_input = pd.read_excel(io.BytesIO(file_bytes))
        else:
            raise HTTPException(status_code=400, detail="仅支持 CSV / Excel 格式")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"文件解析失败: {e}") from e

    numeric_df = df_input.select_dtypes(include=[np.number]).fillna(0)
    if numeric_df.empty:
        raise HTTPException(status_code=400, detail="文件中无数值特征列")

    predictions = model.predict(numeric_df)
    df_input["prediction"] = predictions

    if record.task_type == "classification" and hasattr(model, "predict_proba"):
        proba = model.predict_proba(numeric_df)
        for i, col in enumerate(model.classes_ if hasattr(model, "classes_") else range(proba.shape[1])):
            df_input[f"prob_class_{col}"] = proba[:, i].round(4)

    task_id = uuid.uuid4().hex
    out_path = DATA_DIR / f"predict_{task_id}.csv"
    df_input.to_csv(out_path, index=False, encoding="utf-8-sig")

    preview_records = df_input.head(20).where(pd.notnull(df_input), None).to_dict(orient="records")

    return {
        "task_id": task_id,
        "total_rows": len(df_input),
        "preview": preview_records,
        "download_path": str(out_path),
    }


def get_batch_result_path(task_id: str) -> Path:
    path = DATA_DIR / f"predict_{task_id}.csv"
    if not path.exists():
        raise HTTPException(status_code=404, detail="预测结果不存在")
    return path


def batch_predict_summary(task_id: str) -> dict[str, Any]:
    """返回批量预测结果的统计摘要（各类别计数/比例）"""
    path = DATA_DIR / f"predict_{task_id}.csv"
    if not path.exists():
        raise HTTPException(status_code=404, detail="预测结果不存在")
    df = pd.read_csv(path, encoding="utf-8-sig")
    if "prediction" not in df.columns:
        raise HTTPException(status_code=400, detail="结果文件缺少 prediction 列")
    total = len(df)
    vc = df["prediction"].value_counts()
    distribution = [
        {"label": str(k), "count": int(v), "ratio": round(float(v) / total, 4)}
        for k, v in vc.items()
    ]
    prob_cols = [c for c in df.columns if c.startswith("prob_class_")]
    return {
        "task_id": task_id,
        "total_rows": total,
        "distribution": distribution,
        "has_probability": len(prob_cols) > 0,
        "probability_columns": prob_cols,
    }
