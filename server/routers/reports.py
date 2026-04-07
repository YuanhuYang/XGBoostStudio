"""
报告路由
POST /api/reports/generate        → 生成 PDF 报告
POST /api/reports/compare         → 多模型对比 PDF
GET  /api/reports                 → 报告列表
GET  /api/reports/{id}            → 报告详情
GET  /api/reports/{id}/download   → 下载 PDF
DELETE /api/reports/{id}          → 删除报告

模板路由：
GET  /api/report-templates        → 模板列表
POST /api/report-templates       → 新建模板
DELETE /api/report-templates/{id} → 删除模板
"""
from __future__ import annotations

from typing import Any
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Report, ReportTemplate
from schemas.model import ReportGenerateRequest, ReportCompareRequest, ReportTemplateCreate, ReportTemplateResponse
from services.report_service import generate_report, generate_comparison_report, list_reports, get_report_path

router = APIRouter(prefix="/api/reports", tags=["reports"])

template_router = APIRouter(prefix="/api/report-templates", tags=["report-templates"])


@router.post("/generate")
def generate(body: ReportGenerateRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    brand_config_dict = body.brand_config.model_dump() if body.brand_config else None
    return generate_report(
        model_id=body.model_id,
        title=body.title or "",
        notes=body.notes or "",
        db=db,
        include_sections=body.include_sections,
        narrative_depth=body.narrative_depth or "standard",
        format_style=body.format_style or "default",
        template_type=body.template_type or "full_12_chapters",
        brand_config=brand_config_dict,
        compare_model_ids=body.compare_model_ids,
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


@router.get("/{report_id:int}")
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


@router.get("/{report_id:int}/download")
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


@router.get("/{report_id:int}/preview")
def preview_report(report_id: int, db: Session = Depends(get_db)) -> FileResponse:
    """内联预览（不带 Content-Disposition: attachment，供 iframe 内嵌使用）"""
    path = get_report_path(report_id, db)
    ext = path.suffix.lower()
    media_type = "application/pdf" if ext == ".pdf" else "text/html"
    return FileResponse(path=str(path), media_type=media_type)


@router.delete("/{report_id:int}")
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


# ── 报表模板 CRUD ──

@template_router.get("")
def list_templates(db: Session = Depends(get_db)) -> list[ReportTemplateResponse]:
    """获取所有报表模板（内置+用户自定义）"""
    templates = db.query(ReportTemplate).order_by(ReportTemplate.is_builtin, ReportTemplate.created_at.desc()).all()
    results = []
    for t in templates:
        results.append(ReportTemplateResponse(
            id=t.id,
            name=t.name,
            description=t.description,
            is_builtin=t.is_builtin,
            sections=json.loads(t.sections),
            format_style=t.format_style,
            created_at=t.created_at,
        ))
    return results


@template_router.post("")
def create_template(body: ReportTemplateCreate, db: Session = Depends(get_db)) -> ReportTemplateResponse:
    """新建用户自定义报表模板"""
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="模板名称不能为空")
    if not body.sections:
        raise HTTPException(status_code=400, detail="至少选择一个章节")

    template = ReportTemplate(
        name=body.name.strip(),
        description=body.description,
        is_builtin=False,
        sections=json.dumps(body.sections),
        format_style=body.format_style or "default",
    )
    db.add(template)
    db.commit()
    db.refresh(template)

    return ReportTemplateResponse(
        id=template.id,
        name=template.name,
        description=template.description,
        is_builtin=template.is_builtin,
        sections=json.loads(template.sections),
        format_style=template.format_style,
        created_at=template.created_at,
    )


@template_router.delete("/{template_id}")
def delete_template(template_id: int, db: Session = Depends(get_db)) -> dict[str, str]:
    """删除用户自定义模板（内置模板不能删除）"""
    template = db.query(ReportTemplate).filter(ReportTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="模板不存在")
    if template.is_builtin:
        raise HTTPException(status_code=400, detail="内置模板不能删除")
    db.delete(template)
    db.commit()
    return {"status": "deleted"}

