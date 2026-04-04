import apiClient from './client'

/** 生成报告 */
export async function generateReport(payload: {
  model_id: number
  name: string
  sections?: string[]
  include_sections?: string[] | null
  title?: string
  notes?: string
}): Promise<{ id: number; name: string; path: string; created_at: string }> {
  const res = await apiClient.post('/api/reports/generate', payload)
  return res.data
}

/** 多模型对比报告 */
export async function compareReport(payload: {
  model_ids: number[]
  title?: string
}): Promise<{ id: number; name: string; path: string; created_at: string }> {
  const res = await apiClient.post('/api/reports/compare', payload)
  return res.data
}

/** 获取报告列表 */
export async function listReports(): Promise<Array<{
  id: number
  name: string
  model_id: number
  path: string
  report_type: string
  created_at: string
}>> {
  const res = await apiClient.get('/api/reports')
  return res.data
}

/** 获取报告元数据 */
export async function getReport(id: number): Promise<{
  id: number
  name: string
  model_id: number
  path: string
  report_type: string
  created_at: string
}> {
  const res = await apiClient.get(`/api/reports/${id}`)
  return res.data
}

/** 下载 PDF */
export async function downloadReport(id: number): Promise<Blob> {
  const res = await apiClient.get(`/api/reports/${id}/download`, { responseType: 'blob' })
  return res.data
}

/** 删除报告 */
export async function deleteReport(id: number): Promise<void> {
  await apiClient.delete(`/api/reports/${id}`)
}
