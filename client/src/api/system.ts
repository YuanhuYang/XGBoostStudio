import apiClient from './client'

/** 健康检查 */
export async function checkHealth(): Promise<{ status: string; version: string }> {
  const res = await apiClient.get('/health')
  return res.data
}
