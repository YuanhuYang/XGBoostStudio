"""
特征分析与特征工程业务逻辑
"""
from __future__ import annotations

import uuid
import warnings
from typing import Any, Optional

import numpy as np
import pandas as pd
from fastapi import HTTPException
from sqlalchemy.orm import Session

from db.database import DATA_DIR
from db.models import Dataset
from services.dataset_service import _load_df, _save_df

warnings.filterwarnings("ignore")


# ── 特征分布分析 ──────────────────────────────────────────────────────────────

def get_feature_distributions(dataset: Dataset) -> list[dict[str, Any]]:
    from scipy import stats as sp_stats  # type: ignore

    df = _load_df(dataset)
    result = []
    for col in df.select_dtypes(include=[np.number]).columns:
        series = df[col].dropna()
        if len(series) < 3:
            continue
        skewness = float(series.skew())
        kurtosis = float(series.kurtosis())
        # Shapiro-Wilk（样本 > 5000 时截断）
        sample = series if len(series) <= 5000 else series.sample(5000, random_state=42)
        try:
            _, p_value = sp_stats.shapiro(sample)
        except Exception:
            p_value = None
        result.append({
            "column": col,
            "skewness": round(skewness, 4),
            "kurtosis": round(kurtosis, 4),
            "normality_p": round(float(p_value), 4) if p_value is not None else None,
            "is_normal": bool(p_value > 0.05) if p_value is not None else None,
        })
    return result


# ── 相关矩阵 ──────────────────────────────────────────────────────────────────

def get_correlation(dataset: Dataset, method: str = "pearson") -> dict[str, Any]:
    df = _load_df(dataset)
    numeric_df = df.select_dtypes(include=[np.number])
    if numeric_df.empty:
        return {"columns": [], "matrix": []}
    if method not in ("pearson", "spearman", "kendall"):
        method = "pearson"
    corr = numeric_df.corr(method=method)  # type: ignore
    return {
        "columns": list(corr.columns),
        "matrix": [[round(v, 4) if not np.isnan(v) else None
                    for v in row] for row in corr.values],
    }


# ── 特征与目标变量关系 ────────────────────────────────────────────────────────

def get_target_relation(dataset: Dataset, target_column: str) -> list[dict[str, Any]]:
    from scipy import stats as sp_stats  # type: ignore

    df = _load_df(dataset)
    if target_column not in df.columns:
        raise HTTPException(status_code=400, detail=f"目标列不存在: {target_column}")

    result = []
    for col in df.columns:
        if col == target_column:
            continue
        series = df[col].dropna()
        target = df.loc[series.index, target_column].dropna()
        common_idx = series.index.intersection(target.index)
        s, t = series.loc[common_idx], target.loc[common_idx]
        if len(s) < 5:
            continue

        entry: dict[str, Any] = {"column": col}
        if pd.api.types.is_numeric_dtype(s) and pd.api.types.is_numeric_dtype(t):
            r, p = sp_stats.pearsonr(s, t)
            entry.update({"type": "scatter", "pearson_r": round(float(r), 4),
                          "pearson_p": round(float(p), 4)})
        elif not pd.api.types.is_numeric_dtype(s):
            # ANOVA
            groups = [t[s == cat].values for cat in s.unique() if len(t[s == cat]) >= 2]
            if len(groups) >= 2:
                f, p = sp_stats.f_oneway(*groups)
                entry.update({"type": "boxplot", "anova_f": round(float(f), 4),
                              "anova_p": round(float(p), 4)})
        result.append(entry)
    return result


# ── VIF 多重共线性 ────────────────────────────────────────────────────────────

def get_vif(dataset: Dataset) -> list[dict[str, Any]]:
    from statsmodels.stats.outliers_influence import variance_inflation_factor  # type: ignore

    df = _load_df(dataset)
    numeric_df = df.select_dtypes(include=[np.number]).dropna()
    if numeric_df.shape[1] < 2:
        return []
    result = []
    cols = list(numeric_df.columns)
    X = numeric_df.values
    for i, col in enumerate(cols):
        try:
            vif = float(variance_inflation_factor(X, i))
        except Exception:
            vif = float("inf")
        result.append({
            "column": col,
            "vif": round(vif, 2) if np.isfinite(vif) else 9999,
            "level": "high" if vif > 10 else ("medium" if vif > 5 else "low"),
        })
    return sorted(result, key=lambda x: x["vif"], reverse=True)


# ── 互信息特征重要性 ──────────────────────────────────────────────────────────

def get_mutual_info_importance(dataset: Dataset, target_column: str) -> list[dict[str, Any]]:
    from sklearn.feature_selection import mutual_info_classif, mutual_info_regression  # type: ignore

    df = _load_df(dataset).dropna()
    if target_column not in df.columns:
        raise HTTPException(status_code=400, detail=f"目标列不存在: {target_column}")

    numeric_cols = [c for c in df.select_dtypes(include=[np.number]).columns if c != target_column]
    if not numeric_cols:
        return []

    X = df[numeric_cols].values
    y = df[target_column].values
    is_classification = df[target_column].nunique() <= 20

    if is_classification:
        scores = mutual_info_classif(X, y, random_state=42)
    else:
        scores = mutual_info_regression(X, y, random_state=42)

    result = [
        {"column": col, "importance": round(float(score), 4)}
        for col, score in zip(numeric_cols, scores)
    ]
    return sorted(result, key=lambda x: x["importance"], reverse=True)


# ── Mahalanobis 多元异常值 ────────────────────────────────────────────────────

def get_mahalanobis_outliers(dataset: Dataset) -> list[dict[str, Any]]:
    from scipy.spatial.distance import mahalanobis  # type: ignore
    from scipy import stats as sp_stats  # type: ignore

    df = _load_df(dataset)
    numeric_df = df.select_dtypes(include=[np.number]).dropna()
    if numeric_df.shape[1] < 2 or len(numeric_df) < 10:
        return []

    sample = numeric_df if len(numeric_df) <= 2000 else numeric_df.sample(2000, random_state=42)
    try:
        cov = np.cov(sample.values.T)
        inv_cov = np.linalg.pinv(cov)
        mean = sample.mean().values
        distances = [
            float(mahalanobis(row, mean, inv_cov))
            for row in sample.values
        ]
        threshold = float(np.percentile(distances, 97.5))
        result = []
        for idx, dist in zip(sample.index, distances):
            if dist > threshold:
                result.append({"row_index": int(idx), "mahalanobis_dist": round(dist, 4)})
        return result[:200]
    except Exception:
        return []


# ── 特征编码 ──────────────────────────────────────────────────────────────────

def encode_features(
    dataset: Dataset, columns: list[str], method: str,
    target_column: Optional[str], db: Session
) -> Dataset:
    df = _load_df(dataset)
    for col in columns:
        if col not in df.columns:
            continue
        if method == "onehot":
            dummies = pd.get_dummies(df[col], prefix=col, dtype=int)
            df = pd.concat([df.drop(columns=[col]), dummies], axis=1)
        elif method == "label":
            df[col] = pd.Categorical(df[col]).codes
        elif method == "target" and target_column and target_column in df.columns:
            means = df.groupby(col)[target_column].mean()
            df[col] = df[col].map(means)
    _save_df(df, dataset.path)
    dataset.cols = len(df.columns)
    db.commit()
    db.refresh(dataset)
    return dataset


# ── 特征缩放 ──────────────────────────────────────────────────────────────────

def scale_features(dataset: Dataset, columns: list[str], method: str, db: Session) -> Dataset:
    from sklearn.preprocessing import StandardScaler, MinMaxScaler, RobustScaler  # type: ignore

    df = _load_df(dataset)
    valid_cols = [c for c in columns if c in df.columns]
    if not valid_cols:
        return dataset

    scalers = {"standard": StandardScaler(), "minmax": MinMaxScaler(), "robust": RobustScaler()}
    scaler = scalers.get(method, StandardScaler())
    df[valid_cols] = scaler.fit_transform(df[valid_cols])
    _save_df(df, dataset.path)
    db.commit()
    db.refresh(dataset)
    return dataset


# ── Box-Cox 变换 ──────────────────────────────────────────────────────────────

def box_cox_transform(dataset: Dataset, columns: list[str], db: Session) -> Dataset:
    from scipy.stats import boxcox  # type: ignore

    df = _load_df(dataset)
    for col in columns:
        if col not in df.columns:
            continue
        series = df[col].dropna()
        if not pd.api.types.is_numeric_dtype(series) or (series <= 0).any():
            continue
        try:
            transformed, _ = boxcox(series)
            df.loc[series.index, col] = transformed
        except Exception:
            pass
    _save_df(df, dataset.path)
    db.commit()
    db.refresh(dataset)
    return dataset


# ── PCA 降维 ──────────────────────────────────────────────────────────────────

def pca_transform(dataset: Dataset, columns: list[str], n_components: int, db: Session) -> Dataset:
    from sklearn.decomposition import PCA  # type: ignore

    df = _load_df(dataset)
    valid_cols = [c for c in columns if c in df.columns and pd.api.types.is_numeric_dtype(df[c])]
    if len(valid_cols) < 2:
        raise HTTPException(status_code=400, detail="PCA 需要至少 2 个数值列")

    n_components = min(n_components, len(valid_cols))
    pca = PCA(n_components=n_components, random_state=42)
    pca_result = pca.fit_transform(df[valid_cols].fillna(0))
    pca_df = pd.DataFrame(pca_result, columns=[f"PC{i+1}" for i in range(n_components)], index=df.index)
    df = pd.concat([df.drop(columns=valid_cols), pca_df], axis=1)
    _save_df(df, dataset.path)
    dataset.cols = len(df.columns)
    db.commit()
    db.refresh(dataset)
    return dataset


# ── 特征选择 ──────────────────────────────────────────────────────────────────

def select_features(
    dataset: Dataset, method: str, target_column: str,
    threshold: Optional[float], n_features: Optional[int], db: Session
) -> Dataset:
    from sklearn.feature_selection import VarianceThreshold, SelectFromModel  # type: ignore
    from sklearn.linear_model import LassoCV  # type: ignore

    df = _load_df(dataset).dropna()
    if target_column not in df.columns:
        raise HTTPException(status_code=400, detail=f"目标列不存在: {target_column}")

    feature_cols = [c for c in df.select_dtypes(include=[np.number]).columns if c != target_column]
    X = df[feature_cols]
    y = df[target_column]

    selected: list[str] = feature_cols
    if method == "variance":
        t = threshold or 0.01
        sel = VarianceThreshold(threshold=t)
        sel.fit(X)
        selected = [c for c, s in zip(feature_cols, sel.get_support()) if s]
    elif method == "correlation":
        t = threshold or 0.9
        corr_matrix = X.corr().abs()
        upper = corr_matrix.where(np.triu(np.ones(corr_matrix.shape), k=1).astype(bool))
        to_drop = [col for col in upper.columns if any(upper[col] > t)]
        selected = [c for c in feature_cols if c not in to_drop]
    elif method == "l1":
        lasso = LassoCV(cv=3, random_state=42, max_iter=1000)
        lasso.fit(X, y)
        sel = SelectFromModel(lasso, prefit=True)
        selected = [c for c, s in zip(feature_cols, sel.get_support()) if s] or feature_cols

    keep_cols = selected + [target_column]
    non_feature_cols = [c for c in df.columns if c not in feature_cols and c != target_column]
    final_cols = non_feature_cols + keep_cols
    df_selected = df[[c for c in final_cols if c in df.columns]]
    _save_df(df_selected, dataset.path)
    dataset.cols = len(df_selected.columns)
    db.commit()
    db.refresh(dataset)
    return dataset
