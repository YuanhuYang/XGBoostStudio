/** 报告生成可选章节（与后端 `report_service.ALL_SECTIONS` / 设计文档令牌一致）
 *  G3-C: 新增 12 章固定结构定义 + 4 种预设模板
 */

// ─── 旧版：11 个自由配置节（向后兼容） ────────────────────────────────────────
export const REPORT_SECTION_OPTIONS: { label: string; value: string }[] = [
  { label: '方法与指标定义', value: 'methodology' },
  { label: '执行摘要', value: 'executive_summary' },
  { label: '数据与变量关系', value: 'data_relations' },
  { label: '数据概览', value: 'data_overview' },
  { label: '模型参数', value: 'model_params' },
  { label: '评估指标', value: 'evaluation' },
  { label: 'SHAP 特征重要性', value: 'shap' },
  { label: '学习曲线', value: 'learning_curve' },
  { label: '过拟合分析', value: 'overfitting' },
  { label: '基线对比', value: 'baseline' },
  { label: '业务建议', value: 'business_advice' },
]

// ─── G3-C: 12 章固定结构（规格说明书 §3.2.2）────────────────────────────────
export const CHAPTERS_12: { key: string; title: string; description: string }[] = [
  {
    key: 'ch1_executive_summary',
    title: '第一章  报告摘要与建模目标',
    description: '业务背景、建模目标定义、核心准确性指标、报告导读',
  },
  {
    key: 'ch2_label_dataset',
    title: '第二章  标签与数据集专项分析',
    description: '标签口径说明、标签分布、数据集划分规则、全链路数据泄露检测',
  },
  {
    key: 'ch3_feature_engineering',
    title: '第三章  特征工程全流程分析',
    description: '原始特征池分析、IV/KS/PSI效力排名、特征工程操作记录、最终入模特征池',
  },
  {
    key: 'ch4_modeling_tuning',
    title: '第四章  XGBoost建模与超参数调优全链路过程',
    description: '基线模型定义、初始配置说明、5阶段调优全路径、训练过程全记录',
  },
  {
    key: 'ch5_model_accuracy',
    title: '第五章  模型准确性与泛化能力全维度分析',
    description: '拟合度分析、全维度准确性指标、最优阈值选择、OOT泛化能力、鲁棒性压力测试',
  },
  {
    key: 'ch6_interpretability',
    title: '第六章  模型可解释性分析',
    description: '全局特征重要性、PDP/ICE边际效应、SHAP全维度分析、单样本预测解释',
  },
  {
    key: 'ch7_risk_compliance',
    title: '第七章  模型合规性与风险分析',
    description: '全链路风险识别、算法公平性分析、模型生命周期预测',
  },
  {
    key: 'ch8_business_application',
    title: '第八章  业务落地与应用建议',
    description: '模型业务价值量化、应用场景与落地路径、阈值使用建议、监控要求',
  },
  {
    key: 'ch9_conclusion',
    title: '第九章  结论与优化方向',
    description: '建模全流程核心结论、核心优势与局限性、后续优化方向',
  },
  {
    key: 'ch10_appendix',
    title: '第十章  附录',
    description: '训练环境完整信息、最终超参数明细、全量特征字典、可复现代码片段',
  },
]

// ─── 4 种预设模板定义 ────────────────────────────────────────────────────────
export interface ReportTemplate {
  type: string
  name: string
  description: string
  chapters: string[]
  badge: string
}

export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    type: 'full_12_chapters',
    name: '完整版（12章）',
    description: '包含全部12个章节，适合技术评审、归档存档',
    chapters: CHAPTERS_12.map(c => c.key),
    badge: 'blue',
  },
  {
    type: 'executive_brief',
    name: '管理层简报版',
    description: '聚焦摘要、准确性与业务建议，适合向管理层汇报',
    chapters: ['ch1_executive_summary', 'ch5_model_accuracy', 'ch8_business_application', 'ch9_conclusion'],
    badge: 'green',
  },
  {
    type: 'business_execution',
    name: '业务执行版',
    description: '完整建模过程 + 业务建议，适合业务团队落地参考',
    chapters: ['ch1_executive_summary', 'ch2_label_dataset', 'ch3_feature_engineering', 'ch4_modeling_tuning', 'ch5_model_accuracy', 'ch8_business_application', 'ch9_conclusion'],
    badge: 'orange',
  },
  {
    type: 'technical_expert',
    name: '技术专家版',
    description: '含可解释性与附录，适合算法工程师深度审查',
    chapters: ['ch1_executive_summary', 'ch2_label_dataset', 'ch3_feature_engineering', 'ch4_modeling_tuning', 'ch5_model_accuracy', 'ch6_interpretability', 'ch7_risk_compliance', 'ch9_conclusion', 'ch10_appendix'],
    badge: 'purple',
  },
  {
    type: 'compliance_audit',
    name: '合规审计版',
    description: '含数据合规与风险分析，适合内部审计与监管报送',
    chapters: ['ch1_executive_summary', 'ch2_label_dataset', 'ch3_feature_engineering', 'ch5_model_accuracy', 'ch7_risk_compliance', 'ch9_conclusion', 'ch10_appendix'],
    badge: 'red',
  },
]

/** 与后端 `report_service.generate_report` 中 legacy_map 一致，用于 G3 预设 → 旧版章节列表（保存自定义模板等） */
const G3_CHAPTER_TO_LEGACY: Record<string, string[]> = {
  ch1_executive_summary: ['methodology', 'executive_summary'],
  ch2_label_dataset: ['data_overview', 'data_relations'],
  ch3_feature_engineering: ['data_overview'],
  ch4_modeling_tuning: ['model_params'],
  ch5_model_accuracy: ['evaluation', 'learning_curve', 'overfitting', 'baseline'],
  ch6_interpretability: ['shap'],
  ch7_risk_compliance: ['baseline', 'overfitting'],
  ch8_business_application: ['business_advice'],
  ch9_conclusion: ['business_advice'],
  ch10_appendix: ['model_params'],
}

/** 由当前 G3 模板类型推导旧版 `include_sections` 令牌集合（去重） */
export function legacySectionKeysFromG3TemplateType(templateType: string): string[] {
  const tpl = REPORT_TEMPLATES.find(t => t.type === templateType)
  if (!tpl) return REPORT_SECTION_OPTIONS.map(o => o.value)
  const keys = new Set<string>()
  for (const ch of tpl.chapters) {
    for (const leg of G3_CHAPTER_TO_LEGACY[ch] || []) keys.add(leg)
  }
  return Array.from(keys)
}
