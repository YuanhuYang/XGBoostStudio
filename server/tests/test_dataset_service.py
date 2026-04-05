"""
数据集服务单元测试
补充 dataset_service 覆盖率缺口（当前 34% 需要提升）
"""
import pytest
import pandas as pd
import numpy as np
from pathlib import Path
import tempfile
import shutil
from sqlalchemy.orm import Session
from db.models import Dataset
from services import dataset_service as svc


def test_load_df_works():
    """_load_df 能正确加载 DataFrame"""
    df = pd.DataFrame({"x": [1, 2, 3], "y": [4, 5, 6]})
    tmp_dir = tempfile.mkdtemp()
    temp_path = Path(tmp_dir) / "input.csv"
    df.to_csv(temp_path, index=False)
    
    dataset = Dataset(name="test", path=str(temp_path), file_type="csv")
    loaded = svc._load_df(dataset)
    assert loaded.shape == (3, 2)
    assert list(loaded.columns) == ["x", "y"]
    shutil.rmtree(tmp_dir)


def test_save_df_works():
    """_save_df 能正确保存 DataFrame"""
    from db.database import DATA_DIR
    df = pd.DataFrame({"x": [1, 2, 3], "y": [4, 5, 6]})
    
    # Get filename from existing temp path
    tmp_dir = tempfile.mkdtemp()
    temp_path = Path(tmp_dir) / "input.csv"
    df.to_csv(temp_path, index=False)
    
    # _save_df saves to DATA_DIR with a new name
    saved_path_str = svc._save_df(df, str(temp_path))
    saved_path = DATA_DIR / saved_path_str
    assert saved_path.exists()
    
    loaded = pd.read_csv(saved_path)
    assert loaded.shape == (3, 2)
    
    # Cleanup
    saved_path.unlink()
    shutil.rmtree(tmp_dir)


def test__detect_encoding_exists():
    """_detect_encoding 存在且不崩溃"""
    from pathlib import Path
    import tempfile
    content = "column1,column2\n1,2\n".encode("utf-8")
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(content)
        temp_path = Path(f.name)
    encoding = svc._detect_encoding(temp_path)
    assert encoding.lower() in ["utf-8", "utf-8-sig"]
    temp_path.unlink()
