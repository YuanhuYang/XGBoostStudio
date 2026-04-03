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
    pass


def get_db():
    """FastAPI 依赖注入：获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """初始化数据库，创建所有表"""
    import db.models  # 触发所有 ORM 模型的 mapper 注册（副作用导入）
    _ = db.models
    Base.metadata.create_all(bind=engine)
