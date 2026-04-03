import apiClient from './client'
import type { XGBParams } from '../types'

/** 获取参数 schema（元数据） */
export async function getParamsSchema(): Promise<Record<string, unknown>> {
  const res = await apiClient.get('/api/params/schema')
  return res.data
}

/** 智能推荐参数 */
export async function recommendParams(splitId: number): Promise<Partial<XGBParams>> {
  const res = await apiClient.get('/api/params/recommend', {
    params: { split_id: splitId },
  })
  return res.data
}

/** 验证参数合法性 */
export async function validateParams(
  params: Partial<XGBParams>
): Promise<{ valid: boolean; errors: string[] }> {
  const res = await apiClient.post('/api/params/validate', params)
  return res.data
}
