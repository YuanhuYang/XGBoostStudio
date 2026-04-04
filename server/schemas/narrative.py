"""
G2-R1 数据叙事 API 响应契约（设计定稿，供 OpenAPI 与实现阶段对齐）。

实现阶段：`dataset_narrative_service` 填充本结构；`report_service` 消费 `charts`/`bullets` 等生成 PDF。
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class NarrativeDepth(str, Enum):
    """计算与篇幅档位；实现阶段可映射采样率、相关矩阵列上限等。"""

    standard = "standard"
    detailed = "detailed"


# ── 元信息 ────────────────────────────────────────────────────────────────────


class DataNarrativeMeta(BaseModel):
    dataset_id: int
    split_id: Optional[int] = Field(None, description="划分 ID；无则仅基于数据集元数据/全表 profile（实现阶段定义）")
    model_id: Optional[int] = Field(None, description="若由报告生成链路拉取，可带回用于追溯")
    target_column: Optional[str] = None
    task_type: Optional[Literal["classification", "regression"]] = None
    depth: NarrativeDepth = NarrativeDepth.standard
    generated_at: str = Field(..., description="ISO 或本地可读时间戳")
    row_count_profiled: int = Field(..., ge=0, description="参与 profile 的行数（采样后则为采样数）")
    sample_note: Optional[str] = Field(None, description="如大表采样：「仅随机采样 10000 行做相关分析」")


# ── 变量目录 ──────────────────────────────────────────────────────────────────


class VariableRole(str, Enum):
    numeric = "numeric"
    categorical = "categorical"
    datetime = "datetime"
    text = "text"
    unknown = "unknown"


class VariableProfile(BaseModel):
    name: str
    role: VariableRole
    missing_rate: float = Field(..., ge=0, le=1)
    n_unique: Optional[int] = Field(None, description="类别列有效；高基数可截断展示")
    stats: Optional[dict[str, Any]] = Field(
        None,
        description="数值列：min/max/mean/std/分位数；类别列：top_categories 等，结构实现阶段细化",
    )
    is_target: bool = False


# ── 列间关系 ─────────────────────────────────────────────────────────────────


class CorrelationMethod(str, Enum):
    pearson = "pearson"
    spearman = "spearman"


class CorrelationPair(BaseModel):
    col_a: str
    col_b: str
    method: CorrelationMethod
    coefficient: float = Field(..., description="-1~1；类别对与混合类型由实现选用合适指标并在 narrative_hint 说明")
    narrative_hint: str = Field(..., description="规则模板生成的一句话，供 PDF 正文使用")


class MulticollinearityFlag(BaseModel):
    feature: str
    vif: Optional[float] = None
    note: str


class CategoricalAssociationItem(BaseModel):
    """低基数类别列两两关联（χ² + Cramér's V）。"""

    col_a: str
    col_b: str
    cramers_v: float = Field(..., ge=0, le=1)
    chi2_pvalue: Optional[float] = Field(None, description="样本不足或期望频数过小时可能为 None")
    narrative_hint: str


class MissingVsTargetItem(BaseModel):
    """缺失指示与目标是否统计相关（非随机缺失提示）。"""

    feature: str
    test_name: str = Field(..., description="chi2_missing_vs_target 或 ttest_missing_vs_target")
    pvalue: Optional[float] = None
    narrative_hint: str


# ── 与目标的关系 ─────────────────────────────────────────────────────────────


class TargetRelationMetric(str, Enum):
    mutual_info = "mutual_info"
    f_stat = "f_stat"
    correlation = "correlation"
    other = "other"


class TargetRelationItem(BaseModel):
    feature: str
    metric: TargetRelationMetric
    value: float
    rank: int = Field(..., ge=1)
    narrative_hint: str = Field(..., description="模板生成读特征一句，如「与 Survived 互信息较高」")


# ── 图表规格（供 chart_service + report 消费）────────────────────────────────


class ChartSpec(BaseModel):
    chart_id: str = Field(..., description="稳定 ID，如 corr_heatmap_numeric")
    title: str
    format: Literal["png_embed"] = "png_embed"
    width_cm: float = Field(12.0, gt=0)
    height_cm: Optional[float] = None
    payload_ref: Optional[str] = Field(
        None,
        description="实现阶段：内存键或临时路径；API JSON 可置空由服务内传递",
    )


# ── 叙事 bullet 与合规话术 ────────────────────────────────────────────────────


class DataNarrativeBullets(BaseModel):
    """执行摘要中「数据侧」条目；与模型侧 executive_summary 区分或合并由报告模板决定。"""

    findings: list[str] = Field(default_factory=list, description="3～7 条，规则从统计量生成")
    caveats: list[str] = Field(
        default_factory=list,
        description="相关≠因果、样本量、缺失影响、高基数类别等",
    )


class DataNarrativeResponse(BaseModel):
    """GET …/data-narrative 的完整响应体。"""

    meta: DataNarrativeMeta
    variables: list[VariableProfile] = Field(default_factory=list)
    correlation_pairs: list[CorrelationPair] = Field(
        default_factory=list,
        description="高相关或对目标敏感对；上限由 depth 控制",
    )
    multicollinearity: list[MulticollinearityFlag] = Field(default_factory=list)
    categorical_associations: list[CategoricalAssociationItem] = Field(
        default_factory=list,
        description="低基数类别×类别；Cramér's V 与 p 值供解读",
    )
    missing_vs_target: list[MissingVsTargetItem] = Field(
        default_factory=list,
        description="缺失与目标分布/均值差异的简要检验结论",
    )
    target_relations: list[TargetRelationItem] = Field(default_factory=list)
    charts: list[ChartSpec] = Field(default_factory=list)
    bullets: DataNarrativeBullets = Field(default_factory=DataNarrativeBullets)
