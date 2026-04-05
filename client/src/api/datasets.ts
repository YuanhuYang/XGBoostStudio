import apiClient from './client'
import type { Dataset, DatasetStats, PreviewData, QualityScore } from '../types'

/** 一键导入内置示例（本地 tests/data，离线可用） */
export async function importSampleDataset(
  key: 'titanic' | 'boston' | 'iris'
): Promise<Dataset> {
  const res = await apiClient.post<Dataset>('/api/datasets/import-sample', null, {
    params: { key },
  })
  return res.data
}

/** 上传数据集 */
export async function uploadDataset(file: File, sheetName?: string): Promise<Dataset> {
  const form = new FormData()
  form.append('file', file)
  if (sheetName) form.append('sheet_name', sheetName)
  const res = await apiClient.post('/api/datasets/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

/** 获取所有数据集 */
export async function listDatasets(): Promise<Dataset[]> {
  const res = await apiClient.get('/api/datasets')
  return res.data
}

/** 获取数据集详情 */
export async function getDataset(id: number): Promise<Dataset> {
  const res = await apiClient.get(`/api/datasets/${id}`)
  return res.data
}

/** 删除数据集 */
export async function deleteDataset(id: number): Promise<void> {
  await apiClient.delete(`/api/datasets/${id}`)
}

/** 分页预览数据 */
export async function previewDataset(
  id: number,
  page = 1,
  pageSize = 50
): Promise<PreviewData> {
  const res = await apiClient.get(`/api/datasets/${id}/preview`, {
    params: { page, page_size: pageSize },
  })
  return res.data
}

/** 获取列统计 */
export async function getDatasetStats(id: number): Promise<DatasetStats> {
  const res = await apiClient.get(`/api/datasets/${id}/stats`)
  return res.data
}

/** 获取列分布数据 */
export async function getColumnDistribution(
  id: number,
  column: string
): Promise<{ bins: number[]; counts: number[]; type: string }> {
  const res = await apiClient.get(`/api/datasets/${id}/distribution/${encodeURIComponent(column)}`)
  return res.data
}

/** 缺失值热力图数据 */
export async function getMissingPattern(
  id: number
): Promise<{ columns: string[]; matrix: number[][] }> {
  const res = await apiClient.get(`/api/datasets/${id}/missing-pattern`)
  return res.data
}

/** 处理缺失值 */
export async function handleMissing(
  id: number,
  config: Record<string, { strategy: string; fill_value?: unknown }>
): Promise<Dataset> {
  const res = await apiClient.post(`/api/datasets/${id}/handle-missing`, { config })
  return res.data
}

/** 获取异常值 */
export async function getOutliers(
  id: number
): Promise<{ row_indices: number[]; column: string; value: number; reason: string }[]> {
  const res = await apiClient.get(`/api/datasets/${id}/outliers`)
  return res.data
}

/** 处理异常值 */
export async function handleOutliers(
  id: number,
  action: 'drop' | 'keep',
  rowIndices: number[]
): Promise<Dataset> {
  const res = await apiClient.post(`/api/datasets/${id}/handle-outliers`, {
    action,
    row_indices: rowIndices,
  })
  return res.data
}

/** 获取重复行 */
export async function getDuplicates(
  id: number
): Promise<{ count: number; indices: number[] }> {
  const res = await apiClient.get(`/api/datasets/${id}/duplicates`)
  return res.data
}

/** 删除重复行 */
export async function dropDuplicates(id: number): Promise<Dataset> {
  const res = await apiClient.post(`/api/datasets/${id}/drop-duplicates`)
  return res.data
}

/** 数据质量评分 */
export async function getQualityScore(id: number): Promise<QualityScore> {
  const res = await apiClient.get(`/api/datasets/${id}/quality-score`)
  return res.data
}

/** 划分训练/测试集 */
export async function splitDataset(
  id: number,
  trainRatio: number,
  randomSeed: number,
  stratify: boolean,
  targetColumn: string
): Promise<{ split_id: number; train_rows: number; test_rows: number }> {
  const res = await apiClient.post(`/api/datasets/${id}/split`, {
    train_ratio: trainRatio,
    random_seed: randomSeed,
    stratify,
    target_column: targetColumn,
  })
  return res.data
}

/** 设置目标列 */
export async function setTargetColumn(id: number, targetColumn: string): Promise<void> {
  await apiClient.patch(`/api/datasets/${id}`, { target_column: targetColumn })
}

/** 便捷 API 对象（页面组件使用） */
export const datasetsApi = {
  list: () => apiClient.get('/api/datasets'),
  importSample: (key: 'titanic' | 'boston' | 'iris') =>
    apiClient.post<Dataset>('/api/datasets/import-sample', null, { params: { key } }),
  upload: (formData: FormData) => apiClient.post('/api/datasets/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  preview: (id: number, page = 1, pageSize = 50) => apiClient.get(`/api/datasets/${id}/preview`, { params: { page, page_size: pageSize } }),
  stats: (id: number) => apiClient.get(`/api/datasets/${id}/stats`),
  delete: (id: number) => apiClient.delete(`/api/datasets/${id}`),
  setTarget: (id: number, targetColumn: string) => apiClient.patch(`/api/datasets/${id}`, { target_column: targetColumn }),
  qualityScore: (id: number) => apiClient.get(`/api/datasets/${id}/quality-score`),
  missingPattern: (id: number) => apiClient.get(`/api/datasets/${id}/missing-pattern`),
  outliers: (id: number) => apiClient.get(`/api/datasets/${id}/outliers`),
  duplicates: (id: number) => apiClient.get(`/api/datasets/${id}/duplicates`),
  handleMissing: (id: number, data: unknown) => apiClient.post(`/api/datasets/${id}/handle-missing`, data),
  handleOutliers: (id: number, data: unknown) => apiClient.post(`/api/datasets/${id}/handle-outliers`, data),
  dropDuplicates: (id: number) => apiClient.post(`/api/datasets/${id}/drop-duplicates`),
  split: (id: number, data: unknown) => apiClient.post(`/api/datasets/${id}/split`, data),
  distribution: (id: number, col: string) => apiClient.get(`/api/datasets/${id}/distribution/${col}`),
}
