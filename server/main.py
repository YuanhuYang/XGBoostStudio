"""
XGBoost Studio — FastAPI 后端入口
监听地址：127.0.0.1:18899
"""
import logging
import signal
import sys
from contextlib import asynccontextmanager

import uvicorn

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# 路由模块
from routers import datasets, params, training, models, tuning, reports, prediction, wizard
from db.database import init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("xgboost-studio")

# ── 生命周期 ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """启动/关闭钩子"""
    logger.info("XGBoost Studio 后端启动中...")
    init_db()
    logger.info("数据库初始化完成")
    yield
    logger.info("XGBoost Studio 后端正在关闭...")


# ── 应用实例 ──────────────────────────────────────────────────────────────────

app = FastAPI(
    title="XGBoost Studio API",
    description="XGBoost Studio 后端服务 - 提供数据处理、模型训练、评估与预测 API",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS（仅允许本地 Electron/Vite 访问）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "app://.", "file://"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 路由注册 ──────────────────────────────────────────────────────────────────

app.include_router(datasets.router)
app.include_router(params.router)
app.include_router(training.router)
app.include_router(models.router)
app.include_router(tuning.router)
app.include_router(reports.router)
app.include_router(prediction.router)
app.include_router(wizard.router)


# ── 健康检查 ──────────────────────────────────────────────────────────────────

@app.get("/health", tags=["system"])
async def health_check():
    """健康检查端点，Electron 启动时轮询此接口"""
    return {"status": "ok", "version": "0.1.0"}


@app.get("/", tags=["system"])
async def root():
    return {"message": "XGBoost Studio API is running", "docs": "/docs"}


# ── 优雅关闭（捕获 SIGTERM）────────────────────────────────────────────────────

def handle_sigterm(_signum: int, _frame: object) -> None:
    logger.info("收到 SIGTERM 信号，准备优雅关闭...")
    sys.exit(0)


signal.signal(signal.SIGTERM, handle_sigterm)


# ── 入口 ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=18899,
        reload=False,
        log_level="info",
    )
