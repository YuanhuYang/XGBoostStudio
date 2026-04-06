"""
数据集相关 Pydantic 模型
"""
from __future__ import annotations
from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, ConfigDict


# ── 请求模型 ──────────────────────────────────────────────────────────────────

class MissingHandleConfig(BaseModel):
    strategy: str = Field(..., description="均值/中位数/众数/常量/删除行/不处理")
    fill_value: Optional[Any] = None


class HandleMissingRequest(BaseModel):
    config: dict[str, MissingHandleConfig]


class HandleOutliersRequest(BaseModel):
    action: str = Field(..., description="drop 或 keep")
    row_indices: list[int]


class SimpleMissingRequest(BaseModel):
    strategy: str = Field(..., description="mean/median/mode/constant/drop/knn/none")
    columns: Optional[list[str]] = None  # None 表示全部列
    fill_value: Optional[Any] = None


class SimpleOutliersRequest(BaseModel):
    strategy: str = Field("clip", description="clip:IQR截断 / drop:删除行 / mean:均值替换")


class SplitRequest(BaseModel):
    train_ratio: float = Field(0.8, ge=0.1, le=0.95)
    random_seed: int = Field(42, ge=0)
    stratify: bool = False
    target_column: str
    split_strategy: Literal["random", "time_series"] = Field(
        "random",
        description="random=随机划分；time_series=按时间列升序后前段训练、后段测试（防泄漏）",
    )
    time_column: Optional[str] = Field(
        None,
        description="split_strategy=time_series 时必填，为可排序的时间/日期列名",
    )


class EncodeRequest(BaseModel):
    columns: list[str]
    method: str = Field("onehot", description="onehot/label/target")
    target_column: Optional[str] = None


class ScaleRequest(BaseModel):
    columns: Optional[list[str]] = None  # None 表示全部数值列
    method: str = Field("standard", description="standard/minmax/robust")


class BoxCoxRequest(BaseModel):
    columns: list[str]


class PCARequest(BaseModel):
    columns: Optional[list[str]] = None  # None 表示全部数值列
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


class BuiltinSampleResponse(BaseModel):
    """内置示例数据集目录项（与 import-sample 的 key 对应）。"""

    key: str
    title: str
    task: str
    difficulty: str
    scenario: str
    suggested_target: Optional[str] = None


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

    model_config = ConfigDict(from_attributes=True)


class SplitResponse(BaseModel):
    split_id: int
    train_rows: int
    test_rows: int
    train_ratio: float
    split_strategy: str = "random"
    time_column: Optional[str] = None
