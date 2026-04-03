"""
预测路由（模块10）
POST /api/prediction/single            → 单样本预测（JSON）
POST /api/prediction/batch             → 批量预测（文件上传）
GET  /api/prediction/{task_id}/download → 下载预测结果 CSV
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from db.database import get_db
from schemas.model import SinglePredictRequest
from services.prediction_service import (
    single_predict,
    batch_predict,
    get_batch_result_path,
)

router = APIRouter(prefix="/api/prediction", tags=["prediction"])


@router.post("/single")
def predict_single(
    body: SinglePredictRequest,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return single_predict(model_id=body.model_id, features=body.features, db=db)


@router.post("/batch")
async def predict_batch(
    model_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    file_bytes = await file.read()
    filename = file.filename or "upload.csv"
    return batch_predict(model_id=model_id, file_bytes=file_bytes, filename=filename, db=db)


@router.get("/{task_id}/download")
def download_result(task_id: str) -> FileResponse:
    path = get_batch_result_path(task_id)
    return FileResponse(
        path=str(path),
        filename=f"prediction_{task_id}.csv",
        media_type="text/csv",
    )
