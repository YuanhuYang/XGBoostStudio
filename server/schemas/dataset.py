"""
数据集相关 Pydantic 模型
"""
from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, Field


# ── 请求模型 ──────────────────────────────────────────────────────────────────

class MissingHandleConfig(BaseModel):
    strategy: str = Field(..., description="均值/中位数/众数/常量/删除行/不处理")
    fill_value: Optional[Any] = None


class HandleMissingRequest(BaseModel):
    config: dict[str, MissingHandleConfig]


class HandleOutliersRequest(BaseModel):
    action: str = Field(..., description="drop 或 keep")
    row_indices: list[int]


class SplitRequest(BaseModel):
    train_ratio: float = Field(0.8, ge=0.1, le=0.95)
    random_seed: int = Field(42, ge=0)
    stratify: bool = False
    target_column: str


class EncodeRequest(BaseModel):
    columns: list[str]
    method: str = Field("onehot", description="onehot/label/target")
    target_column: Optional[str] = None


class ScaleRequest(BaseModel):
    columns: list[str]
    method: str = Field("standard", description="standard/minmax/robust")


class BoxCoxRequest(BaseModel):
    columns: list[str]


class PCARequest(BaseModel):
    columns: list[str]
    n_components: int = Field(2, ge=1)


class SelectFeaturesRequest(BaseModel):
    method: str = Field("variance", description="variance/correlation/rfe/l1")
    target_column: str
    threshold: Optional[float] = None
    n_features: Optional[int] = None


# ── 响应模型 ──────────────────────────────────────────────────────────────────

class ColumnStatResponse(BaseModel):
    name: str
    dtype: str
    non_null: int
    missing: int
    missing_rate: float
    mean: Optional[float] = None
    median: Optional[float] = None
    std: Optional[float] = None
    min: Optional[float] = None
    max: Optional[float] = None
    unique: int


class DatasetStatsResponse(BaseModel):
    rows: int
    cols: int
    columns: list[ColumnStatResponse]


class PreviewResponse(BaseModel):
    columns: list[str]
    data: list[dict[str, Any]]
    total: int
    page: int
    page_size: int


class QualityScoreResponse(BaseModel):
    score: float
    missing_rate: float
    outlier_rate: float
    duplicate_rate: float
    suggestions: list[str]


class DatasetResponse(BaseModel):
    id: int
    name: str
    original_filename: str
    file_type: str
    sheet_name: Optional[str] = None
    rows: Optional[int] = None
    cols: Optional[int] = None
    target_column: Optional[str] = None
    task_type: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SplitResponse(BaseModel):
    split_id: int
    train_rows: int
    test_rows: int
    train_ratio: float
