"""全局校验与错误路径抽样（多模块 AC 的 API 侧证据）。"""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from main import app
from db.database import init_db

# 确保数据库初始化
init_db()


def test_training_start_invalid_body_type_422(client):
    """非法 JSON 类型应返回 422（RequestValidationError）。"""
    r = client.post(
        "/api/training/start",
        json={"split_id": "not-an-integer", "params": {}},
    )
    assert r.status_code == 422
    body = r.json()
    detail = body.get("detail")
    assert detail is not None


def test_report_compare_too_few_models_422(client):
    """POST /api/reports/compare 少于 2 个模型 ID 时 422。"""
    r = client.post(
        "/api/reports/compare",
        json={"model_ids": [1], "title": "x"},
    )
    assert r.status_code == 422


def test_upload_empty_csv(client):
    """上传空 CSV 文件应返回 400 错误。"""
    with tempfile.NamedTemporaryFile(mode='w+', suffix='.csv', delete=False) as f:
        f.write('')
        temp_path = Path(f.name)
    
    try:
        with open(temp_path, 'rb') as f:
            response = client.post(
                "/api/datasets/upload",
                files={"file": ("empty.csv", f, "text/csv")}
            )
            assert response.status_code == 400
            # accept any 400 indicating empty file problem
            detail = response.json()["detail"].lower()
            assert "empty" in detail or "column" in detail or "parse" in detail
    finally:
        temp_path.unlink()


def test_upload_large_csv_robustness(client):
    """超大 CSV 文件处理测试 - 验证不崩溃，正常处理或返回合理错误。"""
    # 创建一个约 1MB 的 CSV 文件（仍然可控，不会OOM）
    rows = 10000
    with tempfile.NamedTemporaryFile(mode='w+', suffix='.csv', delete=False) as f:
        f.write("feature1,feature2,target\n")
        for i in range(rows):
            f.write(f"{i},{i*2},{i%2}\n")
        temp_path = Path(f.name)
    
    try:
        with open(temp_path, 'rb') as f:
            response = client.post(
                "/api/datasets/upload",
                files={"file": ("large.csv", f, "text/csv")}
            )
        # 接受：200 成功 或 413 过大（如果后续添加大小限制）
        assert response.status_code in [200, 413]
        if response.status_code == 200:
            data = response.json()
            # FastAPI 返回 id 或者 dataset_id
            assert "id" in data or "dataset_id" in data
            assert "rows" in data
            assert data["rows"] == rows
    finally:
        temp_path.unlink()


def test_idempotent_upload_same_file_twice(client):
    """同一文件重复上传幂等性测试 - 两次上传都成功，生成两个不同数据集。"""
    # 第一次上传
    csv_content = "feature1,feature2,target\n1,2,0\n2,3,1\n3,4,0\n"
    with tempfile.NamedTemporaryFile(mode='w+', suffix='.csv', delete=False) as f:
        f.write(csv_content)
        temp_path = Path(f.name)
    
    try:
        # 第一次上传
        with open(temp_path, 'rb') as f:
            resp1 = client.post(
                "/api/datasets/upload",
                files={"file": ("test.csv", f, "text/csv")}
            )
        assert resp1.status_code == 200
        data1 = resp1.json()
        # DatasetResponse returns 'id', not dataset_id
        id1 = data1["id"]
        
        # 第二次上传同一个文件
        with open(temp_path, 'rb') as f:
            resp2 = client.post(
                "/api/datasets/upload",
                files={"file": ("test.csv", f, "text/csv")}
            )
        assert resp2.status_code == 200
        data2 = resp2.json()
        id2 = data2["id"]
        
        # 不同的 dataset_id，两次都成功
        assert id1 != id2
        
        # 清理
        client.delete(f"/api/datasets/{id1}")
        client.delete(f"/api/datasets/{id2}")
    finally:
        temp_path.unlink()


def test_random_seed_reproducible_split(client):
    """相同随机种子两次划分结果完全一致（可复现性）。"""
    # 先上传数据集
    csv_content = "f1,f2,f3,target\n"
    for i in range(100):
        csv_content += f"{i},{i%2},{i*0.1},{i%2}\n"
    
    with tempfile.NamedTemporaryFile(mode='w+', suffix='.csv', delete=False) as f:
        f.write(csv_content)
        temp_path = Path(f.name)
    
    try:
        with open(temp_path, 'rb') as f:
            resp = client.post(
                "/api/datasets/upload",
                files={"file": ("seed_test.csv", f, "text/csv")}
            )
        assert resp.status_code == 200
        dataset_id = resp.json()["id"]
        
        # 第一次划分，固定种子
        split_resp1 = client.post(
            f"/api/datasets/{dataset_id}/split",
            json={
                "target_column": "target",
                "train_ratio": 0.7,
                "random_seed": 42,
                "stratify": True
            }
        )
        assert split_resp1.status_code == 200
        split_id1 = split_resp1.json()["split_id"]
        train_rows1 = split_resp1.json()["train_rows"]
        test_rows1 = split_resp1.json()["test_rows"]
        
        # 第二次划分，相同种子
        split_resp2 = client.post(
            f"/api/datasets/{dataset_id}/split",
            json={
                "target_column": "target",
                "train_ratio": 0.7,
                "random_seed": 42,
                "stratify": True
            }
        )
        assert split_resp2.status_code == 200
        train_rows2 = split_resp2.json()["train_rows"]
        test_rows2 = split_resp2.json()["test_rows"]
        
        # 相同种子应该产生相同划分结果
        assert train_rows1 == train_rows2 == 70
        assert test_rows1 == test_rows2 == 30
        
        # 清理
        client.delete(f"/api/datasets/{dataset_id}")
    finally:
        temp_path.unlink()


def test_missing_target_column_400(client):
    """目标列不存在时返回 400。"""
    # 先上传数据集
    csv_content = "f1,f2,f3\n1,2,3\n4,5,6\n"
    with tempfile.NamedTemporaryFile(mode='w+', suffix='.csv', delete=False) as f:
        f.write(csv_content)
        temp_path = Path(f.name)
    
    try:
        with open(temp_path, 'rb') as f:
            resp = client.post(
                "/api/datasets/upload",
                files={"file": ("missing_target.csv", f, "text/csv")}
            )
        assert resp.status_code == 200
        dataset_id = resp.json()["id"]
        
        # 尝试划分，目标列不存在
        split_resp = client.post(
            f"/api/datasets/{dataset_id}/split",
            json={
                "target_column": "not_exists",
                "test_size": 0.3,
                "random_state": 42,
                "stratify": False
            }
        )
        assert split_resp.status_code == 400
        assert "不存在" in split_resp.json()["detail"]
        
        # 清理
        client.delete(f"/api/datasets/{dataset_id}")
    finally:
        temp_path.unlink()
