"""
G2-Auth-4：报告「方法与局限性」固定文案；与 dataset_narrative 多重比较/因果免责 **单源** 对齐。
"""
from __future__ import annotations

from services.dataset_narrative_service import CAUSALITY_CAVEAT, MULTIPLICITY_CAVEAT

# 分类：主指标高于此阈值才允许「上线试验」类积极表述（与 _business_advice 条件一致）
CLASSIFICATION_AUC_DEPLOY_THRESHOLD = 0.7
REGRESSION_R2_DEPLOY_THRESHOLD = 0.5


def methodology_section_paragraphs() -> list[str]:
    """PDF「方法与指标定义」章节段落（纯文本，无 HTML）。"""
    return [
        "本报告基于 XGBoost 梯度提升树模型，在单次训练/测试集划分（hold-out）上计算下列指标。"
        "测试集未参与训练，用于估计泛化误差；该估计未通过重复划分或交叉验证度量方差，"
        "若需了解指标稳定性，请在产品中查看训练期 K 折或另行运行调优/验证流程。",
        "指标定义（摘要）：分类任务中 Accuracy 为预测正确的样本比例；"
        "Precision/Recall/F1 按加权平均（多分类）；AUC-ROC 衡量正类排序区分能力（0.5 接近随机）。"
        "回归任务中 RMSE 为均方误差的平方根；R² 表示模型相对常数基线的解释方差比例；MAE 为平均绝对误差。",
        CAUSALITY_CAVEAT,
        MULTIPLICITY_CAVEAT,
    ]
