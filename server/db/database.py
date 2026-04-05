"""
数据库连接配置与数据目录管理

支持跨平台数据存储：
  - Windows: %APPDATA%/XGBoostStudio/ (通常 C:/Users/用户名/AppData/Roaming/XGBoostStudio/)
  - macOS: ~/.xgbooststudio/ (通常 /Users/用户名/.xgbooststudio/)
  - Linux: ~/.xgbooststudio/ (通常 /home/用户名/.xgbooststudio/)

数据目录结构：
  XGBoostStudio/
  ├── app.db           — SQLite 数据库（记录数据集、模型、报告元数据）
  ├── data/            — 上传的原始数据文件（CSV/Excel）
  ├── models/          — 训练保存的 XGBoost 模型文件（.ubj 格式）
  └── reports/         — 生成的 PDF 分析报告
"""
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# 数据目录（跨平台）
# 测试/CI：设置 XGBOOST_STUDIO_DATA_DIR 可隔离到临时目录，避免污染本机 AppData。
_override_data = os.environ.get("XGBOOST_STUDIO_DATA_DIR")
if _override_data:
    APP_DATA_DIR = Path(_override_data)
elif sys.platform == "win32":
    # Windows: %APPDATA%\XGBoostStudio\
    APP_DATA_DIR = Path(os.environ.get("APPDATA", Path.home())) / "XGBoostStudio"
else:
    # macOS / Linux: ~/.xgbooststudio/
    APP_DATA_DIR = Path.home() / ".xgbooststudio"

APP_DATA_DIR.mkdir(parents=True, exist_ok=True)

# 数据文件目录（已上传的 CSV/Excel）
DATA_DIR = APP_DATA_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# 模型目录（已训练的 XGBoost 模型）
MODELS_DIR = APP_DATA_DIR / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# 报告目录（生成的 PDF 报告）
REPORTS_DIR = APP_DATA_DIR / "reports"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

# SQLite 数据库路径
DB_PATH = APP_DATA_DIR / "app.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

# SQLAlchemy 引擎配置
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """所有 ORM 模型的声明基类。"""


def get_db():
    """FastAPI 依赖注入：获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """初始化数据库，创建所有表"""
    # 触发所有 ORM 模型的 mapper 注册（副作用导入）
    import importlib
    importlib.import_module("db.models")

    Base.metadata.create_all(bind=engine)
    _run_migrations()


def _run_migrations():
    """对已存在的表执行增量列迁移（SQLite ALTER TABLE ADD COLUMN）"""
    from sqlalchemy import text

    migrations = [
        # (table, column, column_def)
        ("models",  "is_deleted",      "INTEGER NOT NULL DEFAULT 0"),
        ("models",  "notes",           "TEXT"),
        ("reports", "report_type",     "VARCHAR(50) DEFAULT 'single'"),
        ("reports", "model_ids_json",  "TEXT"),
        ("models",  "provenance_json", "TEXT"),
        ("dataset_splits", "split_strategy", "VARCHAR(32) NOT NULL DEFAULT 'random'"),
        ("dataset_splits", "time_column", "TEXT"),
        ("models", "cv_fold_metrics_json", "TEXT"),
        ("models", "cv_summary_json", "TEXT"),
        ("models", "cv_k", "INTEGER"),
    ]

    with engine.connect() as conn:
        for table, col, col_def in migrations:
            # 检查列是否已存在
            rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            existing_cols = {r[1] for r in rows}
            if col not in existing_cols:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {col_def}"))
                conn.commit()
