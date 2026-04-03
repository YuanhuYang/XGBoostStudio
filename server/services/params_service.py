"""
超参数推荐 & 参数结构定义业务逻辑
"""
from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import HTTPException
from sqlalchemy.orm import Session

from db.database import DATA_DIR
from db.models import Dataset, DatasetSplit


# XGBoost 参数 Schema 元数据
PARAM_SCHEMA: list[dict[str, Any]] = [
    {"name": "n_estimators", "label": "树的数量", "type": "int", "default": 100, "min": 10, "max": 2000, "step": 10,
     "tooltip": "Boosting 轮次（树的棵数），越大模型越复杂，训练越慢"},
    {"name": "max_depth", "label": "最大深度", "type": "int", "default": 6, "min": 1, "max": 20, "step": 1,
     "tooltip": "单棵树最大深度，越深模型越复杂，越易过拟合"},
    {"name": "learning_rate", "label": "学习率", "type": "float", "default": 0.1, "min": 0.001, "max": 1.0, "step": 0.001,
     "log_scale": True, "tooltip": "每步 shrinkage，越小需越多轮次"},
    {"name": "subsample", "label": "行采样比例", "type": "float", "default": 1.0, "min": 0.1, "max": 1.0, "step": 0.05,
     "tooltip": "每棵树随机采样的训练样本比例，有助于防止过拟合"},
    {"name": "colsample_bytree", "label": "列采样比例(树)", "type": "float", "default": 1.0, "min": 0.1, "max": 1.0,
     "step": 0.05, "tooltip": "每棵树随机采样的特征比例"},
    {"name": "colsample_bylevel", "label": "列采样比例(层)", "type": "float", "default": 1.0, "min": 0.1, "max": 1.0,
     "step": 0.05, "tooltip": "每一层分裂时随机采样的特征比例"},
    {"name": "min_child_weight", "label": "最小子节点权重", "type": "float", "default": 1.0, "min": 0.0, "max": 100.0,
     "step": 1.0, "tooltip": "叶节点所需最小样本权重和，越大模型越保守"},
    {"name": "reg_alpha", "label": "L1 正则系数", "type": "float", "default": 0.0, "min": 0.0, "max": 10.0, "step": 0.1,
     "tooltip": "权重的 L1 正则化项（Lasso），可令权重稀疏"},
    {"name": "reg_lambda", "label": "L2 正则系数", "type": "float", "default": 1.0, "min": 0.0, "max": 10.0, "step": 0.1,
     "tooltip": "权重的 L2 正则化项（Ridge），防止过拟合"},
    {"name": "gamma", "label": "最小分裂增益", "type": "float", "default": 0.0, "min": 0.0, "max": 10.0, "step": 0.1,
     "tooltip": "节点分裂所需最小损失减少量，越大越保守"},
    {"name": "scale_pos_weight", "label": "正负样本权重比", "type": "float", "default": 1.0, "min": 0.0, "max": 100.0,
     "step": 1.0, "tooltip": "正负样本权重比，用于类不平衡场景（分类）"},
    {"name": "max_delta_step", "label": "最大步长", "type": "float", "default": 0.0, "min": 0.0, "max": 10.0, "step": 0.5,
     "tooltip": "限制每棵树权重更新的最大步长，0 表示不限制"},
    {"name": "tree_method", "label": "建树算法", "type": "select",
     "options": ["auto", "exact", "approx", "hist", "gpu_hist"], "default": "hist",
     "tooltip": "hist 速度快，大数据集推荐"},
    {"name": "objective", "label": "目标函数", "type": "select",
     "options": ["binary:logistic", "multi:softmax", "multi:softprob",
                 "reg:squarederror", "reg:absoluteerror", "reg:logistic"],
     "default": "binary:logistic",
     "tooltip": "自动从任务类型推断，也可手动覆盖"},
]

DEFAULT_SEARCH_SPACE = {
    "n_estimators": [50, 300],
    "max_depth": [3, 10],
    "learning_rate": [0.01, 0.3],
    "subsample": [0.5, 1.0],
    "colsample_bytree": [0.5, 1.0],
    "reg_alpha": [0.0, 1.0],
    "reg_lambda": [0.5, 2.0],
}


def get_param_schema() -> list[dict[str, Any]]:
    return PARAM_SCHEMA


def recommend_params(split_id: int, db: Session) -> dict[str, Any]:
    """基于数据集规模/类型做规则推荐"""
    split = db.query(DatasetSplit).filter(DatasetSplit.id == split_id).first()
    if not split:
        raise HTTPException(status_code=404, detail="数据集划分不存在")

    dataset = db.query(Dataset).filter(Dataset.id == split.dataset_id).first()
    target_col = dataset.target_column if dataset else None

    try:
        train_df = pd.read_csv(DATA_DIR / split.train_path, encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError):
        return {"params": {}, "search_space": DEFAULT_SEARCH_SPACE, "note": "无法读取训练集"}

    n_rows, n_cols = train_df.shape
    if target_col and target_col in train_df.columns:
        y = train_df[target_col]
        n_classes = y.nunique()
    else:
        n_classes = 2

    # 规则推荐
    params: dict[str, Any] = {}
    notes: list[str] = []

    if n_rows < 1000:
        params["n_estimators"] = 100
        params["max_depth"] = 4
        notes.append("小数据集：树数量100，深度4")
    elif n_rows < 10000:
        params["n_estimators"] = 200
        params["max_depth"] = 6
        notes.append("中等数据集：树数量200，深度6")
    else:
        params["n_estimators"] = 500
        params["max_depth"] = 8
        params["tree_method"] = "hist"
        notes.append("大数据集：hist模式，树数量500，深度8")

    if n_cols > 50:
        params["colsample_bytree"] = 0.7
        notes.append("高维特征：colsample_bytree=0.7")

    # 类不平衡
    if n_classes == 2:
        pos_rate = float((y == y.unique()[1]).mean()) if target_col and target_col in train_df.columns else 0.5
        if pos_rate < 0.15 or pos_rate > 0.85:
            ratio = round((1 - pos_rate) / pos_rate, 2) if pos_rate > 0 else 1.0
            params["scale_pos_weight"] = ratio
            notes.append(f"类不平衡：scale_pos_weight={ratio}")
    elif n_classes > 2:
        params["objective"] = "multi:softprob"
        params["num_class"] = int(n_classes)

    params.setdefault("learning_rate", 0.1)
    params.setdefault("subsample", 0.8)
    params.setdefault("reg_lambda", 1.0)
    params.setdefault("reg_alpha", 0.0)

    return {
        "params": params,
        "search_space": DEFAULT_SEARCH_SPACE,
        "notes": notes,
    }


def validate_params(params: dict[str, Any]) -> dict[str, Any]:
    """验证 XGBoost 参数合法性"""
    errors: dict[str, str] = {}
    int_fields = {"n_estimators": (1, 5000), "max_depth": (1, 30), "num_class": (2, 10000)}
    float_01 = {"subsample", "colsample_bytree", "colsample_bylevel", "colsample_bynode"}
    nonneg = {"reg_alpha", "reg_lambda", "gamma", "min_child_weight", "scale_pos_weight", "learning_rate"}

    for field, (lo, hi) in int_fields.items():
        if field in params:
            v = params[field]
            if not isinstance(v, (int, float)) or not (lo <= int(v) <= hi):
                errors[field] = f"应为 {lo}~{hi} 之间的整数"

    for field in float_01:
        if field in params:
            v = params[field]
            if not isinstance(v, (int, float)) or not (0.0 < float(v) <= 1.0):
                errors[field] = "应为 (0, 1] 的浮点数"

    for field in nonneg:
        if field in params:
            v = params[field]
            if not isinstance(v, (int, float)) or float(v) < 0:
                errors[field] = "应为非负数"

    valid_objectives = {
        "binary:logistic", "multi:softmax", "multi:softprob",
        "reg:squarederror", "reg:absoluteerror", "reg:logistic"
    }
    if "objective" in params and params["objective"] not in valid_objectives:
        errors["objective"] = f"不合法的目标函数，支持: {', '.join(valid_objectives)}"

    return {"valid": len(errors) == 0, "errors": errors}
