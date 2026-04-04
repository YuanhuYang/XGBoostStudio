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
    {
        "name": "n_estimators", "label": "树的数量", "type": "int", "default": 100, "min": 10, "max": 2000, "step": 10,
        "tooltip": "Boosting 轮次（树的棵数），越大模型越复杂，训练越慢",
        "impact_up": "训练时间增加，模型表达能力提升，但边际收益递减，过拟合风险轻微上升",
        "impact_down": "训练更快，但树太少可能导致欠拟合，模型精度不足",
        "overfitting_risk": "low",
        "beginner_hide": False,
        "learn_more": "n_estimators 像雇佣多少位专家顾问——顾问越多，集体决策越稳定，但到一定数量后新增顾问的贡献趋于零。通常配合 learning_rate 使用：learning_rate 越小，需要的树越多。",
        "math_note": "最终预测 = Σ(i=1..T) η·fᵢ(x)，T 即 n_estimators，η 为 learning_rate",
        "tuning_tips": "小数据集(< 1k行)建议 50-200；中等数据集(1k-10k)建议 100-500；大数据集(> 10k)建议 200-1000。配合 early_stopping_rounds 自动找到最优轮次。",
    },
    {
        "name": "max_depth", "label": "最大深度", "type": "int", "default": 6, "min": 1, "max": 20, "step": 1,
        "tooltip": "单棵树最大深度，越深模型越复杂，越易过拟合",
        "impact_up": "模型可以学到更复杂的特征交互，但训练时间增加，过拟合风险明显上升",
        "impact_down": "模型更保守、泛化能力更强，但可能欠拟合，无法捕捉复杂规律",
        "overfitting_risk": "high",
        "beginner_hide": False,
        "learn_more": "max_depth 就像规定一棵决策树最多可以提问多少个问题。深度越大，树能学到越细的规则，但也越容易'背下'训练数据的噪声而失去泛化能力。",
        "math_note": "深度为 d 的完全二叉树最多有 2^d 个叶节点，即模型复杂度随深度指数增长",
        "tuning_tips": "一般推荐 3-8。样本很少时用 3-4；中等规模可用 5-6；特征复杂且数据充足时可尝试 7-10。大于 10 通常会过拟合。",
    },
    {
        "name": "learning_rate", "label": "学习率", "type": "float", "default": 0.1, "min": 0.001, "max": 1.0, "step": 0.001,
        "log_scale": True, "tooltip": "每步 shrinkage，越小需越多轮次",
        "impact_up": "收敛更快，训练轮次减少，但可能跳过最优解，最终精度略低",
        "impact_down": "收敛更稳定，最终精度更高，但需要配合更多的 n_estimators，训练时间增加",
        "overfitting_risk": "medium",
        "beginner_hide": False,
        "learn_more": "learning_rate 是每棵树对最终预测贡献的缩放系数，也叫 shrinkage。低学习率意味着每步走得小，虽然慢但不容易走偏；高学习率每步大步前进，快但容易不稳定。",
        "math_note": "更新公式：Fₜ(x) = Fₜ₋₁(x) + η·fₜ(x)，η 即 learning_rate",
        "tuning_tips": "推荐范围 0.01-0.3。常见组合：lr=0.1 + n_estimators=100；lr=0.05 + n_estimators=300；lr=0.01 + n_estimators=1000（最高精度）。",
    },
    {
        "name": "subsample", "label": "行采样比例", "type": "float", "default": 1.0, "min": 0.1, "max": 1.0, "step": 0.05,
        "tooltip": "每棵树随机采样的训练样本比例，有助于防止过拟合",
        "impact_up": "使用更多样本，训练更稳定，但可能过拟合",
        "impact_down": "增加随机性，有正则化效果，但样本太少会导致每棵树偏差较大",
        "overfitting_risk": "low",
        "beginner_hide": False,
        "learn_more": "subsample 类似随机森林的 Bootstrap 采样，每棵树只看到部分数据。这种随机性让每棵树各有侧重，集成后反而更健壮，是防过拟合的重要手段。",
        "math_note": "每轮随机无放回抽取 subsample × N 条样本用于建树",
        "tuning_tips": "默认 1.0（全量）。高维或大数据集推荐 0.6-0.8；已有轻微过拟合迹象时降到 0.5-0.7。不建议 < 0.5。",
    },
    {
        "name": "colsample_bytree", "label": "列采样比例(树)", "type": "float", "default": 1.0, "min": 0.1, "max": 1.0,
        "step": 0.05, "tooltip": "每棵树随机采样的特征比例",
        "impact_up": "使用更多特征，每棵树信息更丰富",
        "impact_down": "每棵树只看到部分特征，增加多样性，防过拟合，也可以加速训练",
        "overfitting_risk": "low",
        "beginner_hide": False,
        "learn_more": "与 subsample 类似，但作用于特征维度。高维特征时（列数 > 50）降低此值可以有效防止过拟合，同时加快训练速度。",
        "math_note": "每棵树随机选取 colsample_bytree × M 个特征（M 为总特征数）",
        "tuning_tips": "特征数 < 20 时默认 1.0 即可；特征数 20-100 推荐 0.7-0.9；特征数 > 100 推荐 0.5-0.7。",
    },
    {
        "name": "colsample_bylevel", "label": "列采样比例(层)", "type": "float", "default": 1.0, "min": 0.1, "max": 1.0,
        "step": 0.05, "tooltip": "每一层分裂时随机采样的特征比例",
        "impact_up": "层级用更多特征，分裂更全面",
        "impact_down": "每层采样增加随机性，类似 dropout 效果，有正则化作用",
        "overfitting_risk": "low",
        "beginner_hide": True,
        "learn_more": "比 colsample_bytree 粒度更细，在每一层分裂时重新采样特征。通常 colsample_bytree 已够用，此参数用于精细调优。",
        "math_note": "每层分裂时重新随机选取 colsample_bylevel × M 个特征参与分裂搜索",
        "tuning_tips": "高级调参才需要。通常和 colsample_bytree 配合使用，设为 0.7-1.0。",
    },
    {
        "name": "min_child_weight", "label": "最小子节点权重", "type": "float", "default": 1.0, "min": 0.0, "max": 100.0,
        "step": 1.0, "tooltip": "叶节点所需最小样本权重和，越大模型越保守",
        "impact_up": "分裂条件更严格，树更保守，过拟合风险降低，但可能欠拟合",
        "impact_down": "允许更小的叶节点，模型可以捕捉更细的规律，过拟合风险上升",
        "overfitting_risk": "low",
        "beginner_hide": True,
        "learn_more": "控制叶节点中最少需要多少样本权重。对于平衡数据集，它近似等于最小样本数。增大这个值是一种常见的防过拟合正则化手段。",
        "math_note": "叶节点分裂条件：该叶下样本的 Hessian 之和 ≥ min_child_weight",
        "tuning_tips": "默认 1。过拟合时可调至 5-20。类不平衡时要小心：少数类样本少，过大的值会阻止分裂。",
    },
    {
        "name": "reg_alpha", "label": "L1 正则系数", "type": "float", "default": 0.0, "min": 0.0, "max": 10.0, "step": 0.1,
        "tooltip": "权重的 L1 正则化项（Lasso），可令权重稀疏",
        "impact_up": "更强的稀疏化效果，让不重要特征权重变为 0，起到特征选择作用",
        "impact_down": "正则效果减弱，接近无 L1 约束",
        "overfitting_risk": "low",
        "beginner_hide": True,
        "learn_more": "L1 正则化（Lasso）对权重施加绝对值惩罚，会将不重要特征的权重精确推到 0，相当于自动特征选择。高维特征时非常有用。",
        "math_note": "损失函数增加惩罚项 α·Σ|wⱼ|，α 即 reg_alpha",
        "tuning_tips": "默认 0（无 L1 正则）。高维特征（> 100列）时可尝试 0.1-1.0；已有过拟合时设 0.5-2.0。",
    },
    {
        "name": "reg_lambda", "label": "L2 正则系数", "type": "float", "default": 1.0, "min": 0.0, "max": 10.0, "step": 0.1,
        "tooltip": "权重的 L2 正则化项（Ridge），防止过拟合",
        "impact_up": "更强的权重平滑约束，过拟合风险降低，但可能轻微降低拟合能力",
        "impact_down": "正则效果减弱，权重可以更自由增长",
        "overfitting_risk": "low",
        "beginner_hide": True,
        "learn_more": "L2 正则化（Ridge）对权重施加平方惩罚，让所有权重保持小而平滑。与 L1 不同，L2 不会将权重变为 0，而是让所有特征都以较小的权重参与预测。",
        "math_note": "损失函数增加惩罚项 λ·Σwⱼ²，λ 即 reg_lambda",
        "tuning_tips": "默认 1，一般不需要修改。过拟合严重时可调至 2-5。",
    },
    {
        "name": "gamma", "label": "最小分裂增益", "type": "float", "default": 0.0, "min": 0.0, "max": 10.0, "step": 0.1,
        "tooltip": "节点分裂所需最小损失减少量，越大越保守",
        "impact_up": "分裂门槛更高，树结构更简单，过拟合风险降低，但可能欠拟合",
        "impact_down": "更容易发生分裂，树更复杂",
        "overfitting_risk": "low",
        "beginner_hide": True,
        "learn_more": "gamma 是树分裂的'最低收益门槛'。如果一次分裂对损失函数的改善量低于 gamma，就不进行这次分裂。这是一种剪枝机制，让模型只学习真正有价值的规律。",
        "math_note": "分裂条件：损失减少量 ΔLoss ≥ γ；否则不分裂",
        "tuning_tips": "默认 0（任何收益都分裂）。过拟合时可设 0.1-1.0。",
    },
    {
        "name": "scale_pos_weight", "label": "正负样本权重比", "type": "float", "default": 1.0, "min": 0.0, "max": 100.0,
        "step": 1.0, "tooltip": "正负样本权重比，用于类不平衡场景（分类）",
        "impact_up": "正样本（少数类）被赋予更高权重，模型更关注少数类，Recall 提升，Precision 可能降低",
        "impact_down": "少数类权重降低，模型更关注多数类",
        "overfitting_risk": "low",
        "beginner_hide": True,
        "learn_more": "当正负样本数量不均衡时（如欺诈检测中 99% 正常、1% 欺诈），模型会偏向多数类。通过设置 scale_pos_weight = 负样本数/正样本数，让模型平衡对待两类样本。",
        "math_note": "推荐设置：scale_pos_weight = count(负样本) / count(正样本)",
        "tuning_tips": "仅二分类时有效。严重不平衡（> 10:1）时必须设置；轻微不平衡（< 3:1）可先不设置。",
    },
    {
        "name": "max_delta_step", "label": "最大步长", "type": "float", "default": 0.0, "min": 0.0, "max": 10.0, "step": 0.5,
        "tooltip": "限制每棵树权重更新的最大步长，0 表示不限制",
        "impact_up": "更严格的步长限制，训练更稳定，但收敛可能更慢",
        "impact_down": "更宽松，步长自由增长",
        "overfitting_risk": "low",
        "beginner_hide": True,
        "learn_more": "通常只有在类不平衡的逻辑回归目标函数中有用，限制每步更新的最大幅度以稳定训练。绝大多数情况下保持默认值 0 即可。",
        "math_note": "每棵树的叶节点权重更新量 |Δw| ≤ max_delta_step",
        "tuning_tips": "一般不需要调整，保持默认 0。仅在类严重不平衡时参考设为 1-10。",
    },
    {
        "name": "tree_method", "label": "建树算法", "type": "select",
        "options": ["auto", "exact", "approx", "hist", "gpu_hist"], "default": "hist",
        "tooltip": "hist 速度快，大数据集推荐",
        "impact_up": "N/A（选择型参数）",
        "impact_down": "N/A（选择型参数）",
        "overfitting_risk": "low",
        "beginner_hide": True,
        "learn_more": "hist 算法使用直方图近似加速分裂点搜索，是现代大数据集的标准选择。exact 精确但慢，适合小数据集。gpu_hist 需 CUDA GPU 支持。",
        "math_note": "hist 将连续特征分成若干 bin，O(n·d·K) 代替 O(n·d·n) 的 exact 算法",
        "tuning_tips": "推荐始终使用 hist。只有数据集极小（< 1000行）且追求精确时才考虑 exact。",
    },
    {
        "name": "objective", "label": "目标函数", "type": "select",
        "options": ["binary:logistic", "multi:softmax", "multi:softprob",
                    "reg:squarederror", "reg:absoluteerror", "reg:logistic"],
        "default": "binary:logistic",
        "tooltip": "自动从任务类型推断，也可手动覆盖",
        "impact_up": "N/A（选择型参数）",
        "impact_down": "N/A（选择型参数）",
        "overfitting_risk": "low",
        "beginner_hide": True,
        "learn_more": "目标函数决定模型优化的方向。二分类用 binary:logistic；多分类用 multi:softprob；回归用 reg:squarederror（RMSE）。系统会根据数据自动推断，通常无需手动修改。",
        "math_note": "binary:logistic 极小化 log loss = -Σ[yᵢ·log(p̂ᵢ) + (1-yᵢ)·log(1-p̂ᵢ)]",
        "tuning_tips": "系统自动推断，通常无需手动设置。",
    },
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
        # 判断是否为回归任务：浮点型或唯一值超 20 视为回归
        _is_regression = (
            pd.api.types.is_float_dtype(y)
            or n_classes > 20
            or y.dtype not in (int, "int64", "int32", object)
        )
    else:
        n_classes = 2
        _is_regression = False

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

    # 类不平衡 / 多分类：仅在分类任务时设置
    if not _is_regression:
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

    # 生成每个参数的自然语言解释
    explanations: dict[str, str] = {
        "n_estimators": (
            f"您的训练集有 {n_rows} 行数据，"
            + ("数据量较小，推荐较少的树（100棵）避免过拟合" if n_rows < 1000
               else "中等规模数据，推荐200棵树获得较好精度" if n_rows < 10000
               else "大数据集，推荐500棵树以充分学习数据规律")
        ),
        "max_depth": (
            f"特征数量为 {n_cols}，"
            + ("建议较浅的树（深度4），防止小数据集过拟合" if n_rows < 1000
               else "建议中等深度（深度6），平衡表达力与泛化" if n_rows < 10000
               else "数据充足，允许较深树（深度8）学习复杂规律")
        ),
        "learning_rate": "默认学习率 0.1，配合早停可自动找到最优轮次",
        "subsample": "行采样 0.8，保留 80% 样本降低过拟合风险",
        "colsample_bytree": (
            f"特征数 {n_cols}，" + ("列数较多，推荐采样 70% 特征加快训练" if n_cols > 50
                                    else "特征数适中，使用全量特征")
        ),
        "reg_lambda": "L2 正则化系数 1.0，标准设置，有效防止权重过大",
        "reg_alpha": "L1 正则化关闭（0），特征少时无需稀疏化",
    }
    if "scale_pos_weight" in params:
        explanations["scale_pos_weight"] = (
            f"检测到类不平衡（正样本比例约 {pos_rate:.1%}），"
            f"推荐 scale_pos_weight={params['scale_pos_weight']} 帮助模型平衡两类样本"
        )

    return {
        "params": params,
        "search_space": DEFAULT_SEARCH_SPACE,
        "notes": notes,
        "explanations": explanations,
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
