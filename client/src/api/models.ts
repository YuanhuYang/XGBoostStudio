import apiClient from './client'
import type { Model } from '../types'

/** 获取模型列表 */
export async function listModels(): Promise<Model[]> {
  const res = await apiClient.get('/api/models')
  return res.data
}

/** 获取模型详情 */
export async function getModel(id: number): Promise<Model> {
  const res = await apiClient.get(`/api/models/${id}`)
  return res.data
}

/** 删除模型 */
export async function deleteModel(id: number): Promise<void> {
  await apiClient.delete(`/api/models/${id}`)
}

/** 重命名模型 */
export async function renameModel(id: number, name: string): Promise<Model> {
  const res = await apiClient.put(`/api/models/${id}/rename`, { name })
  return res.data
}

/** 打标签 */
export async function tagModel(id: number, tags: string[]): Promise<Model> {
  const res = await apiClient.post(`/api/models/${id}/tag`, { tags })
  return res.data
}

/** 获取模型评估结果 */
export async function getEvaluation(id: number): Promise<Record<string, unknown>> {
  const res = await apiClient.get(`/api/models/${id}/evaluation`)
  return res.data
}

/** 获取 SHAP 分析 */
export async function getSHAP(id: number): Promise<Record<string, unknown>> {
  const res = await apiClient.get(`/api/models/${id}/shap`)
  return res.data
}

/** 多模型对比 */
export async function compareModels(ids: number[]): Promise<Record<string, unknown>> {
  const res = await apiClient.get('/api/models/compare', { params: { ids: ids.join(',') } })
  return res.data
}

/** 学习曲线 */
export async function getLearningCurve(id: number): Promise<Record<string, unknown>> {
  const res = await apiClient.get(`/api/models/${id}/learning-curve`)
  return res.data
}

/** 导出模型 */
export async function exportModel(id: number, format: 'ubj' | 'pickle' = 'ubj'): Promise<Blob> {
  const res = await apiClient.post(
    `/api/models/${id}/export`,
    { format },
    { responseType: 'blob' }
  )
  return res.data
}

/** 更新模型属性（名称 / 标签 / 备注等）*/
export async function updateModel(
  id: number,
  payload: { name?: string; tags?: string; notes?: string; description?: string }
): Promise<Model> {
  const res = await apiClient.patch(`/api/models/${id}`, payload)
  return res.data
}
