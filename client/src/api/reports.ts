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

// ==== 报表模板 API ====

export interface ReportTemplate {
  id: number
  name: string
  description?: string
  is_builtin: boolean
  sections: string[]
  format_style: 'default' | 'apa'
  created_at: string
}

export interface ReportTemplateCreatePayload {
  name: string
  description?: string
  sections: string[]
  format_style?: 'default' | 'apa'
}

/** 获取所有模板（内置 + 用户自定义） */
export async function listReportTemplates(): Promise<ReportTemplate[]> {
  const res = await apiClient.get('/api/report-templates')
  return res.data
}

/** 创建用户自定义模板 */
export async function createReportTemplate(payload: ReportTemplateCreatePayload): Promise<ReportTemplate> {
  const res = await apiClient.post('/api/report-templates', payload)
  return res.data
}

/** 删除用户自定义模板（内置不能删除） */
export async function deleteReportTemplate(id: number): Promise<void> {
  await apiClient.delete(`/api/report-templates/${id}`)
}
