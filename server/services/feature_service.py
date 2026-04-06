"""
特征分析与特征工程业务逻辑
"""
from __future__ import annotations

import warnings
from typing import Any, Optional

import numpy as np
import pandas as pd
from fastapi import HTTPException
from sqlalchemy.orm import Session

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
        except (ValueError, TypeError):
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
        except (ValueError, np.linalg.LinAlgError):
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
    except (ValueError, np.linalg.LinAlgError):
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
    new_path = _save_df(df, dataset.path)
    dataset.path = new_path
    dataset.file_type = 'csv'
    dataset.cols = len(df.columns)
    db.commit()
    db.refresh(dataset)
    return dataset


# ── 特征缩放 ──────────────────────────────────────────────────────────────────

def scale_features(dataset: Dataset, columns: Optional[list[str]], method: str, db: Session) -> Dataset:
    from sklearn.preprocessing import StandardScaler, MinMaxScaler, RobustScaler  # type: ignore

    df = _load_df(dataset)
    if columns:
        valid_cols = [c for c in columns if c in df.columns and pd.api.types.is_numeric_dtype(df[c])]
    else:
        valid_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    if not valid_cols:
        return dataset

    scalers = {"standard": StandardScaler(), "minmax": MinMaxScaler(), "robust": RobustScaler()}
    scaler = scalers.get(method, StandardScaler())
    df[valid_cols] = scaler.fit_transform(df[valid_cols])
    new_path = _save_df(df, dataset.path)
    dataset.path = new_path
    dataset.file_type = 'csv'
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
        except (ValueError, RuntimeError):
            pass
    new_path = _save_df(df, dataset.path)
    dataset.path = new_path
    dataset.file_type = 'csv'
    db.commit()
    db.refresh(dataset)
    return dataset


# ── PCA 降维 ──────────────────────────────────────────────────────────────────

def pca_transform(dataset: Dataset, columns: Optional[list[str]], n_components: int, db: Session) -> Dataset:
    from sklearn.decomposition import PCA  # type: ignore

    df = _load_df(dataset)
    target_col = dataset.target_column
    if columns:
        valid_cols = [c for c in columns if c in df.columns and pd.api.types.is_numeric_dtype(df[c])]
    else:
        valid_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    if target_col and target_col in valid_cols:
        valid_cols = [c for c in valid_cols if c != target_col]
    if len(valid_cols) < 2:
        raise HTTPException(status_code=400, detail="PCA 需要至少 2 个数值特征列（已自动排除目标列）")

    n_components = min(n_components, len(valid_cols))
    pca = PCA(n_components=n_components, random_state=42)
    pca_result = pca.fit_transform(df[valid_cols].fillna(0))
    pca_df = pd.DataFrame(pca_result, columns=[f"PC{i+1}" for i in range(n_components)], index=df.index)
    df = pd.concat([df.drop(columns=valid_cols), pca_df], axis=1)
    new_path = _save_df(df, dataset.path)
    dataset.path = new_path
    dataset.file_type = 'csv'
    dataset.cols = len(df.columns)
    db.commit()
    db.refresh(dataset)
    return dataset


# ── 特征选择 ──────────────────────────────────────────────────────────────────

def select_features(
    dataset: Dataset, method: str, target_column: str,
    threshold: Optional[float], n_features: Optional[int], db: Session
) -> Dataset:
    # n_features: used by l1 method to limit SelectFromModel.max_features
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
        max_feat = n_features if n_features and n_features > 0 else -1
        sel = SelectFromModel(lasso, prefit=True, max_features=max_feat if max_feat > 0 else None)
        selected = [c for c, s in zip(feature_cols, sel.get_support()) if s] or feature_cols

    keep_cols = selected + [target_column]
    non_feature_cols = [c for c in df.columns if c not in feature_cols and c != target_column]
    final_cols = non_feature_cols + keep_cols
    df_selected = df[[c for c in final_cols if c in df.columns]]
    new_path = _save_df(df_selected, dataset.path)
    dataset.path = new_path
    dataset.file_type = 'csv'
    dataset.cols = len(df_selected.columns)
    db.commit()
    db.refresh(dataset)
    return dataset


# ── 分布拟合检验 ──────────────────────────────────────────────────────────────

def get_distribution_tests(dataset: Dataset, column: str) -> dict[str, Any]:
    """拟合正态、对数正态、指数三种分布，返回 KS/Anderson-Darling 检验结果"""
    from scipy import stats as sp_stats  # type: ignore

    df = _load_df(dataset)
    if column not in df.columns:
        raise HTTPException(status_code=400, detail=f"列不存在: {column}")
    if not pd.api.types.is_numeric_dtype(df[column]):
        raise HTTPException(status_code=400, detail=f"列 {column} 不是数值型")

    series = df[column].dropna()
    if len(series) < 10:
        raise HTTPException(status_code=400, detail="样本量不足（< 10）")

    _dist_map = [
        ("正态分布", "norm"),
        ("对数正态分布", "lognorm"),
        ("指数分布", "expon"),
    ]
    tests: list[dict[str, Any]] = []
    for dist_label, dist_name in _dist_map:
        dist = getattr(sp_stats, dist_name)
        try:
            if dist_name == "lognorm" and (series <= 0).any():
                tests.append({"distribution": dist_label, "ks_stat": None, "ks_p": None,
                               "ks_pass": False, "ad_stat": None, "ad_pass": None})
                continue
            params = dist.fit(series)
            ks_stat, ks_p = sp_stats.kstest(series, dist_name, args=params)
            ad_stat: float | None = None
            ad_pass: bool | None = None
            if dist_name == "norm":
                try:
                    ad_result = sp_stats.anderson(series.values, dist="norm")
                    ad_stat = round(float(ad_result.statistic), 4)
                    # 5% 显著性水平对应 critical_values[2]
                    ad_pass = bool(ad_stat < ad_result.critical_values[2])
                except (ValueError, IndexError):
                    pass
            tests.append({
                "distribution": dist_label,
                "ks_stat": round(float(ks_stat), 4),
                "ks_p": round(float(ks_p), 4),
                "ks_pass": bool(ks_p > 0.05),
                "ad_stat": ad_stat,
                "ad_pass": ad_pass,
            })
        except (ValueError, TypeError, FloatingPointError, OverflowError):
            tests.append({"distribution": dist_label, "ks_stat": None, "ks_p": None,
                           "ks_pass": False, "ad_stat": None, "ad_pass": None})

    valid = [t for t in tests if t.get("ks_p") is not None]
    best = max(valid, key=lambda x: x["ks_p"]) if valid else None
    is_normal = next((t["ks_pass"] for t in tests if t["distribution"] == "正态分布"), False)
    skewness = round(float(series.skew()), 4)

    if is_normal:
        recommendation = (
            f"该列符合正态分布（KS p = {next((t['ks_p'] for t in tests if t['distribution']=='正态分布'), 0):.3f}，> 0.05）"
        )
    elif best:
        transform_hint = (
            "，建议对该列进行 Box-Cox / Yeo-Johnson 变换以改善偏度" if abs(skewness) > 1 else ""
        )
        recommendation = (
            f"不符合正态分布（p < 0.05）。推荐最佳拟合分布：{best['distribution']}"
            f"（KS p = {best['ks_p']:.3f}）{transform_hint}"
        )
    else:
        recommendation = "无法确定最佳分布，请检查数据"

    return {
        "column": column,
        "n": int(len(series)),
        "mean": round(float(series.mean()), 4),
        "std": round(float(series.std()), 4),
        "skewness": skewness,
        "kurtosis": round(float(series.kurtosis()), 4),
        "tests": tests,
        "best_fit": best["distribution"] if best else None,
        "is_normal": is_normal,
        "recommendation": recommendation,
    }


# ── IV / KS / 单特征 AUC（分类）& 相关 / F值 / R²（回归）────────────────────

def calc_iv_ks_auc(dataset: Dataset, target_column: str) -> list[dict[str, Any]]:
    """
    分类任务：输出每个特征的 IV（信息价值）、KS（判别力）、单特征 AUC。
    回归任务：输出 Pearson 相关系数、F 检验值、单特征 R²。
    自动判断任务类型：目标列唯一值 ≤ 20 视为分类，否则回归。
    大数据集（>50000 行）自动采样 50000 行以保证性能。
    """
    from scipy import stats as sp_stats  # type: ignore
    from sklearn.metrics import roc_auc_score  # type: ignore

    df = _load_df(dataset)
    if target_column not in df.columns:
        raise HTTPException(status_code=400, detail=f"目标列不存在: {target_column}")

    # 采样上限
    if len(df) > 50000:
        df = df.sample(50000, random_state=42)

    y = df[target_column].dropna()
    feature_cols = [c for c in df.select_dtypes(include=[np.number]).columns if c != target_column]
    is_classification = int(y.nunique()) <= 20

    result: list[dict[str, Any]] = []

    for col in feature_cols:
        s = df[col].dropna()
        common_idx = s.index.intersection(y.index)
        s, t = s.loc[common_idx], y.loc[common_idx]
        if len(s) < 10:
            continue

        entry: dict[str, Any] = {"column": col, "task_type": "classification" if is_classification else "regression"}

        if is_classification:
            # ── IV 计算（等频 10 箱）────────────────────────────
            try:
                bins = pd.qcut(s, q=min(10, s.nunique()), duplicates="drop")
                grouped = pd.DataFrame({"feature": bins, "target": t}).groupby("feature")
                n_pos = int((t == 1).sum()) or 1
                n_neg = int((t == 0).sum()) or 1
                iv = 0.0
                ks_max = 0.0
                cum_pos, cum_neg = 0.0, 0.0
                for _, grp in grouped:
                    pos = int((grp["target"] == 1).sum())
                    neg = int((grp["target"] == 0).sum())
                    p_pos = pos / n_pos
                    p_neg = neg / n_neg
                    if p_pos > 0 and p_neg > 0:
                        woe = np.log(p_pos / p_neg)
                        iv += (p_pos - p_neg) * woe
                    cum_pos += p_pos
                    cum_neg += p_neg
                    ks_max = max(ks_max, abs(cum_pos - cum_neg))
                iv_level = "强" if iv > 0.3 else ("中" if iv > 0.1 else ("弱" if iv > 0.02 else "无效"))
                entry["iv"] = round(float(iv), 4)
                entry["iv_level"] = iv_level
                entry["ks"] = round(float(ks_max), 4)
            except Exception:
                entry["iv"] = None
                entry["iv_level"] = "N/A"
                entry["ks"] = None

            # ── 单特征 AUC ───────────────────────────────────────
            try:
                auc = float(roc_auc_score(t, s))
                auc = max(auc, 1 - auc)  # 保证 >= 0.5
                entry["single_auc"] = round(auc, 4)
            except Exception:
                entry["single_auc"] = None
        else:
            # 回归：Pearson 相关、F 检验、单特征 R²
            try:
                r, p_r = sp_stats.pearsonr(s, t)
                entry["pearson_r"] = round(float(r), 4)
                entry["pearson_p"] = round(float(p_r), 4)
            except Exception:
                entry["pearson_r"] = None
                entry["pearson_p"] = None
            try:
                f_val, p_f = sp_stats.f_oneway(*[t[pd.qcut(s, q=min(5, s.nunique()), duplicates="drop") == b]
                                                  for b in pd.qcut(s, q=min(5, s.nunique()), duplicates="drop").unique()])
                entry["f_stat"] = round(float(f_val), 4)
                entry["f_p"] = round(float(p_f), 4)
            except Exception:
                entry["f_stat"] = None
                entry["f_p"] = None
            try:
                from sklearn.linear_model import LinearRegression  # type: ignore
                lr = LinearRegression().fit(s.values.reshape(-1, 1), t.values)
                ss_res = float(np.sum((t.values - lr.predict(s.values.reshape(-1, 1))) ** 2))
                ss_tot = float(np.sum((t.values - t.mean()) ** 2))
                r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
                entry["r2"] = round(float(r2), 4)
            except Exception:
                entry["r2"] = None

        result.append(entry)

    return sorted(result, key=lambda x: (x.get("iv") or x.get("single_auc") or x.get("r2") or 0), reverse=True)


# ── PSI（群体稳定性指数）────────────────────────────────────────────────────

def calc_psi_all(dataset: Dataset, time_column: str, target_column: Optional[str] = None) -> list[dict[str, Any]]:
    """
    按时间列将数据分为 基准期（前60%）和 对比期（后40%），计算每个数值特征的 PSI。
    PSI < 0.1 → 稳定；0.1-0.25 → 轻微变化；> 0.25 → 不稳定，需关注。
    """
    df = _load_df(dataset)
    if time_column not in df.columns:
        raise HTTPException(status_code=400, detail=f"时间列不存在: {time_column}")

    if len(df) > 50000:
        df = df.sample(50000, random_state=42)

    df_sorted = df.sort_values(time_column).reset_index(drop=True)
    split_idx = int(len(df_sorted) * 0.6)
    base_df = df_sorted.iloc[:split_idx]
    compare_df = df_sorted.iloc[split_idx:]

    feature_cols = [c for c in df.select_dtypes(include=[np.number]).columns
                    if c != time_column and c != target_column]
    result = []

    for col in feature_cols:
        try:
            base_s = base_df[col].dropna()
            comp_s = compare_df[col].dropna()
            if len(base_s) < 5 or len(comp_s) < 5:
                continue

            bins = pd.qcut(base_s, q=min(10, base_s.nunique()), duplicates="drop", retbins=True)[1]
            bins[0] = -np.inf
            bins[-1] = np.inf

            base_counts = pd.cut(base_s, bins=bins).value_counts(sort=False) / len(base_s)
            comp_counts = pd.cut(comp_s, bins=bins).value_counts(sort=False) / len(comp_s)

            psi = 0.0
            for b_pct, c_pct in zip(base_counts, comp_counts):
                b_pct = max(b_pct, 1e-6)
                c_pct = max(c_pct, 1e-6)
                psi += (c_pct - b_pct) * np.log(c_pct / b_pct)

            psi = float(psi)
            level = "稳定" if psi < 0.1 else ("轻微变化" if psi < 0.25 else "不稳定")
            result.append({
                "column": col,
                "psi": round(psi, 4),
                "level": level,
                "recommendation": "可安全入模" if psi < 0.1 else ("建议关注分布变化" if psi < 0.25 else "建议剔除或重新评估该特征"),
            })
        except Exception:
            continue

    return sorted(result, key=lambda x: x["psi"], reverse=True)


# ── 特征业务单调性分析 ────────────────────────────────────────────────────────

def calc_monotonicity(dataset: Dataset, target_column: str) -> list[dict[str, Any]]:
    """
    分析每个数值特征与目标变量的趋势一致性，为 XGBoost monotone_constraints 提供建议。
    输出：特征取值分箱后与目标均值的单调性方向（升/降/非单调）及置信度。
    """
    from scipy import stats as sp_stats  # type: ignore

    df = _load_df(dataset)
    if target_column not in df.columns:
        raise HTTPException(status_code=400, detail=f"目标列不存在: {target_column}")

    if len(df) > 50000:
        df = df.sample(50000, random_state=42)

    y = df[target_column].dropna()
    feature_cols = [c for c in df.select_dtypes(include=[np.number]).columns if c != target_column]
    result = []

    for col in feature_cols:
        s = df[col].dropna()
        common_idx = s.index.intersection(y.index)
        s, t = s.loc[common_idx], y.loc[common_idx]
        if len(s) < 10:
            continue

        try:
            n_bins = min(10, s.nunique())
            bins = pd.qcut(s, q=n_bins, duplicates="drop")
            bin_means = t.groupby(bins).mean().dropna()

            if len(bin_means) < 2:
                continue

            x_vals = list(range(len(bin_means)))
            y_vals = bin_means.values.tolist()
            rho, p_val = sp_stats.spearmanr(x_vals, y_vals)
            rho = float(rho) if not np.isnan(rho) else 0.0
            p_val = float(p_val) if not np.isnan(p_val) else 1.0

            if abs(rho) >= 0.7 and p_val < 0.05:
                direction = "单调递增" if rho > 0 else "单调递减"
                constraint = 1 if rho > 0 else -1
                confidence = "高" if abs(rho) >= 0.9 else "中"
            elif abs(rho) >= 0.4:
                direction = "弱单调递增" if rho > 0 else "弱单调递减"
                constraint = 0
                confidence = "低"
            else:
                direction = "非单调"
                constraint = 0
                confidence = "低"

            result.append({
                "column": col,
                "spearman_rho": round(rho, 4),
                "p_value": round(float(p_val), 4),
                "direction": direction,
                "confidence": confidence,
                "monotone_constraint": constraint,
                "bin_means": [round(v, 4) for v in y_vals],
                "recommendation": f"建议 monotone_constraints 设为 {constraint}" if constraint != 0 else "无强单调性约束建议",
            })
        except Exception:
            continue

    return sorted(result, key=lambda x: abs(x.get("spearman_rho") or 0), reverse=True)


# ── 标签专项分析（含 scale_pos_weight）────────────────────────────────────────

def get_label_analysis(dataset: Dataset, target_column: str) -> dict[str, Any]:
    """
    标签口径全维度分析：分布统计、正负样本比例、scale_pos_weight 推荐值、
    任务类型推断、异常标签值识别。
    """
    df = _load_df(dataset)
    if target_column not in df.columns:
        raise HTTPException(status_code=400, detail=f"目标列不存在: {target_column}")

    y = df[target_column].dropna()
    n_total = int(len(y))
    n_unique = int(y.nunique())

    # 任务类型推断
    if n_unique == 2:
        task_type = "binary_classification"
    elif n_unique <= 20 and not pd.api.types.is_float_dtype(y):
        task_type = "multiclass_classification"
    else:
        task_type = "regression"

    # 基础统计
    value_counts = y.value_counts().to_dict()
    value_counts_pct = (y.value_counts(normalize=True) * 100).round(2).to_dict()

    # 二分类：scale_pos_weight
    scale_pos_weight = None
    class_balance_warning = None
    if task_type == "binary_classification":
        neg_vals = [v for v in value_counts if v == 0 or str(v) == "0"]
        pos_vals = [v for v in value_counts if v == 1 or str(v) == "1"]
        if neg_vals and pos_vals:
            n_neg = int(value_counts[neg_vals[0]])
            n_pos = int(value_counts[pos_vals[0]])
            scale_pos_weight = round(n_neg / n_pos, 4) if n_pos > 0 else None
            ratio = n_neg / n_pos if n_pos > 0 else 1
            if ratio > 10:
                class_balance_warning = f"严重不均衡（负:正 = {ratio:.1f}:1），强烈建议设置 scale_pos_weight={scale_pos_weight}"
            elif ratio > 3:
                class_balance_warning = f"轻度不均衡（负:正 = {ratio:.1f}:1），建议设置 scale_pos_weight={scale_pos_weight}"
        else:
            vals = sorted(value_counts.keys())
            if len(vals) >= 2:
                n_neg = int(value_counts[vals[0]])
                n_pos = int(value_counts[vals[1]])
                scale_pos_weight = round(n_neg / n_pos, 4) if n_pos > 0 else None

    # 异常标签值识别（仅数值型）
    anomaly_labels = []
    if pd.api.types.is_numeric_dtype(y) and task_type == "regression":
        q1, q3 = float(y.quantile(0.25)), float(y.quantile(0.75))
        iqr = q3 - q1
        lower, upper = q1 - 3 * iqr, q3 + 3 * iqr
        anomalies = y[(y < lower) | (y > upper)]
        if len(anomalies) > 0:
            anomaly_labels = [{"value": float(v), "count": int((y == v).sum())} for v in anomalies.unique()[:10]]

    # 缺失标签
    n_missing_label = int(df[target_column].isna().sum())

    return {
        "target_column": target_column,
        "task_type": task_type,
        "n_total": n_total,
        "n_missing_label": n_missing_label,
        "n_unique": n_unique,
        "value_counts": {str(k): int(v) for k, v in value_counts.items()},
        "value_counts_pct": {str(k): float(v) for k, v in value_counts_pct.items()},
        "scale_pos_weight": scale_pos_weight,
        "class_balance_warning": class_balance_warning,
        "anomaly_labels": anomaly_labels,
        "label_stats": {
            "mean": round(float(y.mean()), 4) if pd.api.types.is_numeric_dtype(y) else None,
            "std": round(float(y.std()), 4) if pd.api.types.is_numeric_dtype(y) else None,
            "min": round(float(y.min()), 4) if pd.api.types.is_numeric_dtype(y) else None,
            "max": round(float(y.max()), 4) if pd.api.types.is_numeric_dtype(y) else None,
        },
    }


# ── PCA 辅助分析 ──────────────────────────────────────────────────────────────

def get_pca_analysis(dataset: Dataset, n_components: int = 10) -> dict[str, Any]:
    """PCA 分析：碎石图、载荷矩阵、双标图数据、降维建议"""
    from sklearn.decomposition import PCA  # type: ignore
    from sklearn.preprocessing import StandardScaler  # type: ignore

    df = _load_df(dataset)
    numeric_df = df.select_dtypes(include=[np.number])
    if numeric_df.shape[1] < 2:
        raise HTTPException(status_code=400, detail="需要至少 2 个数值特征才能做 PCA")

    # 填充缺失值（用列均值）并标准化
    numeric_filled = numeric_df.fillna(numeric_df.mean())
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(numeric_filled)

    n_features = numeric_df.shape[1]
    k = min(n_components, n_features, len(numeric_filled))

    pca = PCA(n_components=k, random_state=42)
    X_pca = pca.fit_transform(X_scaled)

    explained_var = [round(float(v), 4) for v in pca.explained_variance_ratio_]
    cumulative_var = [round(float(v), 4) for v in np.cumsum(pca.explained_variance_ratio_)]

    # 降维建议：累计方差 >= 95% 所需最少主成分数
    rec_idx = next((i for i, v in enumerate(cumulative_var) if v >= 0.95), k - 1)
    rec_k = rec_idx + 1
    rec_var = cumulative_var[rec_idx]

    # 载荷：各特征对前 min(k,5) 个主成分的贡献
    max_pcs = min(k, 5)
    loadings: list[dict[str, Any]] = []
    features = list(numeric_df.columns)
    for i, feat in enumerate(features):
        entry: dict[str, Any] = {"feature": feat}
        for j in range(max_pcs):
            entry[f"PC{j + 1}"] = round(float(pca.components_[j][i]), 4)
        loadings.append(entry)

    # Biplot 数据（最多取 150 个样本点）
    n_sample = min(150, len(X_pca))
    biplot_points = [
        {"x": round(float(X_pca[i, 0]), 4), "y": round(float(X_pca[i, 1]), 4)}
        for i in range(n_sample)
    ]

    return {
        "n_components": k,
        "n_features": n_features,
        "n_samples": int(len(df)),
        "features": features,
        "explained_variance": explained_var,
        "cumulative_variance": cumulative_var,
        "loadings": loadings,
        "biplot_points": biplot_points,
        "recommendation": f"保留前 {rec_k} 个主成分可解释 {rec_var * 100:.1f}% 的方差",
    }

