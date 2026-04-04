"""
图表生成服务 - 使用 matplotlib 生成各类图表并返回 base64 编码字节
供 report_service.py 嵌入 PDF 使用
"""
from __future__ import annotations

import base64
import io
from typing import Any

import matplotlib
matplotlib.use("Agg")  # 无头模式，不需要显示器
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

# 统一配色方案（蓝白专业风格）
BRAND_BLUE = "#1677ff"
BRAND_LIGHT = "#e6f4ff"
GRID_COLOR = "#e0e0e0"
TEXT_COLOR = "#1a1a1a"
AXIS_COLOR = "#595959"
SUCCESS_COLOR = "#52c41a"
WARNING_COLOR = "#fa8c16"
DANGER_COLOR = "#ff4d4f"

# 统一字体（回退英文）
plt.rcParams.update({
    "font.family": ["Microsoft YaHei", "SimHei", "DejaVu Sans"],
    "axes.unicode_minus": False,
    "figure.facecolor": "white",
    "axes.facecolor": "#fafafa",
    "axes.edgecolor": GRID_COLOR,
    "axes.labelcolor": AXIS_COLOR,
    "xtick.color": AXIS_COLOR,
    "ytick.color": AXIS_COLOR,
    "text.color": TEXT_COLOR,
    "grid.color": GRID_COLOR,
    "grid.linestyle": "--",
    "grid.alpha": 0.7,
})


def _fig_to_base64(fig: plt.Figure, dpi: int = 150) -> bytes:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight", facecolor="white")
    buf.seek(0)
    data = buf.read()
    plt.close(fig)
    return data


def roc_curve_chart(fpr: list[float], tpr: list[float], auc_val: float) -> bytes:
    """ROC 曲线图"""
    fig, ax = plt.subplots(figsize=(5.5, 4.5))
    ax.plot(fpr, tpr, color=BRAND_BLUE, lw=2.5, label=f"ROC 曲线 (AUC = {auc_val:.4f})")
    ax.plot([0, 1], [0, 1], color="#bfbfbf", lw=1.5, linestyle="--", label="随机基线")
    ax.fill_between(fpr, tpr, alpha=0.08, color=BRAND_BLUE)
    ax.set_xlim([-0.01, 1.01])
    ax.set_ylim([-0.01, 1.05])
    ax.set_xlabel("假阳性率 (FPR)", fontsize=11)
    ax.set_ylabel("真阳性率 (TPR)", fontsize=11)
    ax.set_title("ROC 曲线", fontsize=13, fontweight="bold", color=TEXT_COLOR)
    ax.legend(loc="lower right", fontsize=10)
    ax.grid(True)
    fig.tight_layout()
    return _fig_to_base64(fig)


def confusion_matrix_chart(matrix: list[list[int]], labels: list[str]) -> bytes:
    """混淆矩阵热力图"""
    cm = np.array(matrix)
    n = len(labels)
    fig, ax = plt.subplots(figsize=(max(4.5, n * 1.2), max(3.8, n * 1.0)))

    # 归一化用于颜色，但显示原始值
    cm_norm = cm.astype(float) / (cm.sum(axis=1, keepdims=True) + 1e-9)
    im = ax.imshow(cm_norm, interpolation="nearest", cmap="Blues", vmin=0, vmax=1)
    plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)

    tick_marks = np.arange(n)
    ax.set_xticks(tick_marks)
    ax.set_yticks(tick_marks)
    ax.set_xticklabels(labels, fontsize=10)
    ax.set_yticklabels(labels, fontsize=10)

    thresh = cm_norm.max() / 2.0
    for i in range(n):
        for j in range(n):
            ax.text(j, i, str(cm[i, j]),
                    ha="center", va="center", fontsize=12, fontweight="bold",
                    color="white" if cm_norm[i, j] > thresh else "black")

    ax.set_xlabel("预测标签", fontsize=11)
    ax.set_ylabel("真实标签", fontsize=11)
    ax.set_title("混淆矩阵", fontsize=13, fontweight="bold", color=TEXT_COLOR)
    fig.tight_layout()
    return _fig_to_base64(fig)


def shap_bar_chart(
    features: list[str],
    importances: list[float],
    title: str = "SHAP 特征重要性 (Top 10)",
) -> bytes:
    """SHAP 特征重要性水平条形图"""
    # 取 Top 10
    pairs = sorted(zip(importances, features), reverse=True)[:10]
    vals = [p[0] for p in reversed(pairs)]
    names = [p[1] for p in reversed(pairs)]

    colors = [BRAND_BLUE if v >= 0 else DANGER_COLOR for v in vals]

    fig, ax = plt.subplots(figsize=(6.5, max(3.5, len(names) * 0.45 + 1)))
    bars = ax.barh(names, vals, color=colors, height=0.6, edgecolor="white", linewidth=0.5)

    for bar, val in zip(bars, vals):
        ax.text(
            bar.get_width() + max(vals) * 0.01,
            bar.get_y() + bar.get_height() / 2,
            f"{val:.4f}",
            va="center", ha="left", fontsize=9, color=AXIS_COLOR,
        )

    ax.set_xlabel("平均 |SHAP 值|", fontsize=11)
    ax.set_title(title, fontsize=13, fontweight="bold", color=TEXT_COLOR)
    ax.grid(True, axis="x")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    return _fig_to_base64(fig)


def pr_curve_chart(precision: list[float], recall: list[float], ap: float) -> bytes:
    """Precision-Recall 曲线图"""
    fig, ax = plt.subplots(figsize=(5.5, 4.5))
    ax.step(recall, precision, color="#722ed1", lw=2.5, alpha=0.85,
            where="post", label=f"PR 曲线 (AP = {ap:.4f})")
    ax.fill_between(recall, precision, alpha=0.08, color="#722ed1", step="post")
    ax.set_xlim([-0.01, 1.01])
    ax.set_ylim([0, 1.05])
    ax.set_xlabel("召回率 (Recall)", fontsize=11)
    ax.set_ylabel("精确率 (Precision)", fontsize=11)
    ax.set_title("Precision-Recall 曲线", fontsize=13, fontweight="bold", color=TEXT_COLOR)
    ax.legend(loc="upper right", fontsize=10)
    ax.grid(True)
    fig.tight_layout()
    return _fig_to_base64(fig)


def target_distribution_chart(values: list[Any], task_type: str, target_col: str = "目标列") -> bytes:
    """目标列分布图（分类：条形图；回归：直方图）"""
    fig, ax = plt.subplots(figsize=(5.5, 4.0))
    if task_type == "classification":
        import collections
        counter = collections.Counter(str(v) for v in values)
        labels_sorted = sorted(counter.keys())
        counts = [counter[l] for l in labels_sorted]
        bars = ax.bar(labels_sorted, counts, color=BRAND_BLUE, edgecolor="white", width=0.6)
        for bar, count in zip(bars, counts):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + max(counts) * 0.01,
                    str(count), ha="center", va="bottom", fontsize=10)
        ax.set_xlabel("类别", fontsize=11)
        ax.set_ylabel("样本数量", fontsize=11)
        ax.set_title(f"目标列分布：{target_col}", fontsize=13, fontweight="bold", color=TEXT_COLOR)
    else:
        arr = [float(v) for v in values if v is not None]
        ax.hist(arr, bins=30, color=BRAND_BLUE, edgecolor="white", alpha=0.85)
        ax.set_xlabel(target_col, fontsize=11)
        ax.set_ylabel("频次", fontsize=11)
        ax.set_title(f"目标列分布：{target_col}", fontsize=13, fontweight="bold", color=TEXT_COLOR)
    ax.grid(True, axis="y")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    return _fig_to_base64(fig)


def learning_curve_chart(
    sample_counts: list[int],
    train_scores: list[float],
    val_scores: list[float],
    metric: str = "Accuracy",
    task_type: str = "classification",
) -> bytes:
    """学习曲线图（训练集 vs 验证集 随样本量变化）"""
    fig, ax = plt.subplots(figsize=(6, 4.5))
    ax.plot(sample_counts, train_scores, "o-", color=BRAND_BLUE, lw=2, ms=5, label=f"训练集 {metric}")
    ax.plot(sample_counts, val_scores, "s--", color=WARNING_COLOR, lw=2, ms=5, label=f"验证集 {metric}")
    ax.fill_between(sample_counts, train_scores, val_scores, alpha=0.1, color=WARNING_COLOR)
    ax.set_xlabel("训练样本数", fontsize=11)
    ax.set_ylabel(metric, fontsize=11)
    ax.set_title("学习曲线", fontsize=13, fontweight="bold", color=TEXT_COLOR)
    ax.legend(fontsize=10)
    ax.grid(True)
    fig.tight_layout()
    return _fig_to_base64(fig)


def residual_scatter_chart(predicted: list[float], residuals: list[float]) -> bytes:
    """残差散点图（回归任务）"""
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 4))

    # 残差 vs 预测值
    ax1.scatter(predicted, residuals, color=BRAND_BLUE, alpha=0.5, s=20, edgecolors="none")
    ax1.axhline(0, color=DANGER_COLOR, lw=1.5, linestyle="--")
    ax1.set_xlabel("预测值", fontsize=11)
    ax1.set_ylabel("残差", fontsize=11)
    ax1.set_title("残差 vs 预测值", fontsize=13, fontweight="bold", color=TEXT_COLOR)
    ax1.grid(True)

    # 残差分布直方图
    ax2.hist(residuals, bins=30, color=BRAND_BLUE, edgecolor="white", alpha=0.85)
    ax2.axvline(0, color=DANGER_COLOR, lw=1.5, linestyle="--")
    ax2.set_xlabel("残差值", fontsize=11)
    ax2.set_ylabel("频次", fontsize=11)
    ax2.set_title("残差分布", fontsize=13, fontweight="bold", color=TEXT_COLOR)
    ax2.grid(True)

    fig.tight_layout()
    return _fig_to_base64(fig)


def metrics_radar_chart(metrics: dict[str, float], title: str = "模型评估指标雷达图") -> bytes:
    """评估指标雷达图（分类任务用）"""
    _DISPLAY = {
        "accuracy": "准确率",
        "auc": "AUC",
        "f1": "F1值",
        "precision": "精确率",
        "recall": "召回率",
    }
    # 只取 0~1 范围的核心指标
    selected = {k: float(v) for k, v in metrics.items()
                if k in _DISPLAY and isinstance(v, (int, float)) and 0 <= float(v) <= 1}
    if len(selected) < 3:
        return None  # 不够点则不生成

    labels = [_DISPLAY.get(k, k) for k in selected]
    values = list(selected.values())
    n = len(labels)

    angles = [x / float(n) * 2 * np.pi for x in range(n)]
    angles += angles[:1]
    values_plot = values + values[:1]

    fig, ax = plt.subplots(figsize=(5, 5), subplot_kw=dict(polar=True))
    ax.set_facecolor("#f5f9ff")
    ax.plot(angles, values_plot, color=BRAND_BLUE, lw=2.5)
    ax.fill(angles, values_plot, color=BRAND_BLUE, alpha=0.15)
    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(labels, fontsize=11)
    ax.set_ylim(0, 1)
    ax.set_yticks([0.2, 0.4, 0.6, 0.8, 1.0])
    ax.set_yticklabels(["0.2", "0.4", "0.6", "0.8", "1.0"], fontsize=8, color=AXIS_COLOR)
    ax.grid(color=GRID_COLOR, linestyle="--", alpha=0.7)
    ax.set_title(title, fontsize=13, fontweight="bold", color=TEXT_COLOR, pad=15)
    fig.tight_layout()
    return _fig_to_base64(fig)


def baseline_compare_chart(
    model_metrics: dict[str, float],
    baseline_metrics: dict[str, float],
    task_type: str,
) -> bytes:
    """模型 vs 基线对比柱状图"""
    if task_type == "classification":
        keys = ["accuracy", "f1"]
        names = ["准确率", "F1值"]
    else:
        keys = ["rmse", "r2"]
        names = ["RMSE（越低越好）", "R²（越高越好）"]

    model_vals = [float(model_metrics.get(k, 0)) for k in keys]
    base_vals = [float(baseline_metrics.get(k, 0)) for k in keys]

    x = np.arange(len(keys))
    width = 0.35
    fig, ax = plt.subplots(figsize=(6, 4))
    bars1 = ax.bar(x - width / 2, model_vals, width, label="XGBoost 模型",
                   color=BRAND_BLUE, edgecolor="white")
    bars2 = ax.bar(x + width / 2, base_vals, width, label="Dummy 基线",
                   color="#bfbfbf", edgecolor="white")

    for bar in bars1:
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.01,
                f"{bar.get_height():.3f}", ha="center", va="bottom", fontsize=9, color=BRAND_BLUE)
    for bar in bars2:
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.01,
                f"{bar.get_height():.3f}", ha="center", va="bottom", fontsize=9, color=AXIS_COLOR)

    ax.set_xticks(x)
    ax.set_xticklabels(names, fontsize=11)
    ax.set_title("模型 vs 随机基线对比", fontsize=13, fontweight="bold", color=TEXT_COLOR)
    ax.legend(fontsize=10)
    ax.grid(True, axis="y")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    return _fig_to_base64(fig)


def correlation_heatmap_bytes(
    corr_matrix: np.ndarray,
    labels: list[str],
    *,
    plot_title: str = "数值特征 Pearson 相关矩阵",
) -> bytes:
    """数值相关矩阵热力图（Pearson / Spearman 等，由 plot_title 区分）。"""
    n = len(labels)
    if n < 2 or corr_matrix.shape != (n, n):
        return b""

    fig, ax = plt.subplots(figsize=(max(5, n * 0.55), max(4, n * 0.5)))
    im = ax.imshow(corr_matrix, cmap="RdBu_r", vmin=-1, vmax=1, aspect="auto")
    ax.set_xticks(range(n))
    ax.set_yticks(range(n))
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=8)
    ax.set_yticklabels(labels, fontsize=8)
    ax.set_title(plot_title, fontsize=12, fontweight="bold", color=TEXT_COLOR)
    cbar = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    cbar.ax.tick_params(labelsize=8)
    for i in range(n):
        for j in range(n):
            v = corr_matrix[i, j]
            if not np.isnan(v):
                ax.text(
                    j, i, f"{v:.2f}",
                    ha="center", va="center", fontsize=7,
                    color="white" if abs(v) > 0.55 else TEXT_COLOR,
                )
    fig.tight_layout()
    return _fig_to_base64(fig)


def numeric_boxplot_by_category_bytes(
    values: list[float],
    categories: list[str],
    numeric_col: str,
    category_col: str,
) -> bytes:
    """按类别分组的数值箱线图（G2-R1b：数值×低基数类别）。"""
    if len(values) != len(categories) or len(values) < 4:
        return b""
    # 聚合为按类别分组的值列表
    from collections import defaultdict

    groups: dict[str, list[float]] = defaultdict(list)
    for v, c in zip(values, categories, strict=True):
        if v is None or (isinstance(v, float) and np.isnan(v)):
            continue
        g = str(c) if c is not None else "__NA__"
        try:
            groups[g].append(float(v))
        except (TypeError, ValueError):
            continue
    labels = sorted(groups.keys(), key=lambda x: (x == "__NA__", x))
    data = [groups[k] for k in labels if len(groups[k]) > 0]
    labels = [k for k in labels if len(groups[k]) > 0]
    if len(data) < 2 or not any(len(d) >= 1 for d in data):
        return b""

    fig, ax = plt.subplots(figsize=(max(5, len(labels) * 0.9), 4.2))
    bp = ax.boxplot(data, patch_artist=True)
    ax.set_xticks(np.arange(1, len(labels) + 1))
    ax.set_xticklabels(labels, rotation=20, ha="right", fontsize=9)
    for patch in bp["boxes"]:
        patch.set_facecolor(BRAND_LIGHT)
        patch.set_edgecolor(BRAND_BLUE)
    ax.set_xlabel(category_col, fontsize=10)
    ax.set_ylabel(numeric_col, fontsize=10)
    ax.set_title(f"{numeric_col} 按 {category_col} 分组分布", fontsize=12, fontweight="bold", color=TEXT_COLOR)
    ax.grid(True, axis="y", alpha=0.5)
    fig.tight_layout()
    return _fig_to_base64(fig)


def multi_model_compare_chart(
    model_names: list[str],
    metrics_list: list[dict[str, float]],
    key_metric: str = "accuracy",
) -> bytes:
    """多模型指标横向对比柱状图"""
    values = [float(m.get(key_metric, 0)) for m in metrics_list]
    colors = [BRAND_BLUE if v == max(values) else "#91caff" for v in values]

    fig, ax = plt.subplots(figsize=(max(6, len(model_names) * 1.2), 4.5))
    bars = ax.bar(model_names, values, color=colors, edgecolor="white", width=0.6)
    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + max(values) * 0.01,
                f"{val:.4f}", ha="center", va="bottom", fontsize=9)
    ax.set_xlabel("模型", fontsize=11)
    ax.set_ylabel(key_metric.upper(), fontsize=11)
    ax.set_title(f"多模型 {key_metric.upper()} 对比", fontsize=13, fontweight="bold", color=TEXT_COLOR)
    ax.grid(True, axis="y")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    plt.xticks(rotation=15, ha="right")
    fig.tight_layout()
    return _fig_to_base64(fig)
