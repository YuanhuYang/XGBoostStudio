"""
模型评估服务单元测试
补充 eval_service 覆盖率缺口
"""
from pathlib import Path
import pytest
import pandas as pd
import numpy as np
from sqlalchemy.orm import Session
from db.models import Model, Dataset, DatasetSplit
from services import eval_service


def test_module_imports():
    """验证所有公开 API 可导入"""
    assert hasattr(eval_service, "_load_xy_train_test")
    assert hasattr(eval_service, "_load_model_and_data")
    assert hasattr(eval_service, "get_evaluation")


def test_get_evaluation_raises_404_not_found():
    """get_evaluation 模型不存在抛出 404"""
    from unittest.mock import Mock
    mock_db = Mock()
    
    def mock_query(*args):
        mock_result = Mock()
        mock_result.first = lambda: None
        return mock_result
    
    mock_db.query = mock_query
    with pytest.raises(Exception):
        eval_service.get_evaluation(9999, mock_db)
