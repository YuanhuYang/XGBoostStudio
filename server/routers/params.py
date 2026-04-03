"""
超参数管理路由（模块4）
GET  /api/params/schema          → 参数元数据
GET  /api/params/recommend       → 规则推荐
POST /api/params/validate        → 参数验证
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from db.database import get_db
from services.params_service import get_param_schema, recommend_params, validate_params

router = APIRouter(prefix="/api/params", tags=["params"])


@router.get("/schema")
def param_schema() -> list[dict[str, Any]]:
    return get_param_schema()


@router.get("/recommend")
def recommend(
    split_id: int = Query(..., description="数据集划分 ID"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return recommend_params(split_id, db)


@router.post("/validate")
def validate(params: dict[str, Any]) -> dict[str, Any]:
    return validate_params(params)
