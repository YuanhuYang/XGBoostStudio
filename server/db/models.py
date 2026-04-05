"""
SQLAlchemy ORM 模型定义
"""
from datetime import datetime, timezone
from sqlalchemy import Integer, String, Text, DateTime, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from db.database import Base


class Dataset(Base):
    """数据集表"""
    __tablename__ = "datasets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    path: Mapped[str] = mapped_column(String(500), nullable=False)  # 相对路径
    file_type: Mapped[str] = mapped_column(String(20), nullable=False, default="csv")
    sheet_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    rows: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cols: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_column: Mapped[str | None] = mapped_column(String(100), nullable=True)
    task_type: Mapped[str | None] = mapped_column(String(50), nullable=True)  # classification/regression
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)


class DatasetSplit(Base):
    """数据集划分记录"""
    __tablename__ = "dataset_splits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    dataset_id: Mapped[int] = mapped_column(Integer, ForeignKey("datasets.id"), nullable=False)
    train_path: Mapped[str] = mapped_column(String(500), nullable=False)
    test_path: Mapped[str] = mapped_column(String(500), nullable=False)
    train_ratio: Mapped[float] = mapped_column(Float, nullable=False, default=0.8)
    random_seed: Mapped[int] = mapped_column(Integer, nullable=False, default=42)
    stratify: Mapped[bool] = mapped_column(Integer, nullable=False, default=False)
    train_rows: Mapped[int | None] = mapped_column(Integer, nullable=True)
    test_rows: Mapped[int | None] = mapped_column(Integer, nullable=True)
    split_strategy: Mapped[str] = mapped_column(String(32), nullable=False, default="random")
    time_column: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


class Model(Base):
    """模型表"""
    __tablename__ = "models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    path: Mapped[str] = mapped_column(String(500), nullable=False)  # 相对路径
    task_type: Mapped[str] = mapped_column(String(50), nullable=False)  # classification/regression
    metrics_json: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON 字符串
    params_json: Mapped[str | None] = mapped_column(Text, nullable=True)  # 训练参数 JSON
    provenance_json: Mapped[str | None] = mapped_column(Text, nullable=True)  # G2-Auth-1 运行档案 JSON
    cv_fold_metrics_json: Mapped[str | None] = mapped_column(Text, nullable=True)  # AC-6-03 K 折各折指标
    cv_summary_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    cv_k: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dataset_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("datasets.id"), nullable=True)
    split_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("dataset_splits.id"), nullable=True)
    tags: Mapped[str | None] = mapped_column(String(500), nullable=True)  # 逗号分隔的标签
    description: Mapped[str | None] = mapped_column(Text, nullable=True)  # 用户备注
    training_time_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Integer, nullable=False, default=False)  # 软删除标志
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)  # 用户备注
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)


class TrainingTask(Base):
    """训练任务表"""
    __tablename__ = "training_tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # UUID
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")  # pending/running/completed/failed/stopped
    dataset_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("datasets.id"), nullable=True)
    split_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("dataset_splits.id"), nullable=True)
    params_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("models.id"), nullable=True)
    error_msg: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class TuningTask(Base):
    """调优任务表"""
    __tablename__ = "tuning_tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # UUID
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    dataset_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("datasets.id"), nullable=True)
    split_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("dataset_splits.id"), nullable=True)
    search_space_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    strategy: Mapped[str] = mapped_column(String(50), nullable=False, default="tpe")  # tpe/random/grid
    n_trials: Mapped[int] = mapped_column(Integer, nullable=False, default=50)
    best_params_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    best_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    model_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("models.id"), nullable=True)
    error_msg: Mapped[str | None] = mapped_column(Text, nullable=True)
    # G2-Auth-3：trial 历史、失败计数、收敛序列（JSON）
    tuning_diagnostics_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Report(Base):
    """报告表"""
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    model_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("models.id"), nullable=True)
    path: Mapped[str | None] = mapped_column(String(500), nullable=True)  # 报告文件名（.pdf 或 .html）
    config_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_type: Mapped[str | None] = mapped_column(String(50), nullable=True, default="single")  # single/comparison
    model_ids_json: Mapped[str | None] = mapped_column(Text, nullable=True)  # 多模型对比时的 model_ids JSON
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


class ReportTemplate(Base):
    """报表模板表：保存用户自定义报表模板和内置模板"""
    __tablename__ = "report_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)  # 模板名称
    description: Mapped[str | None] = mapped_column(Text, nullable=True)  # 模板描述
    is_builtin: Mapped[bool] = mapped_column(Integer, nullable=False, default=False)  # 是否内置模板
    sections: Mapped[str] = mapped_column(Text, nullable=False)  # JSON 字符串：选中章节列表
    format_style: Mapped[str] = mapped_column(String(50), nullable=False, default="default")  # default/apa
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)
