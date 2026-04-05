"""
XGBoost Studio — FastAPI 后端入口
监听地址：127.0.0.1:18899
"""
import logging
import os
import signal
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

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
    # 确保运行时目录存在
    _appdata = Path(os.environ.get("APPDATA", Path.home())) / "XGBoostStudio"
    (_appdata / "logs").mkdir(parents=True, exist_ok=True)
    # 文件日志
    fh = logging.FileHandler(_appdata / "logs" / "server.log", encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
    logging.getLogger().addHandler(fh)
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
# allow_origin_regex 覆盖任意 localhost 端口（Vite 端口可能自动递增）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["app://.", "file://"],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
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
# 报表模板独立到 /api/report-templates，避免路由冲突
from routers.reports import template_router
app.include_router(template_router)
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


@app.get("/api/system/version", tags=["system"])
async def system_version():
    """返回后端版本号"""
    try:
        import tomllib  # Python 3.11+
    except ImportError:
        try:
            import tomli as tomllib  # type: ignore
        except ImportError:
            return {"version": "0.1.0"}
    try:
        pyproject = Path(__file__).parent / "pyproject.toml"
        with open(pyproject, "rb") as f:
            data = tomllib.load(f)
        return {"version": data.get("project", {}).get("version", "0.1.0")}
    except (OSError, KeyError, ValueError):
        return {"version": "0.1.0"}


# ── 全局异常处理 ──────────────────────────────────────────────────────────────

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request: Request, exc: RequestValidationError):
    errors = exc.errors()
    msgs = [f"{'.'.join(str(l) for l in e['loc'][1:])}: {e['msg']}" for e in errors]
    return JSONResponse(
        status_code=422,
        content={"detail": "请求参数错误：" + "；".join(msgs)},
    )


@app.exception_handler(Exception)  # pylint: disable=broad-exception-caught  # noqa: BLE001
async def global_exception_handler(_request: Request, exc: Exception):
    logger.exception("未处理的服务器错误: %s", exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "服务器内部错误，请稍后重试或联系支持团队"},
    )


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
