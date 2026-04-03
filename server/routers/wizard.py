"""
智能向导路由
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from services import wizard_service

router = APIRouter(prefix="/api/wizard", tags=["wizard"])


# ── 请求/响应 Schema ──────────────────────────────────────────────────────────

class QuickConfigRequest(BaseModel):
    split_id: int


class RunPipelineRequest(BaseModel):
    split_id: int
    params: dict[str, Any]
    report_title: str = "智能向导自动生成报告"


class RunLabRequest(BaseModel):
    split_id: int
    params: dict[str, Any]


# ── 端点 ──────────────────────────────────────────────────────────────────────

@router.get("/dataset-summary/{dataset_id}", summary="分析数据集质量与任务类型")
def get_dataset_summary(dataset_id: int, db: Session = Depends(get_db)):
    return wizard_service.dataset_summary(dataset_id, db)


@router.get("/preprocess-suggestions/{dataset_id}", summary="AI 预处理建议卡片")
def get_preprocess_suggestions(dataset_id: int, db: Session = Depends(get_db)):
    return wizard_service.preprocess_suggestions(dataset_id, db)


@router.post("/quick-config", summary="基于数据划分推荐参数")
def post_quick_config(body: QuickConfigRequest, db: Session = Depends(get_db)):
    return wizard_service.quick_config(body.split_id, db)


@router.post("/run-pipeline", summary="一键训练+评估+报告流水线（SSE）")
async def post_run_pipeline(body: RunPipelineRequest, db: Session = Depends(get_db)):
    return StreamingResponse(
        wizard_service.run_pipeline_stream(
            split_id=body.split_id,
            params=body.params,
            db=db,
            report_title=body.report_title,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/run-lab", summary="参数对比实验训练（SSE）")
async def post_run_lab(body: RunLabRequest, db: Session = Depends(get_db)):
    return StreamingResponse(
        wizard_service.run_lab_stream(
            split_id=body.split_id,
            params=body.params,
            db=db,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
