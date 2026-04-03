"""
报告路由（模块9）
POST /api/reports/generate        → 生成 HTML 报告
GET  /api/reports                 → 报告列表
GET  /api/reports/{id}            → 报告详情
GET  /api/reports/{id}/download   → 下载 HTML
DELETE /api/reports/{id}          → 删除报告
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Report
from schemas.model import ReportGenerateRequest
from services.report_service import generate_report, list_reports, get_report_path

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.post("/generate")
def generate(body: ReportGenerateRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    return generate_report(
        model_id=body.model_id,
        title=body.title or "",
        notes=body.notes or "",
        db=db,
    )


@router.get("")
def get_reports(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return list_reports(db)


@router.get("/{report_id}")
def get_report(report_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="报告不存在")
    return {
        "id": report.id,
        "name": report.name,
        "model_id": report.model_id,
        "path": report.path,
        "created_at": str(report.created_at),
    }


@router.get("/{report_id}/download")
def download_report(report_id: int, db: Session = Depends(get_db)) -> FileResponse:
    path = get_report_path(report_id, db)
    report = db.query(Report).filter(Report.id == report_id).first()
    safe_name = (report.name if report else "report").replace(" ", "_")
    return FileResponse(
        path=str(path),
        filename=f"{safe_name}.html",
        media_type="text/html",
    )


@router.delete("/{report_id}")
def delete_report(report_id: int, db: Session = Depends(get_db)) -> dict[str, str]:
    from db.database import REPORTS_DIR

    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="报告不存在")
    path = REPORTS_DIR / report.path
    if path.exists():
        path.unlink()
    db.delete(report)
    db.commit()
    return {"status": "deleted"}
