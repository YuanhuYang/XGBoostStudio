"""
模型训练路由（模块5）
POST /api/training/start                  → 创建训练任务 {task_id}
GET  /api/training/{task_id}/progress     → SSE 进度流
POST /api/training/{task_id}/stop         → 停止训练
GET  /api/training/{task_id}/result       → 训练结果
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from db.database import get_db
from schemas.model import KfoldRequest, TrainRequest
from services.training_service import (
    create_task,
    training_stream,
    stop_task,
    get_task_result,
    kfold_evaluate,
)

router = APIRouter(prefix="/api/training", tags=["training"])


@router.post("/start")
def start_training(body: TrainRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    """创建训练任务，返回 task_id。"""
    params = dict(body.params or {})
    if body.use_kfold_cv:
        params["use_kfold_cv"] = True
    params["kfold_k"] = body.kfold_k
    task_id = create_task(
        split_id=body.split_id,
        params=params,
        db=db,
        model_name=body.model_name,
    )
    return {"task_id": task_id}


@router.get("/{task_id}/progress")
def training_progress(task_id: str, db: Session = Depends(get_db)) -> StreamingResponse:
    """返回 SSE 训练进度流。"""
    async def generator():
        async for chunk in training_stream(task_id, db):
            yield chunk

    return StreamingResponse(generator(), media_type="text/event-stream",
                              headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/{task_id}/stop")
def stop_training(task_id: str, db: Session = Depends(get_db)) -> dict[str, str]:
    """停止指定训练任务。"""
    stop_task(task_id, db)
    return {"status": "stopping"}


@router.get("/{task_id}/result")
def training_result(task_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    """获取训练任务结果（指标、model_id 等）。"""
    return get_task_result(task_id, db)

@router.post("/kfold")
def kfold_cross_validate(
    body: KfoldRequest,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    K-Fold 交叉验证：仅在训练集上重划分，返回各折与 summary 均值/标准差。
    """
    return kfold_evaluate(split_id=body.split_id, params=body.params, k=body.k, db=db)