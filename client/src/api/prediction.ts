import apiClient from './client'

/** 批量预测 */
export async function batchPredict(payload: {
  model_id: number
  file: File
}): Promise<{ task_id: string }> {
  const form = new FormData()
  form.append('model_id', String(payload.model_id))
  form.append('file', payload.file)
  const res = await apiClient.post('/api/prediction/batch', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

/** 单条预测 */
export async function singlePredict(payload: {
  model_id: number
  features: Record<string, unknown>
}): Promise<{
  prediction: unknown
  probabilities?: Record<string, number>
  shap_values?: Record<string, number>
}> {
  const res = await apiClient.post('/api/prediction/single', payload)
  return res.data
}

/** 下载批量预测结果 */
export async function downloadPrediction(taskId: string): Promise<Blob> {
  const res = await apiClient.get(`/api/prediction/${taskId}/download`, {
    responseType: 'blob',
  })
  return res.data
}
