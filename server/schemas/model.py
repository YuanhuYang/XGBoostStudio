"""
模型训练/评估/调优相关 Pydantic 模型
"""
from __future__ import annotations
from datetime import datetime
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field, ConfigDict


# ── 训练 ──────────────────────────────────────────────────────────────────────

class TrainRequest(BaseModel):
    split_id: int
    params: dict[str, Any] = Field(default_factory=dict)
    model_name: Optional[str] = None
    use_kfold_cv: bool = Field(
        False,
        description="为 True 时在主训练前对训练集做 K 折并持久化到模型（AC-6-03）；默认关闭以兼容快速测试",
    )
    kfold_k: int = Field(5, ge=2, le=10, description="K 折折数，仅当 use_kfold_cv 为 True 时生效")


class KfoldRequest(BaseModel):
    """训练集 K 折交叉验证（G2-Auth-2）：与默认 hold-out 训练独立。"""

    split_id: int
    k: int = Field(5, ge=2, le=10)
    params: dict[str, Any] = Field(default_factory=dict)


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

    model_config = ConfigDict(from_attributes=True)


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

class BrandConfig(BaseModel):
    """企业品牌定制配置（G3-C）"""
    logo_path: Optional[str] = Field(None, description="企业 Logo 文件路径（本地绝对路径）")
    watermark_text: Optional[str] = Field(None, description="水印文字（如「机密」「内部使用」）")
    primary_color_hex: Optional[str] = Field(None, description="主色调十六进制颜色（如 #003087）")
    company_name: Optional[str] = Field(None, description="企业名称，显示在页眉页脚")
    footer_text: Optional[str] = Field(None, description="自定义页脚文字")


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
    # 与 report_service.ALL_SECTIONS 及 G2-R1 设计对齐；可选令牌示例：data_relations（见 docs/iterations/G2-R1/设计.md）
    include_sections: Optional[list[str]] = None  # 按需生成章节，None=全部
    # G2-R1b：控制 data_relations 内叙事计算深度（与 GET /data-narrative?depth= 一致）
    narrative_depth: Optional[Literal["standard", "detailed"]] = "standard"
    # I3: 格式样式选择 - default/apa
    format_style: Optional[str] = "default"

    # G3-C: 4 种预设模板类型
    template_type: Optional[Literal[
        "executive_brief",    # 管理层简报版
        "business_execution", # 业务执行版
        "technical_expert",   # 技术专家版
        "compliance_audit",   # 合规审计版
        "full_12_chapters",   # 完整 12 章版（默认）
    ]] = Field("full_12_chapters", description="报告预设模板类型")

    # G3-C: 企业品牌定制
    brand_config: Optional[BrandConfig] = Field(None, description="企业品牌定制配置")

    # 与主报告合并展示的对比模型（不含主模型）；最多 8 个
    compare_model_ids: Optional[list[int]] = Field(
        None,
        max_length=8,
        description="对比模型 ID 列表，将写入 PDF 附录 D",
    )


class ReportCompareRequest(BaseModel):
    model_ids: list[int] = Field(..., min_length=2, description="至少选择2个模型")
    title: Optional[str] = None


# ── 报表模板 ───────────────────────────────────────────────────────────────────

class ReportTemplateCreate(BaseModel):
    name: str
    description: Optional[str] = None
    sections: list[str]
    format_style: str = "default"  # default/apa


class ReportTemplateResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    is_builtin: bool
    sections: list[str]
    format_style: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
