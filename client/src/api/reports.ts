import apiClient from './client'

/** 生成报告 */
export async function generateReport(payload: {
  model_id: number
  name: string
  sections: string[]
}): Promise<{ report_id: number }> {
  const res = await apiClient.post('/api/reports/generate', payload)
  return res.data
}

/** 获取报告元数据 */
export async function getReport(id: number): Promise<{
  id: number
  name: string
  model_id: number
  html_path?: string
  pdf_path?: string
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
