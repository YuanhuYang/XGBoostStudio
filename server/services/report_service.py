"""
报告生成业务逻辑  使用 reportlab 生成专业 PDF 报告

支持跨平台字体渲染：
  - Windows: 系统字体目录（思源黑体、微软雅黑等）
  - macOS: 系统字体库（STHeiti、文泉驿等）
  - Linux: 系统字体库（文泉驿、思源黑体等）
  - 回退: Helvetica（英文汉字略显不足，但可用）
"""
from __future__ import annotations
# pylint: disable=broad-exception-caught

import json
import logging
import sys
from datetime import datetime
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

from db.database import REPORTS_DIR
from db.models import Dataset, DatasetSplit, Model, Report

logger = logging.getLogger(__name__)

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, Image, PageBreak,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# -- Font Registration (跨平台支持) --
_FONT_NAME = "ReportFont"

def _register_cn_font() -> str:
    """
    注册中文字体，支持 Windows / macOS / Linux 跨平台。
    
    搜索顺序：
    1. Windows: C:/Windows/Fonts/ 系统字体目录
    2. macOS: /Library/Fonts/ 和 ~/Library/Fonts/
    3. Linux: /usr/share/fonts/
    4. 回退: 使用 Helvetica（仅英文）
    
    Returns:
        成功注册的字体名称，或 "Helvetica" (回退)
    """
    font_paths = []
    
    if sys.platform == "win32":
        # Windows: 微软雅黑、仓颉、思源黑体
        font_paths = [
            "C:/Windows/Fonts/msyh.ttc",      # 微软雅黑
            "C:/Windows/Fonts/simhei.ttf",    # 黑体
            "C:/Windows/Fonts/simsun.ttc",    # 宋体
        ]
    elif sys.platform == "darwin":
        # macOS: 系统字体库
        font_paths = [
            "/Library/Fonts/STHeiti Light.ttc",  # 华文黑体（Light）
            "/System/Library/Fonts/STHeiti.ttc",  # 华文黑体
            "/Library/Fonts/Arial Unicode.ttf",   # Arial Unicode
            Path.home() / "Library/Fonts/SourceHanSansCN-Regular.otf",  # 思源黑体
        ]
    else:
        # Linux: 文泉驿、思源黑体、文泉驿微米黑
        font_paths = [
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",  # Noto Sans CJK
            "/usr/share/fonts/opentype/sourcehansan/SourceHanSansCN-Regular.otf",  # 思源黑体
            "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",           # 文泉驿微米黑
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",          # 备选（可显示部分汉字）
        ]
    
    # 尝试逐个注册字体
    for font_path in font_paths:
        font_path = Path(font_path) if isinstance(font_path, str) else font_path
        try:
            if font_path.exists():
                pdfmetrics.registerFont(TTFont(_FONT_NAME, str(font_path)))
                print(f"[报告] 字体已注册: {font_path}")
                return _FONT_NAME
        except Exception:
            # 继续尝试下一个字体
            continue
    
    # 所有字体都失败，回退到 Helvetica
    print(
        f"[报告] 警告: 未找到中文字体 (平台: {sys.platform})，"
        "将使用 Helvetica（仅英文，中文可能显示为方框）"
    )
    return "Helvetica"

_CN_FONT = _register_cn_font()

# -- Colors --
BRAND_BLUE  = colors.HexColor("#1677ff")
BRAND_DARK  = colors.HexColor("#003eb3")
BRAND_LIGHT = colors.HexColor("#e6f4ff")
SUCCESS     = colors.HexColor("#52c41a")
WARNING     = colors.HexColor("#fa8c16")
DANGER      = colors.HexColor("#ff4d4f")
GRAY_BG     = colors.HexColor("#f0f2f5")
GRAY_LINE   = colors.HexColor("#d9d9d9")
TEXT_DARK   = colors.HexColor("#1a1a1a")
TEXT_MED    = colors.HexColor("#595959")
TEXT_LIGHT  = colors.HexColor("#8c8c8c")

# -- Styles --
def _S(name, **kw):
    return ParagraphStyle(name, fontName=_CN_FONT, **kw)

ST = {
    "cover_title": _S("cover_title", fontSize=28, textColor=BRAND_BLUE, alignment=TA_CENTER, spaceAfter=8, leading=34),
    "cover_sub":   _S("cover_sub",   fontSize=14, textColor=TEXT_MED,   alignment=TA_CENTER, spaceAfter=6),
    "cover_meta":  _S("cover_meta",  fontSize=11, textColor=TEXT_LIGHT, alignment=TA_CENTER, spaceAfter=4),
    "h1":          _S("h1",  fontSize=16, textColor=BRAND_DARK, spaceBefore=16, spaceAfter=8, leading=20),
    "h2":          _S("h2",  fontSize=13, textColor=BRAND_BLUE, spaceBefore=12, spaceAfter=6, leading=16),
    "body":        _S("body", fontSize=10, textColor=TEXT_DARK, leading=16, spaceAfter=6),
    "body_j":      _S("body_j", fontSize=10, textColor=TEXT_DARK, leading=16, spaceAfter=6, alignment=TA_JUSTIFY),
    "small":       _S("small", fontSize=9, textColor=TEXT_LIGHT, spaceAfter=4),
    "caption":     _S("caption", fontSize=9, textColor=TEXT_MED, alignment=TA_CENTER, spaceBefore=2, spaceAfter=10),
    "kv_key":      _S("kv_key", fontSize=10, textColor=TEXT_MED),
    "kv_val":      _S("kv_val", fontSize=10, textColor=TEXT_DARK),
    "warn_text":   _S("warn_text", fontSize=10, textColor=colors.HexColor("#ad4e00"), leading=15, spaceAfter=4),
    "success_text":_S("success_text", fontSize=10, textColor=colors.HexColor("#135200"), leading=15, spaceAfter=4),
    "danger_text": _S("danger_text", fontSize=10, textColor=colors.HexColor("#820014"), leading=15, spaceAfter=4),
}

_INTERNAL_KEYS = frozenset({"overfitting_level","overfitting_gap","train_accuracy","train_rmse","early_stopped","best_round"})

METRIC_EXPLAIN = {
    "accuracy":  "准确率：所有预测中正确的比例，越高越好（满分1.0）",
    "auc":       "AUC：分类器排序能力，0.5=随机，1.0=完美",
    "f1":        "F1分数：精确率与召回率的调和平均数",
    "precision": "精确率：预测正类中实际为正类的比例",
    "recall":    "召回率：实际正类中正确识别的比例",
    "rmse":      "均方根误差：预测偏差，越小越好",
    "mae":       "平均绝对误差：绝对偏差平均值，越小越好",
    "r2":        "R²决定系数：模型解释方差比例，1.0为完美",
    "log_loss":  "对数损失：概率预测质量，越小越好",
}

def _metric_level(key, val):
    if key in("accuracy","auc","f1","precision","recall","r2"):
        if val>=0.9: return "优秀"
        if val>=0.75: return "良好"
        if val>=0.6: return "尚可"
        return "待提升"
    return "越低越好" if key in("rmse","mae","log_loss") else ""

def _img(img_bytes, width=13*cm):
    if not img_bytes: return None
    buf = BytesIO(img_bytes)
    img = Image(buf)
    aspect = img.imageHeight / img.imageWidth
    img.drawWidth = width; img.drawHeight = width * aspect
    return img


def _cn_section_num(i: int) -> str:
    c = (
        "一", "二", "三", "四", "五", "六", "七", "八", "九", "十",
        "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
    )
    return c[i - 1] if 1 <= i <= len(c) else str(i)


def _esc_xml(s: str) -> str:
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _h1_pair(sec_counter: list, title: str) -> list:
    sec_counter[0] += 1
    n = _cn_section_num(sec_counter[0])
    return [
        Paragraph(f"{n}、{title}", ST["h1"]),
        HRFlowable(width="100%", thickness=1, color=BRAND_BLUE, spaceAfter=10),
    ]


def _data_relations_flowables(nar, pdf_assets: dict | None) -> list:
    """G2-R1 / G2-R1b：由 DataNarrativeResponse 生成 platypus 流（不含一级标题）。"""
    assets = pdf_assets or {}
    heatmap_png = assets.get("corr_heatmap_png")
    spearman_png = assets.get("spearman_heatmap_png")
    boxplots = assets.get("boxplots") or []

    out: list = []
    m = nar.meta
    intro = (
        f"本节基于训练集共 <b>{m.row_count_profiled}</b> 行进行自动统计（深度：{m.depth.value}）。"
    )
    if m.sample_note:
        intro += " " + _esc_xml(m.sample_note)
    out.append(Paragraph(intro, ST["body_j"]))
    out.append(Spacer(1, 0.25 * cm))

    out.append(Paragraph("2.1 变量目录", ST["h2"]))
    vrows = [[Paragraph(x, ST["small"]) for x in ("列名", "类型", "缺失率", "唯一值", "是否目标")]]
    for v in nar.variables:
        vrows.append([
            Paragraph(_esc_xml(v.name), ST["small"]),
            Paragraph(_esc_xml(v.role.value), ST["small"]),
            Paragraph(f"{v.missing_rate * 100:.1f}%", ST["small"]),
            Paragraph(str(v.n_unique if v.n_unique is not None else "-"), ST["small"]),
            Paragraph("是" if v.is_target else "否", ST["small"]),
        ])
    vt = Table(vrows, colWidths=[3.2 * cm, 2.2 * cm, 2 * cm, 2 * cm, 2 * cm])
    vt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), _CN_FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, BRAND_LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, GRAY_LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    out += [vt, Spacer(1, 0.3 * cm)]

    out.append(Paragraph("2.2 数值列 Pearson 相关", ST["h2"]))
    im = _img(heatmap_png, 12 * cm) if heatmap_png else None
    if im:
        out += [im, Paragraph("图：数值特征 Pearson 相关热力图", ST["caption"])]
    pear = [p for p in nar.correlation_pairs if p.method.value == "pearson"]
    for p in pear[:12]:
        out.append(Paragraph(f"• {_esc_xml(p.narrative_hint)}", ST["body_j"]))
    if not pear and not im:
        out.append(Paragraph("数值列不足或 Pearson 相关较弱，未列出高相关对。", ST["body"]))
    out.append(Spacer(1, 0.25 * cm))

    out.append(Paragraph("2.3 数值列 Spearman 秩相关", ST["h2"]))
    sim = _img(spearman_png, 12 * cm) if spearman_png else None
    if sim:
        out += [sim, Paragraph("图：数值特征 Spearman 秩相关热力图", ST["caption"])]
    spe = [p for p in nar.correlation_pairs if p.method.value == "spearman"]
    for p in spe[:12]:
        out.append(Paragraph(f"• {_esc_xml(p.narrative_hint)}", ST["body_j"]))
    if not spe and not sim:
        out.append(Paragraph("未启用详细深度或秩相关对较少，本节从略。", ST["body"]))
    out.append(Spacer(1, 0.25 * cm))

    out.append(Paragraph("2.4 低基数类别列关联（Cramér's V）", ST["h2"]))
    if nar.categorical_associations:
        for ca in nar.categorical_associations[:15]:
            out.append(Paragraph(f"• {_esc_xml(ca.narrative_hint)}", ST["body_j"]))
    else:
        out.append(Paragraph("可分析的类别列对不足或关联较弱。", ST["body"]))
    out.append(Spacer(1, 0.2 * cm))

    out.append(Paragraph("2.5 数值 × 类别分布（箱线图）", ST["h2"]))
    if boxplots:
        for png, cap in boxplots[:6]:
            img = _img(png, 12 * cm)
            if img:
                out += [img, Paragraph(f"图：{_esc_xml(cap)}", ST["caption"])]
    else:
        out.append(Paragraph("未生成箱线图（数值列或低基数类别列不足）。", ST["body"]))
    out.append(Spacer(1, 0.2 * cm))

    out.append(Paragraph("2.6 与目标的关系", ST["h2"]))
    if nar.target_relations:
        trows = [[Paragraph(x, ST["small"]) for x in ("特征", "指标", "值", "排名", "解读")]]
        for t in nar.target_relations[:12]:
            trows.append([
                Paragraph(_esc_xml(t.feature), ST["small"]),
                Paragraph(t.metric.value, ST["small"]),
                Paragraph(f"{t.value:.4f}", ST["small"]),
                Paragraph(str(t.rank), ST["small"]),
                Paragraph(_esc_xml(t.narrative_hint[:80] + ("…" if len(t.narrative_hint) > 80 else "")), ST["small"]),
            ])
        tt = Table(trows, colWidths=[2.5 * cm, 2 * cm, 2 * cm, 1.2 * cm, 6.3 * cm])
        tt.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), BRAND_BLUE),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, -1), _CN_FONT),
            ("FONTSIZE", (0, 0), (-1, -1), 7),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, BRAND_LIGHT]),
            ("GRID", (0, 0), (-1, -1), 0.5, GRAY_LINE),
        ]))
        out += [tt, Spacer(1, 0.2 * cm)]
    else:
        out.append(Paragraph("未配置目标列或无法计算与目标的关系。", ST["body"]))
    out.append(Spacer(1, 0.2 * cm))

    out.append(Paragraph("2.7 冗余与多重共线性（含 VIF）", ST["h2"]))
    if nar.multicollinearity:
        for mc in nar.multicollinearity:
            out.append(Paragraph(f"• {_esc_xml(mc.note)}", ST["body_j"]))
    else:
        out.append(Paragraph("未检测到明显多重共线性信号，或数值列不足以估计 VIF。", ST["body"]))
    out.append(Spacer(1, 0.2 * cm))

    out.append(Paragraph("2.8 缺失与目标的统计关联", ST["h2"]))
    if nar.missing_vs_target:
        for mv in nar.missing_vs_target[:12]:
            out.append(Paragraph(f"• {_esc_xml(mv.narrative_hint)}", ST["body_j"]))
    else:
        out.append(Paragraph("未发现缺失与目标在常规显著性水平下的显著关联，或各列无缺失。", ST["body"]))
    out.append(Spacer(1, 0.2 * cm))

    out.append(Paragraph("2.9 数据侧关键发现", ST["h2"]))
    for line in nar.bullets.findings:
        out.append(Paragraph(f"• {_esc_xml(line)}", ST["body_j"]))
    out.append(Spacer(1, 0.2 * cm))

    out.append(Paragraph("2.10 使用局限", ST["h2"]))
    for line in nar.bullets.caveats:
        out.append(Paragraph(f"• {_esc_xml(line)}", ST["body_j"]))
    out.append(Spacer(1, 0.3 * cm))
    return out

def _kv_table(data):
    rows = [[Paragraph(str(k), ST["kv_key"]), Paragraph(str(v), ST["kv_val"])] for k,v in data.items()]
    t = Table(rows, colWidths=[5*cm, 11*cm])
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(0,-1),GRAY_BG),
        ("GRID",(0,0),(-1,-1),0.5,GRAY_LINE),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("LEFTPADDING",(0,0),(-1,-1),8),
        ("RIGHTPADDING",(0,0),(-1,-1),8),
        ("TOPPADDING",(0,0),(-1,-1),5),
        ("BOTTOMPADDING",(0,0),(-1,-1),5),
    ]))
    return t

def _metrics_table(metrics):
    filtered = {k:v for k,v in metrics.items() if k not in _INTERNAL_KEYS and isinstance(v,(int,float))}
    if not filtered: return None
    rows = [["指标","数值","水平","说明"]]
    for k,v in filtered.items():
        rows.append([Paragraph(k.upper(),ST["kv_key"]), Paragraph(f"{float(v):.4f}",ST["body"]),
                     Paragraph(_metric_level(k,float(v)),ST["small"]), Paragraph(METRIC_EXPLAIN.get(k,"")[:50],ST["small"])])
    t = Table(rows, colWidths=[3*cm,2.5*cm,2.5*cm,8*cm])
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0),BRAND_BLUE),("TEXTCOLOR",(0,0),(-1,0),colors.white),
        ("FONTNAME",(0,0),(-1,-1),_CN_FONT),("FONTSIZE",(0,0),(-1,-1),9),
        ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,BRAND_LIGHT]),
        ("GRID",(0,0),(-1,-1),0.5,GRAY_LINE),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),
        ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),
    ]))
    return t

def _header_footer(canvas, doc):
    canvas.saveState()
    w,h = A4
    canvas.setFillColor(BRAND_DARK); canvas.rect(0, h-1.2*cm, w, 1.2*cm, fill=True, stroke=False)
    canvas.setFillColor(colors.white); canvas.setFont(_CN_FONT,9)
    canvas.drawString(1*cm, h-0.8*cm, "XGBoost Studio  专业数据分析报告")
    canvas.drawRightString(w-1*cm, h-0.8*cm, datetime.now().strftime("%Y-%m-%d"))
    canvas.setFillColor(GRAY_BG); canvas.rect(0,0,w,0.8*cm,fill=True,stroke=False)
    canvas.setFillColor(TEXT_LIGHT); canvas.setFont(_CN_FONT,8)
    canvas.drawString(1*cm,0.25*cm,"由 XGBoost Studio 自动生成  仅供参考，请结合实际业务判断")
    canvas.drawRightString(w-1*cm,0.25*cm,f"第 {doc.page} 页")
    canvas.restoreState()

def _executive_summary(metrics, task_type, ds_name, model_name):
    paras = []
    if task_type=="classification":
        acc=metrics.get("accuracy"); auc=metrics.get("auc"); f1=metrics.get("f1")
        level=_metric_level("accuracy",float(acc)) if acc else "未知"
        p1=(f"本报告对模型 <b>\"{model_name}\"</b> 在数据集 <b>\"{ds_name}\"</b> 上的分类性能进行全面评估。"
            f"模型在测试集上达到准确率 <b>{float(acc):.2%}</b>，表现<b>{level}</b>。")
        if auc: p1+=f" AUC={float(auc):.4f}，说明模型具备{'良好' if float(auc)>=0.75 else '基础'}的样本区分能力。"
        paras.append(p1)
        if f1:
            lf=_metric_level("f1",float(f1))
            paras.append(f"F1分数 {float(f1):.4f}（{lf}），{'适合正式部署' if float(f1)>=0.75 else '建议进一步调参再部署'}。")
        ol=metrics.get("overfitting_level","low")
        if ol=="high": paras.append("⚠️ <b>过拟合预警</b>：训练集与验证集指标差距较大，建议降低模型复杂度或增加训练数据后再部署。")
        elif ol=="medium": paras.append("训练集与验证集指标存在轻微差距，建议适当增加正则化参数以提升泛化能力。")
        else: paras.append("✅ 模型泛化能力良好，训练集与验证集指标接近，无明显过拟合迹象。")
    else:
        r2=metrics.get("r2"); rmse=metrics.get("rmse")
        p1=f"本报告对回归模型 <b>\"{model_name}\"</b> 在数据集 <b>\"{ds_name}\"</b> 上的预测性能进行全面评估。"
        if r2 is not None:
            lr=_metric_level("r2",float(r2))
            p1+=f" R²={float(r2):.4f}（{lr}），可解释 {max(0,float(r2))*100:.1f}% 的目标方差。"
        paras.append(p1)
        if rmse: paras.append(f"RMSE={float(rmse):.4f}，{'预测精度较高' if float(r2 or 0)>=0.75 else '仍有提升空间'}，建议结合业务误差容忍度判断可用性。")
    return paras

def _business_advice(metrics, task_type):
    advice=[]
    if task_type=="classification":
        acc=float(metrics.get("accuracy",0)); auc=float(metrics.get("auc",0))
        if acc>=0.9 and auc>=0.9: advice.append("✅ 性能优秀，建议在小范围业务场景中先行上线A/B测试验证效果。")
        elif acc>=0.75: advice.append("📊 性能良好，可考虑在非关键场景上线；若精确率要求高，建议调整预测阈值（当前默认0.5）。")
        else: advice.append("⚠️ 性能有待提升： 增加训练数据； 优化特征工程； 使用Optuna自动调参。")
        advice.append("💡 建议建立模型监控机制，定期用新数据重评估，注意数据分布漂移。")
    else:
        r2=float(metrics.get("r2",0))
        if r2>=0.85: advice.append("✅ 拟合效果优秀，R²较高，可用于实际预测场景。")
        elif r2>=0.6: advice.append("📊 具备基础预测能力，建议检查未被捕捉的交互特征或非线性关系。")
        else: advice.append("⚠️ 拟合效果不理想： 检查数据质量； 增加特征工程； 增大数据量。")
        advice.append("💡 请结合具体业务场景设定可接受的RMSE/MAE阈值，而非仅依赖R²判断。")
    advice.append("📌 免责声明：本报告由机器学习模型自动生成，预测结果仅供参考，最终决策应结合领域专家判断。")
    return advice

ALL_SECTIONS = [
    "executive_summary",
    "data_relations",
    "data_overview",
    "model_params",
    "evaluation",
    "shap",
    "learning_curve",
    "overfitting",
    "baseline",
    "business_advice",
]

def generate_report(
    model_id,
    title,
    notes,
    db,
    include_sections=None,
    narrative_depth: str = "standard",
):
    from services import chart_service
    from services.eval_service import get_evaluation, get_learning_curve

    record = db.query(Model).filter(Model.id==model_id).first()
    if not record: raise HTTPException(status_code=404, detail="模型不存在")
    dataset = db.query(Dataset).filter(Dataset.id==record.dataset_id).first() if record.dataset_id else None
    split   = db.query(DatasetSplit).filter(DatasetSplit.id==record.split_id).first() if record.split_id else None
    gen_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    report_title = title or f"模型报告 - {record.name}"
    ds_name = dataset.name if dataset else "未知数据集"
    params  = json.loads(record.params_json or "{}")
    metrics = json.loads(record.metrics_json or "{}")
    sections = set(include_sections if include_sections else ALL_SECTIONS)

    eval_result = {}
    try: eval_result = get_evaluation(model_id, db)
    except Exception: pass

    story = []
    sn = [0]
    # -- Cover --
    story += [Spacer(1,6*cm),
              Paragraph("XGBoost Studio", ST["cover_title"]),
              Paragraph("专业机器学习分析报告", _S("cs",fontSize=16,textColor=TEXT_MED,alignment=TA_CENTER,spaceAfter=10)),
              HRFlowable(width="80%",thickness=2,color=BRAND_BLUE,spaceAfter=20,spaceBefore=10),
              Paragraph(f"<b>{report_title}</b>", ST["cover_sub"]),
              Spacer(1,0.5*cm),
              Paragraph(f"模型：{record.name}", ST["cover_meta"]),
              Paragraph(f"数据集：{ds_name}", ST["cover_meta"]),
              Paragraph(f"任务类型：{'分类' if record.task_type=='classification' else '回归'}", ST["cover_meta"]),
              Paragraph(f"生成时间：{gen_time}", ST["cover_meta"]),
              PageBreak()]

    # -- 执行摘要 --
    if "executive_summary" in sections:
        story += _h1_pair(sn, "执行摘要")
        for p in _executive_summary(metrics, record.task_type, ds_name, record.name):
            story.append(Paragraph(p, ST["body_j"]))
        story.append(Spacer(1,0.3*cm))

    # -- 数据与变量关系（G2-R1）--
    if "data_relations" in sections:
        story += _h1_pair(sn, "数据与变量关系（自动分析）")
        if dataset and split and record.split_id:
            try:
                from schemas.narrative import NarrativeDepth
                from services.dataset_narrative_service import build_data_narrative

                nd = (
                    NarrativeDepth.detailed
                    if (narrative_depth or "standard").lower() == "detailed"
                    else NarrativeDepth.standard
                )
                pdf_assets: dict = {}
                nar = build_data_narrative(
                    db,
                    dataset.id,
                    record.split_id,
                    nd,
                    record.id,
                    _pdf_assets=pdf_assets,
                )
                story.extend(_data_relations_flowables(nar, pdf_assets))
            except Exception as ex:
                logger.warning("data_relations 章节生成失败: %s", ex, exc_info=True)
                story.append(
                    Paragraph(
                        "本章节生成时出现异常，已跳过详细内容。请确认训练集文件可用且划分有效。",
                        ST["warn_text"],
                    )
                )
        else:
            story.append(
                Paragraph(
                    "当前模型未关联数据集或划分，无法生成数据关系叙事。",
                    ST["body"],
                )
            )

    # -- 数据集概览 --
    if "data_overview" in sections:
        story += _h1_pair(sn, "数据集概览")
        if dataset:
            dinfo = {"数据集名称": dataset.name,"总行数": f"{dataset.rows:,}" if dataset.rows else "-",
                     "总列数": str(dataset.cols) if dataset.cols else "-","目标列": dataset.target_column or "-",
                     "任务类型": "分类" if record.task_type=="classification" else "回归",
                     "上传时间": str(dataset.created_at)[:19]}
            if split:
                dinfo["训练集行数"] = f"{split.train_rows:,}" if split.train_rows else "-"
                dinfo["测试集行数"] = f"{split.test_rows:,}" if split.test_rows else "-"
                dinfo["训练/测试比例"] = f"{split.train_ratio*100:.0f}% / {(1-split.train_ratio)*100:.0f}%"
            story.append(_kv_table(dinfo))
        try:
            from db.database import DATA_DIR
            import pandas as pd
            if split and dataset and dataset.target_column:
                tp = DATA_DIR / split.test_path
                if tp.exists():
                    df = pd.read_csv(tp, encoding="utf-8-sig")
                    if dataset.target_column in df.columns:
                        cb = chart_service.target_distribution_chart(df[dataset.target_column].tolist(), record.task_type, dataset.target_column)
                        im = _img(cb, 12*cm)
                        if im: story += [Spacer(1,0.3*cm), im, Paragraph("图1：目标列分布", ST["caption"])]
        except Exception: pass
        story.append(Spacer(1,0.3*cm))

    # -- 模型参数 --
    if "model_params" in sections:
        story += _h1_pair(sn, "模型训练参数")
        minfo = {"模型名称": record.name,"任务类型": "分类" if record.task_type=="classification" else "回归",
                 "训练耗时": f"{record.training_time_s:.1f} 秒" if record.training_time_s else "-",
                 "创建时间": str(record.created_at)[:19]}
        story.append(_kv_table(minfo))
        if params:
            story.append(Paragraph("XGBoost 超参数配置：", ST["h2"]))
            story.append(_kv_table({k:v for k,v in params.items() if not k.startswith("_")}))

    # -- 评估指标 --
    if "evaluation" in sections:
        story += _h1_pair(sn, "模型评估结果")
        mt = _metrics_table(metrics)
        if mt: story += [mt, Spacer(1,0.3*cm)]
        if record.task_type=="classification":
            try:
                rb = chart_service.metrics_radar_chart(metrics)
                im = _img(rb, 10*cm)
                if im: story += [im, Paragraph("图2：评估指标雷达图", ST["caption"])]
            except Exception: pass
        roc = eval_result.get("roc_curve")
        if roc:
            try:
                cb = chart_service.roc_curve_chart(roc["fpr"],roc["tpr"],roc["auc"])
                im = _img(cb, 12*cm)
                if im: story += [im, Paragraph(f"图3：ROC曲线（AUC={roc['auc']:.4f}）", ST["caption"])]
            except Exception: pass
        cm_data = eval_result.get("confusion_matrix")
        if cm_data:
            try:
                cb = chart_service.confusion_matrix_chart(cm_data["matrix"], cm_data["labels"])
                im = _img(cb, 10*cm)
                if im: story += [im, Paragraph("图4：混淆矩阵", ST["caption"])]
            except Exception: pass
        pr = eval_result.get("pr_curve")
        if pr:
            try:
                cb = chart_service.pr_curve_chart(pr["precision"],pr["recall"],pr["ap"])
                im = _img(cb, 12*cm)
                if im: story += [im, Paragraph(f"图5：PR曲线（AP={pr['ap']:.4f}）", ST["caption"])]
            except Exception: pass
        res_data = eval_result.get("residuals")
        if res_data:
            try:
                cb = chart_service.residual_scatter_chart(res_data["predicted"],res_data["values"])
                im = _img(cb, 14*cm)
                if im: story += [im, Paragraph("图3：残差分析", ST["caption"])]
            except Exception: pass

    # -- SHAP --
    if "shap" in sections:
        shap_data = eval_result.get("shap_summary",[])
        if shap_data:
            story += _h1_pair(sn, "特征重要性分析（SHAP）")
            story.append(Paragraph("SHAP值量化每个特征对预测的平均贡献，绝对值越大影响越显著。", ST["body_j"]))
            try:
                feats=[d["feature"] for d in shap_data[:10]]; imps=[d["importance"] for d in shap_data[:10]]
                cb = chart_service.shap_bar_chart(feats, imps)
                im = _img(cb, 13*cm)
                if im: story += [im, Paragraph("图6：SHAP特征重要性 Top10", ST["caption"])]
            except Exception: pass
            rows=[["排名","特征名称","平均|SHAP|","重要程度"]]
            for i,d in enumerate(shap_data[:10],1):
                lv="高" if i<=3 else("中" if i<=6 else "低")
                rows.append([Paragraph(str(i),ST["small"]),Paragraph(str(d["feature"]),ST["small"]),Paragraph(f"{d['importance']:.4f}",ST["body"]),Paragraph(lv,ST["small"])])
            st2=Table(rows,colWidths=[1.5*cm,8*cm,3*cm,2.5*cm])
            st2.setStyle(TableStyle([
                ("BACKGROUND",(0,0),(-1,0),BRAND_BLUE),("TEXTCOLOR",(0,0),(-1,0),colors.white),
                ("FONTNAME",(0,0),(-1,-1),_CN_FONT),("FONTSIZE",(0,0),(-1,-1),9),
                ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,BRAND_LIGHT]),
                ("GRID",(0,0),(-1,-1),0.5,GRAY_LINE),
                ("ALIGN",(0,0),(-1,-1),"CENTER"),("VALIGN",(0,0),(-1,-1),"MIDDLE"),
                ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),
            ]))
            story += [st2, Spacer(1,0.3*cm)]

    # -- 学习曲线 --
    if "learning_curve" in sections:
        try:
            lc = get_learning_curve(model_id, db)
            if lc and lc.get("sample_counts"):
                story += _h1_pair(sn, "学习曲线分析")
                story.append(Paragraph("学习曲线展示模型随训练样本量增加的性能变化。两曲线趋于收敛说明模型已充分学习；持续差距较大提示过拟合。", ST["body_j"]))
                cb = chart_service.learning_curve_chart(lc["sample_counts"],lc["train_scores"],lc["val_scores"],lc.get("metric","Score"),record.task_type)
                im = _img(cb, 13*cm)
                if im: story += [im, Paragraph("图7：学习曲线", ST["caption"])]
        except Exception: pass

    # -- 过拟合诊断 --
    if "overfitting" in sections:
        ov = eval_result.get("overfitting_diagnosis")
        if ov:
            story += _h1_pair(sn, "过拟合诊断")
            lv=ov.get("level","low")
            sk={"high":"danger_text","medium":"warn_text"}.get(lv,"success_text")
            story.append(Paragraph(ov.get("message",""), ST[sk]))
            if ov.get("early_stopped"):
                story.append(Paragraph(f"🛑 训练在第 {ov.get('best_round')} 轮触发早停，自动保护了模型泛化能力。", ST["body"]))

    # -- 基线对比 --
    if "baseline" in sections:
        baseline = eval_result.get("baseline")
        if baseline:
            story += _h1_pair(sn, "与随机基线对比")
            story.append(Paragraph(f"与策略\"{baseline.get('strategy','均值/多数类预测')}\"相比，本模型的提升如下：", ST["body"]))
            try:
                cb = chart_service.baseline_compare_chart(metrics, baseline, record.task_type)
                im = _img(cb, 12*cm)
                if im: story += [im, Paragraph("图8：模型 vs 随机基线对比", ST["caption"])]
            except Exception: pass

    # -- 业务建议 --
    if "business_advice" in sections:
        story += _h1_pair(sn, "业务建议")
        for line in _business_advice(metrics, record.task_type):
            story.append(Paragraph(line, ST["body"]))

    # -- 备注 --
    if notes:
        story += _h1_pair(sn, "备注")
        story.append(Paragraph(notes, ST["body_j"]))

    # -- 数据来源 --
    story += [Spacer(1,1*cm), HRFlowable(width="100%",thickness=0.5,color=GRAY_LINE,spaceAfter=6),
              Paragraph(f"数据来源：{ds_name}  |  模型：XGBoost {record.task_type}  |  生成工具：XGBoost Studio  |  时间：{gen_time}", ST["small"])]

    rname = f"report_{uuid4().hex[:12]}.pdf"
    rpath = REPORTS_DIR / rname
    doc = SimpleDocTemplate(str(rpath), pagesize=A4, topMargin=1.5*cm, bottomMargin=1.2*cm, leftMargin=2*cm, rightMargin=2*cm, title=report_title, author="XGBoost Studio")
    doc.build(story, onFirstPage=_header_footer, onLaterPages=_header_footer)

    report = Report(name=title or f"Report_{model_id}", model_id=model_id, path=rname)
    db.add(report); db.commit(); db.refresh(report)
    return {"id": report.id, "name": report.name, "path": rname, "created_at": str(report.created_at)}

def generate_comparison_report(model_ids, title, db):
    from services import chart_service
    models = db.query(Model).filter(Model.id.in_(model_ids)).all()
    if not models: raise HTTPException(status_code=404, detail="未找到指定模型")
    gen_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    report_title = title or f"多模型对比报告（{len(models)}个）"
    story = [Spacer(1,5*cm), Paragraph("XGBoost Studio", ST["cover_title"]),
             Paragraph("多模型横向对比报告", _S("cs2",fontSize=16,textColor=TEXT_MED,alignment=TA_CENTER,spaceAfter=10)),
             HRFlowable(width="80%",thickness=2,color=BRAND_BLUE,spaceAfter=20,spaceBefore=10),
             Paragraph(f"对比模型数量：{len(models)} 个", ST["cover_meta"]),
             Paragraph(f"生成时间：{gen_time}", ST["cover_meta"]), PageBreak()]
    story += [Paragraph("一、指标汇总对比", ST["h1"]), HRFlowable(width="100%",thickness=1,color=BRAND_BLUE,spaceAfter=10)]
    all_metrics=[json.loads(m.metrics_json or "{}") for m in models]
    model_names=[m.name[:20] for m in models]
    metric_keys=[k for k in ["accuracy","auc","f1","precision","recall","rmse","mae","r2"] if any(k in md for md in all_metrics)]
    rows=[["指标"]+model_names]
    best_cols={}
    for k in metric_keys:
        row=[Paragraph(k.upper(),ST["kv_key"])]; vals=[]
        for md in all_metrics:
            v=md.get(k); row.append(Paragraph(f"{float(v):.4f}" if v is not None else "-",ST["body"])); vals.append(float(v) if v is not None else None)
        valid=[(i,v) for i,v in enumerate(vals) if v is not None]
        if valid:
            bi=min(valid,key=lambda x:x[1])[0] if k in("rmse","mae","log_loss") else max(valid,key=lambda x:x[1])[0]
            best_cols[len(rows)]=bi+1
        rows.append(row)
    cw=[3*cm]+[max(2.5*cm,12*cm/len(models))]*len(models)
    ct=Table(rows,colWidths=cw)
    ts=[("BACKGROUND",(0,0),(-1,0),BRAND_BLUE),("TEXTCOLOR",(0,0),(-1,0),colors.white),
        ("FONTNAME",(0,0),(-1,-1),_CN_FONT),("FONTSIZE",(0,0),(-1,-1),9),
        ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,BRAND_LIGHT]),
        ("GRID",(0,0),(-1,-1),0.5,GRAY_LINE),("ALIGN",(0,0),(-1,-1),"CENTER"),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)]
    for ri,ci in best_cols.items():
        ts+=[("BACKGROUND",(ci,ri),(ci,ri),colors.HexColor("#d9f7be")),("TEXTCOLOR",(ci,ri),(ci,ri),colors.HexColor("#135200"))]
    ct.setStyle(TableStyle(ts)); story += [ct, Paragraph("注：绿色背景列为该指标最优模型", ST["caption"]), Spacer(1,0.5*cm)]
    km=metric_keys[0] if metric_keys else "accuracy"
    try:
        cb=chart_service.multi_model_compare_chart(model_names, all_metrics, km)
        im=_img(cb,14*cm)
        if im: story += [im, Paragraph(f"图1：多模型{km.upper()}指标对比", ST["caption"])]
    except Exception: pass
    story += [Paragraph("二、训练参数对比", ST["h1"]), HRFlowable(width="100%",thickness=1,color=BRAND_BLUE,spaceAfter=10)]
    all_params=[{k:v for k,v in json.loads(m.params_json or "{}").items() if not k.startswith("_")} for m in models]
    pk=[k for k in ["n_estimators","max_depth","learning_rate","subsample","colsample_bytree","reg_alpha","reg_lambda"] if any(k in p for p in all_params)]
    if pk:
        pr=[["参数"]+model_names]+[[Paragraph(k,ST["kv_key"])]+[Paragraph(str(p.get(k,"-")),ST["body"]) for p in all_params] for k in pk]
        pt=Table(pr,colWidths=cw); pt.setStyle(TableStyle([
            ("BACKGROUND",(0,0),(-1,0),BRAND_DARK),("TEXTCOLOR",(0,0),(-1,0),colors.white),
            ("FONTNAME",(0,0),(-1,-1),_CN_FONT),("FONTSIZE",(0,0),(-1,-1),9),
            ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,colors.HexColor("#f0f2f5")]),
            ("GRID",(0,0),(-1,-1),0.5,GRAY_LINE),("ALIGN",(0,0),(-1,-1),"CENTER"),
            ("VALIGN",(0,0),(-1,-1),"MIDDLE"),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)])); story.append(pt)
    story += [Spacer(1,0.5*cm), HRFlowable(width="100%",thickness=0.5,color=GRAY_LINE,spaceAfter=6),
              Paragraph(f"数据来源：XGBoost Studio  |  生成时间：{gen_time}", ST["small"])]
    rname=f"compare_{uuid4().hex[:12]}.pdf"; rpath=REPORTS_DIR / rname
    doc=SimpleDocTemplate(str(rpath),pagesize=A4,topMargin=1.5*cm,bottomMargin=1.2*cm,leftMargin=2*cm,rightMargin=2*cm,title=report_title,author="XGBoost Studio")
    doc.build(story, onFirstPage=_header_footer, onLaterPages=_header_footer)
    report=Report(name=report_title, model_id=model_ids[0] if model_ids else None, path=rname, report_type="comparison", model_ids_json=json.dumps(model_ids))
    db.add(report); db.commit(); db.refresh(report)
    return {"id": report.id, "name": report.name, "path": rname, "created_at": str(report.created_at)}

def list_reports(db):
    rows = db.query(Report).order_by(Report.created_at.desc()).all()
    return [{"id": r.id, "name": r.name, "model_id": r.model_id, "path": r.path,
             "report_type": getattr(r,"report_type","single") or "single",
             "created_at": str(r.created_at)} for r in rows]

def get_report_path(report_id, db):
    report = db.query(Report).filter(Report.id==report_id).first()
    if not report: raise HTTPException(status_code=404, detail="报告不存在")
    path = REPORTS_DIR / report.path
    if not path.exists(): raise HTTPException(status_code=404, detail="报告文件不存在")
    return path
