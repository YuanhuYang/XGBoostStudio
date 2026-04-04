"""
报告路由
POST /api/reports/generate        → 生成 PDF 报告
POST /api/reports/compare         → 多模型对比 PDF
GET  /api/reports                 → 报告列表
GET  /api/reports/{id}            → 报告详情
GET  /api/reports/{id}/download   → 下载 PDF
DELETE /api/reports/{id}          → 删除报告
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Report
from schemas.model import ReportGenerateRequest, ReportCompareRequest
from services.report_service import generate_report, generate_comparison_report, list_reports, get_report_path

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.post("/generate")
def generate(body: ReportGenerateRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    return generate_report(
        model_id=body.model_id,
        title=body.title or "",
        notes=body.notes or "",
        db=db,
        include_sections=body.include_sections,
        narrative_depth=body.narrative_depth or "standard",
    )


@router.post("/compare")
def compare(body: ReportCompareRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    return generate_comparison_report(
        model_ids=body.model_ids,
        title=body.title or "",
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
    # 向后兼容：检测实际文件扩展名
    ext = path.suffix.lower()
    if ext == ".pdf":
        media_type = "application/pdf"
        filename = f"{safe_name}.pdf"
    else:
        media_type = "text/html"
        filename = f"{safe_name}.html"
    return FileResponse(
        path=str(path),
        filename=filename,
        media_type=media_type,
    )


@router.get("/{report_id}/preview")
def preview_report(report_id: int, db: Session = Depends(get_db)) -> FileResponse:
    """内联预览（不带 Content-Disposition: attachment，供 iframe 内嵌使用）"""
    path = get_report_path(report_id, db)
    ext = path.suffix.lower()
    media_type = "application/pdf" if ext == ".pdf" else "text/html"
    return FileResponse(path=str(path), media_type=media_type)


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
