import type { WorkflowMode } from '../store/appStore'

/**
 * 智能向导、数据处理与模型调优模式展示教学卡片与概念提示；专家分析关闭以减少干扰。
 */
export function showTeachingUi(workflowMode: WorkflowMode): boolean {
  return workflowMode === 'guided' || workflowMode === 'preprocess' || workflowMode === 'learning'
}
