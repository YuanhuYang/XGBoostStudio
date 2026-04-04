"""
模型训练/评估/调优相关 Pydantic 模型
"""
from __future__ import annotations
from datetime import datetime
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


# ── 训练 ──────────────────────────────────────────────────────────────────────

class TrainRequest(BaseModel):
    split_id: int
    params: dict[str, Any] = Field(default_factory=dict)
    model_name: Optional[str] = None


class TrainProgressEvent(BaseModel):
    round: int
    total: int
    train_logloss: Optional[float] = None
    val_logloss: Optional[float] = None
    train_rmse: Optional[float] = None
    val_rmse: Optional[float] = None
    elapsed_s: float


class ModelResponse(BaseModel):
    id: int
    name: str
    task_type: str
    metrics_json: Optional[str] = None
    params_json: Optional[str] = None
    dataset_id: Optional[int] = None
    split_id: Optional[int] = None
    tags: Optional[str] = None
    description: Optional[str] = None
    training_time_s: Optional[float] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── 参数配置 ──────────────────────────────────────────────────────────────────

class ParamValidateRequest(BaseModel):
    params: dict[str, Any]


class ParamValidateResponse(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)


# ── 调优 ──────────────────────────────────────────────────────────────────────

class TuningRequest(BaseModel):
    split_id: int
    search_space: dict[str, Any] = Field(default_factory=dict)
    strategy: str = Field("tpe", description="tpe/random/grid")
    n_trials: int = Field(50, ge=1, le=500)
    metric: Optional[str] = None


class TuningProgressEvent(BaseModel):
    trial: int
    total: int
    score: float
    params: dict[str, Any]
    best_score: float
    elapsed_s: float


# ── 预测 ──────────────────────────────────────────────────────────────────────

class SinglePredictRequest(BaseModel):
    model_id: int
    features: dict[str, Any]


class SinglePredictResponse(BaseModel):
    prediction: Any
    probabilities: Optional[dict[str, float]] = None
    shap_values: Optional[dict[str, float]] = None


# ── 报告 ──────────────────────────────────────────────────────────────────────

class ReportGenerateRequest(BaseModel):
    model_id: int
    name: str = ""
    title: Optional[str] = None
    notes: Optional[str] = None
    sections: list[str] = Field(
        default_factory=lambda: [
            "data_overview", "feature_analysis", "model_eval",
            "shap", "tuning_history"
        ]
    )
    # 与 report_service.ALL_SECTIONS 及 G2-R1 设计对齐；可选令牌示例：data_relations（见 docs/设计-G2-R1-数据叙事API与PDF线框.md）
    include_sections: Optional[list[str]] = None  # 按需生成章节，None=全部
    # G2-R1b：控制 data_relations 内叙事计算深度（与 GET /data-narrative?depth= 一致）
    narrative_depth: Optional[Literal["standard", "detailed"]] = "standard"


class ReportCompareRequest(BaseModel):
    model_ids: list[int] = Field(..., min_length=2, description="至少选择2个模型")
    title: Optional[str] = None
