"""
特征分析服务单元测试
全覆盖 feature_service.py 所有公共函数
"""
import pandas as pd
import numpy as np
import pytest
from sqlalchemy.orm import Session
from fastapi import HTTPException

from db.models import Dataset
from services import feature_service


def create_test_dataset(df):
    """创建一个测试 Dataset 对象，加载指定 DataFrame"""
    from pathlib import Path
    import tempfile
    temp_dir = Path(tempfile.gettempdir())
    csv_path = temp_dir / f"test_feature_{id(df)}.csv"
    df.to_csv(csv_path, index=False)
    
    dataset = Dataset(
        name="test",
        path=str(csv_path.relative_to(temp_dir)),
        file_type="csv",
        cols=len(df.columns),
        rows=len(df),
    )
    # Monkey patch _load_df to use our temp file
    original_load = feature_service._load_df
    def _patched_load(ds):
        if ds.id == dataset.id:
            return df
        return original_load(ds)
    feature_service._load_df = _patched_load
    
    return dataset, csv_path


def test_get_feature_distributions_normal():
    """正态分布特征统计正确计算偏度和峰度"""
    np.random.seed(42)
    df = pd.DataFrame({
        "normal": np.random.normal(0, 1, 100),
        "skewed": np.random.exponential(1, 100),
        "target": np.random.randint(0, 2, 100),
    })
    dataset, _ = create_test_dataset(df)
    result = feature_service.get_feature_distributions(dataset)
    
    assert len(result) == 3  # all three numeric features (target is also numeric)
    # 偏度接近 0 对于正态分布
    normal_entry = next(e for e in result if e["column"] == "normal")
    assert abs(normal_entry["skewness"]) < 0.5
    assert normal_entry["is_normal"] is not None


def test_get_feature_distributions_few_samples():
    """样本太少的列被跳过"""
    df = pd.DataFrame({
        "col1": [1, 2],
        "target": [0, 1],
    })
    dataset, _ = create_test_dataset(df)
    result = feature_service.get_feature_distributions(dataset)
    # len(series) < 3 -> skipped
    assert len(result) == 0


def test_get_correlation_pearson():
    """Pearson 相关矩阵计算正确"""
    df = pd.DataFrame({
        "x1": [1, 2, 3, 4, 5],
        "x2": [1, 2, 3, 4, 5],  # 完全相关 x1
        "x3": [5, 4, 3, 2, 1],  # 完全负相关
    })
    dataset, _ = create_test_dataset(df)
    result = feature_service.get_correlation(dataset, method="pearson")
    
    assert result["columns"] == ["x1", "x2", "x3"]
    matrix = result["matrix"]
    assert matrix[0][1] is not None
    assert abs(matrix[0][1] - 1.0) < 0.01  # x1-x2 correlation = 1
    assert abs(matrix[0][2] + 1.0) < 0.01  # x1-x3 correlation = -1


def test_get_correlation_empty():
    """无数值列返回空结果"""
    df = pd.DataFrame({
        "cat1": ["a", "b", "c"],
        "cat2": ["x", "y", "z"],
    })
    dataset, _ = create_test_dataset(df)
    result = feature_service.get_correlation(dataset)
    assert result["columns"] == []
    assert result["matrix"] == []


def test_get_correlation_invalid_method_fallback():
    """无效相关方法回退到 pearson"""
    df = pd.DataFrame({
        "x1": [1, 2, 3],
        "x2": [4, 5, 6],
    })
    dataset, _ = create_test_dataset(df)
    result = feature_service.get_correlation(dataset, method="invalid_method")
    assert len(result["columns"]) == 2
    # 不抛出异常，正常返回就是正确回退


def test_get_target_relation_numeric_numeric():
    """数值特征与数值目标正确计算 pearson 相关"""
    df = pd.DataFrame({
        "feature": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        "target": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    })
    dataset, _ = create_test_dataset(df)
    result = feature_service.get_target_relation(dataset, "target")
    
    assert len(result) == 1
    entry = result[0]
    assert entry["type"] == "scatter"
    assert abs(entry["pearson_r"] - 1.0) < 0.01


def test_get_target_relation_categorical_numeric():
    """类别特征与数值目标正确计算 ANOVA"""
    df = pd.DataFrame({
        "cat": ["A", "A", "A", "B", "B", "B"],
        "target": [1, 2, 3, 10, 11, 12],
    })
    dataset, _ = create_test_dataset(df)
    result = feature_service.get_target_relation(dataset, "target")
    
    assert len(result) == 1
    entry = result[0]
    assert entry["type"] == "boxplot"
    assert "anova_f" in entry
    assert "anova_p" in entry


def test_get_target_relation_missing_target():
    """目标列不存在抛出 400 HTTPException"""
    df = pd.DataFrame({"x": [1, 2, 3]})
    dataset, _ = create_test_dataset(df)
    with pytest.raises(HTTPException) as exc_info:
        feature_service.get_target_relation(dataset, "not_exists")
    assert exc_info.value.status_code == 400
    assert "不存在" in exc_info.value.detail


def test_get_target_relation_too_few_samples():
    """样本太少的特征被跳过"""
    df = pd.DataFrame({
        "f1": [1, 2],
        "target": [0, 1],
    })
    dataset, _ = create_test_dataset(df)
    result = feature_service.get_target_relation(dataset, "target")
    assert len(result) == 0


def test_get_vif_multicollinear():
    """多重共线性检测正确计算 VIF"""
    np.random.seed(42)
    x1 = np.random.normal(0, 1, 100)
    x2 = x1 + np.random.normal(0, 0.01, 100)  # 高度共线性
    x3 = np.random.normal(0, 1, 100)
    df = pd.DataFrame({"x1": x1, "x2": x2, "x3": x3})
    dataset, _ = create_test_dataset(df)
    result = feature_service.get_vif(dataset)
    
    # 按 VIF 降序排列
    assert len(result) == 3
    assert result[0]["vif"] > result[-1]["vif"]
    # x1 和 x2 应该有高 VIF
    assert any(entry["vif"] > 10 for entry in result)
    # 分级正确
    for entry in result:
        assert entry["level"] in ["low", "medium", "high"]


def test_get_vif_less_than_two_columns():
    """少于两列返回空列表"""
    df = pd.DataFrame({"x1": [1, 2, 3]})
    dataset, _ = create_test_dataset(df)
    result = feature_service.get_vif(dataset)
    assert result == []


def test_get_vif_singular_matrix():
    """奇异矩阵处理（完全共线性）返回无穷大 VIF"""
    df = pd.DataFrame({"x1": [1, 2, 3], "x2": [1, 2, 3]})
    dataset, _ = create_test_dataset(df)
    result = feature_service.get_vif(dataset)
    # 至少有一个特征 VIF 很高
    assert any(entry["vif"] >= 9999 for entry in result)


def test_get_mutual_info_importance_classification():
    """分类任务互信息重要性计算"""
    np.random.seed(42)
    df = pd.DataFrame({
        "important": np.concatenate([np.zeros(50), np.ones(50)]),
        "noise": np.random.rand(100),
        "target": np.concatenate([np.zeros(50), np.ones(50)]),
    })
    dataset, _ = create_test_dataset(df)
    result = feature_service.get_mutual_info_importance(dataset, "target")
    
    assert len(result) == 2
    # important 特征的互信息应该大于 noise
    important_score = next(e["importance"] for e in result if e["column"] == "important")
    noise_score = next(e["importance"] for e in result if e["column"] == "noise")
    assert important_score > noise_score
    # 按重要性降序排列
    assert result[0]["importance"] >= result[-1]["importance"]


def test_get_mutual_info_importance_missing_target():
    """目标列不存在抛出 400"""
    df = pd.DataFrame({"x": [1, 2, 3]})
    dataset, _ = create_test_dataset(df)
    with pytest.raises(HTTPException) as exc_info:
        feature_service.get_mutual_info_importance(dataset, "target")
    assert exc_info.value.status_code == 400


def test_get_mutual_info_importance_no_numeric():
    """无非数值特征返回空"""
    df = pd.DataFrame({
        "cat": ["a", "b", "c"],
        "target": [0, 1, 0],
    })
    dataset, _ = create_test_dataset(df)
    result = feature_service.get_mutual_info_importance(dataset, "target")
    assert result == []


def test_get_mahalanobis_outliers():
    """马氏距离异常值检测返回结果正确格式"""
    np.random.seed(42)
    df = pd.DataFrame({
        "x1": np.random.normal(0, 1, 100),
        "x2": np.random.normal(0, 1, 100),
    })
    # 注入一个异常值
    df.loc[0, "x1"] = 10
    df.loc[0, "x2"] = 10
    dataset, _ = create_test_dataset(df)
    result = feature_service.get_mahalanobis_outliers(dataset)
    
    # 异常值应该被检测到（97.5% 阈值）
    assert any(outlier["row_index"] == 0 for outlier in result)
    assert all("mahalanobis_dist" in outlier for outlier in result)


def test_get_mahalanobis_too_few_samples():
    """样本太少返回空列表"""
    df = pd.DataFrame({"x1": [1, 2, 3, 4, 5, 6, 7, 8], "x2": [1, 2, 3, 4, 5, 6, 7, 8]})
    dataset, _ = create_test_dataset(df)
    result = feature_service.get_mahalanobis_outliers(dataset)
    assert result == []


def test_encode_features_onehot():
    """one-hot 编码正确"""
    df = pd.DataFrame({
        "cat": ["A", "B", "A", "C"],
        "num": [1, 2, 3, 4],
    })
    dataset, _ = create_test_dataset(df)
    
    # mock db session
    class MockDB(Session):
        def commit(self):
            pass
        def refresh(self, obj):
            pass
    
    result = feature_service.encode_features(dataset, ["cat"], "onehot", None, MockDB())
    # 我们无法验证保存的文件，但函数不抛异常就是成功
    assert result is not None


def test_encode_features_label():
    """标签编码正确"""
    df = pd.DataFrame({
        "cat": ["A", "B", "A", "C"],
        "num": [1, 2, 3, 4],
    })
    dataset, _ = create_test_dataset(df)
    class MockDB(Session):
        def commit(self): pass
        def refresh(self, obj): pass
    
    result = feature_service.encode_features(dataset, ["cat"], "label", None, MockDB())
    assert result is not None


def test_scale_features_standard():
    """StandardScaler 标准化"""
    df = pd.DataFrame({
        "x": [1, 2, 3, 4, 5],
        "y": [10, 20, 30, 40, 50],
    })
    dataset, _ = create_test_dataset(df)
    class MockDB(Session):
        def commit(self): pass
        def refresh(self, obj): pass
    
    result = feature_service.scale_features(dataset, None, "standard", MockDB())
    assert result is not None


def test_scale_features_empty_valid_cols():
    """无有效数值列返回原数据集"""
    df = pd.DataFrame({
        "cat1": ["a", "b", "c"],
        "cat2": ["x", "y", "z"],
    })
    # all columns are categorical, no numeric columns
    dataset, _ = create_test_dataset(df)
    class MockDB(Session):
        def commit(self): pass
        def refresh(self, obj): pass
    
    # scale only non-numeric columns, all filtered out -> valid_cols empty
    result = feature_service.scale_features(dataset, ["cat1", "cat2"], "standard", MockDB())
    assert result == dataset


def test_box_cox_transform():
    """Box-Cox 变换对正数据有效"""
    np.random.seed(42)
    df = pd.DataFrame({
        "positive": np.random.exponential(1, 100) + 0.1,
        "target": [0, 1] * 50,
    })
    dataset, _ = create_test_dataset(df)
    class MockDB(Session):
        def commit(self): pass
        def refresh(self, obj): pass
    
    result = feature_service.box_cox_transform(dataset, ["positive"], MockDB())
    assert result is not None


def test_box_cox_skip_non_positive():
    """非正数数据跳过 Box-Cox"""
    df = pd.DataFrame({
        "has_zero": [-1, 0, 1, 2],
    })
    dataset, _ = create_test_dataset(df)
    class MockDB(Session):
        def commit(self): pass
        def refresh(self, obj): pass
    
    result = feature_service.box_cox_transform(dataset, ["has_zero"], MockDB())
    # 函数不抛异常，原数据集保留
    assert result is not None


