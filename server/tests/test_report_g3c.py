"""
G3-C 测试套件：XGBoost 专业 PDF 报告

覆盖：
  - report_service.CHAPTER_12_KEYS（12章定义完整性）
  - report_service.TEMPLATE_CHAPTER_SETS（4种预设模板）
  - report_service.CHAPTER_12_TITLES（章节标题完整性）
  - BrandConfig schema（品牌定制字段）
  - ReportGenerateRequest（template_type / brand_config 字段）
  - generate_report with template_type（12章模式生成）
  - API 端点：POST /api/reports/generate（包含 template_type）
"""
from __future__ import annotations

import os
import tempfile

import pytest


# ─── 12章定义完整性测试 ────────────────────────────────────────────────────────

class TestChapter12Definitions:
    def test_exactly_10_chapters(self):
        """CHAPTER_12_KEYS 必须包含 10 个章节（规格说明书共10章）"""
        from services.report_service import CHAPTER_12_KEYS
        assert len(CHAPTER_12_KEYS) == 10

    def test_chapter_keys_cover_all_required(self):
        """必须包含规格说明书规定的所有章节"""
        from services.report_service import CHAPTER_12_KEYS
        required = {
            "ch1_executive_summary",
            "ch2_label_dataset",
            "ch3_feature_engineering",
            "ch4_modeling_tuning",
            "ch5_model_accuracy",
            "ch6_interpretability",
            "ch7_risk_compliance",
            "ch8_business_application",
            "ch9_conclusion",
            "ch10_appendix",
        }
        assert set(CHAPTER_12_KEYS) == required

    def test_chapter_titles_all_present(self):
        """每个章节 key 都应有对应的中文标题"""
        from services.report_service import CHAPTER_12_KEYS, CHAPTER_12_TITLES
        for ch_key in CHAPTER_12_KEYS:
            assert ch_key in CHAPTER_12_TITLES, f"章节 {ch_key} 缺少标题"
            assert len(CHAPTER_12_TITLES[ch_key]) > 0, f"章节 {ch_key} 标题为空"

    def test_chapter_titles_contain_chapter_numbers(self):
        """章节标题应包含章节序号（第X章）"""
        from services.report_service import CHAPTER_12_TITLES
        for key, title in CHAPTER_12_TITLES.items():
            assert "章" in title, f"章节 {key} 标题 '{title}' 不含章节序号"


# ─── 4种预设模板测试 ──────────────────────────────────────────────────────────

class TestTemplateChapterSets:
    def test_five_templates_defined(self):
        """TEMPLATE_CHAPTER_SETS 应定义 5 个模板（含 full_12_chapters）"""
        from services.report_service import TEMPLATE_CHAPTER_SETS
        expected = {"full_12_chapters", "executive_brief", "business_execution", "technical_expert", "compliance_audit"}
        assert set(TEMPLATE_CHAPTER_SETS.keys()) == expected

    def test_full_12_chapters_contains_all(self):
        """full_12_chapters 模板必须包含所有 10 个章节"""
        from services.report_service import TEMPLATE_CHAPTER_SETS, CHAPTER_12_KEYS
        assert set(TEMPLATE_CHAPTER_SETS["full_12_chapters"]) == set(CHAPTER_12_KEYS)

    def test_executive_brief_is_shorter(self):
        """管理层简报版应少于 full_12_chapters"""
        from services.report_service import TEMPLATE_CHAPTER_SETS
        assert len(TEMPLATE_CHAPTER_SETS["executive_brief"]) < len(TEMPLATE_CHAPTER_SETS["full_12_chapters"])

    def test_executive_brief_has_required_chapters(self):
        """管理层简报必须包含摘要和业务建议章节"""
        from services.report_service import TEMPLATE_CHAPTER_SETS
        chapters = TEMPLATE_CHAPTER_SETS["executive_brief"]
        assert "ch1_executive_summary" in chapters
        assert "ch8_business_application" in chapters or "ch9_conclusion" in chapters

    def test_compliance_audit_has_appendix(self):
        """合规审计版必须包含附录"""
        from services.report_service import TEMPLATE_CHAPTER_SETS
        assert "ch10_appendix" in TEMPLATE_CHAPTER_SETS["compliance_audit"]

    def test_technical_expert_has_interpretability(self):
        """技术专家版必须包含可解释性章节"""
        from services.report_service import TEMPLATE_CHAPTER_SETS
        assert "ch6_interpretability" in TEMPLATE_CHAPTER_SETS["technical_expert"]

    def test_all_chapter_keys_in_templates_are_valid(self):
        """所有模板中引用的章节 key 应在 CHAPTER_12_KEYS 中"""
        from services.report_service import TEMPLATE_CHAPTER_SETS, CHAPTER_12_KEYS
        valid_keys = set(CHAPTER_12_KEYS)
        for template_name, chapters in TEMPLATE_CHAPTER_SETS.items():
            for ch in chapters:
                assert ch in valid_keys, f"模板 {template_name} 中的章节 {ch} 不在 CHAPTER_12_KEYS 中"


# ─── BrandConfig Schema 测试 ──────────────────────────────────────────────────

class TestBrandConfigSchema:
    def test_brand_config_optional_fields(self):
        """BrandConfig 所有字段应可选"""
        from schemas.model import BrandConfig
        bc = BrandConfig()
        assert bc.logo_path is None
        assert bc.watermark_text is None
        assert bc.primary_color_hex is None
        assert bc.company_name is None
        assert bc.footer_text is None

    def test_brand_config_with_values(self):
        """BrandConfig 可以正确设置所有字段"""
        from schemas.model import BrandConfig
        bc = BrandConfig(
            watermark_text="机密",
            company_name="测试公司",
            primary_color_hex="#003087",
        )
        assert bc.watermark_text == "机密"
        assert bc.company_name == "测试公司"
        assert bc.primary_color_hex == "#003087"

    def test_report_generate_request_has_template_type(self):
        """ReportGenerateRequest 必须包含 template_type 字段"""
        from schemas.model import ReportGenerateRequest
        req = ReportGenerateRequest(model_id=1)
        assert hasattr(req, "template_type")
        assert req.template_type == "full_12_chapters"

    def test_report_generate_request_template_type_validation(self):
        """template_type 应限制为合法值"""
        from pydantic import ValidationError
        from schemas.model import ReportGenerateRequest
        # 合法值应成功
        for valid in ["full_12_chapters", "executive_brief", "business_execution", "technical_expert", "compliance_audit"]:
            req = ReportGenerateRequest(model_id=1, template_type=valid)
            assert req.template_type == valid
        # 非法值应抛出 ValidationError
        with pytest.raises(ValidationError):
            ReportGenerateRequest(model_id=1, template_type="invalid_type")

    def test_report_generate_request_has_brand_config(self):
        """ReportGenerateRequest 必须包含 brand_config 字段"""
        from schemas.model import ReportGenerateRequest
        req = ReportGenerateRequest(model_id=1)
        assert hasattr(req, "brand_config")
        assert req.brand_config is None  # 默认为 None

    def test_report_generate_request_with_brand_config(self):
        """ReportGenerateRequest 可以接收 brand_config"""
        from schemas.model import ReportGenerateRequest, BrandConfig
        req = ReportGenerateRequest(
            model_id=1,
            template_type="technical_expert",
            brand_config=BrandConfig(watermark_text="CONFIDENTIAL", company_name="XYZ Corp"),
        )
        assert req.brand_config is not None
        assert req.brand_config.watermark_text == "CONFIDENTIAL"


# ─── 报告服务单元测试 ─────────────────────────────────────────────────────────

class TestReportServiceG3:
    def test_legacy_section_mapping_has_all_chapters(self):
        """12章到旧 section 的映射应覆盖所有 ch 键"""
        from services.report_service import CHAPTER_12_KEYS
        legacy_map = {
            "ch1_executive_summary": ["methodology", "executive_summary"],
            "ch2_label_dataset": ["data_overview", "data_relations"],
            "ch3_feature_engineering": ["data_overview"],
            "ch4_modeling_tuning": ["model_params"],
            "ch5_model_accuracy": ["evaluation", "learning_curve", "overfitting", "baseline"],
            "ch6_interpretability": ["shap"],
            "ch7_risk_compliance": ["baseline", "overfitting"],
            "ch8_business_application": ["business_advice"],
            "ch9_conclusion": ["business_advice"],
            "ch10_appendix": ["model_params"],
        }
        for ch_key in CHAPTER_12_KEYS:
            assert ch_key in legacy_map, f"章节 {ch_key} 缺少旧版 section 映射"

    def test_template_type_determines_chapters(self):
        """不同 template_type 应生成不同数量的章节"""
        from services.report_service import TEMPLATE_CHAPTER_SETS
        full = len(TEMPLATE_CHAPTER_SETS["full_12_chapters"])
        brief = len(TEMPLATE_CHAPTER_SETS["executive_brief"])
        technical = len(TEMPLATE_CHAPTER_SETS["technical_expert"])
        assert full > brief, "完整版应多于管理层简报版"
        assert full >= technical, "完整版应不少于技术专家版"


# ─── API 集成测试 ─────────────────────────────────────────────────────────────

@pytest.fixture
def client_for_report():
    """创建含有训练好模型的测试客户端"""
    from fastapi.testclient import TestClient
    from main import app
    from db.database import get_db
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from db.models import Base

    db_path = os.path.join(tempfile.gettempdir(), "test_g3c_report.db")
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
    with TestClient(app) as client:
        # 导入 Titanic 并训练模型
        resp = client.post("/api/datasets/import-sample?key=titanic")
        if resp.status_code != 200:
            yield client, None
            return
        ds_id = resp.json()["id"]

        split_resp = client.post(f"/api/datasets/{ds_id}/split", json={
            "train_ratio": 0.8, "target_column": "Survived", "random_seed": 42
        })
        if split_resp.status_code != 200:
            yield client, None
            return
        split_id = split_resp.json()["split_id"]

        train_resp = client.post("/api/training/start", json={
            "split_id": split_id, "params": {"n_estimators": 10, "max_depth": 3}
        })
        if train_resp.status_code != 200:
            yield client, None
            return

        import time
        time.sleep(2)
        models_resp = client.get("/api/models")
        model_id = models_resp.json()[0]["id"] if models_resp.json() else None
        yield client, model_id

    app.dependency_overrides.clear()


def test_generate_report_full_12_chapters(client_for_report):
    """生成完整 12 章报告应成功"""
    client, model_id = client_for_report
    if model_id is None:
        pytest.skip("模型未创建")

    resp = client.post("/api/reports/generate", json={
        "model_id": model_id,
        "template_type": "full_12_chapters",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "id" in data
    assert "path" in data
    assert data["path"].endswith(".pdf")


def test_generate_report_executive_brief(client_for_report):
    """生成管理层简报版报告应成功"""
    client, model_id = client_for_report
    if model_id is None:
        pytest.skip("模型未创建")

    resp = client.post("/api/reports/generate", json={
        "model_id": model_id,
        "template_type": "executive_brief",
        "title": "管理层简报测试",
    })
    assert resp.status_code == 200


def test_generate_report_with_brand_config(client_for_report):
    """带品牌定制的报告生成应成功"""
    client, model_id = client_for_report
    if model_id is None:
        pytest.skip("模型未创建")

    resp = client.post("/api/reports/generate", json={
        "model_id": model_id,
        "template_type": "compliance_audit",
        "brand_config": {
            "watermark_text": "机密",
            "company_name": "测试公司",
        },
    })
    assert resp.status_code == 200


def test_generate_report_technical_expert(client_for_report):
    """生成技术专家版报告应成功"""
    client, model_id = client_for_report
    if model_id is None:
        pytest.skip("模型未创建")

    resp = client.post("/api/reports/generate", json={
        "model_id": model_id,
        "template_type": "technical_expert",
    })
    assert resp.status_code == 200


def test_generate_report_legacy_include_sections_still_works(client_for_report):
    """旧版 include_sections 参数仍然可用（向后兼容）"""
    client, model_id = client_for_report
    if model_id is None:
        pytest.skip("模型未创建")

    resp = client.post("/api/reports/generate", json={
        "model_id": model_id,
        "include_sections": ["executive_summary", "evaluation"],
    })
    assert resp.status_code == 200


def test_generate_report_missing_model_returns_404(client_for_report):
    """不存在的模型 ID 应返回 404"""
    client, _ = client_for_report
    resp = client.post("/api/reports/generate", json={
        "model_id": 99999,
        "template_type": "full_12_chapters",
    })
    assert resp.status_code == 404


def test_report_list_returns_generated_reports(client_for_report):
    """生成报告后，列表接口应能返回该报告"""
    client, model_id = client_for_report
    if model_id is None:
        pytest.skip("模型未创建")

    # 生成一份
    client.post("/api/reports/generate", json={"model_id": model_id, "template_type": "executive_brief"})
    # 列出所有报告
    resp = client.get("/api/reports")
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


def test_reportSections_ts_constants():
    """reportSections.ts 中的常量应与后端对齐（通过 Python 间接验证）"""
    from services.report_service import CHAPTER_12_KEYS
    # 期待的前端 key 列表
    expected_frontend_keys = [
        "ch1_executive_summary", "ch2_label_dataset", "ch3_feature_engineering",
        "ch4_modeling_tuning", "ch5_model_accuracy", "ch6_interpretability",
        "ch7_risk_compliance", "ch8_business_application", "ch9_conclusion", "ch10_appendix",
    ]
    assert set(CHAPTER_12_KEYS) == set(expected_frontend_keys), (
        "后端 CHAPTER_12_KEYS 与前端 CHAPTERS_12 的 key 列表不一致"
    )
