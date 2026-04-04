"""
Pytest 配置：在导入 `main` 之前隔离数据目录，避免测试污染本机 AppData。
"""
from __future__ import annotations

# 需已启动服务的脚本式验收，不参与默认 pytest 收集（见 AGENTS.md）。
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

    from main import app

    with TestClient(app) as c:
        yield c
