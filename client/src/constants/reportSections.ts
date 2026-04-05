/** 报告生成可选章节（与后端 `report_service.ALL_SECTIONS` / 设计文档令牌一致） */
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
