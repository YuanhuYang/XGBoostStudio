"""
Pytest 配置：在导入 `main` 之前隔离数据目录，避免测试污染本机 AppData。
"""
from __future__ import annotations

# 需已启动服务的脚本式验收，不参与默认 pytest 收集（见 .cursor/AGENTS.md）。
collect_ignore = ["acceptance_test.py"]

import os
import tempfile
from pathlib import Path

import pytest


def pytest_configure(config: pytest.Config) -> None:
    if os.environ.get("XGBOOST_STUDIO_DATA_DIR"):
        return
    root = Path(tempfile.mkdtemp(prefix="xgboost_studio_pytest_"))
    os.environ["XGBOOST_STUDIO_DATA_DIR"] = str(root)


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from db.database import init_db
    init_db()  # 确保表创建（包括 report_templates）

    from main import app

    with TestClient(app) as c:
        yield c


def pytest_collection_modifyitems(config, items):
    """标记需要串行执行的集成测试，避免并发冲突"""
    # 这些完整 pipeline 测试依赖数据库状态，并发执行会冲突
    serial_tests = [
        "test_titanic_ac001_api_pipeline_report_pdf",
        "test_report_pdf_evaluation_section_generates",
        "test_models_compare_query_and_comparison_report_pdf",
        "test_pdf_contains_methodology_section",
        "test_g2r1b_report_generate_accepts_narrative_depth",
        "test_report_pdf_contains_data_relations_ac912",
        "test_evaluation_stable_after_report_generate",
    ]
    for item in items:
        if any(name in item.nodeid for name in serial_tests):
            item.add_marker(pytest.mark.serial)

