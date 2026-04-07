import apiClient from './client'
import type { Dataset, DatasetStats, PreviewData, QualityScore } from '../types'

/** 与 GET /api/datasets/builtin-samples 一致。
 * 仅作离线文案参考或测试夹具，勿用作运行时可选列表（须以接口返回为准，避免新旧后端 key 不一致）。 */
export interface BuiltinSampleItem {
  key: string
  title: string
  task: string
  difficulty: string
  scenario: string
  suggested_target?: string | null
}

export const FALLBACK_BUILTIN_SAMPLES: BuiltinSampleItem[] = [
  { key: 'titanic', title: 'Titanic', task: '二分类', difficulty: '入门', scenario: '生存预测', suggested_target: 'Survived' },
  { key: 'iris', title: 'Iris', task: '多分类', difficulty: '入门', scenario: '经典花种分类', suggested_target: 'species' },
  { key: 'boston', title: 'Boston Housing', task: '回归', difficulty: '入门', scenario: '房价回归（教学用）', suggested_target: 'medv' },
  { key: 'wine', title: 'Wine 化学成分', task: '多分类', difficulty: '进阶', scenario: '酿酒化学特征多分类', suggested_target: 'class' },
  { key: 'german_credit', title: 'German Credit', task: '二分类', difficulty: '进阶', scenario: '信贷评分 / 风控表格', suggested_target: 'class' },
  { key: 'bank_marketing', title: 'Bank Marketing', task: '二分类', difficulty: '进阶', scenario: '营销响应（类流失场景）', suggested_target: 'y' },
  { key: 'credit_card_default', title: '信用卡违约', task: '二分类', difficulty: '进阶', scenario: '循环授信违约预测', suggested_target: 'default_payment_next_month' },
  { key: 'adult_income', title: 'Adult Income', task: '二分类', difficulty: '挑战', scenario: '人口统计收入（高基数类别、混合类型）', suggested_target: 'income' },
  { key: 'uci_automobile_price', title: 'UCI 汽车价格（1985 Imports）', task: '回归', difficulty: '挑战', scenario: 'UCI 公开集：车型与规格预测标价（美元；离散制造/成品定价类比）', suggested_target: 'price' },
  { key: 'mfg_assembly_price', title: '产线组装定价（合成）', task: '回归', difficulty: '挑战', scenario: '演示用合成：零部件成本与产线特征预测单价（仓库内生成，非 UCI 镜像）', suggested_target: 'finished_unit_price' },
]

export function builtinDifficultyColor(difficulty: string): string {
  if (difficulty === '入门') return 'green'
  if (difficulty === '进阶') return 'gold'
  if (difficulty === '挑战') return 'red'
  return 'default'
}

/** 仅从后端拉取；失败或异常响应时返回 []，避免展示当前进程不支持的示例 key。 */
export async function fetchBuiltinSamples(): Promise<BuiltinSampleItem[]> {
  try {
    const res = await apiClient.get<unknown>('/api/datasets/builtin-samples')
    const raw = res.data
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (x): x is BuiltinSampleItem =>
        x != null &&
        typeof x === 'object' &&
        typeof (x as BuiltinSampleItem).key === 'string' &&
        typeof (x as BuiltinSampleItem).title === 'string'
    )
  } catch {
    return []
  }
}

/** 一键导入内置示例（本地 tests/data，离线可用） */
export async function importSampleDataset(key: string): Promise<Dataset> {
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

/** 划分测试集单行（与训练管线数值列一致），供交互预测预填 */
export interface SplitTestRowResponse {
  row_index: number
  total_rows: number
  features: Record<string, number>
  target: string | number | boolean | null
}

export async function fetchSplitTestRow(splitId: number, index: number): Promise<SplitTestRowResponse> {
  const res = await apiClient.get<SplitTestRowResponse>(`/api/datasets/splits/${splitId}/test-row`, {
    params: { index },
  })
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
  builtinSamples: () => apiClient.get<BuiltinSampleItem[]>('/api/datasets/builtin-samples'),
  importSample: (key: string) =>
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
