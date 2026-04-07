"""
目标列推荐算法（纯函数，零外部依赖）

通过多维度评分 + softmax 归一化，为数据集的每一列计算「作为目标列」的置信度。
供 wizard_service.dataset_summary 和测试直接 import。
"""
from __future__ import annotations

import math
import re
from typing import Any

import pandas as pd

# ── 常量 ────────────────────────────────────────────────────────────────────────

_KW_EXACT = frozenset({
    'y', 'target', 'label', 'class', 'output', 'prediction',
    'survived', 'species', 'medv', 'diagnosis', 'income',
    'result', 'outcome', 'category', 'churn', 'flag',
})

_KW_TOKEN = frozenset({
    'target', 'label', 'result', 'outcome', 'class', 'category',
    'survived', 'churn', 'status', 'flag', 'prediction', 'output',
    'medv', 'species', 'diagnosis', 'income', 'default', 'response',
    'fraud', 'sentiment', 'approved', 'quality', 'defect',
    'grade', 'rating',
})

_KW_PRICE = frozenset({
    'price', 'sales', 'revenue', 'cost', 'amount', 'wage', 'salary', 'value',
})

_KW_FINAL = frozenset({
    'manual', 'final', 'actual', 'real', 'true', 'total', 'net', 'gross', 'finished',
})

_KW_TARGET_SUFFIX = frozenset({'target', 'label', 'class', 'output', 'prediction'})

_KW_ID = frozenset({'id', 'index', 'idx', 'name', 'uuid', 'key', 'pk', 'rowid', 'row'})

_SINGLE_LETTER_COORDS = frozenset(set('abcdefghijklmnopqrstuvwxyz'))

_SOFTMAX_TEMP = 0.15


# ── 公开 API ────────────────────────────────────────────────────────────────────

def tokenize_col_name(name: str) -> list[str]:
    """按下划线/连字符/空格及 camelCase 边界拆分列名为小写词元列表。"""
    s = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1_\2', name)
    s = re.sub(r'([a-z\d])([A-Z])', r'\1_\2', s)
    return [t for t in re.split(r'[^a-zA-Z0-9]+', s.lower()) if t]


def recommend_target_columns(df: pd.DataFrame) -> list[dict[str, Any]]:
    """对每列进行目标列可能性评分，返回 Top-10 候选（含 softmax 归一化置信度）。

    返回格式::

        [{"col": "survived", "confidence": 0.87, "reason": "列名精确匹配...；二值列..."}, ...]
    """
    n_rows = len(df)
    n_cols = len(df.columns)
    candidates: list[dict[str, Any]] = []

    single_letter_cols = {c for c in df.columns if len(c) == 1 and c.lower() in _SINGLE_LETTER_COORDS}
    has_coord_system = len(single_letter_cols) >= 2

    for i, col in enumerate(df.columns):
        col_lower = col.lower()
        tokens_list = tokenize_col_name(col)
        tokens = set(tokens_list)
        last_token = tokens_list[-1] if tokens_list else ''

        score = 0.0
        reasons: list[str] = []

        # ── 命名信号 ──
        if col_lower in _KW_EXACT:
            score += 0.50
            reasons.append("列名精确匹配目标列关键词")
        elif tokens & _KW_TOKEN:
            score += 0.35
            reasons.append("列名含目标列关键词")

        if tokens & _KW_PRICE:
            score += 0.25
            reasons.append("列名含价格/金额关键词")

        has_final = bool(tokens & _KW_FINAL)
        has_price = bool(tokens & _KW_PRICE)

        if has_final:
            score += 0.10
            reasons.append("含最终/实际语义前缀")

        if has_final and has_price:
            score += 0.20
            reasons.append("同时含最终语义+价格语义（强目标信号）")

        if last_token in _KW_TARGET_SUFFIX:
            score += 0.10
            reasons.append("含目标语义后缀")

        # ── 位置信号 ──
        if i == n_cols - 1:
            score += 0.10
            reasons.append("位于最后一列（业界习惯）")

        # ── 基数信号 ──
        n_unique = int(df[col].nunique())

        if n_unique == 2:
            score += 0.15
            reasons.append("二值列（典型分类目标）")
        elif 3 <= n_unique <= 20 and not pd.api.types.is_float_dtype(df[col]):
            score += 0.10
            reasons.append("低基数列（可能为分类目标）")

        if pd.api.types.is_numeric_dtype(df[col]) and not df[col].isnull().all():
            std = float(df[col].std())
            mean_abs = abs(float(df[col].mean())) if float(df[col].mean()) != 0 else 1e-9
            if std / mean_abs > 0.1:
                score += 0.05
                reasons.append("数值型且具有一定方差")

        # ── 惩罚信号 ──
        if has_coord_system and col in single_letter_cols:
            score -= 0.35
            reasons.append("单字母列且存在坐标系（可能为空间维度）")

        # 浮点列高基数是回归目标的正常特征，仅对整型/字符串列施加惩罚
        if n_rows > 50 and n_unique >= n_rows * 0.95 and not pd.api.types.is_float_dtype(df[col]):
            score -= 0.30
            reasons.append("近唯一列（可能为 ID）")

        if tokens & _KW_ID and n_rows > 0 and n_unique > n_rows * 0.5:
            score -= 0.40
            reasons.append("列名含 ID 类关键词且基数高")

        if score > 0:
            candidates.append({
                "col": col,
                "_raw": score,
                "reason": "；".join(reasons),
            })

    candidates.sort(key=lambda x: -x["_raw"])
    candidates = candidates[:10]

    # softmax 归一化：加入虚拟 "无明确目标" 基线，让绝对弱信号不会膨胀到高百分比
    if candidates:
        exp_scores = [math.exp(c["_raw"] / _SOFTMAX_TEMP) for c in candidates]
        total = sum(exp_scores) + 1.0          # +1.0 = exp(0/temp) 虚拟基线
        for c, e in zip(candidates, exp_scores):
            c["confidence"] = round(min(e / total, 0.99), 2)

    for c in candidates:
        c.pop("_raw", None)

    return candidates
