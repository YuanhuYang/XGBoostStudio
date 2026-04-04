"""
G2-R1 / G2-R1b：基于训练集的本地统计「数据叙事」，供 GET /data-narrative 与 PDF data_relations 章节使用。

depth 常量（AC-9-13 断言依据）：
- standard：数值列参与相关分析上限 12，相关对 Top 8，|r|≥0.45
- detailed：数值列上限 22，相关对 Top 18，|r|≥0.35；另算 Spearman 相关对 + Spearman 热力图
- 行数 > ROW_SAMPLE_THRESHOLD 时随机采样 SAMPLE_ROWS 行做相关/MI，并写入 meta.sample_note

G2-R1b（迭代计划缺口表）：低基数类别 Cramér's V、数值×类别箱线图 Top-N、statsmodels VIF、
缺失×目标的 χ²/t 检验（仅 p<阈值入列）、多重比较固定免责句。
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

import numpy as np
import pandas as pd
from fastapi import HTTPException
from scipy import stats
from scipy.stats import chi2_contingency
from sklearn.feature_selection import mutual_info_classif, mutual_info_regression
from sqlalchemy.orm import Session
from statsmodels.stats.outliers_influence import variance_inflation_factor

from db.database import DATA_DIR
from db.models import Dataset, DatasetSplit
from schemas.narrative import (
    CategoricalAssociationItem,
    ChartSpec,
    CorrelationMethod,
    CorrelationPair,
    DataNarrativeBullets,
    DataNarrativeMeta,
    DataNarrativeResponse,
    MissingVsTargetItem,
    MulticollinearityFlag,
    NarrativeDepth,
    TargetRelationItem,
    TargetRelationMetric,
    VariableProfile,
    VariableRole,
)

# --- depth 参数（验收与设计对齐）---
STANDARD_MAX_NUMERIC = 12
DETAILED_MAX_NUMERIC = 22
STANDARD_PAIR_TOP = 8
DETAILED_PAIR_TOP = 18
STANDARD_CORR_THRESHOLD = 0.45
DETAILED_CORR_THRESHOLD = 0.35
ROW_SAMPLE_THRESHOLD = 8000
SAMPLE_ROWS = 5000

# G2-R1b：类别关联、箱线图、VIF、缺失×目标
LOW_CARD_MAX = 10
STANDARD_CAT_PAIR_TOP = 8
DETAILED_CAT_PAIR_TOP = 18
STANDARD_CRAMER_TH = 0.12
DETAILED_CRAMER_TH = 0.08
STANDARD_BOX_TOP = 2
DETAILED_BOX_TOP = 5
VIF_WARN = 5.0
MISSING_P_THRESH = 0.05
MULTIPLICITY_CAVEAT = (
    "同时对多列进行排序或假设检验时存在多重比较与偶然显著性的风险，"
    "解读时宜保守并优先关注效应量与业务可解释性。"
)

_CAUSALITY_CAVEAT = (
    "统计上的相关或关联不等于因果关系；结论需结合业务与实验设计解读。"
)


def _infer_task_type(ds: Dataset, df: pd.DataFrame, target_col: str | None) -> str:
    if ds.task_type in ("classification", "regression"):
        return ds.task_type
    if not target_col or target_col not in df.columns:
        return "classification"
    s = df[target_col].dropna()
    if s.empty:
        return "classification"
    if pd.api.types.is_numeric_dtype(s):
        nu = s.nunique()
        if nu <= 15 and len(s) > 0:
            return "classification"
        return "regression"
    return "classification"


def _role_for_column(series: pd.Series) -> VariableRole:
    if pd.api.types.is_datetime64_any_dtype(series):
        return VariableRole.datetime
    if pd.api.types.is_numeric_dtype(series):
        return VariableRole.numeric
    nuniq = series.nunique(dropna=True)
    if nuniq <= 50:
        return VariableRole.categorical
    return VariableRole.text


def _profile_column(name: str, series: pd.Series, is_target: bool) -> VariableProfile:
    role = _role_for_column(series)
    miss = float(series.isna().mean()) if len(series) else 0.0
    nuniq = int(series.nunique(dropna=True))
    stats: dict[str, Any] | None = None
    if role == VariableRole.numeric:
        s = pd.to_numeric(series, errors="coerce")
        stats = {
            "min": float(s.min()) if s.notna().any() else None,
            "max": float(s.max()) if s.notna().any() else None,
            "mean": float(s.mean()) if s.notna().any() else None,
            "std": float(s.std()) if s.notna().any() else None,
        }
    elif role in (VariableRole.categorical, VariableRole.text):
        vc = series.astype(str).value_counts().head(5)
        stats = {"top_categories": {str(k): int(v) for k, v in vc.items()}}
    return VariableProfile(
        name=name,
        role=role,
        missing_rate=miss,
        n_unique=nuniq,
        stats=stats,
        is_target=is_target,
    )


def _mi_vs_target(
    df: pd.DataFrame,
    target_col: str,
    task_type: str,
    feature_names: list[str],
) -> list[tuple[str, float]]:
    y_raw = df[target_col]
    scores: list[tuple[str, float]] = []
    if task_type == "classification":
        y_enc = pd.factorize(y_raw.astype(str))[0]
        for col in feature_names:
            if col == target_col:
                continue
            x = df[col]
            if pd.api.types.is_numeric_dtype(x):
                xv = x.fillna(x.median()).values.reshape(-1, 1)
                disc = False
            else:
                xv = pd.factorize(x.astype(str).fillna("__NA__"))[0].reshape(-1, 1)
                disc = True
            try:
                mi = mutual_info_classif(
                    xv, y_enc, discrete_features=[disc], random_state=42
                )[0]
            except Exception:
                mi = 0.0
            scores.append((col, float(mi)))
    else:
        yv = pd.to_numeric(y_raw, errors="coerce")
        if yv.notna().sum() == 0:
            return []
        y_fill = yv.fillna(yv.median()).values
        for col in feature_names:
            if col == target_col:
                continue
            x = df[col]
            if pd.api.types.is_numeric_dtype(x):
                xv = x.fillna(x.median()).values.reshape(-1, 1)
            else:
                xv = pd.factorize(x.astype(str).fillna("__NA__"))[0].reshape(-1, 1).astype(float)
            try:
                mi = mutual_info_regression(xv, y_fill, random_state=42)[0]
            except Exception:
                mi = 0.0
            scores.append((col, float(abs(mi))))
    scores.sort(key=lambda t: t[1], reverse=True)
    return scores


def _cramer_v_and_p(a: pd.Series, b: pd.Series) -> tuple[float, float | None]:
    ta = a.astype(str).fillna("__NA__")
    tb = b.astype(str).fillna("__NA__")
    ct = pd.crosstab(ta, tb)
    if ct.size < 4 or ct.shape[0] < 2 or ct.shape[1] < 2:
        return 0.0, None
    ntot = int(ct.values.sum())
    if ntot < 8:
        return 0.0, None
    try:
        chi2, p, _dof, expected = chi2_contingency(ct.values)
    except Exception:
        return 0.0, None
    if not np.isfinite(chi2) or chi2 < 0:
        return 0.0, float(p) if p is not None and np.isfinite(p) else None
    r, k = ct.shape
    denom = ntot * (min(r, k) - 1)
    v = float(np.sqrt(chi2 / denom)) if denom > 0 else 0.0
    v = min(1.0, v) if np.isfinite(v) else 0.0
    p_f = float(p) if p is not None and np.isfinite(p) else None
    return v, p_f


def _anova_f_numeric_by_cat(y: pd.Series, x_cat: pd.Series) -> float:
    yv = pd.to_numeric(y, errors="coerce")
    xc = x_cat.astype(str).fillna("__NA__")
    groups = [yv[xc == g].dropna().values for g in xc.unique()]
    groups = [g for g in groups if len(g) >= 1]
    if len(groups) < 2:
        return 0.0
    try:
        f_stat, _p = stats.f_oneway(*groups)
        return float(f_stat) if np.isfinite(f_stat) else 0.0
    except Exception:
        return 0.0


def _compute_vif_values(cols: list[str], df: pd.DataFrame) -> dict[str, float]:
    if len(cols) < 2:
        return {}
    sub = df[cols].apply(pd.to_numeric, errors="coerce").dropna()
    if len(sub) < max(40, 5 * len(cols)):
        return {}
    X = sub.values.astype(float)
    out: dict[str, float] = {}
    for i, c in enumerate(cols):
        try:
            v = float(variance_inflation_factor(X, i))
            if np.isfinite(v) and v > 0:
                out[c] = v
        except Exception:
            continue
    return out


def _missing_vs_target_item(
    df: pd.DataFrame,
    feat: str,
    target_col: str,
    task_type: str,
) -> MissingVsTargetItem | None:
    if feat == target_col:
        return None
    miss = df[feat].isna()
    n_m = int(miss.sum())
    if n_m == 0 or n_m == len(df):
        return None
    if task_type == "classification":
        y = df[target_col].astype(str)
        ct = pd.crosstab(miss, y)
        if ct.shape[0] < 2 or ct.shape[1] < 1:
            return None
        try:
            _chi2, p, _dof, _e = chi2_contingency(ct.values)
        except Exception:
            return None
        if p is None or not np.isfinite(p):
            return None
        pf = float(p)
        if pf >= MISSING_P_THRESH:
            return None
        return MissingVsTargetItem(
            feature=feat,
            test_name="chi2_missing_vs_target",
            pvalue=pf,
            narrative_hint=(
                f"「{feat}」的缺失与目标「{target_col}」类别分布存在统计关联（χ² 检验 p={pf:.4f}），"
                "提示可能为非随机缺失，建模与解释时需谨慎。"
            ),
        )
    y = pd.to_numeric(df[target_col], errors="coerce")
    g0 = y[~miss].dropna()
    g1 = y[miss].dropna()
    if len(g0) < 3 or len(g1) < 2:
        return None
    try:
        _t, p = stats.ttest_ind(g0, g1, equal_var=False)
    except Exception:
        return None
    if p is None or not np.isfinite(p):
        return None
    pf = float(p)
    if pf >= MISSING_P_THRESH:
        return None
    return MissingVsTargetItem(
        feature=feat,
        test_name="ttest_missing_vs_target",
        pvalue=pf,
        narrative_hint=(
            f"「{feat}」缺失组与非缺失组在「{target_col}」上均值差异显著（Welch t 检验 p={pf:.4f}），"
            "请关注缺失机制及对模型的影响。"
        ),
    )


def build_data_narrative(
    db: Session,
    dataset_id: int,
    split_id: Optional[int],
    depth: NarrativeDepth,
    model_id: Optional[int] = None,
    *,
    _pdf_assets: Optional[dict[str, Any]] = None,
) -> DataNarrativeResponse:
    ds = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail=f"数据集 {dataset_id} 不存在")

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    max_num = STANDARD_MAX_NUMERIC if depth == NarrativeDepth.standard else DETAILED_MAX_NUMERIC
    top_pairs = STANDARD_PAIR_TOP if depth == NarrativeDepth.standard else DETAILED_PAIR_TOP
    corr_th = STANDARD_CORR_THRESHOLD if depth == NarrativeDepth.standard else DETAILED_CORR_THRESHOLD

    if split_id is None:
        meta = DataNarrativeMeta(
            dataset_id=dataset_id,
            split_id=None,
            model_id=model_id,
            target_column=ds.target_column,
            task_type=ds.task_type if ds.task_type in ("classification", "regression") else None,
            depth=depth,
            generated_at=now,
            row_count_profiled=ds.rows or 0,
            sample_note="未提供 split_id：仅返回数据集元数据级叙事，未计算列间相关与互信息。",
        )
        vars_: list[VariableProfile] = []
        if ds.cols:
            vars_.append(
                VariableProfile(
                    name="(元数据)",
                    role=VariableRole.unknown,
                    missing_rate=0.0,
                    n_unique=None,
                    stats={"rows": ds.rows, "cols": ds.cols},
                    is_target=False,
                )
            )
        caveats = [
            _CAUSALITY_CAVEAT,
            "请传入 split_id 以基于训练集生成完整数据关系分析。",
        ]
        return DataNarrativeResponse(
            meta=meta,
            variables=vars_,
            bullets=DataNarrativeBullets(findings=[], caveats=caveats),
        )

    sp = db.query(DatasetSplit).filter(DatasetSplit.id == split_id).first()
    if not sp or sp.dataset_id != dataset_id:
        raise HTTPException(status_code=404, detail="划分不存在或不属于该数据集")

    train_path = DATA_DIR / sp.train_path
    if not train_path.exists():
        raise HTTPException(status_code=404, detail="训练集文件不存在")

    encodings = ("utf-8-sig", "utf-8", "gbk")
    df = None
    for enc in encodings:
        try:
            df = pd.read_csv(train_path, encoding=enc)
            break
        except Exception:
            continue
    if df is None or df.empty:
        raise HTTPException(status_code=400, detail="无法读取训练集或数据为空")

    sample_note: str | None = None
    n_rows = len(df)
    if n_rows > ROW_SAMPLE_THRESHOLD:
        df = df.sample(n=min(SAMPLE_ROWS, n_rows), random_state=42).reset_index(drop=True)
        sample_note = (
            f"训练集共 {n_rows} 行，为控制耗时仅随机采样 {len(df)} 行做相关与互信息分析。"
        )

    target_col = ds.target_column
    task_type = _infer_task_type(ds, df, target_col)

    variables: list[VariableProfile] = []
    for c in df.columns:
        variables.append(_profile_column(c, df[c], is_target=(c == target_col)))

    numeric_cols = [
        c
        for c in df.columns
        if pd.api.types.is_numeric_dtype(df[c]) and _role_for_column(df[c]) == VariableRole.numeric
    ]
    numeric_cols = numeric_cols[:max_num]

    correlation_pairs: list[CorrelationPair] = []
    charts: list[ChartSpec] = []
    multicollinearity: list[MulticollinearityFlag] = []
    categorical_associations: list[CategoricalAssociationItem] = []
    missing_vs_target: list[MissingVsTargetItem] = []
    heatmap_png: bytes | None = None
    spearman_png: bytes | None = None
    high_r_feats: set[str] = set()
    vif_dict: dict[str, float] = {}

    try:
        from services import chart_service
    except Exception:
        chart_service = None  # type: ignore[assignment]

    if len(numeric_cols) >= 2:
        sub = df[numeric_cols].apply(pd.to_numeric, errors="coerce")
        corr = sub.corr(method="pearson")
        pairs_raw: list[tuple[str, str, float]] = []
        for i, a in enumerate(numeric_cols):
            for j in range(i + 1, len(numeric_cols)):
                b = numeric_cols[j]
                try:
                    r = float(corr.loc[a, b])
                except Exception:
                    continue
                if np.isnan(r):
                    continue
                if abs(r) >= corr_th:
                    pairs_raw.append((a, b, r))
        pairs_raw.sort(key=lambda t: abs(t[2]), reverse=True)
        for a, b, r in pairs_raw[:top_pairs]:
            correlation_pairs.append(
                CorrelationPair(
                    col_a=a,
                    col_b=b,
                    method=CorrelationMethod.pearson,
                    coefficient=r,
                    narrative_hint=(
                        f"数值列「{a}」与「{b}」Pearson 相关系数为 {r:.3f}，"
                        f"{'正相关较强' if r > 0.5 else '负相关较强' if r < -0.5 else '存在线性关联'}，建模时需注意信息重叠。"
                    ),
                )
            )
        for a, b, r in pairs_raw[:top_pairs]:
            if abs(r) >= 0.75:
                high_r_feats.add(a)
                high_r_feats.add(b)

        vif_dict = _compute_vif_values(numeric_cols, df)

        if chart_service:
            try:
                mat = corr.values.astype(float)
                labels = list(corr.columns)
                heatmap_png = chart_service.correlation_heatmap_bytes(mat, labels)
            except Exception:
                heatmap_png = None
        if heatmap_png:
            charts.append(
                ChartSpec(
                    chart_id="corr_heatmap_numeric",
                    title="数值特征 Pearson 相关热力图",
                    width_cm=12.0,
                    height_cm=10.0,
                )
            )

        if depth == NarrativeDepth.detailed:
            corr_s = sub.corr(method="spearman")
            sp_th = max(0.25, corr_th - 0.08)
            sp_raw: list[tuple[str, str, float]] = []
            for i, a in enumerate(numeric_cols):
                for j in range(i + 1, len(numeric_cols)):
                    b = numeric_cols[j]
                    try:
                        r = float(corr_s.loc[a, b])
                    except Exception:
                        continue
                    if np.isnan(r):
                        continue
                    if abs(r) >= sp_th:
                        sp_raw.append((a, b, r))
            sp_raw.sort(key=lambda t: abs(t[2]), reverse=True)
            for a, b, r in sp_raw[:top_pairs]:
                correlation_pairs.append(
                    CorrelationPair(
                        col_a=a,
                        col_b=b,
                        method=CorrelationMethod.spearman,
                        coefficient=r,
                        narrative_hint=(
                            f"数值列「{a}」与「{b}」Spearman 秩相关系数为 {r:.3f}，"
                            "对秩次/单调非线性关系较敏感，可与 Pearson 对照解读。"
                        ),
                    )
                )
            if chart_service:
                try:
                    mat_s = corr_s.values.astype(float)
                    labels_s = list(corr_s.columns)
                    spearman_png = chart_service.correlation_heatmap_bytes(
                        mat_s,
                        labels_s,
                        plot_title="数值特征 Spearman 秩相关矩阵",
                    )
                except Exception:
                    spearman_png = None
            if spearman_png:
                charts.append(
                    ChartSpec(
                        chart_id="corr_heatmap_spearman",
                        title="数值特征 Spearman 秩相关热力图",
                        width_cm=12.0,
                        height_cm=10.0,
                    )
                )

    mc_map: dict[str, MulticollinearityFlag] = {}
    for col, v in vif_dict.items():
        if v >= VIF_WARN:
            mc_map[col] = MulticollinearityFlag(
                feature=col,
                vif=v,
                note=(
                    f"特征「{col}」方差膨胀因子 VIF≈{v:.2f}（≥{VIF_WARN:.0f} 提示多重共线性风险），"
                    "可考虑正则化、降维或删减冗余特征。"
                ),
            )
    for col in sorted(high_r_feats):
        if col in mc_map and mc_map[col].vif is not None and mc_map[col].vif >= VIF_WARN:
            continue
        if col in mc_map:
            continue
        v = vif_dict.get(col)
        note = "特征「{}」与其他数值特征存在较高 Pearson 相关（|r|≥0.75）".format(col)
        if v is not None and np.isfinite(v):
            note += f"；当前样本下 VIF≈{v:.2f}。"
        else:
            note += "；若 VIF 在部分样本下无法稳定估计，请结合业务判断是否保留。"
        mc_map[col] = MulticollinearityFlag(feature=col, vif=v, note=note)
    multicollinearity = sorted(mc_map.values(), key=lambda x: x.feature)

    cat_pair_top = (
        STANDARD_CAT_PAIR_TOP if depth == NarrativeDepth.standard else DETAILED_CAT_PAIR_TOP
    )
    cramer_th = (
        STANDARD_CRAMER_TH if depth == NarrativeDepth.standard else DETAILED_CRAMER_TH
    )
    cat_cols = [
        c
        for c in df.columns
        if c != target_col
        and _role_for_column(df[c]) == VariableRole.categorical
        and 2 <= df[c].nunique(dropna=True) <= LOW_CARD_MAX
    ]
    assoc_raw: list[tuple[str, str, float, float | None]] = []
    for i, ca in enumerate(cat_cols):
        for cb in cat_cols[i + 1 :]:
            v, p = _cramer_v_and_p(df[ca], df[cb])
            if v >= cramer_th:
                assoc_raw.append((ca, cb, v, p))
    assoc_raw.sort(key=lambda t: t[2], reverse=True)
    for ca, cb, v, p in assoc_raw[:cat_pair_top]:
        pv_txt = f"χ² p={p:.4f}" if p is not None else "p 值未可靠估计"
        categorical_associations.append(
            CategoricalAssociationItem(
                col_a=ca,
                col_b=cb,
                cramers_v=v,
                chi2_pvalue=p,
                narrative_hint=(
                    f"类别列「{ca}」与「{cb}」关联强度 Cramér's V≈{v:.3f}（{pv_txt}），"
                    "需结合列语义解读。"
                ),
            )
        )

    box_top = STANDARD_BOX_TOP if depth == NarrativeDepth.standard else DETAILED_BOX_TOP
    numeric_for_box = [c for c in numeric_cols if c != target_col]
    pair_scores: list[tuple[float, str, str]] = []
    for nc in numeric_for_box:
        for cc in cat_cols:
            if target_col and cc == target_col:
                continue
            f_ = _anova_f_numeric_by_cat(df[nc], df[cc])
            if f_ > 1e-6:
                pair_scores.append((f_, nc, cc))
    pair_scores.sort(key=lambda t: t[0], reverse=True)
    if chart_service:
        for _fs, nc, cc in pair_scores[:box_top]:
            mask = df[nc].notna() & df[cc].notna()
            if int(mask.sum()) < 15:
                continue
            sub_y = pd.to_numeric(df.loc[mask, nc], errors="coerce")
            valid = sub_y.notna()
            if int(valid.sum()) < 15:
                continue
            vals = sub_y[valid].tolist()
            cats = df.loc[sub_y[valid].index, cc].astype(str).tolist()
            try:
                png = chart_service.numeric_boxplot_by_category_bytes(
                    vals, cats, str(nc), str(cc)
                )
            except Exception:
                png = b""
            if png:
                slug = f"{nc}_{cc}".replace(" ", "_")[:48]
                charts.append(
                    ChartSpec(
                        chart_id=f"box_{slug}",
                        title=f"{nc} × {cc} 分组箱线图",
                        width_cm=12.0,
                        height_cm=8.0,
                    )
                )
                if _pdf_assets is not None:
                    _pdf_assets.setdefault("boxplots", []).append((png, f"{nc} 按 {cc} 分组"))

    if target_col and target_col in df.columns:
        cols_by_miss = sorted(
            [c for c in df.columns if c != target_col],
            key=lambda c: float(df[c].isna().mean()),
            reverse=True,
        )
        for c in cols_by_miss:
            item = _missing_vs_target_item(df, c, target_col, task_type)
            if item:
                missing_vs_target.append(item)
            if len(missing_vs_target) >= 12:
                break

    target_relations: list[TargetRelationItem] = []
    if target_col and target_col in df.columns:
        feats = [c for c in df.columns if c != target_col]
        mi_ranked = _mi_vs_target(df, target_col, task_type, feats)
        for rank, (fname, val) in enumerate(mi_ranked[:15], start=1):
            target_relations.append(
                TargetRelationItem(
                    feature=fname,
                    metric=TargetRelationMetric.mutual_info,
                    value=float(val),
                    rank=rank,
                    narrative_hint=(
                        f"特征「{fname}」与目标「{target_col}」的互信息为 {val:.4f}，"
                        f"在当前特征中排名第 {rank}，对模型可能较有信息量。"
                    ),
                )
            )

    findings: list[str] = []
    if variables:
        vm = max(variables, key=lambda v: v.missing_rate)
        if vm.missing_rate > 0.05:
            findings.append(
                f"列「{vm.name}」缺失率最高（{vm.missing_rate*100:.1f}%），训练前建议检查缺失机制。"
            )
    pear_pairs = [p for p in correlation_pairs if p.method == CorrelationMethod.pearson]
    if pear_pairs:
        p0 = pear_pairs[0]
        findings.append(
            f"最强 Pearson 线性相关对为「{p0.col_a}」与「{p0.col_b}」（r={p0.coefficient:.3f}）。"
        )
    sp_pairs = [p for p in correlation_pairs if p.method == CorrelationMethod.spearman]
    if sp_pairs:
        s0 = sp_pairs[0]
        findings.append(
            f"最强 Spearman 秩相关对为「{s0.col_a}」与「{s0.col_b}」（ρ={s0.coefficient:.3f}）。"
        )
    if categorical_associations:
        ca0 = categorical_associations[0]
        findings.append(
            f"类别关联较强的一对为「{ca0.col_a}」×「{ca0.col_b}」（Cramér's V≈{ca0.cramers_v:.3f}）。"
        )
    if missing_vs_target:
        findings.append(
            f"有 {len(missing_vs_target)} 列特征的缺失与目标存在统计关联（p<{MISSING_P_THRESH}），需关注非随机缺失。"
        )
    if target_relations:
        t0 = target_relations[0]
        findings.append(
            f"与目标关联（互信息）最高的特征为「{t0.feature}」。"
        )
    if not findings:
        findings.append("当前训练集 profile 未发现极端缺失或必选的高相关对；仍建议结合业务复核。")

    caveats = [
        _CAUSALITY_CAVEAT,
        MULTIPLICITY_CAVEAT,
        f"本分析仅基于训练集（约 {len(df)} 行），未使用测试集做探索，以避免信息泄漏。",
        "互信息与相关均为启发式指标，不保证与最终模型重要性一致。",
    ]
    if sample_note:
        caveats.append(sample_note)

    meta = DataNarrativeMeta(
        dataset_id=dataset_id,
        split_id=split_id,
        model_id=model_id,
        target_column=target_col,
        task_type=task_type if task_type in ("classification", "regression") else None,
        depth=depth,
        generated_at=now,
        row_count_profiled=len(df),
        sample_note=sample_note,
    )

    response = DataNarrativeResponse(
        meta=meta,
        variables=variables,
        correlation_pairs=correlation_pairs,
        multicollinearity=multicollinearity,
        categorical_associations=categorical_associations,
        missing_vs_target=missing_vs_target,
        target_relations=target_relations,
        charts=charts,
        bullets=DataNarrativeBullets(findings=findings[:7], caveats=caveats),
    )
    if _pdf_assets is not None:
        if heatmap_png:
            _pdf_assets["corr_heatmap_png"] = heatmap_png
        if spearman_png:
            _pdf_assets["spearman_heatmap_png"] = spearman_png
    return response
