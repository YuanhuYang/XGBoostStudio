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
from db.models import Dataset, DatasetSplit, Model, Report, TuningTask

logger = logging.getLogger(__name__)

# #region agent log
_AGENT_DEBUG_LOG = Path(__file__).resolve().parents[2] / "debug-eedc4d.log"


def _agent_debug_ndjson(hypothesis_id: str, location: str, message: str, data: dict) -> None:
    try:
        import time as _time

        line = json.dumps(
            {
                "sessionId": "eedc4d",
                "hypothesisId": hypothesis_id,
                "location": location,
                "message": message,
                "data": data,
                "timestamp": int(_time.time() * 1000),
            },
            ensure_ascii=False,
        )
        with open(_AGENT_DEBUG_LOG, "a", encoding="utf-8") as _df:
            _df.write(line + "\n")
            _df.flush()
    except Exception:
        pass


# #endregion

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, Image, Preformatted,
)
from reportlab.platypus.flowables import Flowable
from reportlab.platypus.doctemplate import NotAtTopPageBreak
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# -- Font Registration (跨平台支持) --
_FONT_NAME = "ReportFont"
# P0-10: 模块级字体名称缓存，每次生成重新注册后更新
_current_cn_font = None
# 与 SimpleDocTemplate 左右边距一致的版心宽度（点）；在 generate_report / generate_comparison_report 入口赋值
_report_inner_width_pt: float | None = None


def _horizontal_margins_lr_pt(format_style: str) -> tuple[float, float]:
    """左右边距（点），须与 generate_report / generate_comparison_report 中 SimpleDocTemplate 一致。"""
    if format_style == "apa":
        m = 2.54 * cm
    else:
        m = 2.0 * cm
    return (m, m)


def _inner_frame_width_pt_for_format(format_style: str) -> float:
    lm, rm = _horizontal_margins_lr_pt(format_style)
    return A4[0] - lm - rm


def _inner_w_pt() -> float:
    """当前 PDF 内容区宽度（点）；未进入生成流程时回退 default 版心。"""
    if _report_inner_width_pt is not None:
        return _report_inner_width_pt
    return _inner_frame_width_pt_for_format("default")


def _boxed(flowable: Flowable) -> Table:
    """将流式对象限制在版心宽度内排版，避免正文 Paragraph 在个别环境下未按 Frame 宽度换行而溢出页面。"""
    t = Table([[flowable]], colWidths=[_inner_w_pt()])
    t.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return t


def _col_widths_pt_from_cm_parts(parts_cm: list[float]) -> list[float]:
    """将原为固定 cm 的列宽按比例缩放到当前版心宽度（点）。"""
    inner = _inner_w_pt()
    if not parts_cm:
        return [inner]
    total_pt = sum(p * cm for p in parts_cm)
    if total_pt <= 0:
        return [inner]
    scale = inner / total_pt
    return [p * cm * scale for p in parts_cm]


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
    "h1":          {"fontSize": 16, "textColor": BRAND_DARK, "spaceBefore": 12, "spaceAfter": 8, "leading": 22},
    "h2":          {"fontSize": 13, "textColor": BRAND_DARK, "spaceBefore": 12, "spaceAfter": 6, "leading": 18},
    "body":        {"fontSize": 11, "textColor": TEXT_DARK, "leading": 19, "spaceAfter": 7, "alignment": TA_LEFT, "wordWrap": "CJK", "splitLongWords": 1},
    "body_j":      {"fontSize": 11, "textColor": TEXT_DARK, "leading": 19, "spaceAfter": 7, "alignment": TA_LEFT, "wordWrap": "CJK", "splitLongWords": 1},
    "small":       {"fontSize": 9, "textColor": TEXT_MED, "leading": 13, "spaceAfter": 5, "wordWrap": "CJK", "splitLongWords": 1},
    "caption":     {"fontSize": 9, "textColor": TEXT_MED, "alignment": TA_CENTER, "spaceBefore": 5, "spaceAfter": 9, "leading": 13, "wordWrap": "CJK", "splitLongWords": 1},
    "kv_key":      {"fontSize": 10, "textColor": TEXT_DARK, "leading": 14, "wordWrap": "CJK", "splitLongWords": 1},
    "kv_val":      {"fontSize": 10, "textColor": TEXT_DARK, "leading": 14, "wordWrap": "CJK", "splitLongWords": 1},
    "tbl_head":    {"fontSize": 10, "textColor": colors.white, "leading": 14, "alignment": TA_CENTER, "spaceAfter": 0, "wordWrap": "CJK", "splitLongWords": 1},
    "tbl_cell":    {"fontSize": 10, "textColor": TEXT_DARK, "leading": 15, "alignment": TA_LEFT, "spaceAfter": 0, "wordWrap": "CJK", "splitLongWords": 1},
    "tbl_num":     {"fontSize": 10, "textColor": TEXT_DARK, "leading": 15, "alignment": TA_CENTER, "spaceAfter": 0, "wordWrap": "CJK", "splitLongWords": 1},
    "warn_text":   {"fontSize": 10, "textColor": colors.HexColor("#ad4e00"), "leading": 16, "spaceAfter": 6},
    "success_text":{"fontSize": 10, "textColor": colors.HexColor("#135200"), "leading": 16, "spaceAfter": 6},
    "danger_text": {"fontSize": 10, "textColor": colors.HexColor("#820014"), "leading": 16, "spaceAfter": 6},
}

# APA 格式增量覆盖参数（P0-11: 基础样式+增量覆盖消除重复）
APA_OVERRIDES = {
    "cover_title": {"fontSize": 24, "leading": 36, "spaceAfter": 12, "textColor": TEXT_DARK},
    "cover_sub":   {"fontSize": 12, "spaceAfter": 8, "textColor": TEXT_MED},
    "cover_meta":  {"fontSize": 10, "spaceAfter": 4, "textColor": TEXT_LIGHT},
    "h1":          {"fontSize": 18, "spaceBefore": 14, "spaceAfter": 8, "leading": 24, "textColor": TEXT_DARK},
    "h2":          {"fontSize": 16, "spaceBefore": 16, "spaceAfter": 8, "leading": 20, "textColor": TEXT_DARK},
    "body":        {"fontSize": 12, "leading": 24, "spaceAfter": 6, "alignment": TA_LEFT, "wordWrap": "CJK", "splitLongWords": 1},
    "body_j":      {"fontSize": 12, "leading": 24, "spaceAfter": 6, "alignment": TA_LEFT, "wordWrap": "CJK", "splitLongWords": 1},
    "small":       {"fontSize": 10, "spaceAfter": 4},
    "caption":     {"fontSize": 10, "spaceBefore": 4, "spaceAfter": 10},
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

def _img(img_bytes, width=13 * cm):
    if not img_bytes:
        return None
    # ReportLab.Image 需要在绘制前保持流打开，因此不使用 with 关闭
    # 报告生成完成后整个流会被垃圾收集，没有资源泄漏
    buf = BytesIO(img_bytes)
    img = Image(buf)
    aspect = img.imageHeight / img.imageWidth
    cap = _inner_w_pt() * 0.98
    w = min(width, cap)
    img.drawWidth = w
    img.drawHeight = w * aspect
    return img


def _cn_section_num(i: int) -> str:
    c = (
        "一", "二", "三", "四", "五", "六", "七", "八", "九", "十",
        "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
    )
    return c[i - 1] if 1 <= i <= len(c) else str(i)


def _esc_xml(s: str) -> str:
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _table_style_standard(header_bg, *, header_rows: int = 1) -> TableStyle:
    """统一数据表：表头反色、正文深色字、网格与留白一致。"""
    hr = max(1, header_rows)
    return TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, hr - 1), header_bg),
            ("TEXTCOLOR", (0, 0), (-1, hr - 1), colors.white),
            ("TEXTCOLOR", (0, hr), (-1, -1), TEXT_DARK),
            ("FONTNAME", (0, 0), (-1, -1), _current_cn_font),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ROWBACKGROUNDS", (0, hr), (-1, -1), [colors.white, BRAND_LIGHT]),
            ("GRID", (0, 0), (-1, -1), 0.55, GRAY_LINE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ]
    )


class OutlineBookmark(Flowable):
    """PDF 大纲书签：在阅读器侧可展开导航（bookmark + outline 条目）。"""

    _ZEROSIZE = 1

    def __init__(self, key: str, title: str, level: int = 0, closed: bool | None = None) -> None:
        Flowable.__init__(self)
        self._key = key
        self._title = title
        self._level = level
        self._closed = closed

    def wrap(self, availWidth, availHeight):
        return (0, 0)

    def draw(self):
        self.canv.bookmarkHorizontal(self._key, 0, 0)
        self.canv.addOutlineEntry(self._title, self._key, level=self._level, closed=self._closed)


def _cover_story_pages(
    *,
    company_line: str,
    report_title: str,
    record: Model,
    ds_name: str,
    template_label: str,
    gen_time: str,
    accent_color,
    format_style: str,
    metrics: dict | None = None,
    params: dict | None = None,
    dataset: Dataset | None = None,
    split: DatasetSplit | None = None,
) -> list:
    """封面：品牌顶栏 + 元信息 + 核心指标/数据概要 + 复现提示（填满首屏可读信息）。"""
    ST = get_styles(_current_cn_font, format_style)
    accent = accent_color or BRAND_BLUE
    task_cn = "分类" if record.task_type == "classification" else "回归"
    metrics = metrics or {}
    band_para = Paragraph(
        f'{_esc_xml(company_line)}<br/><br/><b><font size="22">模型分析报告</font></b><br/>'
        f'<font size="10" color="#e6f4ff">{_esc_xml(template_label)}</font>',
        _S(
            "cov_band",
            fontName=_current_cn_font,
            fontSize=11,
            textColor=colors.white,
            alignment=TA_CENTER,
            leading=15,
            spaceAfter=0,
            spaceBefore=0,
        ),
    )
    band = Table([[band_para]], colWidths=[_inner_w_pt()], rowHeights=[5 * cm])
    band.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), accent),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("TOPPADDING", (0, 0), (-1, -1), 18),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 18),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ]
        )
    )
    meta_left = [
        "报告标题",
        "模型名称",
        "数据集",
        "任务类型",
        "生成时间",
    ]
    meta_right = [
        _esc_xml(report_title),
        _esc_xml(record.name),
        _esc_xml(ds_name),
        task_cn,
        _esc_xml(gen_time),
    ]
    meta_rows = [
        [
            Paragraph(f"<b>{_esc_xml(a)}</b>", ST["tbl_cell"]),
            Paragraph(b, ST["tbl_cell"]),
        ]
        for a, b in zip(meta_left, meta_right)
    ]
    meta_tbl = Table(meta_rows, colWidths=_col_widths_pt_from_cm_parts([3.2, 12.3]))
    meta_tbl.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.45, GRAY_LINE),
                ("BACKGROUND", (0, 0), (0, -1), BRAND_LIGHT),
                ("TEXTCOLOR", (0, 0), (-1, -1), TEXT_DARK),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("FONTNAME", (0, 0), (-1, -1), _current_cn_font),
            ]
        )
    )
    quick_pairs: list[tuple[str, str]] = []
    if record.task_type == "classification":
        if metrics.get("auc") is not None:
            quick_pairs.append(("AUC（测试集）", f"{float(metrics['auc']):.4f}"))
        if metrics.get("accuracy") is not None:
            quick_pairs.append(("准确率（测试集）", f"{float(metrics['accuracy']):.4f}"))
        if metrics.get("f1") is not None:
            quick_pairs.append(("F1（测试集）", f"{float(metrics['f1']):.4f}"))
    else:
        if metrics.get("r2") is not None:
            quick_pairs.append(("R²（测试集）", f"{float(metrics['r2']):.4f}"))
        if metrics.get("rmse") is not None:
            quick_pairs.append(("RMSE（测试集）", f"{float(metrics['rmse']):.4f}"))
    if dataset and dataset.rows:
        quick_pairs.append(
            ("数据规模", f"约 {dataset.rows:,} 行 × {dataset.cols if dataset.cols is not None else '?'} 列")
        )
    if split:
        tr, te = split.train_rows, split.test_rows
        quick_pairs.append(
            ("训练 / 测试样本量", f"{tr if tr is not None else '-'} / {te if te is not None else '-'}")
        )
        quick_pairs.append(("划分策略", str(getattr(split, "split_strategy", None) or "random")))
    if params:
        n_p = len([k for k in params if not str(k).startswith("_")])
        quick_pairs.append(("本模型超参数项数", str(n_p)))
    if record.training_time_s:
        quick_pairs.append(("训练耗时", f"{record.training_time_s:.1f} 秒"))

    out_extra: list = []
    if quick_pairs:
        out_extra += [
            Spacer(1, 0.28 * cm),
            Paragraph("<b>核心指标与数据概要</b>", ST["h2"]),
            Spacer(1, 0.12 * cm),
        ]
        qh = [
            Paragraph("<b>条目</b>", ST["tbl_head"]),
            Paragraph("<b>内容</b>", ST["tbl_head"]),
        ]
        qrows = [qh]
        for a, b in quick_pairs:
            qrows.append(
                [
                    Paragraph(f"<b>{_esc_xml(a)}</b>", ST["tbl_cell"]),
                    Paragraph(_esc_xml(b), ST["tbl_cell"]),
                ]
            )
        qtbl = Table(qrows, colWidths=_col_widths_pt_from_cm_parts([4.5, 11.0]))
        qtbl.setStyle(_table_style_standard(accent, header_rows=1))
        out_extra += [qtbl, Spacer(1, 0.25 * cm)]

    repro = Paragraph(
        "<b>阅读与复现提示：</b>"
        + _esc_xml("左侧书签/大纲可跳转各章；")
        + "<br/>"
        + _esc_xml(
            "数值复现需与记录保持一致的数据集、划分方式与随机种子、XGBoost 全部超参数（见正文「模型训练参数」与附录B）。"
        ),
        ST["body_j"],
    )
    return [
        OutlineBookmark("xs_cover", "封面", 0),
        Spacer(1, 0.55 * cm),
        band,
        Spacer(1, 0.4 * cm),
        Paragraph(f"<b>{_esc_xml(report_title)}</b>", ST["cover_sub"]),
        Spacer(1, 0.3 * cm),
        meta_tbl,
        *out_extra,
        repro,
        NotAtTopPageBreak(),
    ]


def _train_val_snapshot_html(metrics: dict, task_type: str) -> str | None:
    """训练集与 hold-out 测试集核心指标一句话（数据来自训练阶段写入的 metrics_json）。"""
    if task_type == "classification":
        tr, te = metrics.get("train_accuracy"), metrics.get("accuracy")
        if tr is None or te is None:
            return None
        extra = []
        if metrics.get("best_iteration") is not None:
            extra.append(f"最优提升轮次（0-based）约 <b>{int(metrics['best_iteration'])}</b>")
        if metrics.get("early_stopped"):
            extra.append("训练过程触发了早停")
        suf = (" " + "，".join(extra)) if extra else ""
        return (
            f"<b>训练集 vs 测试集（准确率）：</b>训练 <b>{float(tr):.4f}</b>，"
            f"测试 <b>{float(te):.4f}</b>。{suf}"
        )
    tr, te = metrics.get("train_rmse"), metrics.get("rmse")
    if tr is None or te is None:
        return None
    return (
        f"<b>训练集 vs 测试集（RMSE）：</b>训练 <b>{float(tr):.4f}</b>，"
        f"测试 <b>{float(te):.4f}</b>。"
    )


def _cv_fold_table(cv_block: dict, format_style: str) -> Table:
    ST = get_styles(_current_cn_font, format_style)
    folds: list = cv_block.get("fold_metrics") or []
    if not folds:
        return Table([[Paragraph("（无）", ST["tbl_cell"])]], colWidths=[_inner_w_pt()])
    keys = [k for k in folds[0].keys() if k not in ("fold", "outlier_highlight")]
    header = ["折"] + [k.upper() for k in keys]
    rows: list = [[Paragraph(f"<b>{_esc_xml(x)}</b>", ST["tbl_head"]) for x in header]]
    for fm in folds:
        row = [Paragraph(str(fm.get("fold", "-")), ST["tbl_num"])]
        for k in keys:
            v = fm.get(k)
            cell = f"{float(v):.4f}" if isinstance(v, (int, float)) else str(v)
            row.append(Paragraph(cell, ST["tbl_num"]))
        rows.append(row)
    inner_cm = _inner_w_pt() / cm
    cw = [1.3 * cm] + [(inner_cm - 1.3) / max(1, len(keys)) * cm] * len(keys)
    t = Table(rows, colWidths=cw)
    t.setStyle(_table_style_standard(BRAND_DARK, header_rows=1))
    return t


def _threshold_metrics_table(thr_rows: list, format_style: str) -> Table:
    ST = get_styles(_current_cn_font, format_style)
    rows = [
        [
            Paragraph("<b>阈值</b>", ST["tbl_head"]),
            Paragraph("<b>精确率</b>", ST["tbl_head"]),
            Paragraph("<b>召回率</b>", ST["tbl_head"]),
            Paragraph("<b>F1</b>", ST["tbl_head"]),
        ]
    ]
    for r in thr_rows:
        rows.append(
            [
                Paragraph(str(r.get("threshold", "-")), ST["tbl_num"]),
                Paragraph(f"{float(r['precision']):.4f}", ST["tbl_num"]),
                Paragraph(f"{float(r['recall']):.4f}", ST["tbl_num"]),
                Paragraph(f"{float(r['f1']):.4f}", ST["tbl_num"]),
            ]
        )
    t = Table(rows, colWidths=_col_widths_pt_from_cm_parts([2.0, 3.5, 3.5, 3.5]))
    t.setStyle(_table_style_standard(BRAND_BLUE, header_rows=1))
    return t


def _runtime_brief_flowables(record: Model, split: DatasetSplit | None, sec_counter: list, format_style: str) -> list:
    """运行档案摘要：依赖 provenance_json；无则仅展示划分随机种子等。"""
    ST = get_styles(_current_cn_font, format_style)
    out: list = []
    prov: dict | None = None
    raw = getattr(record, "provenance_json", None)
    if raw:
        try:
            prov = json.loads(raw)
        except Exception:
            prov = None
    seed = None
    if prov and prov.get("split_random_seed") is not None:
        seed = prov["split_random_seed"]
    elif split is not None:
        seed = getattr(split, "random_seed", None)
    src = (prov or {}).get("source")
    src_cn = {"training": "单次训练", "tuning": "自动调优"}.get(str(src), str(src) if src else None)
    pkgs = (prov or {}).get("packages") or {}
    if prov and not prov.get("legacy") and pkgs:
        out.extend(_h2_pair(sec_counter, "运行环境与依赖版本", format_style))
        for k, v in sorted(pkgs.items()):
            out.append(
                _boxed(Paragraph(f"<b>{_esc_xml(str(k))}</b>：{_esc_xml(str(v))}", ST["body_j"]))
            )
        if src_cn:
            out.append(_boxed(Paragraph(f"<b>来源：</b>{src_cn}。", ST["body_j"])))
        if seed is not None:
            out.append(_boxed(Paragraph(f"<b>划分随机种子（DatasetSplit）：</b>{seed}。", ST["body_j"])))
        out.append(Spacer(1, 0.2 * cm))
    elif seed is not None:
        out.extend(_h2_pair(sec_counter, "数据划分复现", format_style))
        out.append(_boxed(Paragraph(f"<b>划分随机种子：</b>{seed}。", ST["body_j"])))
        out.append(Spacer(1, 0.2 * cm))
    return out


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


def _data_relations_flowables(
    nar, pdf_assets: dict | None, sec_counter: list, format_style: str = "default"
) -> list:
    """G2-R1 / G2-R1b：由 DataNarrativeResponse 生成 platypus 流（不含一级标题）。

    sec_counter 与 build_pdf_story 中的 sn 同源：[一级章节序号, 二级小节序号]，供 _h2_pair 编号。
    """
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
    out.append(_boxed(Paragraph(intro, ST["body_j"])))
    out.append(Spacer(1, 0.25 * cm))

    out.extend(_h2_pair(sec_counter, "数据质量口径与可审计清洗", format_style))
    out.append(_boxed(Paragraph(
        "本产品中<b>数据质量综合分</b>（0–100）在数据工作台与智能向导侧<b>同源</b>，由服务端 "
        "<b>get_quality_score</b> 根据全表缺失率、数值列行级 3σ 异常率、重复行率加权计算，并给出改进建议；"
        "具体权重与阈值与界面「质量评分」一致。",
        ST["body_j"],
    )))
    out.append(_boxed(Paragraph(
        "用户在界面中执行的清洗（含缺失处理、去重、异常处理等）或 AutoML 智能清洗若调用相同 "
        "dataset_service 接口，将写入数据集 <b>preprocessing_log_json</b>；"
        "下方「用户预处理与清洗操作记录」由该日志解析，便于审计。"
        "其后「训练阶段默认处理说明」描述的是 XGBoost 训练管线对缺失/标签的约定，与上述用户侧清洗相互独立。",
        ST["body_j"],
    )))
    out.append(Spacer(1, 0.25 * cm))

    if nar.preprocessing_audit:
        out.extend(_h2_pair(sec_counter, "用户预处理与清洗操作记录", format_style))
        for ent in nar.preprocessing_audit:
            line = f"<b>{_esc_xml(ent.ts)}</b> [{_esc_xml(ent.kind)}] {_esc_xml(ent.summary)}"
            out.append(_boxed(Paragraph(line, ST["body_j"])))
            if ent.detail:
                detail_s = json.dumps(ent.detail, ensure_ascii=False)
                if len(detail_s) > 1600:
                    detail_s = detail_s[:1600] + "…"
                out.append(_boxed(Paragraph(f"详情：{_esc_xml(detail_s)}", ST["small"])))
        out.append(Spacer(1, 0.25 * cm))

    out.extend(_h2_pair(sec_counter, "训练阶段默认处理说明", format_style))
    out.append(_boxed(Paragraph(
        "以下为服务端 XGBoost 训练管线约定（与上节用户在前端配置的清洗相互独立）："
        "数值型特征在入模前对缺失按 <b>0</b> 填充；监督学习时标签缺失或非有限值所在行从训练/验证矩阵中剔除。",
        ST["body_j"],
    )))
    out.append(Spacer(1, 0.25 * cm))

    out.extend(_h2_pair(sec_counter, "变量目录", format_style))
    vrows = [
        [
            Paragraph(f"<b>{x}</b>", ST["tbl_head"])
            for x in ("列名", "类型", "缺失率", "唯一值", "是否目标")
        ]
    ]
    # P0-06: 高缺失率(>20%)标记需要背景高亮的行索引
    high_missing_rows = []
    for idx, v in enumerate(nar.variables, 1):  # idx从1开始，跳过表头
        vrows.append([
            Paragraph(_esc_xml(v.name), ST["tbl_cell"]),
            Paragraph(_esc_xml(v.role.value), ST["tbl_cell"]),
            Paragraph(f"{v.missing_rate * 100:.1f}%", ST["tbl_num"]),
            Paragraph(str(v.n_unique if v.n_unique is not None else "-"), ST["tbl_num"]),
            Paragraph("是" if v.is_target else "否", ST["tbl_cell"]),
        ])
        if v.missing_rate > 0.2:
            high_missing_rows.append(idx)
    # 列宽贴近版心（A4 默认左右边距下约 17cm），避免英文类型名/列名被不必要断字
    vt = Table(vrows, colWidths=_col_widths_pt_from_cm_parts([5.2, 3.2, 2.2, 2.2, 3.2]))
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("TEXTCOLOR", (0, 1), (-1, -1), TEXT_DARK),
        ("FONTNAME", (0, 0), (-1, -1), _current_cn_font),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, BRAND_LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.55, GRAY_LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
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
        out.append(_boxed(Paragraph(f"• {_esc_xml(p.narrative_hint)}", ST["body_j"])))
    if not pear and not im:
        out.append(_boxed(Paragraph("数值列不足或 Pearson 相关较弱，未列出高相关对。", ST["body"])))
    out.append(Spacer(1, 0.25 * cm))

    out.extend(_h2_pair(sec_counter, "数值列 Spearman 秩相关", format_style))
    sim = _img(spearman_png, 12 * cm) if spearman_png else None
    if sim:
        out += [sim, Paragraph("图：数值特征 Spearman 秩相关热力图（色标范围：-1 ～ +1，越深蓝正相关越强，越深红负相关越强）", ST["caption"])]
        # P1-04: 增加图表下方统一留白
        out.append(Spacer(1, 0.4 * cm))
    spe = [p for p in nar.correlation_pairs if p.method.value == "spearman"]
    for p in spe[:12]:
        out.append(_boxed(Paragraph(f"• {_esc_xml(p.narrative_hint)}", ST["body_j"])))
    if not spe and not sim:
        out.append(_boxed(Paragraph("未启用详细深度或秩相关对较少，本节从略。", ST["body"])))
    out.append(Spacer(1, 0.25 * cm))

    out.extend(_h2_pair(sec_counter, "低基数类别列关联（Cramér's V）", format_style))
    if nar.categorical_associations:
        for ca in nar.categorical_associations[:15]:
            out.append(_boxed(Paragraph(f"• {_esc_xml(ca.narrative_hint)}", ST["body_j"])))
    else:
        out.append(_boxed(Paragraph("可分析的类别列对不足或关联较弱。", ST["body"])))
    out.append(Spacer(1, 0.2 * cm))

    out.extend(_h2_pair(sec_counter, "数值 × 类别分布（箱线图）", format_style))
    if boxplots:
        for png, cap in boxplots[:6]:
            img = _img(png, 12 * cm)
            if img:
                out += [img, Paragraph(f"图：{_esc_xml(cap)}", ST["caption"]), Spacer(1, 0.5 * cm)]
    else:
        out.append(_boxed(Paragraph("未生成箱线图（数值列或低基数类别列不足）。", ST["body"])))
        out.append(Spacer(1, 0.2 * cm))

    out.extend(_h2_pair(sec_counter, "与目标的关系", format_style))
    if nar.target_relations:
        # 与 _table_style_standard 中 FONTSIZE=9 对齐，避免表级字号与 Paragraph 10pt/15 leading 不一致导致多行「解读」叠行
        tr_hint_style = ParagraphStyle(
            "_target_rel_hint",
            parent=ST["tbl_cell"],
            fontSize=9,
            leading=13.5,
            wordWrap="CJK",
            splitLongWords=1,
        )
        trows = [
            [
                Paragraph(f"<b>{x}</b>", ST["tbl_head"])
                for x in ("特征", "指标", "值", "排名", "解读")
            ]
        ]
        for t in nar.target_relations[:12]:
            hint = t.narrative_hint[:100] + ("…" if len(t.narrative_hint) > 100 else "")
            # NBSP 在窄列中不利于断行，改为普通空格以免 CJK 折行异常
            hint = hint.replace("\u00a0", " ")
            trows.append([
                Paragraph(_esc_xml(t.feature), ST["tbl_cell"]),
                Paragraph(_esc_xml(t.metric.value), ST["tbl_cell"]),
                Paragraph(f"{t.value:.4f}", ST["tbl_num"]),
                Paragraph(str(t.rank), ST["tbl_num"]),
                Paragraph(_esc_xml(hint), tr_hint_style),
            ])
        tt = Table(trows, colWidths=_col_widths_pt_from_cm_parts([4.0, 3.2, 2.0, 1.2, 5.6]))
        tt.setStyle(_table_style_standard(BRAND_BLUE, header_rows=1))
        tt.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEADING", (0, 0), (-1, -1), 13.5),
                ]
            )
        )
        out += [tt, Spacer(1, 0.2 * cm)]
    else:
        out.append(_boxed(Paragraph("未配置目标列或无法计算与目标的关系。", ST["body"])))
    out.append(Spacer(1, 0.2 * cm))

    out.extend(_h2_pair(sec_counter, "冗余与多重共线性（含 VIF）", format_style))
    if nar.multicollinearity:
        for mc in nar.multicollinearity:
            out.append(_boxed(Paragraph(f"• {_esc_xml(mc.note)}", ST["body_j"])))
    else:
        out.append(_boxed(Paragraph("未检测到明显多重共线性信号，或数值列不足以估计 VIF。", ST["body"])))
    out.append(Spacer(1, 0.2 * cm))

    out.extend(_h2_pair(sec_counter, "缺失与目标的统计关联", format_style))
    if nar.missing_vs_target:
        for mv in nar.missing_vs_target[:12]:
            out.append(_boxed(Paragraph(f"• {_esc_xml(mv.narrative_hint)}", ST["body_j"])))
    else:
        out.append(_boxed(Paragraph("未发现缺失与目标在常规显著性水平下的显著关联，或各列无缺失。", ST["body"])))
    out.append(Spacer(1, 0.2 * cm))

    out.extend(_h2_pair(sec_counter, "数据侧关键发现", format_style))
    for line in nar.bullets.findings:
        out.append(_boxed(Paragraph(f"• {_esc_xml(line)}", ST["body_j"])))
    out.append(Spacer(1, 0.2 * cm))

    out.extend(_h2_pair(sec_counter, "使用局限", format_style))
    for line in nar.bullets.caveats:
        out.append(_boxed(Paragraph(f"• {_esc_xml(line)}", ST["body_j"])))
    out.append(Spacer(1, 0.3 * cm))
    return out


def _kv_table(data, format_style: str = "default"):
    ST = get_styles(_current_cn_font, format_style)
    rows = [
        [
            Paragraph(f"<b>{_esc_xml(str(k))}</b>", ST["tbl_cell"]),
            Paragraph(_esc_xml(str(v)), ST["tbl_cell"]),
        ]
        for k, v in data.items()
    ]
    t = Table(rows, colWidths=_col_widths_pt_from_cm_parts([5.0, 11.0]))
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), GRAY_BG),
                ("TEXTCOLOR", (0, 0), (-1, -1), TEXT_DARK),
                ("GRID", (0, 0), (-1, -1), 0.55, GRAY_LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("FONTNAME", (0, 0), (-1, -1), _current_cn_font),
            ]
        )
    )
    return t

def _metrics_table(metrics, format_style: str = "default"):
    ST = get_styles(_current_cn_font, format_style)
    filtered = {k: v for k, v in metrics.items() if k not in _INTERNAL_KEYS and isinstance(v, (int, float))}
    if not filtered:
        return None
    rows = [
        [
            Paragraph("<b>指标</b>", ST["tbl_head"]),
            Paragraph("<b>数值</b>", ST["tbl_head"]),
            Paragraph("<b>水平</b>", ST["tbl_head"]),
            Paragraph("<b>说明</b>", ST["tbl_head"]),
        ]
    ]
    for k, v in filtered.items():
        expl = METRIC_EXPLAIN.get(k, "")
        if len(expl) > 120:
            expl = expl[:120] + "…"
        rows.append(
            [
                Paragraph(f"<b>{_esc_xml(k.upper())}</b>", ST["tbl_cell"]),
                Paragraph(f"{float(v):.4f}", ST["tbl_num"]),
                Paragraph(_metric_level(k, float(v)), ST["tbl_cell"]),
                Paragraph(_esc_xml(expl), ST["tbl_cell"]),
            ]
        )
    t = Table(rows, colWidths=_col_widths_pt_from_cm_parts([2.6, 2.4, 2.2, 8.8]))
    t.setStyle(_table_style_standard(BRAND_BLUE, header_rows=1))
    return t


def _model_params_table(params, format_style: str = "default"):
    """P0-07: 模型参数表格改为三列布局（参数名|值|说明）"""
    ST = get_styles(_current_cn_font, format_style)
    rows = [
        [
            Paragraph("<b>参数名</b>", ST["tbl_head"]),
            Paragraph("<b>当前值</b>", ST["tbl_head"]),
            Paragraph("<b>说明</b>", ST["tbl_head"]),
        ]
    ]
    for k, v in params.items():
        if k.startswith("_"):
            continue
        explain = XGBOOST_PARAM_EXPLAIN.get(k, "")
        rows.append(
            [
                Paragraph(f"<b>{_esc_xml(str(k))}</b>", ST["tbl_cell"]),
                Paragraph(_esc_xml(str(v)), ST["tbl_num"]),
                Paragraph(_esc_xml(explain) if explain else "—", ST["tbl_cell"]),
            ]
        )
    t = Table(rows, colWidths=_col_widths_pt_from_cm_parts([3.2, 3.0, 9.8]))
    t.setStyle(_table_style_standard(BRAND_BLUE, header_rows=1))
    return t


def _appendix_repro_flowables(
    params: dict,
    record: Model,
    ds_name: str,
    split: DatasetSplit | None,
    ST: dict,
) -> list:
    """附录 C：完整参数字典 + 可运行骨架代码（无省略号、无「打码」截断）。"""
    from reportlab.lib.styles import getSampleStyleSheet

    out: list = []
    params_clean = {k: v for k, v in params.items() if not str(k).startswith("_")}
    prov: dict = {}
    if record.provenance_json:
        try:
            prov = json.loads(record.provenance_json)
        except Exception:
            prov = {}
    seed = prov.get("split_random_seed")
    if seed is None and split is not None:
        seed = getattr(split, "random_seed", None)

    out.append(
        _boxed(
            Paragraph(
                "<b>附录 C 说明：</b>下列代码中的 <b>PARAMS</b> 与本记录 <b>params_json</b> 一致（已排除以下划线开头的内部字段）。"
                "复现需在本地准备与 Studio <b>相同的特征列顺序</b>、<b>缺失填充规则</b>及<b>训练/验证/测试划分</b>。",
                ST["body_j"],
            )
        )
    )
    out.append(Spacer(1, 0.15 * cm))
    out.append(
        _boxed(
            Paragraph(
                "<b>建议复现步骤：</b>（1）按数据工作台导出与模型关联的划分，重建 <b>X_train, y_train</b> 等矩阵；"
                "（2）使用下述 <b>PARAMS</b> 构造 <b>XGBClassifier</b> 或 <b>XGBRegressor</b>；"
                "（3）若当时启用 <b>early_stopping_rounds</b>，请在 <b>fit</b> 中传入相同的 <b>eval_set</b>；"
                "（4）在 hold-out 测试集上对比本文<b>评估指标</b>。",
                ST["body_j"],
            )
        )
    )
    out.append(Spacer(1, 0.22 * cm))

    cls_name = "XGBClassifier" if record.task_type == "classification" else "XGBRegressor"
    payload = json.dumps(params_clean, ensure_ascii=False, indent=2)
    if len(payload) > 14000:
        payload = json.dumps(params_clean, ensure_ascii=False, separators=(",", ":"))
        out.append(
            _boxed(
                Paragraph(
                    "<b>注：</b>参数字典较长，下列 JSON 已使用紧凑格式写出，键值与附录 B 一致。",
                    ST["small"],
                )
            )
        )
        out.append(Spacer(1, 0.1 * cm))

    code = (
        f"# -*- coding: utf-8 -*-\n"
        f"# 数据集：{ds_name}\n"
        f"# 任务类型：{record.task_type}\n"
        f"# 建议 DatasetSplit.random_seed（与 Studio 划分一致时）：{seed}\n"
        f"# model_id（数据库）: {record.id}\n\n"
        "import json\n"
        "import xgboost as xgb\n\n"
        f"PARAMS = json.loads({payload!r})\n\n"
        f"model = xgb.{cls_name}(**PARAMS)\n"
        "# 示例（需替换为真实矩阵）：\n"
        "# model.fit(X_train, y_train, eval_set=[(X_valid, y_valid)], verbose=False)\n"
        "# y_pred = model.predict(X_test)\n"
    )
    # 使用正文中文字体而非 Courier：注释里的中文在 PDF 中否则会显示为方块（误似「打码」）
    code_style = ParagraphStyle(
        "xs_appendix_code",
        parent=getSampleStyleSheet()["Normal"],
        fontName=_current_cn_font,
        fontSize=8,
        leading=11,
        textColor=TEXT_DARK,
        backColor=colors.HexColor("#f4f4f5"),
        leftIndent=8,
        rightIndent=8,
        spaceBefore=6,
        spaceAfter=8,
    )
    out.append(Preformatted(code, code_style, maxLineLength=96))
    return out


def _header_footer(canvas, doc):
    canvas.saveState()
    w,h = A4
    if doc.page == 1:
        try:
            canvas.showOutline()
        except Exception:
            pass
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
        if ol=="high": paras.append("<b>【注意】过拟合预警：</b>训练集与验证集指标差距较大，建议降低模型复杂度或增加训练数据后再部署。")
        elif ol=="medium": paras.append("训练集与验证集指标存在轻微差距，建议适当增加正则化参数以提升泛化能力。")
        else: paras.append("<b>【结论】</b>模型泛化能力良好，训练集与验证集指标接近，无明显过拟合迹象。")
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
                f"【注意】当前 AUC（{auc:.4f}）低于建议阈值 {CLASSIFICATION_AUC_DEPLOY_THRESHOLD}，"
                "不宜将「上线试验」作为近期目标；优先补充特征、检查标签与样本、或调参后再评估。"
            )
        elif acc >= 0.9 and auc >= 0.9:
            advice.append("【结论】性能优秀，可在小范围业务场景中先行 A/B 测试验证效果。")
        elif acc >= 0.75:
            advice.append(
                "【评估】性能良好，可考虑在非关键场景试点；若精确率要求高，建议调整预测阈值（当前默认 0.5）。"
            )
        else:
            advice.append("【注意】性能有待提升：增加训练数据、优化特征工程或使用 Optuna 自动调参。")
        advice.append("【建议】建立模型监控机制，定期用新数据重评估，注意数据分布漂移。")
    else:
        r2 = float(metrics.get("r2", 0))
        if r2 < REGRESSION_R2_DEPLOY_THRESHOLD:
            advice.append(
                f"【注意】当前 R²（{r2:.4f}）低于建议阈值 {REGRESSION_R2_DEPLOY_THRESHOLD}，"
                "不宜将「用于实际预测场景」作为结论；请先提升数据质量、特征或模型再评估。"
            )
        elif r2 >= 0.85:
            advice.append("【结论】拟合效果优秀，R² 较高，在业务误差容忍度允许时可进入试点应用。")
        elif r2 >= 0.6:
            advice.append("【评估】具备基础预测能力，建议检查未被捕捉的交互特征或非线性关系。")
        else:
            advice.append("【注意】拟合效果不理想：检查数据质量、增加特征工程或增大数据量。")
        advice.append("【建议】请结合具体业务场景设定可接受的 RMSE/MAE 阈值，而非仅依赖 R² 判断。")
    advice.append(
        "【说明】免责声明：本报告由机器学习模型自动生成，预测结果仅供参考，最终决策应结合领域专家判断。"
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


def _g3_chapter_h1_flowables(
    sec_counter: list,
    ch_key: str,
    format_style: str,
    accent_color,
) -> list:
    """G3-C：与书签一致的章标题（带强调分隔线），并同步一、二级标题计数。"""
    sec_counter[0] += 1
    sec_counter[1] = 0
    ST = get_styles(_current_cn_font, format_style)
    title = CHAPTER_12_TITLES.get(ch_key, ch_key)
    ac = accent_color or BRAND_BLUE
    return [
        Paragraph(title, ST["h1"]),
        HRFlowable(width="100%", thickness=2, color=ac, spaceAfter=8),
    ]


def _resolve_tuning_task(db, model_record: Model) -> tuple[TuningTask | None, dict | None]:
    """由运行档案 tuning_task_id 或 model_id 回查已完成调优任务，解析 diagnostics JSON。"""
    tid = None
    raw = getattr(model_record, "provenance_json", None)
    if raw:
        try:
            prov = json.loads(raw)
            tid = prov.get("tuning_task_id")
        except Exception:
            pass
    task = None
    if tid:
        task = db.query(TuningTask).filter(TuningTask.id == str(tid)).first()
    if task is None:
        task = (
            db.query(TuningTask)
            .filter(TuningTask.model_id == model_record.id, TuningTask.status == "completed")
            .order_by(TuningTask.completed_at.desc())
            .first()
        )
    if not task or not task.tuning_diagnostics_json:
        return task, None
    try:
        return task, json.loads(task.tuning_diagnostics_json)
    except Exception:
        return task, None


def _short_params_for_cell(params: dict | None, max_chars: int = 140) -> str:
    if not params:
        return "-"
    parts: list[str] = []
    for k in sorted(params.keys(), key=str):
        if str(k).startswith("_"):
            continue
        v = params[k]
        parts.append(f"{k}={v}")
    s = "，".join(parts)
    if len(s) <= max_chars:
        return s
    return s[: max_chars - 1] + "…"


def _tuning_process_flowables(
    task: TuningTask | None,
    diag: dict,
    narrative_depth: str,
    sec_counter: list,
    format_style: str,
) -> list:
    ST = get_styles(_current_cn_font, format_style)
    out: list = []
    out.extend(_h2_pair(sec_counter, "超参数调优过程摘要", format_style))
    detailed = (narrative_depth or "").lower() == "detailed"
    strat = (getattr(task, "strategy", None) or diag.get("strategy") or "-") if task else (diag.get("strategy") or "-")
    n_req = diag.get("n_trials_requested")
    if n_req is None and task is not None:
        n_req = getattr(task, "n_trials", None)
    n_done = diag.get("n_trials_completed", "-")
    n_fail = diag.get("n_trials_failed", "-")
    direction = diag.get("direction") or ""
    direction_cn = "越大越好（分类典型为 AUC 等）" if direction == "maximize" else "越小越好（回归典型为 RMSE 等）"
    intro = (
        f"本模型经 <b>Optuna</b> 自动调优（策略 <b>{_esc_xml(str(strat))}</b>），优化方向为 <b>{direction_cn}</b>；"
        f"请求 trial 数 <b>{n_req}</b>，完成 <b>{n_done}</b>，失败 <b>{n_fail}</b>。"
    )
    if diag.get("tuning_methodology") == "5_phase_hierarchical":
        intro += (
            " 采用产品内置的<b>五阶段分层搜索</b>：依次侧重迭代次数与学习率、树结构复杂度、"
            "行/列采样、正则化与收尾精细化，每阶段最优参数固定后传入下一阶段。"
        )
    out.append(_boxed(Paragraph(intro, ST["body_j"])))
    out.append(Spacer(1, 0.12 * cm))

    phases: list = diag.get("phase_records") or []
    if phases:
        hdr = [
            Paragraph("<b>阶段</b>", ST["tbl_head"]),
            Paragraph("<b>目标</b>", ST["tbl_head"]),
            Paragraph("<b>Trial</b><br/>计划/完成/失败", ST["tbl_head"]),
            Paragraph("<b>阶段最优分</b>", ST["tbl_head"]),
            Paragraph("<b>较上阶段提升</b>", ST["tbl_head"]),
            Paragraph("<b>阶段最优参数摘要</b>", ST["tbl_head"]),
        ]
        rows: list = [hdr]
        for pr in phases:
            nt = pr.get("n_trials", "-")
            nc = pr.get("n_completed", "-")
            nf = pr.get("n_failed", "-")
            trial_cell = f"{nt} / {nc} / {nf}"
            imp = pr.get("effect_improvement")
            imp_s = f"{imp:.4f}" if isinstance(imp, (int, float)) else ("—" if imp is None else str(imp))
            bs = pr.get("best_score")
            bs_s = f"{float(bs):.4f}" if isinstance(bs, (int, float)) else ("—" if bs is None else str(bs))
            bp = pr.get("best_params") or {}
            rows.append(
                [
                    Paragraph(_esc_xml(str(pr.get("phase_name", "-"))), ST["tbl_cell"]),
                    Paragraph(_esc_xml(str(pr.get("phase_goal", "-"))), ST["tbl_cell"]),
                    Paragraph(_esc_xml(trial_cell), ST["tbl_num"]),
                    Paragraph(_esc_xml(bs_s), ST["tbl_num"]),
                    Paragraph(_esc_xml(imp_s), ST["tbl_num"]),
                    Paragraph(_esc_xml(_short_params_for_cell(bp if isinstance(bp, dict) else {})), ST["tbl_cell"]),
                ]
            )
        ph_tbl = Table(rows, colWidths=_col_widths_pt_from_cm_parts([2.2, 3.2, 2.0, 2.0, 2.0, 3.6]))
        ph_tbl.setStyle(_table_style_standard(BRAND_BLUE, header_rows=1))
        out.append(ph_tbl)
        out.append(Spacer(1, 0.15 * cm))

    if task is not None and task.best_score is not None:
        out.append(
            _boxed(
                Paragraph(
                    f"<b>调优轨迹上的最优得分（与 Optuna 目标一致）：</b>{float(task.best_score):.4f}。",
                    ST["body_j"],
                )
            )
        )
        out.append(Spacer(1, 0.1 * cm))

    if detailed and phases:
        out.append(
            _boxed(
                Paragraph(
                    "<b>Trial 抽样（每阶段至多 10 条；完整 trial 请在系统「超参数调优」中查看对应任务）：</b>",
                    ST["small"],
                )
            )
        )
        out.append(Spacer(1, 0.08 * cm))
        max_trials_per_phase = 10
        for pr in phases:
            pid = pr.get("phase_id", "")
            pname = pr.get("phase_name", "")
            trials = [t for t in (pr.get("trials") or []) if not t.get("trial_failed")][:max_trials_per_phase]
            if not trials:
                continue
            out.append(_boxed(Paragraph(f"<b>{_esc_xml(str(pname))}</b>（阶段 {pid}）", ST["body_j"])))
            subh = [
                Paragraph("<b>Trial#</b>", ST["tbl_head"]),
                Paragraph("<b>得分</b>", ST["tbl_head"]),
                Paragraph("<b>参数摘要</b>", ST["tbl_head"]),
            ]
            subrows: list = [subh]
            for tr in trials:
                params = tr.get("params") or {}
                subrows.append(
                    [
                        Paragraph(str(tr.get("trial", "-")), ST["tbl_num"]),
                        Paragraph(
                            _esc_xml(f"{float(tr['score']):.4f}" if tr.get("score") is not None else "-"),
                            ST["tbl_num"],
                        ),
                        Paragraph(_esc_xml(_short_params_for_cell(params, max_chars=200)), ST["tbl_cell"]),
                    ]
                )
            st = Table(subrows, colWidths=_col_widths_pt_from_cm_parts([1.5, 2.0, 12.5]))
            st.setStyle(_table_style_standard(BRAND_DARK, header_rows=1))
            out.append(st)
            out.append(Spacer(1, 0.12 * cm))

    out.append(Spacer(1, 0.15 * cm))
    return out


def _modeling_path_no_tuning_flowables(model_record: Model, sec_counter: list, format_style: str) -> list:
    """无可用调优诊断时：说明单次训练 / 手工参数路径。"""
    ST = get_styles(_current_cn_font, format_style)
    out: list = []
    out.extend(_h2_pair(sec_counter, "建模路径说明", format_style))
    prov: dict = {}
    if model_record.provenance_json:
        try:
            prov = json.loads(model_record.provenance_json)
        except Exception:
            pass
    src = prov.get("source")
    if src == "tuning":
        out.append(
            _boxed(
                Paragraph(
                    "本模型在运行档案中标记为<b>自动调优</b>来源，但未找到可解析的调优诊断数据；"
                    "以下表格仍为本次固化到模型的最终超参数，可作为复现依据。",
                    ST["body_j"],
                )
            )
        )
    else:
        out.append(
            _boxed(
                Paragraph(
                    "本模型为<b>单次训练</b>路径得到：超参数由用户在界面配置或采用系统默认值，"
                    "未经本报告所附的多阶段自动搜索记录。下列表格为本次训练实际使用的 XGBoost 超参数。",
                    ST["body_j"],
                )
            )
        )
    out.append(Spacer(1, 0.15 * cm))
    return out


def _accuracy_narrative_intro_flowables(
    metrics: dict,
    task_type: str,
    eval_result: dict,
    ds_name: str,
    format_style: str,
) -> list:
    ST = get_styles(_current_cn_font, format_style)
    out: list = []
    proto_notes = (eval_result.get("evaluation_protocol") or {}).get("notes_zh")
    has_proto = bool(proto_notes and str(proto_notes).strip())

    if task_type == "classification":
        bits = []
        if metrics.get("auc") is not None:
            bits.append(f"AUC = <b>{float(metrics['auc']):.4f}</b>")
        if metrics.get("accuracy") is not None:
            bits.append(f"Accuracy = <b>{float(metrics['accuracy']):.4f}</b>")
        if metrics.get("f1") is not None:
            bits.append(f"F1 = <b>{float(metrics['f1']):.4f}</b>")
        if bits:
            out.append(
                _boxed(
                    Paragraph(
                        f"<b>准确性概览（当前 hold-out 测试集，数据集「{_esc_xml(ds_name)}」）：</b>"
                        + "，".join(bits)
                        + "。",
                        ST["body_j"],
                    )
                )
            )
    else:
        bits = []
        if metrics.get("r2") is not None:
            bits.append(f"R² = <b>{float(metrics['r2']):.4f}</b>")
        if metrics.get("rmse") is not None:
            bits.append(f"RMSE = <b>{float(metrics['rmse']):.4f}</b>")
        if metrics.get("mae") is not None:
            bits.append(f"MAE = <b>{float(metrics['mae']):.4f}</b>")
        if bits:
            out.append(
                _boxed(
                    Paragraph(
                        f"<b>拟合效果概览（当前 hold-out 测试集，数据集「{_esc_xml(ds_name)}」）：</b>"
                        + "，".join(bits)
                        + "。",
                        ST["body_j"],
                    )
                )
            )

    if not out:
        return []

    follow = (
        "下文提供指标明细与图表：分类任务可结合 ROC/PR 与混淆矩阵理解排序质量与混淆结构；"
        "回归任务可结合残差图观察系统误差。"
        "若报告中包含训练期 K 折结果，可与单次划分对照；学习曲线与过拟合诊断用于辅助判断泛化趋势。"
        "<b>本报告未替代独立的跨时间（OOT）外推验证</b>，若业务需要时间外推，请另行组织验证数据。"
    )
    if has_proto:
        follow = "评估协议说明见上文；" + follow
    out.append(_boxed(Paragraph(follow, ST["body_j"])))
    out.append(Spacer(1, 0.15 * cm))
    return out


def _accuracy_conclusion_flowables(
    metrics: dict,
    task_type: str,
    eval_result: dict,
    sec_counter: list,
    format_style: str,
) -> list:
    ST = get_styles(_current_cn_font, format_style)
    ov = eval_result.get("overfitting_diagnosis") or {}
    lev = ov.get("level") or "low"
    lev_cn = {"high": "高", "medium": "中", "low": "低"}.get(str(lev), str(lev))
    baseline = eval_result.get("baseline")

    sentences: list[str] = []
    if task_type == "classification":
        te = metrics.get("accuracy")
        auc = metrics.get("auc")
        if te is not None:
            sentences.append(f"在<b>当前划分下的测试集</b>上，准确率约为 <b>{float(te):.4f}</b>。")
        if auc is not None:
            sentences.append(f"排序能力（AUC）约为 <b>{float(auc):.4f}</b>，可与 ROC 曲线相互印证。")
    else:
        r2 = metrics.get("r2")
        if r2 is not None:
            sentences.append(f"在<b>当前划分下的测试集</b>上，R² 约为 <b>{float(r2):.4f}</b>。")

    snap_plain = _train_val_snapshot_html(metrics, task_type)
    if snap_plain:
        sentences.append("训练集与测试集核心指标对比见上文快照，用于观察是否明显过拟合。")

    sentences.append(f"过拟合诊断等级为<b>{lev_cn}</b>（见「过拟合诊断」章节）。")

    if baseline and isinstance(baseline, dict):
        sentences.append(
            "与随机基线策略相比的提升见「与随机基线对比」图表，用于说明模型是否优于简单参照。"
        )

    if not sentences:
        return []

    out: list = []
    out.extend(_h2_pair(sec_counter, "准确性分析小结", format_style))
    body = "<b>小结：</b>" + "".join(sentences)
    out.append(_boxed(Paragraph(body, ST["body_j"])))
    out.append(Spacer(1, 0.2 * cm))
    return out


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


MAX_COMPARE_MODELS = 8


def _comparison_metrics_params_flowables(
    models: list,
    ST: dict,
    *,
    metrics_title: str = "一、指标汇总对比",
    params_title: str = "二、训练参数对比",
    chart_caption_fmt: str = "图1：多模型{km}指标对比",
    metrics_hdr_color=BRAND_BLUE,
    params_hr_color=BRAND_BLUE,
    params_table_hdr_color=BRAND_DARK,
) -> list:
    """多模型指标表、柱状图、参数对比表（独立对比报告与主报告附录 D 共用）。"""
    from services import chart_service

    global _current_cn_font
    story: list = []
    # #region agent log
    _agent_debug_ndjson(
        "H3",
        "report_service.py:_comparison_metrics_params_flowables",
        "compare_table_start",
        {"n_models": len(models), "model_ids": [getattr(m, "id", None) for m in models]},
    )
    # #endregion
    story += [Paragraph(metrics_title, ST["h1"]), HRFlowable(width="100%", thickness=1, color=metrics_hdr_color, spaceAfter=10)]
    all_metrics = [json.loads(m.metrics_json or "{}") for m in models]
    model_names = [m.name[:20] for m in models]
    model_names_tbl = [_esc_xml(n) for n in model_names]
    metric_keys = [k for k in ["accuracy", "auc", "f1", "precision", "recall", "rmse", "mae", "r2"] if any(k in md for md in all_metrics)]
    rows: list = [["指标"] + model_names_tbl]
    best_cols: dict[int, int] = {}
    for k in metric_keys:
        row = [Paragraph(k.upper(), ST["kv_key"])]
        vals = []
        for md in all_metrics:
            v = md.get(k)
            # #region agent log
            try:
                _cell = f"{float(v):.4f}" if v is not None else "-"
                _fv = float(v) if v is not None else None
            except (TypeError, ValueError) as _ex:
                _agent_debug_ndjson(
                    "H4",
                    "report_service.py:_comparison_metrics_params_flowables",
                    "metric_float_coerce_failed",
                    {"metric_key": k, "v_repr": repr(v)[:120], "err": type(_ex).__name__},
                )
                raise
            # #endregion
            row.append(Paragraph(_cell, ST["body"]))
            vals.append(_fv)
        valid = [(i, v) for i, v in enumerate(vals) if v is not None]
        if valid:
            bi = min(valid, key=lambda x: x[1])[0] if k in ("rmse", "mae", "log_loss") else max(valid, key=lambda x: x[1])[0]
            best_cols[len(rows)] = bi + 1
        rows.append(row)
    min_col_width = 2.0 * cm
    available_width = _inner_w_pt()
    n_models = len(models)
    first_w = 3.0 * cm
    if n_models <= 0:
        cw = [available_width]
    else:
        rest = max(0.0, available_width - first_w)
        model_col_width = max(min_col_width, rest / n_models)
        cw = [first_w] + [model_col_width] * n_models
        total_w = sum(cw)
        if total_w > available_width and total_w > 0:
            scale = available_width / total_w
            cw = [w * scale for w in cw]
    ct = Table(rows, colWidths=cw)
    ts = [
        ("BACKGROUND", (0, 0), (-1, 0), metrics_hdr_color),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), _current_cn_font),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, BRAND_LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, GRAY_LINE),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for ri, ci in best_cols.items():
        ts += [
            ("BACKGROUND", (ci, ri), (ci, ri), colors.HexColor("#d9f7be")),
            ("TEXTCOLOR", (ci, ri), (ci, ri), colors.HexColor("#135200")),
        ]
    ct.setStyle(TableStyle(ts))
    story += [ct, Paragraph("注：绿色背景列为该指标最优模型", ST["caption"]), Spacer(1, 0.5 * cm)]
    km = metric_keys[0] if metric_keys else "accuracy"
    try:
        cb = chart_service.multi_model_compare_chart(model_names, all_metrics, km)
        im = _img(cb, 14 * cm)
        if im:
            cap = chart_caption_fmt.replace("{km}", str(km).upper())
            story += [im, Paragraph(cap, ST["caption"])]
            story.append(Spacer(1, 0.4 * cm))
    except Exception:
        pass
    story += [Paragraph(params_title, ST["h1"]), HRFlowable(width="100%", thickness=1, color=params_hr_color, spaceAfter=10)]
    all_params = [{k: v for k, v in json.loads(m.params_json or "{}").items() if not k.startswith("_")} for m in models]
    pk = [k for k in ["n_estimators", "max_depth", "learning_rate", "subsample", "colsample_bytree", "reg_alpha", "reg_lambda"] if any(k in p for p in all_params)]
    if pk:
        pr = [["参数"] + model_names_tbl] + [
            [Paragraph(k, ST["kv_key"])] + [Paragraph(str(p.get(k, "-")), ST["body"]) for p in all_params]
            for k in pk
        ]
        pt = Table(pr, colWidths=cw)
        pt.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), params_table_hdr_color),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, -1), _current_cn_font),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f0f2f5")]),
                    ("GRID", (0, 0), (-1, -1), 0.5, GRAY_LINE),
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        story.append(pt)
    return story


def _appendix_compare_model_flowables(
    main: Model,
    compare_ordered: list[Model],
    db,
    ST: dict,
    accent_color,
) -> list:
    """主报告附录 D：口径说明、共用对比表图、McNemar（二分类）或回归相对差异。"""
    # #region agent log
    _agent_debug_ndjson(
        "D0",
        "report_service.py:_appendix_compare_model_flowables",
        "appendix_d_enter",
        {"main_id": main.id, "compare_ids": [m.id for m in compare_ordered]},
    )
    # #endregion

    m_hdr = accent_color or BRAND_BLUE
    p_tbl = accent_color or BRAND_DARK
    story: list = [Spacer(1, 0.28 * cm)]
    h2 = ST.get("h2", ST["body"])
    story.append(_boxed(Paragraph("<b>附录D：对比模型横向评估</b>", h2)))
    story.append(Spacer(1, 0.12 * cm))

    warn_lines = []
    for m in compare_ordered:
        if m.dataset_id != main.dataset_id or m.split_id != main.split_id:
            warn_lines.append(
                f"模型「{_esc_xml(m.name[:24])}」（ID {m.id}）与主模型数据集或划分不一致，"
                f"下列指标为各自 hold-out 结果，横向对比仅供参考。"
            )
    if warn_lines:
        story.append(
            _boxed(
                Paragraph(
                    "<b>口径提示：</b>" + " ".join(warn_lines),
                    ST["warn_text"],
                )
            )
        )
        story.append(Spacer(1, 0.15 * cm))

    models_row = [main] + compare_ordered
    story.extend(
        _comparison_metrics_params_flowables(
            models_row,
            ST,
            metrics_title="（1）指标汇总对比",
            params_title="（2）训练参数对比",
            chart_caption_fmt="附图：多模型{km}指标对比",
            metrics_hdr_color=m_hdr,
            params_hr_color=m_hdr,
            params_table_hdr_color=p_tbl,
        )
    )

    if main.task_type == "classification":
        story.append(Spacer(1, 0.2 * cm))
        story.append(_boxed(Paragraph("<b>（3）主模型 vs 各对比模型（McNemar，二分类适用）</b>", h2)))
        story.append(
            _boxed(
                Paragraph(
                    "在相同测试集、特征列对齐的前提下，可对主模型与各对比模型做 McNemar 等配对检验。"
                    "<b>PDF 生成阶段不执行全量重预测</b>（避免多次加载模型与 predict 导致耗时过长、连接中断）；"
                    "上表（1）（2）已为多模型指标与参数对比。完整 McNemar / 配对检验请在应用内「专家工作台」使用模型对比查看。",
                    ST["body_j"],
                )
            )
        )
        story.append(Spacer(1, 0.1 * cm))
        mcnemar_rows = [
            [
                Paragraph("<b>对比模型</b>", ST["tbl_head"]),
                Paragraph("<b>p 值</b>", ST["tbl_head"]),
                Paragraph("<b>简要结论</b>", ST["tbl_head"]),
            ]
        ]
        for cmp in compare_ordered:
            if cmp.task_type != "classification":
                mcnemar_rows.append(
                    [
                        Paragraph(f"{_esc_xml(cmp.name[:18])} (#{cmp.id})", ST["tbl_cell"]),
                        Paragraph("-", ST["tbl_num"]),
                        Paragraph("任务类型非分类，未做 McNemar。", ST["tbl_cell"]),
                    ]
                )
                continue
            mcnemar_rows.append(
                [
                    Paragraph(f"{_esc_xml(cmp.name[:18])} (#{cmp.id})", ST["tbl_cell"]),
                    Paragraph("-", ST["tbl_num"]),
                    Paragraph("PDF 未计算；请在工作台对比查看。", ST["tbl_cell"]),
                ]
            )
        if len(mcnemar_rows) > 1:
            mt = Table(mcnemar_rows, colWidths=_col_widths_pt_from_cm_parts([4.2, 2.2, 9.6]))
            mt.setStyle(_table_style_standard(m_hdr, header_rows=1))
            story.append(mt)

    elif main.task_type == "regression":
        story.append(Spacer(1, 0.2 * cm))
        story.append(_boxed(Paragraph("<b>（3）相对主模型的指标差异（回归）</b>", h2)))
        main_md = json.loads(main.metrics_json or "{}")
        parts = []
        for cmp in compare_ordered:
            if cmp.task_type != "regression":
                parts.append(f"「{_esc_xml(cmp.name[:16])}」(# {cmp.id})：非回归任务，略。")
                continue
            om = json.loads(cmp.metrics_json or "{}")
            seg = [f"「{_esc_xml(cmp.name[:16])}」(# {cmp.id})："]
            for key, label in (("rmse", "RMSE"), ("mae", "MAE"), ("r2", "R²")):
                bv = main_md.get(key)
                ov = om.get(key)
                if bv is None or ov is None or (isinstance(bv, (int, float)) and bv == 0):
                    continue
                try:
                    bf, of = float(bv), float(ov)
                    if key == "r2":
                        rel = (of - bf) / abs(bf) * 100 if bf != 0 else 0.0
                        seg.append(f"{label} 相对主模型变化约 {rel:+.1f}%；")
                    else:
                        rel = (of - bf) / abs(bf) * 100
                        seg.append(f"{label} 相对主模型变化约 {rel:+.1f}%；")
                except (TypeError, ValueError):
                    continue
            parts.append("".join(seg) if len(seg) > 1 else f"「{_esc_xml(cmp.name[:16])}」：指标不完整，略。")
        if parts:
            story.append(_boxed(Paragraph(" ".join(parts), ST["body_j"])))
        else:
            story.append(_boxed(Paragraph("对比模型缺少可比较的回归指标。", ST["body_j"])))

    return story


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
    compare_model_ids: list[int] | None = None,
):
    from services import chart_service
    from services.eval_service import get_evaluation, get_learning_curve

    # P0-10: 每次生成报告前重新注册字体，失败后可重试
    global _current_cn_font, _report_inner_width_pt
    _current_cn_font = _register_cn_font()
    _report_inner_width_pt = _inner_frame_width_pt_for_format(format_style)

    record = db.query(Model).filter(Model.id==model_id).first()
    if not record: raise HTTPException(status_code=404, detail="模型不存在")
    dataset = db.query(Dataset).filter(Dataset.id==record.dataset_id).first() if record.dataset_id else None
    split   = db.query(DatasetSplit).filter(DatasetSplit.id==record.split_id).first() if record.split_id else None
    gen_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    report_title = title or f"模型报告 - {record.name}"
    ds_name = dataset.name if dataset else "未知数据集"
    params  = json.loads(record.params_json or "{}")
    metrics = json.loads(record.metrics_json or "{}")

    normalized_compare_ids: list[int] = []
    seen_cmp: set[int] = set()
    for x in compare_model_ids or []:
        if not isinstance(x, int) or x == model_id:
            continue
        if x in seen_cmp:
            continue
        seen_cmp.add(x)
        normalized_compare_ids.append(x)
    if len(normalized_compare_ids) > MAX_COMPARE_MODELS:
        raise HTTPException(status_code=400, detail=f"对比模型最多 {MAX_COMPARE_MODELS} 个")
    # 对比模型完整行推迟到附录 D 前再加载，避免与长耗时叙事/图表共用 Session 时序问题（见 debug：有对比时仅打 H1、未到 pre_doc_build）
    if normalized_compare_ids:
        rows_id = db.query(Model.id).filter(Model.id.in_(normalized_compare_ids)).all()
        found_ids = {int(r[0]) for r in rows_id}
        missing_cmp = [i for i in normalized_compare_ids if i not in found_ids]
        if missing_cmp:
            raise HTTPException(status_code=404, detail=f"对比模型不存在: {missing_cmp}")

    # #region agent log
    _agent_debug_ndjson(
        "H1",
        "report_service.py:generate_report",
        "compare_ids_normalized",
        {
            "model_id": model_id,
            "raw_compare_arg_types": [type(x).__name__ for x in (compare_model_ids or [])],
            "normalized_compare_ids": normalized_compare_ids,
            "compare_models_deferred": bool(normalized_compare_ids),
        },
    )
    # #endregion

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

    template_chapters_to_show = TEMPLATE_CHAPTER_SETS.get(
        template_type or "full_12_chapters", CHAPTER_12_KEYS
    )
    bookmarked_ch: set[str] = set()

    def _bm_ch(ch_key: str) -> list:
        if not use_12_chapters or ch_key not in template_chapters_to_show:
            return []
        if ch_key in bookmarked_ch:
            return []
        bookmarked_ch.add(ch_key)
        return [OutlineBookmark(f"xs_{ch_key}", CHAPTER_12_TITLES[ch_key], 0)]

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

    story += _cover_story_pages(
        company_line=company_line,
        report_title=report_title,
        record=record,
        ds_name=ds_name,
        template_label=template_label,
        gen_time=gen_time,
        accent_color=brand_primary_color,
        format_style=format_style,
        metrics=metrics,
        params=params,
        dataset=dataset,
        split=split,
    )

    # -- 方法与指标定义（G2-Auth-4）--
    if "methodology" in sections:
        story.extend(_bm_ch("ch1_executive_summary"))
        story += _h1_pair(sn, "方法与指标定义", format_style)
        for para in methodology_section_paragraphs():
            story.append(_boxed(Paragraph(para, ST["body_j"])))
        story.append(Spacer(1, 0.3 * cm))

    # -- 执行摘要 --
    if "executive_summary" in sections:
        if "methodology" not in sections:
            story.extend(_bm_ch("ch1_executive_summary"))
        story += _h1_pair(sn, "执行摘要", format_style)
        for p in _executive_summary(metrics, record.task_type, ds_name, record.name):
            story.append(_boxed(Paragraph(p, ST["body_j"])))
        story.append(Spacer(1,0.3*cm))

    # -- 数据与变量关系（G2-R1）--
    if "data_relations" in sections:
        story.extend(_bm_ch("ch2_label_dataset"))
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
                story.extend(_data_relations_flowables(nar, pdf_assets, sn, format_style))
            except Exception as ex:
                logger.warning("data_relations 章节生成失败: %s", ex, exc_info=True)
                warn_body = "本章节生成时出现异常，已跳过详细内容。请确认训练集文件可用且划分有效。"
                det = getattr(ex, "detail", None)
                if isinstance(det, str) and det.strip():
                    warn_body += f"（{_esc_xml(det.strip())}）"
                story.append(_boxed(Paragraph(warn_body, ST["warn_text"])))
        else:
            story.append(
                _boxed(
                    Paragraph(
                        "当前模型未关联数据集或划分，无法生成数据关系叙事。",
                        ST["body"],
                    )
                )
            )

    # -- 数据集概览 --
    if "data_overview" in sections:
        story.extend(_bm_ch("ch3_feature_engineering"))
        story += _h1_pair(sn, "数据集概览", format_style)
        story.append(_boxed(Paragraph(
            "<b>解读说明：</b>本节展示数据集基本统计信息，帮助你理解数据规模和质量。"
            "数据质量评分综合了缺失率、异常率和重复率，评分低于 70 建议先做预处理。",
            ST["body_j"],
        )))
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
        story.extend(_bm_ch("ch4_modeling_tuning"))
        if use_12_chapters and "ch4_modeling_tuning" in template_chapters_to_show:
            story += _g3_chapter_h1_flowables(sn, "ch4_modeling_tuning", format_style, brand_primary_color)
        else:
            story += _h1_pair(sn, "模型训练参数", format_style)
        story.append(_boxed(Paragraph(
            "<b>解读说明：</b>本节记录模型训练时的所有超参数配置。"
            "完整参数记录保证结果可复现，便于后续对比分析。"
            "如果你对某个参数含义不清楚，可以在前端参数配置页面点击 [?] 按钮查看详细解释。",
            ST["body_j"],
        )))
        story.append(Spacer(1, 0.2 * cm))
        minfo = {"模型名称": record.name,"任务类型": "分类" if record.task_type=="classification" else "回归",
                 "训练耗时": f"{record.training_time_s:.1f} 秒" if record.training_time_s else "-",
                 "创建时间": str(record.created_at)[:19]}
        if split:
            minfo["数据划分策略"] = getattr(split, "split_strategy", None) or "random"
            if getattr(split, "time_column", None):
                minfo["时间列（时序划分）"] = split.time_column
            if record.cv_k:
                minfo["训练期 K 折"] = f"K={record.cv_k}（各折指标见评估章节）"
        story.append(_kv_table(minfo, format_style))
        tun_task, tun_diag = _resolve_tuning_task(db, record)
        if tun_diag:
            story.extend(
                _tuning_process_flowables(
                    tun_task,
                    tun_diag,
                    narrative_depth or "standard",
                    sn,
                    format_style,
                )
            )
        else:
            story.extend(_modeling_path_no_tuning_flowables(record, sn, format_style))
        if params:
            story.extend(_h2_pair(sn, "XGBoost 超参数配置", format_style))
            story.append(Spacer(1, 0.2 * cm))
            # P0-07: 改为三列布局（参数名|值|说明）
            pt = _model_params_table({k:v for k,v in params.items() if not k.startswith("_")}, format_style)
            story.append(pt)
            story.append(Spacer(1, 0.3 * cm))
        ne = params.get("n_estimators")
        bi = metrics.get("best_iteration")
        if ne is not None and bi is not None:
            story.append(
                _boxed(
                    Paragraph(
                        f"<b>树棵数说明：</b>配置的最大树棵数为 <b>{ne}</b>，"
                        f"实际有效提升轮次（best_iteration）约为 <b>{int(bi)}</b>（0-based，与 XGBoost 一致）。",
                        ST["body_j"],
                    )
                )
            )
            story.append(Spacer(1, 0.15 * cm))
        story.extend(_runtime_brief_flowables(record, split, sn, format_style))

    # -- 评估指标 --
    if "evaluation" in sections:
        story.extend(_bm_ch("ch5_model_accuracy"))
        if use_12_chapters and "ch5_model_accuracy" in template_chapters_to_show:
            story += _g3_chapter_h1_flowables(sn, "ch5_model_accuracy", format_style, brand_primary_color)
        else:
            story += _h1_pair(sn, "模型评估结果", format_style)
        story.extend(
            _accuracy_narrative_intro_flowables(metrics, record.task_type, eval_result, ds_name, format_style)
        )
        story.append(_boxed(Paragraph(
            "<b>解读说明：</b>下表为<b>测试集（hold-out）</b>上的各项<b>评估指标</b>，"
            "每项附<b>含义</b>与<b>水平评级</b>。"
            "<b>95% 置信区间</b>反映估计不确定性，区间越窄越可靠。"
            "<b>评级参考：</b>分类任务 <b>Accuracy/AUC</b> &gt; 0.85 为优秀，0.75–0.85 良好，&lt; 0.75 待提升；"
            "回归任务 <b>R²</b> &gt; 0.75 为优秀，0.5–0.75 良好，&lt; 0.5 待提升。",
            ST["body_j"],
        )))
        story.append(Spacer(1, 0.2 * cm))
        _proto = eval_result.get("evaluation_protocol") or {}
        if _proto.get("notes_zh"):
            story.append(_boxed(Paragraph(_proto["notes_zh"], ST["body_j"])))
        story.append(_boxed(Paragraph(
            "<b>口径提示：</b>指标定义与局限见前文<b>「方法与指标定义」</b>；"
            "表中数值均来自<b>单次 hold-out</b>划分下的<b>测试集</b>，非交叉验证汇总。",
            ST["body_j"],
        )))
        snap = _train_val_snapshot_html(metrics, record.task_type)
        if snap:
            story.append(_boxed(Paragraph(snap, ST["body_j"])))
            story.append(Spacer(1, 0.12 * cm))
        cv_block = eval_result.get("cv_kfold")
        if cv_block and cv_block.get("fold_metrics"):
            story.extend(_h2_pair(sn, "训练期 K 折交叉验证", format_style))
            summ = cv_block.get("summary") or {}
            mean_bits = [f"{k}={v:.4f}" for k, v in summ.items() if k.endswith("_mean") and isinstance(v, (int, float))]
            if mean_bits:
                story.append(
                    _boxed(
                        Paragraph("<b>各折汇总（均值类字段）：</b>" + "，".join(mean_bits[:8]), ST["small"])
                    )
                )
            story.append(_cv_fold_table(cv_block, format_style))
            story.append(Spacer(1, 0.2 * cm))
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
                    story.append(Spacer(1, 0.28 * cm))
            except Exception: pass
        if "evaluation" in sections:
            thr = eval_result.get("threshold_metrics")
            if thr:
                story.extend(_h2_pair(sn, "分类阈值敏感性（测试集）", format_style))
                story.append(
                    _boxed(
                        Paragraph(
                            "不同概率阈值下精确率、召回率、F1 的折中关系，可按业务偏好在精确率与召回率之间选取截断点。",
                            ST["body_j"],
                        )
                    )
                )
                story.append(Spacer(1, 0.1 * cm))
                story.append(_threshold_metrics_table(thr, format_style))
                story.append(Spacer(1, 0.2 * cm))
            cal = eval_result.get("calibration")
            if cal and cal.get("brier_score") is not None:
                story.append(
                    _boxed(
                        Paragraph(
                            f"<b>概率校准：</b>测试集 Brier 分数 <b>{cal['brier_score']}</b>（越接近 0 越好），"
                            "可与业务对概率可信度的要求一并评估。",
                            ST["body_j"],
                        )
                    )
                )
                story.append(Spacer(1, 0.15 * cm))
        res_data = eval_result.get("residuals")
        if res_data:
            try:
                cb = chart_service.residual_scatter_chart(res_data["predicted"],res_data["values"])
                im = _img(cb, 14*cm)
                if im:
                    story += [im, Paragraph("图3：残差分析", ST["caption"])]
                    story.append(Spacer(1, 0.4*cm))
            except Exception: pass

    if "evaluation" in sections:
        story.extend(_accuracy_conclusion_flowables(metrics, record.task_type, eval_result, sn, format_style))

    # -- SHAP --
    if "shap" in sections:
        story.extend(_bm_ch("ch6_interpretability"))
        shap_data = eval_result.get("shap_summary",[])
        if shap_data:
            story += _h1_pair(sn, "特征重要性分析（SHAP）", format_style)
            story.append(_boxed(Paragraph(
                "<b>解读说明：</b>SHAP 是一种先进的可解释性方法，它量化每个特征对模型预测结果的平均贡献。"
                "SHAP 值的绝对值越大，表示该特征对预测结果的影响越大。"
                "XGBoost 内置的特征重要性衡量特征在分裂中的增益，与 SHAP 结论互补。",
                ST["body_j"],
            )))
            story.append(Spacer(1, 0.2 * cm))
            story.append(_boxed(Paragraph("SHAP 值量化每个特征对预测的平均贡献，绝对值越大影响越显著。", ST["body_j"])))
            try:
                feats=[d["feature"] for d in shap_data[:10]]; imps=[d["importance"] for d in shap_data[:10]]
                cb = chart_service.shap_bar_chart(feats, imps)
                im = _img(cb, 13*cm)
                # P1-03: 调整间距，P1-04: 增加图表下方留白
                if im:
                    story += [im, Paragraph("图6：SHAP特征重要性 Top10", ST["caption"])]
                    story.append(Spacer(1, 0.5 * cm))  # P1-03: 增加间距到 0.5cm，表格放图表下方
            except Exception: pass
            rows = [
                [
                    Paragraph("<b>排名</b>", ST["tbl_head"]),
                    Paragraph("<b>特征名称</b>", ST["tbl_head"]),
                    Paragraph("<b>平均|SHAP|</b>", ST["tbl_head"]),
                    Paragraph("<b>重要程度</b>", ST["tbl_head"]),
                ]
            ]
            for i, d in enumerate(shap_data[:10], 1):
                lv = "高" if i <= 3 else ("中" if i <= 6 else "低")
                rows.append(
                    [
                        Paragraph(str(i), ST["tbl_num"]),
                        Paragraph(_esc_xml(str(d["feature"])), ST["tbl_cell"]),
                        Paragraph(f"{d['importance']:.4f}", ST["tbl_num"]),
                        Paragraph(lv, ST["tbl_cell"]),
                    ]
                )
            st2 = Table(rows, colWidths=_col_widths_pt_from_cm_parts([1.5, 8.0, 3.0, 2.5]))
            st2.setStyle(_table_style_standard(BRAND_BLUE, header_rows=1))
            story += [st2, Spacer(1, 0.28 * cm)]

    # -- 学习曲线 --
    if "learning_curve" in sections:
        try:
            lc = get_learning_curve(model_id, db)
            if lc and lc.get("sample_counts"):
                story += _h1_pair(sn, "学习曲线分析", format_style)
                story.append(_boxed(Paragraph(
                    "<b>解读说明：</b>学习曲线展示模型性能随训练样本量增加的变化趋势。"
                    "如果训练分数和验证分数随着样本量增加逐渐收敛到一起，说明模型容量适合当前数据；"
                    "如果训练分数很高但验证分数始终很低，说明模型存在过拟合。",
                    ST["body_j"],
                )))
                story.append(Spacer(1, 0.2 * cm))
                story.append(_boxed(Paragraph("学习曲线展示模型随训练样本量增加的性能变化。两曲线趋于收敛说明模型已充分学习；持续差距较大提示过拟合。", ST["body_j"])))
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
            story.append(_boxed(Paragraph(
                "<b>解读说明：</b>过拟合是指模型在训练集上表现很好，但在测试集/新数据上泛化能力差。"
                "诊断依据是训练集和验证集之间的性能差距：差距越大，过拟合越严重。"
                "解决过拟合的常用方法：增加训练数据、增大正则化（reg_lambda）、减小 max_depth、早停。",
                ST["body_j"],
            )))
            story.append(Spacer(1, 0.2 * cm))
            # 按风险等级：浅色底 + 彩色边框（避免大块实心红底）；高危前加红色「!」替代易乱码的符号
            lv = ov.get("level", "low")
            message = (ov.get("message") or "").strip()
            level_border = {"high": DANGER, "medium": WARNING, "low": SUCCESS}
            level_fill = {
                "high": colors.HexColor("#fff2f0"),
                "medium": colors.HexColor("#fff7e6"),
                "low": colors.HexColor("#f6ffed"),
            }
            border_c = level_border.get(lv, SUCCESS)
            fill_c = level_fill.get(lv, level_fill["low"])
            body_xml = _esc_xml(message)
            if lv == "high":
                body_xml = (
                    f'<font color="#cf1322"><b>!</b></font> {body_xml}'
                )
            diag_rows = [[Paragraph(body_xml, ST["body_j"])]]
            diag_table = Table(diag_rows, colWidths=[_inner_w_pt()])
            diag_table.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, -1), fill_c),
                        ("TEXTCOLOR", (0, 0), (-1, -1), TEXT_DARK),
                        ("BOX", (0, 0), (-1, -1), 1.2, border_c),
                        ("FONTNAME", (0, 0), (-1, -1), _current_cn_font),
                        ("FONTSIZE", (0, 0), (-1, -1), 11),
                        ("LEFTPADDING", (0, 0), (-1, -1), 12),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                        ("TOPPADDING", (0, 0), (-1, -1), 10),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                        ("ROUNDED", (0, 0), (-1, -1), 3),
                    ]
                )
            )
            story.append(diag_table)
            story.append(Spacer(1, 0.3 * cm))

            if ov.get("early_stopped"):
                story.append(
                    _boxed(
                        Paragraph(
                            f"【早停】训练在第 {ov.get('best_round')} 轮触发早停，自动保护了模型泛化能力。",
                            ST["body"],
                        )
                    )
                )
            story.append(Spacer(1, 0.2 * cm))

    # -- 基线对比 --
    if "baseline" in sections:
        baseline = eval_result.get("baseline")
        if baseline:
            story += _h1_pair(sn, "与随机基线对比", format_style)
            story.append(_boxed(Paragraph(f"与策略\"{baseline.get('strategy','均值/多数类预测')}\"相比，本模型的提升如下：", ST["body"])))
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
            story.extend(_bm_ch("ch8_business_application"))
            story += [
                Paragraph(CHAPTER_12_TITLES["ch8_business_application"], ST["h1"]),
                HRFlowable(width="100%", thickness=2, color=brand_primary_color or BRAND_BLUE, spaceAfter=8),
            ]
        else:
            story += _h1_pair(sn, "业务建议", format_style)
        for line in _business_advice(metrics, record.task_type):
            story.append(_boxed(Paragraph(line, ST["body"])))

    # G3-C: 第7章 模型合规性与风险分析
    if use_12_chapters and "ch7_risk_compliance" in sections:
        story.extend(_bm_ch("ch7_risk_compliance"))
        story += [
            Paragraph(CHAPTER_12_TITLES["ch7_risk_compliance"], ST["h1"]),
            HRFlowable(width="100%", thickness=2, color=brand_primary_color or BRAND_BLUE, spaceAfter=8),
        ]
        task_cn = "分类" if record.task_type == "classification" else "回归"
        risk_items = [
            ("P0-数据风险", f"数据集 {ds_name} 的数据质量直接影响模型可靠性，已通过 XGBoost Studio 数据分析模块进行质量评估。"),
            ("P1-泛化风险", f"模型在 {ds_name} 上训练，在时间/场景外推时存在性能衰减风险，建议进行 OOT 跨时间集验证。"),
            ("P1-业务风险", f"本{task_cn}模型的预测结果仅为辅助决策依据，最终业务决策应结合领域专家判断。"),
            ("P2-合规风险", "如涉及个人信息处理，请确保符合《个人信息保护法》等相关法规要求。"),
        ]
        for risk_level, risk_desc in risk_items:
            story.append(_boxed(Paragraph(f"<b>[{risk_level}]</b> {risk_desc}", ST["body"])))
            story.append(Spacer(1, 0.2 * cm))

        # 生命周期建议
        story.append(_boxed(Paragraph("<b>模型生命周期管理建议</b>", ST["h2"] if "h2" in ST else ST["body"])))
        lifecycle_advice = [
            "建议在生产环境中部署后，按月监控模型关键指标（PSI、KS）的变化趋势。",
            f"当 PSI > 0.25 或 KS 下降超过 20% 时，触发模型重训练流程。",
            "建议每季度进行一次全量 OOT 验证，评估模型在最新数据上的表现。",
        ]
        for advice in lifecycle_advice:
            story.append(_boxed(Paragraph(advice, ST["body"])))

    # G3-C: 第9章 结论与优化方向
    if use_12_chapters and "ch9_conclusion" in sections:
        story.extend(_bm_ch("ch9_conclusion"))
        story += [
            Paragraph(CHAPTER_12_TITLES["ch9_conclusion"], ST["h1"]),
            HRFlowable(width="100%", thickness=2, color=brand_primary_color or BRAND_BLUE, spaceAfter=8),
        ]
        task_cn = "分类" if record.task_type == "classification" else "回归"
        key_metric = "AUC" if record.task_type == "classification" else "R²"
        key_val = metrics.get("auc", metrics.get("r2", "N/A"))
        story.append(_boxed(Paragraph(
            f"本报告基于 {ds_name} 数据集，完成了 XGBoost {task_cn}模型的完整建模流程，"
            f"最终模型核心指标 {key_metric} = {f'{key_val:.4f}' if isinstance(key_val, float) else key_val}。",
            ST["body_j"],
        )))

        strengths = [
            f"采用 XGBoost 原生树模型，充分利用其并行计算与内置正则化特性",
            f"通过 5 阶段分层调优策略，系统性地优化了 {len(params)} 个超参数",
            "完整记录了从数据准备到模型验证的全流程操作，100% 可复现",
        ]
        story.append(_boxed(Paragraph("<b>核心优势：</b>", ST["body"])))
        for s in strengths:
            story.append(_boxed(Paragraph(f"• {s}", ST["body"])))

        story.append(_boxed(Paragraph("<b>局限性与后续优化方向：</b>", ST["body"])))
        limitations = [
            "当前版本未包含完整的 OOT 跨时间集验证，建议补充以评估时间泛化能力",
            "特征工程可进一步探索特征交互项与时间窗口特征的衍生",
            "可结合业务专家知识补充 monotone_constraints 单调性约束",
        ]
        for l in limitations:
            story.append(_boxed(Paragraph(f"• {l}", ST["body"])))

    # G3-C: 第10章 附录
    if use_12_chapters and "ch10_appendix" in sections:
        story.extend(_bm_ch("ch10_appendix"))
        story += [
            Paragraph(CHAPTER_12_TITLES["ch10_appendix"], ST["h1"]),
            HRFlowable(width="100%", thickness=2, color=brand_primary_color or BRAND_BLUE, spaceAfter=8),
        ]

        # 训练环境信息
        import platform, sys as _sys

        _xb_ver = "（见运行档案）"
        if record.provenance_json:
            try:
                _pk = json.loads(record.provenance_json).get("packages") or {}
                _xb_ver = str(_pk.get("xgboost", _xb_ver))
            except Exception:
                pass
        story.append(_boxed(Paragraph("<b>附录A：训练环境完整信息</b>", ST["h2"] if "h2" in ST else ST["body"])))
        env_hdr = brand_primary_color or BRAND_BLUE
        env_rows = [
            [
                Paragraph("<b>项目</b>", ST["tbl_head"]),
                Paragraph("<b>版本/信息</b>", ST["tbl_head"]),
            ],
            [
                Paragraph("<b>Python</b>", ST["tbl_cell"]),
                Paragraph(_esc_xml(f"{_sys.version.split()[0]}"), ST["tbl_cell"]),
            ],
            [
                Paragraph("<b>操作系统</b>", ST["tbl_cell"]),
                Paragraph(_esc_xml(platform.system() + " " + platform.release()), ST["tbl_cell"]),
            ],
            [
                Paragraph("<b>XGBoost</b>", ST["tbl_cell"]),
                Paragraph(_esc_xml(_xb_ver), ST["tbl_cell"]),
            ],
            [
                Paragraph("<b>random_state</b>", ST["tbl_cell"]),
                Paragraph(_esc_xml(str(params.get("random_state", params.get("seed", "42")))), ST["tbl_num"]),
            ],
        ]
        env_table = Table(env_rows, colWidths=_col_widths_pt_from_cm_parts([5.0, 10.0]))
        env_table.setStyle(_table_style_standard(env_hdr, header_rows=1))
        story.append(env_table)
        story.append(Spacer(1, 0.28 * cm))

        # 最终超参数明细
        story.append(_boxed(Paragraph("<b>附录B：最终超参数完整明细</b>", ST["h2"] if "h2" in ST else ST["body"])))
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
        param_hdr = brand_primary_color or BRAND_DARK
        # 与 _table_style_standard 中 FONTSIZE=9 一致，避免长文案列叠行/溢出（勿用「5 阶段」易被断成单独一行）
        param_basis_style = ParagraphStyle(
            "_appendix_param_basis",
            parent=ST["tbl_cell"],
            fontSize=9,
            leading=13.5,
            wordWrap="CJK",
            splitLongWords=1,
        )
        _param_basis_txt = "五阶段分层调优；默认模板下与左列一致。"
        param_rows = [
            [
                Paragraph("<b>参数名</b>", ST["tbl_head"]),
                Paragraph("<b>取值</b>", ST["tbl_head"]),
                Paragraph("<b>业务含义</b>", ST["tbl_head"]),
                Paragraph("<b>选择依据</b>", ST["tbl_head"]),
            ]
        ]
        for k, v in params.items():
            if k.startswith("_"):
                continue
            param_rows.append(
                [
                    Paragraph(f"<b>{_esc_xml(str(k))}</b>", ST["tbl_cell"]),
                    Paragraph(_esc_xml(str(v)), ST["tbl_num"]),
                    Paragraph(_esc_xml(param_docs.get(k, "—")), ST["tbl_cell"]),
                    Paragraph(_esc_xml(_param_basis_txt), param_basis_style),
                ]
            )
        if len(param_rows) > 1:
            # 略缩前三列、加宽「选择依据」，降低长句贴边溢出观感
            param_table = Table(param_rows, colWidths=_col_widths_pt_from_cm_parts([3.2, 2.8, 3.4, 6.6]))
            param_table.setStyle(_table_style_standard(param_hdr, header_rows=1))
            param_table.setStyle(
                TableStyle(
                    [
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEADING", (0, 0), (-1, -1), 13.5),
                    ]
                )
            )
            story.append(param_table)

        story.append(Spacer(1, 0.28 * cm))
        story.append(_boxed(Paragraph("<b>附录C：可复现脚本（完整参数 JSON）</b>", ST["h2"] if "h2" in ST else ST["body"])))
        story.extend(_appendix_repro_flowables(params, record, ds_name, split, ST))

    compare_ordered: list[Model] = []
    if normalized_compare_ids:
        cm_rows = db.query(Model).filter(Model.id.in_(normalized_compare_ids)).all()
        by_cid = {m.id: m for m in cm_rows}
        compare_ordered = [by_cid[i] for i in normalized_compare_ids]
        # #region agent log
        _agent_debug_ndjson(
            "H1b",
            "report_service.py:generate_report",
            "compare_models_loaded_for_appendix",
            {"normalized_compare_ids": normalized_compare_ids, "loaded_n": len(compare_ordered)},
        )
        # #endregion

    if compare_ordered:
        try:
            story.extend(
                _appendix_compare_model_flowables(record, compare_ordered, db, ST, brand_primary_color)
            )
        except Exception as _app_d_ex:
            # #region agent log
            _agent_debug_ndjson(
                "DEXC",
                "report_service.py:generate_report",
                "appendix_d_failed",
                {
                    "exc_type": type(_app_d_ex).__name__,
                    "exc_msg": str(_app_d_ex)[:1200],
                },
            )
            # #endregion
            logger.warning("附录D 生成失败，已跳过: %s", _app_d_ex, exc_info=True)
            story.append(Spacer(1, 0.2 * cm))
            story.append(
                _boxed(
                    Paragraph(
                        "<b>附录D：</b>对比模型附录生成时出现异常，已跳过该节；主文与前面附录仍有效。",
                        ST["warn_text"],
                    )
                )
            )

    # -- 备注 --
    if notes:
        story += _h1_pair(sn, "备注", format_style)
        story.append(_boxed(Paragraph(notes, ST["body_j"])))

    # -- 数据来源 --
    footer_company = brand_company or "XGBoost Studio"
    _ft_ds = _esc_xml(ds_name)
    _ft_task = _esc_xml(record.task_type)
    _ft_co = _esc_xml(footer_company)
    _ft_time = _esc_xml(gen_time)
    _footer_meta = (
        f"数据来源：{_ft_ds}  |  模型：XGBoost {_ft_task}  |  生成工具：{_ft_co}"
        f"<br/>时间：{_ft_time}"
    )
    story += [
        Spacer(1, 0.5 * cm),
        HRFlowable(width="100%", thickness=0.5, color=GRAY_LINE, spaceAfter=6),
        _boxed(Paragraph(_footer_meta, ST["small"])),
    ]

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
    # #region agent log
    _agent_debug_ndjson(
        "H2",
        "report_service.py:generate_report",
        "pre_doc_build",
        {
            "story_flowables": len(story),
            "compare_ordered_n": len(compare_ordered),
            "format_style": format_style,
            "has_watermark": bool(brand_watermark),
        },
    )
    # #endregion
    try:
        if brand_watermark:
            _wm_text = brand_watermark
            _wm_font = _current_cn_font

            def _page_with_watermark(canvas_obj, doc_obj):
                _header_footer(canvas_obj, doc_obj)
                _apply_watermark(canvas_obj, doc_obj, _wm_text, _wm_font)

            doc.build(story, onFirstPage=_page_with_watermark, onLaterPages=_page_with_watermark)
        else:
            doc.build(story, onFirstPage=_header_footer, onLaterPages=_header_footer)
    except Exception as _build_ex:
        # #region agent log
        _agent_debug_ndjson(
            "H2",
            "report_service.py:generate_report",
            "doc_build_failed",
            {
                "exc_type": type(_build_ex).__name__,
                "exc_msg": str(_build_ex)[:800],
            },
        )
        # #endregion
        raise

    _cmp_json = json.dumps([model_id] + normalized_compare_ids) if normalized_compare_ids else None
    _rtype = "single_with_compare" if normalized_compare_ids else "single"
    report = Report(
        name=title or f"Report_{model_id}",
        model_id=model_id,
        path=rname,
        report_type=_rtype,
        model_ids_json=_cmp_json,
    )
    db.add(report); db.commit(); db.refresh(report)
    return {"id": report.id, "name": report.name, "path": rname, "created_at": str(report.created_at)}

def generate_comparison_report(model_ids, title, db):
    # P0-10: 每次生成报告前重新注册字体，失败后可重试
    global _current_cn_font, _report_inner_width_pt
    _current_cn_font = _register_cn_font()
    _report_inner_width_pt = _inner_frame_width_pt_for_format("default")

    rows = db.query(Model).filter(Model.id.in_(model_ids)).all()
    if not rows:
        raise HTTPException(status_code=404, detail="未找到指定模型")
    by_id = {m.id: m for m in rows}
    models = [by_id[i] for i in model_ids if i in by_id]
    if len(models) != len(model_ids):
        raise HTTPException(status_code=404, detail="部分模型不存在")

    gen_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    report_title = title or f"多模型对比报告（{len(models)}个）"
    ST = get_styles(_current_cn_font, "default")
    story = [
        Spacer(1, 3.5 * cm),
        Paragraph("XGBoost Studio", ST["cover_title"]),
        Paragraph("多模型横向对比报告", _S("cs2", fontSize=16, textColor=TEXT_MED, alignment=TA_CENTER, spaceAfter=10)),
        HRFlowable(width="80%", thickness=2, color=BRAND_BLUE, spaceAfter=20, spaceBefore=10),
        Paragraph(f"对比模型数量：{len(models)} 个", ST["cover_meta"]),
        Paragraph(f"生成时间：{gen_time}", ST["cover_meta"]),
        NotAtTopPageBreak(),
    ]
    story.extend(
        _comparison_metrics_params_flowables(
            models,
            ST,
            metrics_title="一、指标汇总对比",
            params_title="二、训练参数对比",
            chart_caption_fmt="图1：多模型{km}指标对比",
        )
    )
    _cmp_time = _esc_xml(gen_time)
    story += [
        Spacer(1, 0.5 * cm),
        HRFlowable(width="100%", thickness=0.5, color=GRAY_LINE, spaceAfter=6),
        _boxed(Paragraph(f"数据来源：XGBoost Studio<br/>生成时间：{_cmp_time}", ST["small"])),
    ]
    rname = f"compare_{uuid4().hex[:12]}.pdf"
    rpath = REPORTS_DIR / rname
    doc = SimpleDocTemplate(
        str(rpath),
        pagesize=A4,
        topMargin=1.5 * cm,
        bottomMargin=1.2 * cm,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        title=report_title,
        author="XGBoost Studio",
    )
    doc.build(story, onFirstPage=_header_footer, onLaterPages=_header_footer)
    report = Report(
        name=report_title,
        model_id=model_ids[0] if model_ids else None,
        path=rname,
        report_type="comparison",
        model_ids_json=json.dumps(model_ids),
    )
    db.add(report)
    db.commit()
    db.refresh(report)
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
