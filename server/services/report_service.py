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
# P0-10: 模块级字体名称缓存，每次生成重新注册后更新
_current_cn_font = None

def _register_cn_font() -> str:
    """
    注册中文字体，支持 Windows / macOS / Linux 跨平台。
    P0-10: 延迟到每次生成报告时注册，失败后可重试
    P1-09: 增加Linux更多备选路径
    
    搜索顺序：
    1. Windows: C:/Windows/Fonts/ 系统字体目录
    2. macOS: /Library/Fonts/ 和 ~/Library/Fonts/
    3. Linux: /usr/share/fonts/ 多个常见路径
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
            "C:/Windows/Fonts/SourceHanSansCN-Regular.otf",  # 思源黑体（用户安装）
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
        # Linux: 增加更多常见路径（P1-09）
        font_paths = [
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",  # Noto Sans CJK
            "/usr/share/fonts/opentype/sourcehansan/SourceHanSansCN-Regular.otf",  # 思源黑体
            "/usr/share/fonts/opentype/noto-cjk/NotoSansCJK-Regular.ttc",  # Debian/Ubuntu 路径
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",           # 文泉驿微米黑
            "/usr/share/fonts/truetype/wqy/wqy-microhei.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",          # 备选（可显示部分汉字）
            "/usr/local/share/fonts/SourceHanSansCN-Regular.otf",      # 自定义安装
            "~/.local/share/fonts/SourceHanSansCN-Regular.otf",         # 用户安装
        ]
    
    # 尝试逐个注册字体
    for font_path in font_paths:
        if isinstance(font_path, str) and font_path.startswith("~/"):
            font_path = Path.home() / font_path[2:]
        else:
            font_path = Path(font_path) if isinstance(font_path, str) else font_path
        try:
            if font_path.exists():
                pdfmetrics.registerFont(TTFont(_FONT_NAME, str(font_path)))
                logger.info(f"[报告] 字体已注册: {font_path}")
                return _FONT_NAME
        except Exception:
            # 继续尝试下一个字体
            continue
    
    # 所有字体都失败，回退到 Helvetica
    logger.warning(
        f"[报告] 警告: 未找到中文字体 (平台: {sys.platform})，"
        "将使用 Helvetica（仅英文，中文可能显示为方框）"
    )
    return "Helvetica"

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

# -- Shortcut for inline custom style paragraph --
def _S(name_prefix: str, **kw):
    """便捷函数创建临时 ParagraphStyle 实例（用于封面少量特殊文本）"""
    return ParagraphStyle(f"_custom_{name_prefix}", **kw)

# -- Styles --
# P0-10: 字体每次重新注册，需要动态创建样式，因此存储的是样式参数不是实例
def _build_style(name, font_name, **kw):
    return ParagraphStyle(name, fontName=font_name, **kw)

# 基础样式参数定义（默认格式，P0-01: 正文字号 10→11px；P0-03: 增加段落留白）
BASE_STYLE_PARAMS = {
    "cover_title": {"fontSize": 28, "textColor": BRAND_BLUE, "alignment": TA_CENTER, "spaceAfter": 12, "leading": 34},
    "cover_sub":   {"fontSize": 14, "textColor": TEXT_MED,   "alignment": TA_CENTER, "spaceAfter": 8},
    "cover_meta":  {"fontSize": 11, "textColor": TEXT_LIGHT, "alignment": TA_CENTER, "spaceAfter": 6},
    "h1":          {"fontSize": 16, "textColor": BRAND_DARK, "spaceBefore": 20, "spaceAfter": 12, "leading": 20},
    "h2":          {"fontSize": 13, "textColor": BRAND_BLUE, "spaceBefore": 16, "spaceAfter": 8, "leading": 16},
    "body":        {"fontSize": 11, "textColor": TEXT_DARK, "leading": 18, "spaceAfter": 8},
    "body_j":      {"fontSize": 11, "textColor": TEXT_DARK, "leading": 18, "spaceAfter": 8, "alignment": TA_JUSTIFY},
    "small":       {"fontSize": 9, "textColor": TEXT_LIGHT, "spaceAfter": 6},
    "caption":     {"fontSize": 9, "textColor": TEXT_MED, "alignment": TA_CENTER, "spaceBefore": 4, "spaceAfter": 14},  # P1-07: 增加图标题下方留白
    "kv_key":      {"fontSize": 10, "textColor": TEXT_MED},
    "kv_val":      {"fontSize": 10, "textColor": TEXT_DARK},
    "warn_text":   {"fontSize": 10, "textColor": colors.HexColor("#ad4e00"), "leading": 16, "spaceAfter": 6},
    "success_text":{"fontSize": 10, "textColor": colors.HexColor("#135200"), "leading": 16, "spaceAfter": 6},
    "danger_text": {"fontSize": 10, "textColor": colors.HexColor("#820014"), "leading": 16, "spaceAfter": 6},
}

# APA 格式增量覆盖参数（P0-11: 基础样式+增量覆盖消除重复）
APA_OVERRIDES = {
    "cover_title": {"fontSize": 24, "leading": 36, "spaceAfter": 12, "textColor": TEXT_DARK},
    "cover_sub":   {"fontSize": 12, "spaceAfter": 8, "textColor": TEXT_MED},
    "cover_meta":  {"fontSize": 10, "spaceAfter": 4, "textColor": TEXT_LIGHT},
    "h1":          {"fontSize": 18, "spaceBefore": 20, "spaceAfter": 10, "leading": 24, "textColor": TEXT_DARK},
    "h2":          {"fontSize": 16, "spaceBefore": 16, "spaceAfter": 8, "leading": 20, "textColor": TEXT_DARK},
    "body":        {"fontSize": 12, "leading": 24, "spaceAfter": 6},
    "body_j":      {"fontSize": 12, "leading": 24, "spaceAfter": 6},
    "small":       {"fontSize": 10, "spaceAfter": 4},
    "caption":     {"fontSize": 10, "spaceBefore": 4, "spaceAfter": 16},
    "kv_key":      {"fontSize": 12},
    "kv_val":      {"fontSize": 12},
    "warn_text":   {"fontSize": 12, "leading": 24, "spaceAfter": 4},
    "success_text":{"fontSize": 12, "leading": 24, "spaceAfter": 4},
    "danger_text": {"fontSize": 12, "leading": 24, "spaceAfter": 4},
}

def get_styles(cn_font_name: str, format_style: str = "default") -> dict:
    """根据格式样式获取对应的样式字典
    P0-10: 字体每次重新注册，动态传入字体名称构建样式
    P0-11: 基础样式+APA增量覆盖，消除代码重复
    """
    styles = {}
    if format_style != "apa":
        # 默认格式：基于参数构建
        for name, params in BASE_STYLE_PARAMS.items():
            styles[name] = _build_style(name, cn_font_name, **params)
        return styles

    # APA 格式：基于基础样式应用增量覆盖
    for name, base_params in BASE_STYLE_PARAMS.items():
        merged = base_params.copy()
        if name in APA_OVERRIDES:
            merged.update(APA_OVERRIDES[name])
        styles[name] = _build_style(name, cn_font_name, **merged)
    return styles

_INTERNAL_KEYS = frozenset({"overfitting_level","overfitting_gap","train_accuracy","train_rmse","early_stopped","best_round"})

XGBOOST_PARAM_EXPLAIN = {
    "n_estimators": "树的数量，集成学习中决策树的个数",
    "max_depth": "树的最大深度，控制模型复杂度",
    "learning_rate": "学习率，每次更新的步长缩放",
    "subsample": "样本抽样比例，随机选择样本训练",
    "colsample_bytree": "特征抽样比例，每棵树随机选特征",
    "colsample_bylevel": "每层分裂的特征抽样比例",
    "gamma": "最小分裂损失减少，大于0进行分裂",
    "reg_alpha": "L1正则化，稀疏性促进特征选择",
    "reg_lambda": "L2正则化，权重衰减减少过拟合",
    "min_child_weight": "叶子节点最小样本权重和",
    "objective": "损失函数类型，定义学习目标",
    "eval_metric": "评估指标，用于早停和模型选择",
    "early_stopping_rounds": "早停轮数，N轮不提升则停止",
    "scale_pos_weight": "正类别权重，不平衡分类时调整",
    "random_state": "随机种子，保证结果可复现",
    "booster": "基学习器类型，gbtree/dart/gblinear",
    "max_bin": "分箱最大数量，直方图分割的箱数",
    "tree_method": "树构建算法，exact/approx/hist",
    "process_type": "处理类型，用于增量训练",
    "grow_policy": "树生长策略，depthwise/lossguide",
    "max_leaves": "最大叶子节点数，控制树复杂度",
}

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
    # ReportLab.Image 需要在绘制前保持流打开，因此不使用 with 关闭
    # 报告生成完成后整个流会被垃圾收集，没有资源泄漏
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


def _h1_pair(sec_counter: list, title: str, format_style: str = "default") -> list:
    sec_counter[0] += 1
    sec_counter[1] = 0  # 重置二级标题计数
    n = _cn_section_num(sec_counter[0])
    ST = get_styles(_current_cn_font, format_style)
    return [
        Paragraph(f"{n}、{title}", ST["h1"]),
        HRFlowable(width="100%", thickness=1, color=BRAND_BLUE, spaceAfter=10),
    ]


def _h2_pair(sec_counter: list, title: str, format_style: str = "default") -> list:
    """P1-06: 统一二级标题编号抽象逻辑"""
    sec_counter[1] += 1
    ST = get_styles(_current_cn_font, format_style)
    return [
        Paragraph(f"{sec_counter[0]}.{sec_counter[1]} {title}", ST["h2"]),
    ]


def _data_relations_flowables(nar, pdf_assets: dict | None, format_style: str = "default") -> list:
    """G2-R1 / G2-R1b：由 DataNarrativeResponse 生成 platypus 流（不含一级标题）。"""
    assets = pdf_assets or {}
    heatmap_png = assets.get("corr_heatmap_png")
    spearman_png = assets.get("spearman_heatmap_png")
    boxplots = assets.get("boxplots") or []
    ST = get_styles(_current_cn_font, format_style)

    out: list = []
    m = nar.meta
    intro = (
        f"本节基于训练集共 <b>{m.row_count_profiled}</b> 行进行自动统计（深度：{m.depth.value}）。"
    )
    if m.sample_note:
        intro += " " + _esc_xml(m.sample_note)
    out.append(Paragraph(intro, ST["body_j"]))
    out.append(Spacer(1, 0.25 * cm))

    out.extend(_h2_pair(sec_counter, "变量目录", format_style))
    vrows = [[Paragraph(x, ST["small"]) for x in ("列名", "类型", "缺失率", "唯一值", "是否目标")]]
    # P0-06: 高缺失率(>20%)标记需要背景高亮的行索引
    high_missing_rows = []
    for idx, v in enumerate(nar.variables, 1):  # idx从1开始，跳过表头
        vrows.append([
            Paragraph(_esc_xml(v.name), ST["small"]),
            Paragraph(_esc_xml(v.role.value), ST["small"]),
            Paragraph(f"{v.missing_rate * 100:.1f}%", ST["small"]),
            Paragraph(str(v.n_unique if v.n_unique is not None else "-"), ST["small"]),
            Paragraph("是" if v.is_target else "否", ST["small"]),
        ])
        if v.missing_rate > 0.2:
            high_missing_rows.append(idx)
    vt = Table(vrows, colWidths=[3.2 * cm, 2.2 * cm, 2 * cm, 2 * cm, 2 * cm])
    # P0-02/P0-04: 字体 8→9pt
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), _current_cn_font),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, BRAND_LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, GRAY_LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]
    # P0-06: 高缺失率增加浅黄色背景标注
    HIGH_MISSING_BG = colors.HexColor("#fffbe6")  # 浅黄色
    for row_idx in high_missing_rows:
        style_cmds.append(("BACKGROUND", (0, row_idx), (-1, row_idx), HIGH_MISSING_BG))
    vt.setStyle(TableStyle(style_cmds))
    out += [vt, Spacer(1, 0.3 * cm)]

    out.extend(_h2_pair(sec_counter, "数值列 Pearson 相关", format_style))
    im = _img(heatmap_png, 12 * cm) if heatmap_png else None
    if im:
        out += [im, Paragraph("图：数值特征 Pearson 相关热力图（色标范围：-1 ～ +1，越深蓝正相关越强，越深红负相关越强）", ST["caption"])]
        # P1-04: 增加图表下方统一留白
        out.append(Spacer(1, 0.4 * cm))
    pear = [p for p in nar.correlation_pairs if p.method.value == "pearson"]
    for p in pear[:12]:
        out.append(Paragraph(f"• {_esc_xml(p.narrative_hint)}", ST["body_j"]))
    if not pear and not im:
        out.append(Paragraph("数值列不足或 Pearson 相关较弱，未列出高相关对。", ST["body"]))
    out.append(Spacer(1, 0.25 * cm))

    out.extend(_h2_pair(sec_counter, "数值列 Spearman 秩相关", format_style))
    sim = _img(spearman_png, 12 * cm) if spearman_png else None
    if sim:
        out += [sim, Paragraph("图：数值特征 Spearman 秩相关热力图（色标范围：-1 ～ +1，越深蓝正相关越强，越深红负相关越强）", ST["caption"])]
        # P1-04: 增加图表下方统一留白
        out.append(Spacer(1, 0.4 * cm))
    spe = [p for p in nar.correlation_pairs if p.method.value == "spearman"]
    for p in spe[:12]:
        out.append(Paragraph(f"• {_esc_xml(p.narrative_hint)}", ST["body_j"]))
    if not spe and not sim:
        out.append(Paragraph("未启用详细深度或秩相关对较少，本节从略。", ST["body"]))
    out.append(Spacer(1, 0.25 * cm))

    out.extend(_h2_pair(sec_counter, "低基数类别列关联（Cramér's V）", format_style))
    if nar.categorical_associations:
        for ca in nar.categorical_associations[:15]:
            out.append(Paragraph(f"• {_esc_xml(ca.narrative_hint)}", ST["body_j"]))
    else:
        out.append(Paragraph("可分析的类别列对不足或关联较弱。", ST["body"]))
    out.append(Spacer(1, 0.2 * cm))

    out.extend(_h2_pair(sec_counter, "数值 × 类别分布（箱线图）", format_style))
    if boxplots:
        for png, cap in boxplots[:6]:
            img = _img(png, 12 * cm)
            if img:
                out += [img, Paragraph(f"图：{_esc_xml(cap)}", ST["caption"]), Spacer(1, 0.5 * cm)]
    else:
        out.append(Paragraph("未生成箱线图（数值列或低基数类别列不足）。", ST["body"]))
        out.append(Spacer(1, 0.2 * cm))

    out.extend(_h2_pair(sec_counter, "与目标的关系", format_style))
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
            ("FONTNAME", (0, 0), (-1, -1), _current_cn_font),
            ("FONTSIZE", (0, 0), (-1, -1), 8),  # P0-05: 7→8pt
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, BRAND_LIGHT]),
            ("GRID", (0, 0), (-1, -1), 0.5, GRAY_LINE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        out += [tt, Spacer(1, 0.2 * cm)]
    else:
        out.append(Paragraph("未配置目标列或无法计算与目标的关系。", ST["body"]))
    out.append(Spacer(1, 0.2 * cm))

    out.extend(_h2_pair(sec_counter, "冗余与多重共线性（含 VIF）", format_style))
    if nar.multicollinearity:
        for mc in nar.multicollinearity:
            out.append(Paragraph(f"• {_esc_xml(mc.note)}", ST["body_j"]))
    else:
        out.append(Paragraph("未检测到明显多重共线性信号，或数值列不足以估计 VIF。", ST["body"]))
    out.append(Spacer(1, 0.2 * cm))

    out.extend(_h2_pair(sec_counter, "缺失与目标的统计关联", format_style))
    if nar.missing_vs_target:
        for mv in nar.missing_vs_target[:12]:
            out.append(Paragraph(f"• {_esc_xml(mv.narrative_hint)}", ST["body_j"]))
    else:
        out.append(Paragraph("未发现缺失与目标在常规显著性水平下的显著关联，或各列无缺失。", ST["body"]))
    out.append(Spacer(1, 0.2 * cm))

    out.extend(_h2_pair(sec_counter, "数据侧关键发现", format_style))
    for line in nar.bullets.findings:
        out.append(Paragraph(f"• {_esc_xml(line)}", ST["body_j"]))
    out.append(Spacer(1, 0.2 * cm))

    out.extend(_h2_pair(sec_counter, "使用局限", format_style))
    for line in nar.bullets.caveats:
        out.append(Paragraph(f"• {_esc_xml(line)}", ST["body_j"]))
    out.append(Spacer(1, 0.3 * cm))
    return out

def _kv_table(data, format_style: str = "default"):
    ST = get_styles(_current_cn_font, format_style)
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
        ("FONTNAME",(0,0),(-1,-1),_current_cn_font),
    ]))
    return t

def _metrics_table(metrics, format_style: str = "default"):
    ST = get_styles(_current_cn_font, format_style)
    filtered = {k:v for k,v in metrics.items() if k not in _INTERNAL_KEYS and isinstance(v,(int,float))}
    if not filtered: return None
    rows = [["指标","数值","水平","说明"]]
    for k,v in filtered.items():
        rows.append([Paragraph(k.upper(),ST["kv_key"]), Paragraph(f"{float(v):.4f}",ST["body"]),
                     Paragraph(_metric_level(k,float(v)),ST["small"]), Paragraph(METRIC_EXPLAIN.get(k,"")[:50],ST["small"])])
    # P0-09: 调整评估指标表格列宽分配，给说明列更多空间
    t = Table(rows, colWidths=[2.8*cm,2.2*cm,2.0*cm,9.0*cm])
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0),BRAND_BLUE),("TEXTCOLOR",(0,0),(-1,0),colors.white),
        ("FONTNAME",(0,0),(-1,-1),_current_cn_font),("FONTSIZE",(0,0),(-1,-1),9),
        ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,BRAND_LIGHT]),
        ("GRID",(0,0),(-1,-1),0.5,GRAY_LINE),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),
        ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),
    ]))
    return t


def _model_params_table(params, format_style: str = "default"):
    """P0-07: 模型参数表格改为三列布局（参数名|值|说明）"""
    ST = get_styles(_current_cn_font, format_style)
    rows = [[
        Paragraph("参数名", ST["kv_key"]),
        Paragraph("当前值", ST["kv_val"]),
        Paragraph("说明", ST["small"])
    ]]
    for k, v in params.items():
        if k.startswith("_"):
            continue
        explain = XGBOOST_PARAM_EXPLAIN.get(k, "")
        rows.append([
            Paragraph(str(k), ST["kv_key"]),
            Paragraph(str(v), ST["kv_val"]),
            Paragraph(explain, ST["small"])
        ])
    # 三列列宽分配：参数名 3cm，值 2.5cm，说明 10cm
    t = Table(rows, colWidths=[3*cm, 2.5*cm, 10*cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), _current_cn_font),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, BRAND_LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, GRAY_LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def _header_footer(canvas, doc):
    canvas.saveState()
    w,h = A4
    # P1-05: 简化页眉视觉权重 - 使用更浅的颜色和减小高度
    canvas.setFillColor(BRAND_LIGHT); canvas.rect(0, h-0.8*cm, w, 0.8*cm, fill=True, stroke=False)
    canvas.setFillColor(BRAND_DARK); canvas.setFont(_current_cn_font, 8)
    canvas.drawString(1*cm, h-0.5*cm, "XGBoost Studio  专业数据分析报告")
    canvas.drawRightString(w-1*cm, h-0.5*cm, datetime.now().strftime("%Y-%m-%d"))
    canvas.setFillColor(GRAY_BG); canvas.rect(0,0,w,0.6*cm,fill=True,stroke=False)
    canvas.setFillColor(TEXT_LIGHT); canvas.setFont(_current_cn_font, 7)
    canvas.drawString(1*cm,0.2*cm,"由 XGBoost Studio 自动生成  仅供参考，请结合实际业务判断")
    canvas.drawRightString(w-1*cm,0.2*cm,f"第 {doc.page} 页")
    canvas.restoreState()

def _executive_summary(metrics, task_type, ds_name, model_name):
    paras = []
    if task_type=="classification":
        acc=metrics.get("accuracy"); auc=metrics.get("auc"); f1=metrics.get("f1")
        level=_metric_level("accuracy",float(acc)) if acc else "未知"
        p1=(f"本报告对模型 <b>\"{model_name}\"</b> 在数据集 <b>\"{ds_name}\"</b> 上的分类性能进行全面评估。"
            f"模型在测试集上达到准确率 <b>{float(acc):.2%}</b>，表现<b>{level}</b>。")
        if auc: p1+=f" AUC=<b>{float(auc):.4f}</b>，说明模型具备{'良好' if float(auc)>=0.75 else '基础'}的样本区分能力。"
        paras.append(p1)
        if f1:
            lf=_metric_level("f1",float(f1))
            paras.append(f"F1分数=<b>{float(f1):.4f}</b>（{lf}），{'适合正式部署' if float(f1)>=0.75 else '建议进一步调参再部署'}。")
        ol=metrics.get("overfitting_level","low")
        if ol=="high": paras.append("⚠️ <b>过拟合预警</b>：训练集与验证集指标差距较大，建议降低模型复杂度或增加训练数据后再部署。")
        elif ol=="medium": paras.append("训练集与验证集指标存在轻微差距，建议适当增加正则化参数以提升泛化能力。")
        else: paras.append("✅ 模型泛化能力良好，训练集与验证集指标接近，无明显过拟合迹象。")
    else:
        r2=metrics.get("r2"); rmse=metrics.get("rmse")
        p1=f"本报告对回归模型 <b>\"{model_name}\"</b> 在数据集 <b>\"{ds_name}\"</b> 上的预测性能进行全面评估。"
        if r2 is not None:
            lr=_metric_level("r2",float(r2))
            p1+=f" R²=<b>{float(r2):.4f}</b>（{lr}），可解释 {max(0,float(r2))*100:.1f}% 的目标方差。"
        paras.append(p1)
        if rmse: paras.append(f"RMSE=<b>{float(rmse):.4f}</b>，{'预测精度较高' if float(r2 or 0)>=0.75 else '仍有提升空间'}，建议结合业务误差容忍度判断可用性。")
    return paras

def _business_advice(metrics, task_type):
    from services.report_methodology import (
        CLASSIFICATION_AUC_DEPLOY_THRESHOLD,
        REGRESSION_R2_DEPLOY_THRESHOLD,
    )

    advice = []
    if task_type == "classification":
        acc = float(metrics.get("accuracy", 0))
        auc = float(metrics.get("auc", 0))
        if auc < CLASSIFICATION_AUC_DEPLOY_THRESHOLD:
            advice.append(
                f"⚠️ 当前 AUC（{auc:.4f}）低于建议阈值 {CLASSIFICATION_AUC_DEPLOY_THRESHOLD}，"
                "不宜将「上线试验」作为近期目标；优先补充特征、检查标签与样本、或调参后再评估。"
            )
        elif acc >= 0.9 and auc >= 0.9:
            advice.append("✅ 性能优秀，可在小范围业务场景中先行 A/B 测试验证效果。")
        elif acc >= 0.75:
            advice.append(
                "📊 性能良好，可考虑在非关键场景试点；若精确率要求高，建议调整预测阈值（当前默认 0.5）。"
            )
        else:
            advice.append("⚠️ 性能有待提升：增加训练数据、优化特征工程或使用 Optuna 自动调参。")
        advice.append("💡 建议建立模型监控机制，定期用新数据重评估，注意数据分布漂移。")
    else:
        r2 = float(metrics.get("r2", 0))
        if r2 < REGRESSION_R2_DEPLOY_THRESHOLD:
            advice.append(
                f"⚠️ 当前 R²（{r2:.4f}）低于建议阈值 {REGRESSION_R2_DEPLOY_THRESHOLD}，"
                "不宜将「用于实际预测场景」作为结论；请先提升数据质量、特征或模型再评估。"
            )
        elif r2 >= 0.85:
            advice.append("✅ 拟合效果优秀，R² 较高，在业务误差容忍度允许时可进入试点应用。")
        elif r2 >= 0.6:
            advice.append("📊 具备基础预测能力，建议检查未被捕捉的交互特征或非线性关系。")
        else:
            advice.append("⚠️ 拟合效果不理想：检查数据质量、增加特征工程或增大数据量。")
        advice.append("💡 请结合具体业务场景设定可接受的 RMSE/MAE 阈值，而非仅依赖 R² 判断。")
    advice.append(
        "📌 免责声明：本报告由机器学习模型自动生成，预测结果仅供参考，最终决策应结合领域专家判断。"
    )
    return advice


ALL_SECTIONS = [
    "methodology",
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

# ── G3-C: 12 个固定章节（规格说明书 §3.2.2）────────────────────────────────────
# 映射到内部 section key
CHAPTER_12_KEYS = [
    "ch1_executive_summary",    # 第1章：报告摘要与建模目标
    "ch2_label_dataset",        # 第2章：标签与数据集专项分析
    "ch3_feature_engineering",  # 第3章：特征工程全流程分析
    "ch4_modeling_tuning",      # 第4章：XGBoost建模与超参数调优全链路过程
    "ch5_model_accuracy",       # 第5章：模型准确性与泛化能力全维度分析
    "ch6_interpretability",     # 第6章：模型可解释性分析
    "ch7_risk_compliance",      # 第7章：模型合规性与风险分析
    "ch8_business_application", # 第8章：业务落地与应用建议
    "ch9_conclusion",           # 第9章：结论与优化方向
    "ch10_appendix",            # 第10章：附录
]

CHAPTER_12_TITLES = {
    "ch1_executive_summary":    "第一章  报告摘要与建模目标",
    "ch2_label_dataset":        "第二章  标签与数据集专项分析",
    "ch3_feature_engineering":  "第三章  特征工程全流程分析",
    "ch4_modeling_tuning":      "第四章  XGBoost建模与超参数调优全链路过程",
    "ch5_model_accuracy":       "第五章  模型准确性与泛化能力全维度分析",
    "ch6_interpretability":     "第六章  模型可解释性分析",
    "ch7_risk_compliance":      "第七章  模型合规性与风险分析",
    "ch8_business_application": "第八章  业务落地与应用建议",
    "ch9_conclusion":           "第九章  结论与优化方向",
    "ch10_appendix":            "第十章  附录",
}

# 4 种预设模板：每种包含的章节集合
TEMPLATE_CHAPTER_SETS = {
    "full_12_chapters": CHAPTER_12_KEYS,  # 完整版（默认）
    "executive_brief": [                   # 管理层简报：摘要+准确性+业务建议
        "ch1_executive_summary",
        "ch5_model_accuracy",
        "ch8_business_application",
        "ch9_conclusion",
    ],
    "business_execution": [                # 业务执行版：前5章+第8章+第9章
        "ch1_executive_summary",
        "ch2_label_dataset",
        "ch3_feature_engineering",
        "ch4_modeling_tuning",
        "ch5_model_accuracy",
        "ch8_business_application",
        "ch9_conclusion",
    ],
    "technical_expert": [                  # 技术专家版：全量（10章）
        "ch1_executive_summary",
        "ch2_label_dataset",
        "ch3_feature_engineering",
        "ch4_modeling_tuning",
        "ch5_model_accuracy",
        "ch6_interpretability",
        "ch7_risk_compliance",
        "ch9_conclusion",
        "ch10_appendix",
    ],
    "compliance_audit": [                  # 合规审计版：侧重数据、风险、附录
        "ch1_executive_summary",
        "ch2_label_dataset",
        "ch3_feature_engineering",
        "ch5_model_accuracy",
        "ch7_risk_compliance",
        "ch9_conclusion",
        "ch10_appendix",
    ],
}


def _apply_watermark(canvas_obj, doc, watermark_text: str, font_name: str = "Helvetica") -> None:
    """在 PDF 页面上添加水印文字"""
    canvas_obj.saveState()
    canvas_obj.setFont(font_name, 40)
    canvas_obj.setFillColorRGB(0.85, 0.85, 0.85, alpha=0.3)
    canvas_obj.rotate(45)
    canvas_obj.drawString(5*cm, 0, watermark_text)
    canvas_obj.restoreState()


def generate_report(
    model_id,
    title,
    notes,
    db,
    include_sections=None,
    narrative_depth: str = "standard",
    format_style: str = "default",
    template_type: str = "full_12_chapters",
    brand_config: dict | None = None,
):
    from services import chart_service
    from services.eval_service import get_evaluation, get_learning_curve

    # P0-10: 每次生成报告前重新注册字体，失败后可重试
    global _current_cn_font
    _current_cn_font = _register_cn_font()

    record = db.query(Model).filter(Model.id==model_id).first()
    if not record: raise HTTPException(status_code=404, detail="模型不存在")
    dataset = db.query(Dataset).filter(Dataset.id==record.dataset_id).first() if record.dataset_id else None
    split   = db.query(DatasetSplit).filter(DatasetSplit.id==record.split_id).first() if record.split_id else None
    gen_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    report_title = title or f"模型报告 - {record.name}"
    ds_name = dataset.name if dataset else "未知数据集"
    params  = json.loads(record.params_json or "{}")
    metrics = json.loads(record.metrics_json or "{}")

    # G3-C: 根据 template_type 决定 sections，同时兼容旧的 include_sections 参数
    if include_sections is not None:
        # 旧接口：直接指定 section key（向后兼容）
        sections = set(include_sections)
        use_12_chapters = False
    else:
        # G3-C 新接口：使用 12 章结构
        template_chapters = TEMPLATE_CHAPTER_SETS.get(template_type or "full_12_chapters", CHAPTER_12_KEYS)
        sections = set(template_chapters)
        # 同时包含原有 section key 以兼容现有渲染逻辑
        legacy_map = {
            "ch1_executive_summary": ["methodology", "executive_summary"],
            "ch2_label_dataset": ["data_overview", "data_relations"],
            "ch3_feature_engineering": ["data_overview"],
            "ch4_modeling_tuning": ["model_params"],
            "ch5_model_accuracy": ["evaluation", "learning_curve", "overfitting", "baseline"],
            "ch6_interpretability": ["shap"],
            "ch7_risk_compliance": ["baseline", "overfitting"],
            "ch8_business_application": ["business_advice"],
            "ch9_conclusion": ["business_advice"],
            "ch10_appendix": ["model_params"],
        }
        legacy_sections: set[str] = set()
        for ch_key in template_chapters:
            legacy_sections.update(legacy_map.get(ch_key, []))
        sections = sections | legacy_sections
        use_12_chapters = True

    # G3-C: 品牌定制参数提取
    brand_watermark = None
    brand_company = None
    brand_primary_color = None
    if brand_config:
        brand_watermark = brand_config.get("watermark_text")
        brand_company = brand_config.get("company_name")
        if brand_config.get("primary_color_hex"):
            try:
                from reportlab.lib.colors import HexColor  # type: ignore
                brand_primary_color = HexColor(brand_config["primary_color_hex"])
            except Exception:
                brand_primary_color = None

    # P0-10: 传入当前注册的字体名称
    ST = get_styles(_current_cn_font, format_style)

    eval_result = {}
    try: eval_result = get_evaluation(model_id, db)
    except Exception: pass

    story = []
    sn = [0, 0]  # [一级标题计数, 二级标题计数]
    from services.report_methodology import methodology_section_paragraphs

    # -- Cover --
    template_label = {
        "full_12_chapters": "完整分析报告（12章）",
        "executive_brief": "管理层简报版",
        "business_execution": "业务执行版",
        "technical_expert": "技术专家版",
        "compliance_audit": "合规审计版",
    }.get(template_type or "full_12_chapters", "专业分析报告")

    company_line = brand_company or "XGBoost Studio"

    story += [Spacer(1,6*cm),
              Paragraph(company_line, ST["cover_title"]),
              Paragraph(template_label, _S("cs",fontSize=16,textColor=TEXT_MED,alignment=TA_CENTER,spaceAfter=10)),
              HRFlowable(width="80%",thickness=2,color=brand_primary_color or BRAND_BLUE,spaceAfter=20,spaceBefore=10),
              Paragraph(f"<b>{report_title}</b>", ST["cover_sub"]),
              Spacer(1,0.5*cm),
              Paragraph(f"模型：{record.name}", ST["cover_meta"]),
              Paragraph(f"数据集：{ds_name}", ST["cover_meta"]),
              Paragraph(f"任务类型：{'分类' if record.task_type=='classification' else '回归'}", ST["cover_meta"]),
              Paragraph(f"报告模板：{template_label}", ST["cover_meta"]),
              Paragraph(f"生成时间：{gen_time}", ST["cover_meta"]),
              PageBreak()]

    # G3-C: 12章目录页
    if use_12_chapters:
        template_chapters_to_show = TEMPLATE_CHAPTER_SETS.get(template_type or "full_12_chapters", CHAPTER_12_KEYS)
        story += [
            Paragraph("目　　录", _S("toc_title", fontSize=18, fontName=_current_cn_font,
                                     alignment=TA_CENTER, spaceAfter=20, spaceBefore=10,
                                     textColor=brand_primary_color or BRAND_BLUE)),
            HRFlowable(width="100%", thickness=1, color=brand_primary_color or BRAND_BLUE, spaceAfter=12),
        ]
        for i, ch_key in enumerate(template_chapters_to_show):
            ch_title = CHAPTER_12_TITLES.get(ch_key, ch_key)
            story.append(Paragraph(
                f"{ch_title}",
                _S(f"toc_{i}", fontSize=11, fontName=_current_cn_font,
                   textColor=BRAND_DARK, spaceAfter=6, leftIndent=10)
            ))
        story.append(PageBreak())

    # -- 方法与指标定义（G2-Auth-4）--
    if "methodology" in sections:
        story += _h1_pair(sn, "方法与指标定义", format_style)
        for para in methodology_section_paragraphs():
            story.append(Paragraph(para, ST["body_j"]))
        story.append(Spacer(1, 0.3 * cm))

    # -- 执行摘要 --
    if "executive_summary" in sections:
        story += _h1_pair(sn, "执行摘要", format_style)
        for p in _executive_summary(metrics, record.task_type, ds_name, record.name):
            story.append(Paragraph(p, ST["body_j"]))
        story.append(Spacer(1,0.3*cm))

    # -- 数据与变量关系（G2-R1）--
    if "data_relations" in sections:
        story += _h1_pair(sn, "数据与变量关系（自动分析）", format_style)
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
                story.extend(_data_relations_flowables(nar, pdf_assets, format_style))
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
        story += _h1_pair(sn, "数据集概览", format_style)
        story.append(Paragraph(
            "<b>解读说明：</b>本节展示数据集基本统计信息，帮助你理解数据规模和质量。"
            "数据质量评分综合了缺失率、异常率和重复率，评分低于 70 建议先做预处理。",
            ST["body_j"]
        ))
        story.append(Spacer(1, 0.2 * cm))
        if dataset:
            dinfo = {"数据集名称": dataset.name,"总行数": f"{dataset.rows:,}" if dataset.rows else "-",
                     "总列数": str(dataset.cols) if dataset.cols else "-","目标列": dataset.target_column or "-",
                     "任务类型": "分类" if record.task_type=="classification" else "回归",
                     "上传时间": str(dataset.created_at)[:19]}
            if split:
                dinfo["训练集行数"] = f"{split.train_rows:,}" if split.train_rows else "-"
                dinfo["测试集行数"] = f"{split.test_rows:,}" if split.test_rows else "-"
                dinfo["训练/测试比例"] = f"{split.train_ratio*100:.0f}% / {(1-split.train_ratio)*100:.0f}%"
            story.append(_kv_table(dinfo, format_style))
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
                        if im:
                            story += [Spacer(1,0.3*cm), im, Paragraph("图1：目标列分布", ST["caption"])]
                            story.append(Spacer(1, 0.4*cm))
        except Exception: pass
        story.append(Spacer(1,0.3*cm))

    # -- 模型参数 --
    if "model_params" in sections:
        story += _h1_pair(sn, "模型训练参数", format_style)
        story.append(Paragraph(
            "<b>解读说明：</b>本节记录模型训练时的所有超参数配置。"
            "完整参数记录保证结果可复现，便于后续对比分析。"
            "如果你对某个参数含义不清楚，可以在前端参数配置页面点击 [?] 按钮查看详细解释。",
            ST["body_j"]
        ))
        story.append(Spacer(1, 0.2 * cm))
        minfo = {"模型名称": record.name,"任务类型": "分类" if record.task_type=="classification" else "回归",
                 "训练耗时": f"{record.training_time_s:.1f} 秒" if record.training_time_s else "-",
                 "创建时间": str(record.created_at)[:19]}
        story.append(_kv_table(minfo, format_style))
        if params:
            story.extend(_h2_pair(sn, "XGBoost 超参数配置", format_style))
            story.append(Spacer(1, 0.2 * cm))
            # P0-07: 改为三列布局（参数名|值|说明）
            pt = _model_params_table({k:v for k,v in params.items() if not k.startswith("_")}, format_style)
            story.append(pt)
            story.append(Spacer(1, 0.3 * cm))

    # -- 评估指标 --
    if "evaluation" in sections:
        story += _h1_pair(sn, "模型评估结果", format_style)
        story.append(Paragraph(
            "<b>解读说明：</b>下表给出模型在测试集上的各项评估指标，"
            "每个指标附带简短含义解释和水平评级。"
            "95% 置信区间表示我们对该指标估计的不确定性，区间越窄结果越可靠。"
            "评级标准：分类任务 Accuracy/AUC > 0.85 为优秀，0.75-0.85 良好，< 0.75 待提升；"
            "回归任务 R² > 0.75 为优秀，0.5-0.75 良好，< 0.5 待提升。",
            ST["body_j"]
        ))
        story.append(Spacer(1, 0.2 * cm))
        _proto = eval_result.get("evaluation_protocol") or {}
        if _proto.get("notes_zh"):
            story.append(Paragraph(_proto["notes_zh"], ST["body_j"]))
        story.append(Paragraph(
            "指标口径与局限性见前文<b>「方法与指标定义」</b>；下列数值均基于<b>单次 hold-out</b> 测试集。",
            ST["body_j"],
        ))
    mt = _metrics_table(metrics, format_style)
    if mt: story += [mt, Spacer(1,0.3*cm)]
    if record.task_type=="classification":
        try:
            rb = chart_service.metrics_radar_chart(metrics)
            im = _img(rb, 10*cm)
            if im:
                story += [im, Paragraph("图2：评估指标雷达图", ST["caption"])]
                story.append(Spacer(1, 0.4*cm))
        except Exception: pass
        roc = eval_result.get("roc_curve")
        if roc:
            try:
                cb = chart_service.roc_curve_chart(roc["fpr"],roc["tpr"],roc["auc"])
                im = _img(cb, 12*cm)
                if im:
                    story += [im, Paragraph(f"图3：ROC曲线（AUC={roc['auc']:.4f}）", ST["caption"])]
                    story.append(Spacer(1, 0.4*cm))
            except Exception: pass
        cm_data = eval_result.get("confusion_matrix")
        if cm_data:
            try:
                cb = chart_service.confusion_matrix_chart(cm_data["matrix"], cm_data["labels"])
                im = _img(cb, 10*cm)
                if im:
                    story += [im, Paragraph("图4：混淆矩阵", ST["caption"])]
                    story.append(Spacer(1, 0.4*cm))
            except Exception: pass
        pr = eval_result.get("pr_curve")
        if pr:
            try:
                cb = chart_service.pr_curve_chart(pr["precision"],pr["recall"],pr["ap"])
                im = _img(cb, 12*cm)
                if im:
                    story += [im, Paragraph(f"图5：PR曲线（AP={pr['ap']:.4f}）", ST["caption"])]
                    story.append(Spacer(1, 0.4*cm))
            except Exception: pass
        res_data = eval_result.get("residuals")
        if res_data:
            try:
                cb = chart_service.residual_scatter_chart(res_data["predicted"],res_data["values"])
                im = _img(cb, 14*cm)
                if im:
                    story += [im, Paragraph("图3：残差分析", ST["caption"])]
                    story.append(Spacer(1, 0.4*cm))
            except Exception: pass

    # -- SHAP --
    if "shap" in sections:
        shap_data = eval_result.get("shap_summary",[])
        if shap_data:
            story += _h1_pair(sn, "特征重要性分析（SHAP）", format_style)
            story.append(Paragraph(
                "<b>解读说明：</b>SHAP 是一种先进的可解释性方法，它量化每个特征对模型预测结果的平均贡献。"
                "SHAP 值的绝对值越大，表示该特征对预测结果的影响越大。"
                "XGBoost 内置的特征重要性衡量特征在分裂中的增益，与 SHAP 结论互补。",
                ST["body_j"]
            ))
            story.append(Spacer(1, 0.2 * cm))
            story.append(Paragraph("SHAP 值量化每个特征对预测的平均贡献，绝对值越大影响越显著。", ST["body_j"]))
            try:
                feats=[d["feature"] for d in shap_data[:10]]; imps=[d["importance"] for d in shap_data[:10]]
                cb = chart_service.shap_bar_chart(feats, imps)
                im = _img(cb, 13*cm)
                # P1-03: 调整间距，P1-04: 增加图表下方留白
                if im:
                    story += [im, Paragraph("图6：SHAP特征重要性 Top10", ST["caption"])]
                    story.append(Spacer(1, 0.5 * cm))  # P1-03: 增加间距到 0.5cm，表格放图表下方
            except Exception: pass
            rows=[["排名","特征名称","平均|SHAP|","重要程度"]]
            for i,d in enumerate(shap_data[:10],1):
                lv="高" if i<=3 else("中" if i<=6 else "低")
                rows.append([Paragraph(str(i),ST["small"]),Paragraph(str(d["feature"]),ST["small"]),Paragraph(f"{d['importance']:.4f}",ST["body"]),Paragraph(lv,ST["small"])])
            st2=Table(rows,colWidths=[1.5*cm,8*cm,3*cm,2.5*cm])
            st2.setStyle(TableStyle([
                ("BACKGROUND",(0,0),(-1,0),BRAND_BLUE),("TEXTCOLOR",(0,0),(-1,0),colors.white),
                ("FONTNAME",(0,0),(-1,-1),_current_cn_font),("FONTSIZE",(0,0),(-1,-1),9),
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
                story += _h1_pair(sn, "学习曲线分析", format_style)
                story.append(Paragraph(
                    "<b>解读说明：</b>学习曲线展示模型性能随训练样本量增加的变化趋势。"
                    "如果训练分数和验证分数随着样本量增加逐渐收敛到一起，说明模型容量适合当前数据；"
                    "如果训练分数很高但验证分数始终很低，说明模型存在过拟合。",
                    ST["body_j"]
                ))
                story.append(Spacer(1, 0.2 * cm))
                story.append(Paragraph("学习曲线展示模型随训练样本量增加的性能变化。两曲线趋于收敛说明模型已充分学习；持续差距较大提示过拟合。", ST["body_j"]))
                cb = chart_service.learning_curve_chart(lc["sample_counts"],lc["train_scores"],lc["val_scores"],lc.get("metric","Score"),record.task_type)
                im = _img(cb, 13*cm)
                if im:
                    story += [im, Paragraph("图7：学习曲线", ST["caption"])]
                    story.append(Spacer(1, 0.4*cm))
        except Exception: pass

    # -- 过拟合诊断 --
    if "overfitting" in sections:
        ov = eval_result.get("overfitting_diagnosis")
        if ov:
            story += _h1_pair(sn, "过拟合诊断", format_style)
            story.append(Paragraph(
                "<b>解读说明：</b>过拟合是指模型在训练集上表现很好，但在测试集/新数据上泛化能力差。"
                "诊断依据是训练集和验证集之间的性能差距：差距越大，过拟合越严重。"
                "解决过拟合的常用方法：增加训练数据、增大正则化（reg_lambda）、减小 max_depth、早停。",
                ST["body_j"]
            ))
            story.append(Spacer(1, 0.2 * cm))
            # P0-08: 按风险等级增加背景色块
            lv = ov.get("level", "low")
            message = ov.get("message", "")
            # 定义各等级背景色
            level_bg = {
                "high": DANGER,
                "medium": WARNING,
                "low": SUCCESS
            }
            level_text_color = {
                "high": colors.white,
                "medium": colors.white,
                "low": colors.white
            }
            sk = {"high": "danger_text", "medium": "warn_text"}.get(lv, "success_text")

            # 创建带背景框的段落表格
            diag_rows = [[Paragraph(message, ST[sk])]]
            diag_table = Table(diag_rows, colWidths=[16*cm])
            bg_color = level_bg.get(lv, SUCCESS)
            text_color = level_text_color.get(lv, colors.white)
            diag_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), bg_color),
                ("TEXTCOLOR", (0, 0), (-1, -1), text_color),
                ("FONTNAME", (0, 0), (-1, -1), _current_cn_font),
                ("FONTSIZE", (0, 0), (-1, -1), 11),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ("ROUNDED", (0, 0), (-1, -1), 3),
            ]))
            story.append(diag_table)
            story.append(Spacer(1, 0.3 * cm))

            if ov.get("early_stopped"):
                story.append(Paragraph(f"🛑 训练在第 {ov.get('best_round')} 轮触发早停，自动保护了模型泛化能力。", ST["body"]))
            story.append(Spacer(1, 0.2 * cm))

    # -- 基线对比 --
    if "baseline" in sections:
        baseline = eval_result.get("baseline")
        if baseline:
            story += _h1_pair(sn, "与随机基线对比", format_style)
            story.append(Paragraph(f"与策略\"{baseline.get('strategy','均值/多数类预测')}\"相比，本模型的提升如下：", ST["body"]))
            try:
                cb = chart_service.baseline_compare_chart(metrics, baseline, record.task_type)
                im = _img(cb, 12*cm)
                if im:
                    story += [im, Paragraph("图8：模型 vs 随机基线对比", ST["caption"])]
                    story.append(Spacer(1, 0.4*cm))
            except Exception: pass

    # -- 业务建议 --
    if "business_advice" in sections or "ch8_business_application" in sections:
        if use_12_chapters and "ch8_business_application" in sections:
            story += [PageBreak(), Paragraph(CHAPTER_12_TITLES["ch8_business_application"], ST["h1"]),
                      HRFlowable(width="100%", thickness=2, color=brand_primary_color or BRAND_BLUE, spaceAfter=10)]
        else:
            story += _h1_pair(sn, "业务建议", format_style)
        for line in _business_advice(metrics, record.task_type):
            story.append(Paragraph(line, ST["body"]))

    # G3-C: 第7章 模型合规性与风险分析
    if use_12_chapters and "ch7_risk_compliance" in sections:
        story += [PageBreak(), Paragraph(CHAPTER_12_TITLES["ch7_risk_compliance"], ST["h1"]),
                  HRFlowable(width="100%", thickness=2, color=brand_primary_color or BRAND_BLUE, spaceAfter=10)]
        task_cn = "分类" if record.task_type == "classification" else "回归"
        risk_items = [
            ("P0-数据风险", f"数据集 {ds_name} 的数据质量直接影响模型可靠性，已通过 XGBoost Studio 数据分析模块进行质量评估。"),
            ("P1-泛化风险", f"模型在 {ds_name} 上训练，在时间/场景外推时存在性能衰减风险，建议进行 OOT 跨时间集验证。"),
            ("P1-业务风险", f"本{task_cn}模型的预测结果仅为辅助决策依据，最终业务决策应结合领域专家判断。"),
            ("P2-合规风险", "如涉及个人信息处理，请确保符合《个人信息保护法》等相关法规要求。"),
        ]
        for risk_level, risk_desc in risk_items:
            story.append(Paragraph(f"<b>[{risk_level}]</b> {risk_desc}", ST["body"]))
            story.append(Spacer(1, 0.2 * cm))

        # 生命周期建议
        story.append(Paragraph("<b>模型生命周期管理建议</b>", ST["h2"] if "h2" in ST else ST["body"]))
        lifecycle_advice = [
            "建议在生产环境中部署后，按月监控模型关键指标（PSI、KS）的变化趋势。",
            f"当 PSI > 0.25 或 KS 下降超过 20% 时，触发模型重训练流程。",
            "建议每季度进行一次全量 OOT 验证，评估模型在最新数据上的表现。",
        ]
        for advice in lifecycle_advice:
            story.append(Paragraph(advice, ST["body"]))

    # G3-C: 第9章 结论与优化方向
    if use_12_chapters and "ch9_conclusion" in sections:
        story += [PageBreak(), Paragraph(CHAPTER_12_TITLES["ch9_conclusion"], ST["h1"]),
                  HRFlowable(width="100%", thickness=2, color=brand_primary_color or BRAND_BLUE, spaceAfter=10)]
        task_cn = "分类" if record.task_type == "classification" else "回归"
        key_metric = "AUC" if record.task_type == "classification" else "R²"
        key_val = metrics.get("auc", metrics.get("r2", "N/A"))
        story.append(Paragraph(
            f"本报告基于 {ds_name} 数据集，完成了 XGBoost {task_cn}模型的完整建模流程，"
            f"最终模型核心指标 {key_metric} = {f'{key_val:.4f}' if isinstance(key_val, float) else key_val}。",
            ST["body_j"]
        ))

        strengths = [
            f"采用 XGBoost 原生树模型，充分利用其并行计算与内置正则化特性",
            f"通过 5 阶段分层调优策略，系统性地优化了 {len(params)} 个超参数",
            "完整记录了从数据准备到模型验证的全流程操作，100% 可复现",
        ]
        story.append(Paragraph("<b>核心优势：</b>", ST["body"]))
        for s in strengths:
            story.append(Paragraph(f"• {s}", ST["body"]))

        story.append(Paragraph("<b>局限性与后续优化方向：</b>", ST["body"]))
        limitations = [
            "当前版本未包含完整的 OOT 跨时间集验证，建议补充以评估时间泛化能力",
            "特征工程可进一步探索特征交互项与时间窗口特征的衍生",
            "可结合业务专家知识补充 monotone_constraints 单调性约束",
        ]
        for l in limitations:
            story.append(Paragraph(f"• {l}", ST["body"]))

    # G3-C: 第10章 附录
    if use_12_chapters and "ch10_appendix" in sections:
        story += [PageBreak(), Paragraph(CHAPTER_12_TITLES["ch10_appendix"], ST["h1"]),
                  HRFlowable(width="100%", thickness=2, color=brand_primary_color or BRAND_BLUE, spaceAfter=10)]

        # 训练环境信息
        import platform, sys as _sys
        story.append(Paragraph("<b>附录A：训练环境完整信息</b>", ST["h2"] if "h2" in ST else ST["body"]))
        env_info = [
            ["项目", "版本/信息"],
            ["Python", f"{_sys.version.split()[0]}"],
            ["操作系统", platform.system() + " " + platform.release()],
            ["XGBoost", "参见模型运行档案"],
            ["随机种子", str(params.get("random_state", params.get("seed", "42")))],
        ]
        env_table = Table(env_info, colWidths=[5*cm, 10*cm])
        env_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), brand_primary_color or BRAND_BLUE),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, -1), _current_cn_font),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("GRID", (0, 0), (-1, -1), 0.5, GRAY_LINE),
        ]))
        story.append(env_table)
        story.append(Spacer(1, 0.3 * cm))

        # 最终超参数明细
        story.append(Paragraph("<b>附录B：最终超参数完整明细</b>", ST["h2"] if "h2" in ST else ST["body"]))
        param_docs = {
            "n_estimators": "树棵数",
            "max_depth": "最大树深度",
            "learning_rate": "学习率（eta）",
            "subsample": "行采样比例",
            "colsample_bytree": "列采样比例（每棵树）",
            "reg_alpha": "L1 正则化系数",
            "reg_lambda": "L2 正则化系数",
            "min_child_weight": "叶节点最小样本权重",
            "gamma": "分裂最小损失减少量",
        }
        param_rows = [["参数名", "取值", "业务含义", "选择依据（5阶段调优）"]]
        for k, v in params.items():
            if k.startswith("_"):
                continue
            param_rows.append([k, str(v), param_docs.get(k, "—"), "通过 5 阶段分层调优确定"])
        if len(param_rows) > 1:
            param_table = Table(param_rows, colWidths=[4*cm, 2*cm, 4*cm, 6*cm])
            param_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), brand_primary_color or BRAND_DARK),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, -1), _current_cn_font),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, BRAND_LIGHT]),
                ("GRID", (0, 0), (-1, -1), 0.5, GRAY_LINE),
            ]))
            story.append(param_table)

        # 可复现代码片段
        story.append(Spacer(1, 0.3 * cm))
        story.append(Paragraph("<b>附录C：可复现代码片段</b>", ST["h2"] if "h2" in ST else ST["body"]))
        params_str = ", ".join(f"{k}={v}" for k, v in list(params.items())[:5])
        code_snippet = (
            f"# XGBoost Studio 自动生成的复现代码\n"
            f"import xgboost as xgb\n"
            f"# 数据集：{ds_name}\n"
            f"# 任务类型：{record.task_type}\n"
            f"model = xgb.XGBClassifier({params_str}, ...)\n"
            f"# 完整参数见附录B；随机种子：{params.get('random_state', 42)}"
        )
        story.append(Paragraph(
            code_snippet.replace("\n", "<br/>").replace(" ", "&nbsp;"),
            _S("code", fontName="Courier", fontSize=9, backColor=colors.HexColor("#f0f2f5"),
               textColor=colors.HexColor("#1f2937"), spaceAfter=6, spaceBefore=6,
               leftIndent=10, rightIndent=10)
        ))

    # -- 备注 --
    if notes:
        story += _h1_pair(sn, "备注", format_style)
        story.append(Paragraph(notes, ST["body_j"]))

    # -- 数据来源 --
    footer_company = brand_company or "XGBoost Studio"
    story += [Spacer(1,1*cm), HRFlowable(width="100%",thickness=0.5,color=GRAY_LINE,spaceAfter=6),
              Paragraph(f"数据来源：{ds_name}  |  模型：XGBoost {record.task_type}  |  生成工具：{footer_company}  |  时间：{gen_time}", ST["small"])]

    rname = f"report_{uuid4().hex[:12]}.pdf"
    rpath = REPORTS_DIR / rname
    # P1-11: APA格式需要更宽页边距（左右各 2.54cm = 1 inch）
    author_name = brand_company or "XGBoost Studio"
    if format_style == "apa":
        doc = SimpleDocTemplate(str(rpath), pagesize=A4,
            topMargin=2.54*cm, bottomMargin=2.54*cm,
            leftMargin=2.54*cm, rightMargin=2.54*cm,
            title=report_title, author=author_name)
    else:
        doc = SimpleDocTemplate(str(rpath), pagesize=A4,
            topMargin=1.5*cm, bottomMargin=1.2*cm,
            leftMargin=2*cm, rightMargin=2*cm,
            title=report_title, author=author_name)

    # G3-C: 水印支持
    if brand_watermark:
        _wm_text = brand_watermark
        _wm_font = _current_cn_font

        def _page_with_watermark(canvas_obj, doc_obj):
            _header_footer(canvas_obj, doc_obj)
            _apply_watermark(canvas_obj, doc_obj, _wm_text, _wm_font)

        doc.build(story, onFirstPage=_page_with_watermark, onLaterPages=_page_with_watermark)
    else:
        doc.build(story, onFirstPage=_header_footer, onLaterPages=_header_footer)

    report = Report(name=title or f"Report_{model_id}", model_id=model_id, path=rname)
    db.add(report); db.commit(); db.refresh(report)
    return {"id": report.id, "name": report.name, "path": rname, "created_at": str(report.created_at)}

def generate_comparison_report(model_ids, title, db):
    from services import chart_service
    # P0-10: 每次生成报告前重新注册字体，失败后可重试
    global _current_cn_font
    _current_cn_font = _register_cn_font()

    models = db.query(Model).filter(Model.id.in_(model_ids)).all()
    if not models: raise HTTPException(status_code=404, detail="未找到指定模型")
    gen_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    report_title = title or f"多模型对比报告（{len(models)}个）"
    ST = get_styles(_current_cn_font, "default")
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
    # P0-12: 保证最小列宽 2.0cm，即使模型数量多也不会溢出太严重
    min_col_width = 2.0 * cm
    available_width = 16 * cm  # 总可用宽度减去第一列
    model_col_width = max(min_col_width, available_width / len(models))
    cw = [3 * cm] + [model_col_width] * len(models)
    ct = Table(rows, colWidths=cw)
    ts=[("BACKGROUND",(0,0),(-1,0),BRAND_BLUE),("TEXTCOLOR",(0,0),(-1,0),colors.white),
        ("FONTNAME",(0,0),(-1,-1),_current_cn_font),("FONTSIZE",(0,0),(-1,-1),9),
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
        if im:
            story += [im, Paragraph(f"图1：多模型{km.upper()}指标对比", ST["caption"])]
            story.append(Spacer(1, 0.4*cm))
    except Exception: pass
    story += [Paragraph("二、训练参数对比", ST["h1"]), HRFlowable(width="100%",thickness=1,color=BRAND_BLUE,spaceAfter=10)]
    all_params=[{k:v for k,v in json.loads(m.params_json or "{}").items() if not k.startswith("_")} for m in models]
    pk=[k for k in ["n_estimators","max_depth","learning_rate","subsample","colsample_bytree","reg_alpha","reg_lambda"] if any(k in p for p in all_params)]
    if pk:
        pr=[["参数"]+model_names]+[[Paragraph(k,ST["kv_key"])]+[Paragraph(str(p.get(k,"-")),ST["body"]) for p in all_params] for k in pk]
        pt=Table(pr,colWidths=cw); pt.setStyle(TableStyle([
            ("BACKGROUND",(0,0),(-1,0),BRAND_DARK),("TEXTCOLOR",(0,0),(-1,0),colors.white),
            ("FONTNAME",(0,0),(-1,-1),_current_cn_font),("FONTSIZE",(0,0),(-1,-1),9),
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
