"""
超参数调优路由（模块7）
POST /api/tuning/start                  → 创建调优任务
GET  /api/tuning/{task_id}/progress     → SSE 进度流
POST /api/tuning/{task_id}/stop         → 停止调优
GET  /api/tuning/{task_id}/result       → 最优参数 & 模型
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from db.database import get_db
from schemas.model import TuningRequest
from services.tuning_service import (
    create_tuning_task,
    tuning_stream,
    stop_tuning_task,
    get_tuning_result,
)

router = APIRouter(prefix="/api/tuning", tags=["tuning"])


@router.post("/start")
def start_tuning(body: TuningRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    task_id = create_tuning_task(
        split_id=body.split_id,
        search_space=body.search_space or {},
        strategy=body.strategy or "tpe",
        n_trials=body.n_trials or 30,
        db=db,
    )
    return {"task_id": task_id}


@router.get("/{task_id}/progress")
def tuning_progress(task_id: str, db: Session = Depends(get_db)) -> StreamingResponse:
    async def generator():
        async for chunk in tuning_stream(task_id, db):
            yield chunk

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{task_id}/stop")
def stop_tuning(task_id: str, db: Session = Depends(get_db)) -> dict[str, str]:
    stop_tuning_task(task_id, db)
    return {"status": "stopping"}


@router.get("/{task_id}/result")
def tuning_result(task_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    return get_tuning_result(task_id, db)
