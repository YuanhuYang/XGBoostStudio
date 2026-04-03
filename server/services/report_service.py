"""
报告生成业务逻辑（HTML 报告）
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any
from fastapi import HTTPException
from sqlalchemy.orm import Session

from db.database import REPORTS_DIR
from db.models import Dataset, DatasetSplit, Model, Report


_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>{title}</title>
<style>
  body {{ font-family: 'Microsoft YaHei', sans-serif; background:#0f172a; color:#e2e8f0; margin:0; padding:32px; }}
  h1 {{ font-size:24px; color:#60a5fa; border-bottom:2px solid #334155; padding-bottom:12px; }}
  h2 {{ font-size:18px; color:#93c5fd; margin-top:32px; }}
  table {{ border-collapse:collapse; width:100%; margin-top:8px; }}
  th {{ background:#1e293b; color:#94a3b8; font-weight:600; padding:8px 12px; text-align:left; border:1px solid #334155; }}
  td {{ padding:8px 12px; border:1px solid #334155; }}
  tr:nth-child(even) td {{ background:#1e293b; }}
  .badge {{ display:inline-block; padding:2px 10px; border-radius:12px; font-size:12px; font-weight:600; }}
  .badge-blue {{ background:#1d4ed8; color:#bfdbfe; }}
  .badge-green {{ background:#15803d; color:#bbf7d0; }}
  .metric-grid {{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-top:12px; }}
  .metric-card {{ background:#1e293b; border:1px solid #334155; border-radius:8px; padding:16px; text-align:center; }}
  .metric-value {{ font-size:28px; font-weight:700; color:#60a5fa; }}
  .metric-label {{ font-size:12px; color:#94a3b8; margin-top:4px; }}
  .tag {{ background:#1e3a5f; color:#93c5fd; border-radius:4px; padding:2px 8px; font-size:12px; }}
  footer {{ margin-top:48px; color:#475569; font-size:12px; border-top:1px solid #334155; padding-top:16px; }}
</style>
</head>
<body>
<h1>XGBoost Studio · 模型报告</h1>
<p>生成时间：{gen_time} &nbsp;|&nbsp; 报告标题：<strong>{title}</strong></p>

<h2>数据集信息</h2>
{dataset_section}

<h2>模型信息</h2>
{model_section}

<h2>训练参数</h2>
{params_section}

<h2>评估指标</h2>
{metrics_section}

{extra_section}

<footer>由 XGBoost Studio 自动生成 · {gen_time}</footer>
</body>
</html>"""


def _kv_table(data: dict[str, Any]) -> str:
    rows = "".join(f"<tr><td><strong>{k}</strong></td><td>{v}</td></tr>" for k, v in data.items())
    return f"<table><thead><tr><th>参数</th><th>值</th></tr></thead><tbody>{rows}</tbody></table>"


def _metrics_grid(metrics: dict[str, Any]) -> str:
    cards = ""
    for k, v in metrics.items():
        if isinstance(v, float):
            val = f"{v:.4f}"
        else:
            val = str(v)
        cards += f'<div class="metric-card"><div class="metric-value">{val}</div><div class="metric-label">{k}</div></div>'
    return f'<div class="metric-grid">{cards}</div>'


def generate_report(
    model_id: int,
    title: str,
    notes: str,
    db: Session,
) -> dict[str, Any]:
    record = db.query(Model).filter(Model.id == model_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="模型不存在")

    dataset = db.query(Dataset).filter(Dataset.id == record.dataset_id).first() if record.dataset_id else None
    split = db.query(DatasetSplit).filter(DatasetSplit.id == record.split_id).first() if record.split_id else None

    gen_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 数据集区块
    if dataset:
        dataset_info = {
            "名称": dataset.name,
            "行数": dataset.rows,
            "列数": dataset.cols,
            "目标列": dataset.target_column or "-",
            "上传时间": str(dataset.created_at)[:19],
        }
    else:
        dataset_info = {"信息": "无关联数据集"}
    dataset_section = _kv_table(dataset_info)

    # 模型区块
    model_info = {
        "模型名称": record.name,
        "任务类型": record.task_type,
        "创建时间": str(record.created_at)[:19],
        "文件": record.path,
    }
    if split:
        model_info["训练集比例"] = f"{split.train_ratio * 100:.0f}%"
    model_section = _kv_table(model_info)

    # 参数区块
    params = json.loads(record.params_json or "{}")
    params_section = _kv_table(params) if params else "<p>无参数信息</p>"

    # 指标区块
    metrics = json.loads(record.metrics_json or "{}")
    metrics_section = _metrics_grid(metrics) if metrics else "<p>无指标信息</p>"

    # 备注
    extra_section = f"<h2>备注</h2><p>{notes}</p>" if notes else ""

    html = _HTML_TEMPLATE.format(
        title=title or f"模型报告_{model_id}",
        gen_time=gen_time,
        dataset_section=dataset_section,
        model_section=model_section,
        params_section=params_section,
        metrics_section=metrics_section,
        extra_section=extra_section,
    )

    from uuid import uuid4
    report_filename = f"report_{uuid4().hex[:12]}.html"
    report_path = REPORTS_DIR / report_filename
    report_path.write_text(html, encoding="utf-8")

    report = Report(
        name=title or f"Report_{model_id}",
        model_id=model_id,
        path=report_filename,
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    return {
        "id": report.id,
        "name": report.name,
        "path": report_filename,
        "created_at": str(report.created_at),
    }


def list_reports(db: Session) -> list[dict[str, Any]]:
    rows = db.query(Report).order_by(Report.created_at.desc()).all()
    return [{"id": r.id, "name": r.name, "path": r.path, "created_at": str(r.created_at)} for r in rows]


def get_report_path(report_id: int, db: Session) -> Path:
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="报告不存在")
    path = REPORTS_DIR / report.path
    if not path.exists():
        raise HTTPException(status_code=404, detail="报告文件不存在")
    return path
