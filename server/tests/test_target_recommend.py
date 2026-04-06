"""回归测试：目标列推荐算法在 10 个标准数据集上的 Top-1 正确率与置信度。"""
from __future__ import annotations

import os

import pandas as pd
import pytest

from services.target_recommend import recommend_target_columns, tokenize_col_name

# ── 测试数据 ────────────────────────────────────────────────────────────────────

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

EXPECTED_TARGETS: dict[str, str] = {
    "adult_income.csv": "income",
    "bank_marketing.csv": "y",
    "boston_housing.csv": "medv",
    "breast_cancer.csv": "diagnosis",
    "credit_card_default.csv": "default_payment_next_month",
    "german_credit.csv": "class",
    "iris.csv": "species",
    "manufacturing_assembly_price.csv": "finished_unit_price",
    "titanic.csv": "Survived",
    "wine.csv": "class",
}

MIN_TOP1_CONFIDENCE = 0.40


# ── 参数化测试 ──────────────────────────────────────────────────────────────────

@pytest.fixture(params=sorted(EXPECTED_TARGETS.keys()))
def dataset_case(request):
    name = request.param
    path = os.path.join(DATA_DIR, name)
    if not os.path.exists(path):
        pytest.skip(f"测试数据不存在: {path}")
    df = pd.read_csv(path)
    return name, df, EXPECTED_TARGETS[name]


def test_top1_correct(dataset_case):
    """Top-1 推荐必须命中期望目标列。"""
    name, df, expected_target = dataset_case
    cands = recommend_target_columns(df)
    assert cands, f"[{name}] 候选列表为空"
    top1 = cands[0]["col"]
    assert top1 == expected_target, (
        f"[{name}] Top-1 错误: got '{top1}', expected '{expected_target}'. "
        f"Top-3: {[(c['col'], c['confidence']) for c in cands[:3]]}"
    )


def test_top1_confidence_above_threshold(dataset_case):
    """Top-1 置信度不得低于阈值。"""
    name, df, expected_target = dataset_case
    cands = recommend_target_columns(df)
    assert cands, f"[{name}] 候选列表为空"
    conf = cands[0]["confidence"]
    assert conf >= MIN_TOP1_CONFIDENCE, (
        f"[{name}] Top-1 置信度过低: {conf:.0%} < {MIN_TOP1_CONFIDENCE:.0%}"
    )


# ── 边界 case 单元测试 ─────────────────────────────────────────────────────────

def test_tokenize_camelcase():
    assert tokenize_col_name("camelCaseVar") == ["camel", "case", "var"]
    assert tokenize_col_name("HTTPServer") == ["http", "server"]
    assert tokenize_col_name("simple") == ["simple"]
    assert tokenize_col_name("under_score") == ["under", "score"]
    assert tokenize_col_name("MixedCase_and_under") == ["mixed", "case", "and", "under"]
    # Pclass 不会被拆分（P+class 不符合标准 camelCase），
    # 这反而正确地避免了 "Pclass" 误命中 "class" 关键词
    assert tokenize_col_name("Pclass") == ["pclass"]


def test_id_column_excluded():
    df = pd.DataFrame({"user_id": range(100), "age": [25]*50 + [30]*50, "target": [0]*50 + [1]*50})
    cands = recommend_target_columns(df)
    cols = [c["col"] for c in cands]
    assert cols[0] == "target", f"Expected 'target' as Top-1, got {cols}"
    assert "user_id" not in cols, "user_id should be excluded from candidates"


def test_empty_dataframe():
    df = pd.DataFrame(columns=["a", "b", "c"])
    cands = recommend_target_columns(df)
    assert cands == [] or all(c["confidence"] > 0 for c in cands)


def test_single_strong_candidate():
    df = pd.DataFrame({"feat1": range(50), "feat2": range(50, 100), "survived": [0]*25 + [1]*25})
    cands = recommend_target_columns(df)
    assert cands[0]["col"] == "survived"
    assert cands[0]["confidence"] >= 0.80


def test_confidence_output_format():
    """验证输出字段格式契合前端 API 契约。"""
    df = pd.DataFrame({"x": [1, 2], "target": [0, 1]})
    cands = recommend_target_columns(df)
    for c in cands:
        assert "col" in c
        assert "confidence" in c
        assert "reason" in c
        assert 0 < c["confidence"] <= 0.99
        assert "_raw" not in c
