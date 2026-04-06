"""
G3-A 测试套件：XGBoost 专属特征分析 + 数据泄露检测

覆盖：
  - feature_service.calc_iv_ks_auc（IV/KS/AUC 效力分析）
  - feature_service.calc_psi_all（PSI 稳定性分析）
  - feature_service.calc_monotonicity（单调性分析）
  - feature_service.get_label_analysis（标签专项分析）
  - leakage_service.detect_label_leakage（标签泄露检测）
  - leakage_service.detect_time_leakage（时间穿越泄露检测）
  - leakage_service.detect_fit_leakage（拟合泄露检测）
  - leakage_service.run_full_leakage_detection（综合检测）
  - API 端点：/iv-ks-psi、/psi、/monotonicity、/label-analysis、/leakage-detection
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from db.models import Dataset
from services import feature_service
from services import leakage_service


# ─── 测试夹具：构造 Dataset 对象 ──────────────────────────────────────────────

def _make_dataset(df: pd.DataFrame, name: str = "test") -> Dataset:
    """创建一个内存中使用的伪 Dataset，直接 monkey-patch _load_df。"""
    ds = Dataset(name=name, path="__mem__", file_type="csv", cols=len(df.columns), rows=len(df))
    ds.id = id(df)

    original = feature_service._load_df

    def _patched(d):
        if d is ds:
            return df.copy()
        return original(d)

    feature_service._load_df = _patched
    leakage_service._load_df = _patched
    return ds


@pytest.fixture(autouse=True)
def restore_load_df():
    orig_feat = feature_service._load_df
    orig_leak = leakage_service._load_df
    yield
    feature_service._load_df = orig_feat
    leakage_service._load_df = orig_leak


# ─── IV / KS / AUC 分类任务测试 ──────────────────────────────────────────────

class TestCalcIvKsAuc:
    def _cls_df(self) -> pd.DataFrame:
        """构造一个强预测特征 + 噪声特征的二分类数据集"""
        np.random.seed(42)
        n = 500
        target = np.random.randint(0, 2, n)
        strong = target * 2 + np.random.normal(0, 0.1, n)   # 强相关特征
        noise = np.random.normal(0, 1, n)                    # 噪声特征
        return pd.DataFrame({"strong": strong, "noise": noise, "target": target})

    def test_returns_sorted_by_iv(self):
        df = self._cls_df()
        ds = _make_dataset(df)
        result = feature_service.calc_iv_ks_auc(ds, "target")
        assert len(result) == 2
        # 强特征排在前面
        assert result[0]["column"] == "strong"

    def test_iv_fields_present(self):
        df = self._cls_df()
        ds = _make_dataset(df)
        result = feature_service.calc_iv_ks_auc(ds, "target")
        for row in result:
            assert "iv" in row
            assert "ks" in row
            assert "single_auc" in row
            assert "iv_level" in row

    def test_strong_feature_high_iv(self):
        df = self._cls_df()
        ds = _make_dataset(df)
        result = feature_service.calc_iv_ks_auc(ds, "target")
        strong_row = next(r for r in result if r["column"] == "strong")
        assert strong_row["iv"] is not None
        assert strong_row["iv"] > 0.1, "强特征 IV 应大于 0.1"

    def test_strong_feature_high_auc(self):
        df = self._cls_df()
        ds = _make_dataset(df)
        result = feature_service.calc_iv_ks_auc(ds, "target")
        strong_row = next(r for r in result if r["column"] == "strong")
        assert strong_row["single_auc"] is not None
        assert strong_row["single_auc"] >= 0.8, "强特征单特征 AUC 应 >= 0.8"

    def test_missing_target_raises_400(self):
        from fastapi import HTTPException
        df = pd.DataFrame({"x": [1, 2, 3]})
        ds = _make_dataset(df)
        with pytest.raises(HTTPException) as exc:
            feature_service.calc_iv_ks_auc(ds, "not_exists")
        assert exc.value.status_code == 400

    def test_regression_task_returns_r2(self):
        """回归任务（目标列唯一值 > 20）应输出 R²"""
        np.random.seed(0)
        n = 200
        x = np.linspace(0, 10, n)
        target = x * 2 + np.random.normal(0, 0.5, n)   # 连续目标
        df = pd.DataFrame({"x": x, "noise": np.random.normal(0, 1, n), "target": target})
        ds = _make_dataset(df)
        result = feature_service.calc_iv_ks_auc(ds, "target")
        assert result[0]["task_type"] == "regression"
        assert "r2" in result[0]
        assert result[0]["r2"] is not None
        x_row = next(r for r in result if r["column"] == "x")
        assert x_row["r2"] > 0.8, "高线性相关特征 R² 应 > 0.8"


# ─── PSI 稳定性测试 ───────────────────────────────────────────────────────────

class TestCalcPsiAll:
    def test_stable_feature_low_psi(self):
        """时间前后分布相同的特征 PSI 应接近 0"""
        np.random.seed(42)
        n = 600
        time_idx = np.arange(n)
        stable = np.random.normal(0, 1, n)   # 稳定分布
        df = pd.DataFrame({"time": time_idx, "stable": stable})
        ds = _make_dataset(df)
        result = feature_service.calc_psi_all(ds, "time")
        assert len(result) == 1
        stable_row = result[0]
        assert stable_row["psi"] < 0.1, f"稳定特征 PSI 应 < 0.1，实际为 {stable_row['psi']}"
        assert stable_row["level"] == "稳定"

    def test_unstable_feature_high_psi(self):
        """前后分布截然不同的特征 PSI 应 > 0.25"""
        n = 600
        time_idx = np.arange(n)
        # 前 60% 均值=0，后 40% 均值=10
        unstable = np.concatenate([np.random.normal(0, 1, 360), np.random.normal(10, 1, 240)])
        df = pd.DataFrame({"time": time_idx, "unstable": unstable})
        ds = _make_dataset(df)
        result = feature_service.calc_psi_all(ds, "time")
        assert len(result) == 1
        row = result[0]
        assert row["psi"] > 0.25, f"不稳定特征 PSI 应 > 0.25，实际为 {row['psi']}"
        assert row["level"] == "不稳定"

    def test_missing_time_col_raises_400(self):
        from fastapi import HTTPException
        df = pd.DataFrame({"x": [1, 2, 3]})
        ds = _make_dataset(df)
        with pytest.raises(HTTPException):
            feature_service.calc_psi_all(ds, "missing_time")

    def test_excludes_target_column(self):
        """target_column 不应出现在 PSI 结果中"""
        n = 300
        df = pd.DataFrame({"time": np.arange(n), "feature": np.random.normal(0, 1, n), "target": np.random.randint(0, 2, n)})
        ds = _make_dataset(df)
        result = feature_service.calc_psi_all(ds, "time", target_column="target")
        cols = [r["column"] for r in result]
        assert "target" not in cols
        assert "time" not in cols


# ─── 单调性分析测试 ───────────────────────────────────────────────────────────

class TestCalcMonotonicity:
    def test_monotone_increasing_detected(self):
        """强单调递增特征应被识别为递增，constraint = 1"""
        n = 300
        x = np.linspace(0, 10, n)
        target = x + np.random.normal(0, 0.01, n)
        df = pd.DataFrame({"x": x, "target": target})
        ds = _make_dataset(df)
        result = feature_service.calc_monotonicity(ds, "target")
        assert len(result) == 1
        row = result[0]
        assert row["monotone_constraint"] == 1
        assert "递增" in row["direction"]

    def test_monotone_decreasing_detected(self):
        """强单调递减特征应被识别为递减，constraint = -1"""
        n = 300
        x = np.linspace(0, 10, n)
        target = -x + np.random.normal(0, 0.01, n)
        df = pd.DataFrame({"x": x, "target": target})
        ds = _make_dataset(df)
        result = feature_service.calc_monotonicity(ds, "target")
        row = result[0]
        assert row["monotone_constraint"] == -1
        assert "递减" in row["direction"]

    def test_non_monotone_zero_constraint(self):
        """随机特征单调性约束应为 0"""
        np.random.seed(42)
        n = 300
        x = np.random.normal(0, 1, n)
        target = np.random.normal(0, 1, n)
        df = pd.DataFrame({"x": x, "target": target})
        ds = _make_dataset(df)
        result = feature_service.calc_monotonicity(ds, "target")
        row = result[0]
        assert row["monotone_constraint"] == 0

    def test_returns_bin_means(self):
        """bin_means 字段应包含分箱目标均值序列"""
        n = 200
        x = np.linspace(0, 10, n)
        target = x
        df = pd.DataFrame({"x": x, "target": target})
        ds = _make_dataset(df)
        result = feature_service.calc_monotonicity(ds, "target")
        assert "bin_means" in result[0]
        assert len(result[0]["bin_means"]) >= 2

    def test_categorical_string_target(self):
        """字符串类别目标 + 数值特征时应能产出单调性结果（factorize 后聚合）"""
        np.random.seed(7)
        n = 400
        x = np.linspace(0, 10, n)
        p_pos = 1 / (1 + np.exp(-(x - 5)))
        y_bin = np.random.binomial(1, p_pos)
        df = pd.DataFrame({"x": x, "target": np.where(y_bin == 1, "pos", "neg")})
        ds = _make_dataset(df)
        result = feature_service.calc_monotonicity(ds, "target")
        assert len(result) >= 1
        row = result[0]
        assert row["column"] == "x"
        assert "spearman_rho" in row
        assert "bin_means" in row
        assert len(row["bin_means"]) >= 2


# ─── 标签专项分析测试 ──────────────────────────────────────────────────────────

class TestGetLabelAnalysis:
    def test_binary_classification_scale_pos_weight(self):
        """不均衡二分类数据应输出 scale_pos_weight"""
        df = pd.DataFrame({"target": [0] * 90 + [1] * 10})
        ds = _make_dataset(df)
        result = feature_service.get_label_analysis(ds, "target")
        assert result["task_type"] == "binary_classification"
        assert result["scale_pos_weight"] is not None
        assert abs(result["scale_pos_weight"] - 9.0) < 0.01, "scale_pos_weight 应为 90/10 = 9"

    def test_severe_imbalance_warning(self):
        """严重不均衡（> 10:1）应有警告"""
        df = pd.DataFrame({"target": [0] * 990 + [1] * 10})
        ds = _make_dataset(df)
        result = feature_service.get_label_analysis(ds, "target")
        assert result["class_balance_warning"] is not None
        assert "严重" in result["class_balance_warning"]

    def test_regression_task_no_scale_pos_weight(self):
        """回归任务不输出 scale_pos_weight"""
        np.random.seed(0)
        df = pd.DataFrame({"target": np.random.normal(0, 1, 300)})
        ds = _make_dataset(df)
        result = feature_service.get_label_analysis(ds, "target")
        assert result["task_type"] == "regression"

    def test_missing_labels_counted(self):
        """缺失标签数量正确统计"""
        target = [0, 1, None, 0, 1, None, 0]
        df = pd.DataFrame({"target": target})
        ds = _make_dataset(df)
        result = feature_service.get_label_analysis(ds, "target")
        assert result["n_missing_label"] == 2

    def test_missing_target_raises_400(self):
        from fastapi import HTTPException
        df = pd.DataFrame({"x": [1, 2, 3]})
        ds = _make_dataset(df)
        with pytest.raises(HTTPException) as exc:
            feature_service.get_label_analysis(ds, "no_col")
        assert exc.value.status_code == 400


# ─── 标签泄露检测测试 ──────────────────────────────────────────────────────────

class TestDetectLabelLeakage:
    def test_high_correlation_detected(self):
        """与目标相关性 > 0.9 的特征应被识别为泄露"""
        np.random.seed(42)
        target = np.random.randint(0, 2, 300)
        leaking = target + np.random.normal(0, 0.001, 300)  # 几乎完全相关
        noise = np.random.normal(0, 1, 300)
        df = pd.DataFrame({"leaking": leaking, "noise": noise, "target": target})
        result = leakage_service.detect_label_leakage(df, "target", threshold=0.9)
        assert result["risks_found"] >= 1
        assert any(r["feature"] == "leaking" for r in result["risks"])

    def test_no_leakage_clean_data(self):
        """干净数据集不应检测到泄露"""
        np.random.seed(42)
        n = 300
        df = pd.DataFrame({
            "f1": np.random.normal(0, 1, n),
            "f2": np.random.normal(5, 2, n),
            "target": np.random.randint(0, 2, n),
        })
        result = leakage_service.detect_label_leakage(df, "target", threshold=0.9)
        assert result["overall_risk"] == "通过"

    def test_identical_column_detected(self):
        """与目标完全相同的列应被检测"""
        df = pd.DataFrame({"copy_target": [0, 1, 0, 1], "target": [0, 1, 0, 1]})
        result = leakage_service.detect_label_leakage(df, "target", threshold=0.9)
        assert any(r["feature"] == "copy_target" for r in result["risks"])
        assert result["overall_risk"].startswith("P0")

    def test_top_correlations_returned(self):
        """top_correlations 字段应包含相关性排名"""
        np.random.seed(42)
        n = 200
        df = pd.DataFrame({"f1": np.random.normal(0, 1, n), "target": np.random.randint(0, 2, n)})
        result = leakage_service.detect_label_leakage(df, "target", threshold=0.9)
        assert "top_correlations" in result
        assert len(result["top_correlations"]) >= 1


# ─── 时间穿越泄露检测测试 ──────────────────────────────────────────────────────

class TestDetectTimeLeakage:
    def test_time_leakage_detected(self):
        """特征时间戳晚于标签时间戳应被检测"""
        # 设置：前5行 feature_time >= label_time（泄露），后5行 feature_time < label_time（正常）
        label_dates = pd.date_range("2023-01-05", periods=10, freq="D")
        # 前5行特征时间晚于或等于标签时间（泄露）
        feat_early = pd.date_range("2023-01-01", periods=5, freq="D")   # < label: 正常
        feat_late = pd.date_range("2023-01-10", periods=5, freq="D")    # > label: 泄露
        feat_times = list(feat_late) + list(feat_early)  # 前5行泄露，后5行正常
        df = pd.DataFrame({
            "feature_time": feat_times,
            "label_time": label_dates,
            "value": range(10),
        })
        result = leakage_service.detect_time_leakage(df, "label_time", feature_time_map={"value": "feature_time"})
        assert result["risks_found"] >= 1

    def test_no_time_leakage_valid_data(self):
        """特征时间戳严格早于标签时间戳，不应检测到泄露"""
        feat_dates = pd.date_range("2023-01-01", periods=10, freq="D")
        label_dates = pd.date_range("2023-02-01", periods=10, freq="D")  # 标签时间更晚
        df = pd.DataFrame({
            "feature_time": feat_dates,
            "label_time": label_dates,
            "value": range(10),
        })
        result = leakage_service.detect_time_leakage(df, "label_time", feature_time_map={"value": "feature_time"})
        assert result["risks_found"] == 0
        assert result["overall_risk"] == "通过"

    def test_missing_label_time_col_raises_400(self):
        from fastapi import HTTPException
        df = pd.DataFrame({"x": [1, 2, 3]})
        with pytest.raises(HTTPException):
            leakage_service.detect_time_leakage(df, "missing_col")


# ─── 拟合泄露检测测试 ──────────────────────────────────────────────────────────

class TestDetectFitLeakage:
    def test_full_dataset_fit_detected(self):
        """fit_on=full_dataset 的操作应被标记为 P0 风险"""
        steps = [
            {"step_name": "标准化", "operation": "scaling", "fit_on": "full_dataset"},
        ]
        result = leakage_service.detect_fit_leakage(steps)
        assert result["risks_found"] == 1
        assert result["overall_risk"].startswith("P0")

    def test_train_only_fit_compliant(self):
        """fit_on=train_only 的操作应标记为合规"""
        steps = [
            {"step_name": "标准化", "operation": "scaling", "fit_on": "train_only"},
            {"step_name": "独热编码", "operation": "encoding", "fit_on": "train_only"},
        ]
        result = leakage_service.detect_fit_leakage(steps)
        assert result["risks_found"] == 0
        assert result["overall_risk"] == "通过"

    def test_unknown_fit_generates_warning(self):
        """fit_on=unknown 应生成 P1 警告"""
        steps = [
            {"step_name": "缺失值填充", "operation": "imputation", "fit_on": "unknown"},
        ]
        result = leakage_service.detect_fit_leakage(steps)
        assert result["risks_found"] == 1
        assert "P1" in result["overall_risk"]

    def test_non_fitting_operations_not_flagged(self):
        """非拟合型操作（如删除列）不应产生风险"""
        steps = [
            {"step_name": "删除重复列", "operation": "drop_columns", "fit_on": "full_dataset"},
        ]
        result = leakage_service.detect_fit_leakage(steps)
        assert result["risks_found"] == 0


# ─── 综合泄露检测测试 ──────────────────────────────────────────────────────────

class TestRunFullLeakageDetection:
    def test_full_detection_returns_all_types(self):
        """综合检测应返回三个检测类型的结果"""
        np.random.seed(42)
        n = 200
        df = pd.DataFrame({
            "f1": np.random.normal(0, 1, n),
            "f2": np.random.normal(0, 1, n),
            "target": np.random.randint(0, 2, n),
        })
        ds = _make_dataset(df)
        result = leakage_service.run_full_leakage_detection(ds, "target")
        assert "label_leakage" in result["detections"]
        assert "time_leakage" in result["detections"]
        assert "fit_leakage" in result["detections"]
        assert "overall_risk" in result

    def test_leaking_feature_triggers_p0(self):
        """包含高相关特征的数据集整体风险应为 P0"""
        np.random.seed(42)
        n = 200
        target = np.random.randint(0, 2, n)
        leaking = target + np.random.normal(0, 0.001, n)
        df = pd.DataFrame({"leaking": leaking, "target": target})
        ds = _make_dataset(df)
        result = leakage_service.run_full_leakage_detection(ds, "target")
        assert "P0" in result["overall_risk"]

    def test_clean_data_overall_pass(self):
        """干净数据集整体风险应为通过"""
        np.random.seed(0)
        n = 300
        df = pd.DataFrame({
            "f1": np.random.normal(0, 1, n),
            "f2": np.random.normal(5, 2, n),
            "target": np.random.randint(0, 2, n),
        })
        ds = _make_dataset(df)
        result = leakage_service.run_full_leakage_detection(ds, "target")
        assert "通过" in result["overall_risk"] or "P1" not in result["overall_risk"]


# ─── API 端点集成测试 ──────────────────────────────────────────────────────────

@pytest.fixture
def client_with_titanic():
    """使用内置 Titanic 数据集创建 TestClient"""
    from fastapi.testclient import TestClient
    from main import app
    from db.database import get_db
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from db.models import Base
    import tempfile, os

    db_path = os.path.join(tempfile.gettempdir(), "test_g3a.db")
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_api_iv_ks_psi_endpoint(client_with_titanic):
    """IV/KS/PSI API 端点应返回特征效力列表"""
    # 先导入 titanic 数据集
    resp = client_with_titanic.post("/api/datasets/import-sample?key=titanic")
    assert resp.status_code == 200
    ds_id = resp.json()["id"]

    # 测试 IV/KS 端点
    resp2 = client_with_titanic.get(f"/api/datasets/{ds_id}/feature-analysis/iv-ks-psi", params={"target_column": "Survived"})
    assert resp2.status_code == 200
    data = resp2.json()
    assert isinstance(data, list)
    if len(data) > 0:
        assert "column" in data[0]


def test_api_label_analysis_endpoint(client_with_titanic):
    """标签分析 API 端点应返回 scale_pos_weight"""
    resp = client_with_titanic.post("/api/datasets/import-sample?key=titanic")
    ds_id = resp.json()["id"]

    resp2 = client_with_titanic.get(f"/api/datasets/{ds_id}/label-analysis", params={"target_column": "Survived"})
    assert resp2.status_code == 200
    data = resp2.json()
    assert "task_type" in data
    assert "scale_pos_weight" in data


def test_api_monotonicity_endpoint(client_with_titanic):
    """单调性分析 API 端点应返回 monotone_constraint"""
    resp = client_with_titanic.post("/api/datasets/import-sample?key=titanic")
    ds_id = resp.json()["id"]

    resp2 = client_with_titanic.get(f"/api/datasets/{ds_id}/feature-analysis/monotonicity", params={"target_column": "Survived"})
    assert resp2.status_code == 200
    data = resp2.json()
    assert isinstance(data, list)
    if len(data) > 0:
        assert "monotone_constraint" in data[0]
        assert data[0]["monotone_constraint"] in [-1, 0, 1]


def test_api_leakage_detection_endpoint(client_with_titanic):
    """泄露检测 API 端点应返回综合风险结果"""
    resp = client_with_titanic.post("/api/datasets/import-sample?key=titanic")
    ds_id = resp.json()["id"]

    resp2 = client_with_titanic.post(
        f"/api/datasets/{ds_id}/leakage-detection",
        json={"target_column": "Survived", "correlation_threshold": 0.9}
    )
    assert resp2.status_code == 200
    data = resp2.json()
    assert "overall_risk" in data
    assert "detections" in data
    assert "label_leakage" in data["detections"]
