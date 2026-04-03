"""
模型管理 & 评估路由（模块6/8）
GET    /api/models                      → 模型列表
GET    /api/models/{id}                 → 模型详情
DELETE /api/models/{id}                 → 删除模型
PUT    /api/models/{id}/rename          → 重命名
GET    /api/models/{id}/evaluation      → 评估指标 + 图表数据
GET    /api/models/{id}/shap            → SHAP 详细值
GET    /api/models/compare?ids=1,2,3   → 多模型对比
POST   /api/models/{id}/export          → 导出模型文件
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from db.database import get_db, MODELS_DIR
from db.models import Model
from services.eval_service import get_evaluation, get_shap_detail

router = APIRouter(prefix="/api/models", tags=["models"])


def _to_dict(m: Model) -> dict[str, Any]:
    return {
        "id": m.id,
        "name": m.name,
        "task_type": m.task_type,
        "metrics": json.loads(m.metrics_json or "{}"),
        "params": json.loads(m.params_json or "{}"),
        "dataset_id": m.dataset_id,
        "split_id": m.split_id,
        "tags": m.tags or "",
        "description": m.description or "",
        "training_time_s": m.training_time_s,
        "created_at": str(m.created_at),
    }


@router.get("")
def list_models(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    models = db.query(Model).order_by(Model.created_at.desc()).all()
    return [_to_dict(m) for m in models]


@router.get("/compare")
def compare_models(
    ids: str = Query(..., description="逗号分隔的模型ID列表"),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    id_list = [int(i.strip()) for i in ids.split(",") if i.strip().isdigit()]
    models = db.query(Model).filter(Model.id.in_(id_list)).all()
    return [_to_dict(m) for m in models]


@router.get("/{model_id}")
def get_model(model_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    m = db.query(Model).filter(Model.id == model_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="模型不存在")
    return _to_dict(m)


@router.delete("/{model_id}")
def delete_model(model_id: int, db: Session = Depends(get_db)) -> dict[str, str]:
    m = db.query(Model).filter(Model.id == model_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="模型不存在")
    path = MODELS_DIR / m.path
    if path.exists():
        path.unlink()
    db.delete(m)
    db.commit()
    return {"status": "deleted"}


@router.put("/{model_id}/rename")
def rename_model(
    model_id: int, body: dict[str, Any], db: Session = Depends(get_db)
) -> dict[str, Any]:
    m = db.query(Model).filter(Model.id == model_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="模型不存在")
    m.name = body.get("name", m.name)
    db.commit()
    return _to_dict(m)


@router.post("/{model_id}/tag")
def tag_model(
    model_id: int, body: dict[str, Any], db: Session = Depends(get_db)
) -> dict[str, Any]:
    m = db.query(Model).filter(Model.id == model_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="模型不存在")
    m.tags = body.get("tags", m.tags)
    m.description = body.get("description", m.description)
    db.commit()
    return _to_dict(m)


@router.get("/{model_id}/evaluation")
def evaluation(model_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    return get_evaluation(model_id, db)


@router.get("/{model_id}/shap")
def shap_detail(model_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    return get_shap_detail(model_id, db)


@router.post("/{model_id}/export")
def export_model(model_id: int, db: Session = Depends(get_db)) -> FileResponse:
    m = db.query(Model).filter(Model.id == model_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="模型不存在")
    path = MODELS_DIR / m.path
    if not path.exists():
        raise HTTPException(status_code=404, detail="模型文件不存在")
    safe_name = m.name.replace(" ", "_")
    return FileResponse(
        path=str(path),
        filename=f"{safe_name}.ubj",
        media_type="application/octet-stream",
    )
