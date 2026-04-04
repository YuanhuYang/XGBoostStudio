"""
数据库连接配置
SQLite 存储路径: APPDATA/XGBoostStudio/app.db
"""
import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# 数据目录: %APPDATA%/XGBoostStudio/
APP_DATA_DIR = Path(os.environ.get("APPDATA", Path.home())) / "XGBoostStudio"
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)

# 数据文件目录
DATA_DIR = APP_DATA_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# 模型目录
MODELS_DIR = APP_DATA_DIR / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# 报告目录
REPORTS_DIR = APP_DATA_DIR / "reports"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = APP_DATA_DIR / "app.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

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
    ]

    with engine.connect() as conn:
        for table, col, col_def in migrations:
            # 检查列是否已存在
            rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            existing_cols = {r[1] for r in rows}
            if col not in existing_cols:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {col_def}"))
                conn.commit()
