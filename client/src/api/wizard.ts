import apiClient from './client'

const BASE_URL = 'http://127.0.0.1:18899'

export interface DatasetColumn {
  name: string
  dtype: string
  null_count: number
  null_rate: number
  is_target: boolean
  min?: number
  max?: number
  mean?: number
  n_unique?: number
}

export interface CandidateTarget {
  col: string
  confidence: number
  reason: string
}

export interface FeatureMI {
  col: string
  mi: number
}

export interface PreprocessSuggestion {
  type: string
  severity: 'info' | 'warning' | 'error'
  title: string
  description: string
  action: string
  expected_improvement: string
  potential_risk: string
  learn_why?: string
}

export interface PreprocessSuggestionsResult {
  dataset_id: number
  suggestions: PreprocessSuggestion[]
  skip_allowed: boolean
}

export interface DatasetSummary {
  dataset_id: number
  name: string
  n_rows: number
  n_cols: number
  target_column: string | null
  task_type: string
  task_hint: string
  quality_score: number
  missing_rate: number
  /** 与数据工作台质量报告一致 */
  outlier_rate: number
  duplicate_rate: number
  quality_suggestions: string[]
  columns: DatasetColumn[]
  recommendations: string[]
  candidate_targets: CandidateTarget[]
  feature_mi: FeatureMI[]
}

export interface QuickConfigResult {
  split_id: number
  params: Record<string, unknown>
  search_space: Record<string, unknown>
  notes: string[]
  explanations: Record<string, string>
  summary: string
}

export interface PipelineProgress {
  type: 'progress' | 'log' | 'done' | 'error'
  percent?: number
  message?: string
  model_id?: number
  report_id?: number | null
  metrics?: Record<string, unknown>
  natural_summary?: string
}

/** 获取数据集摘要与质量报告 */
export async function getDatasetSummary(datasetId: number): Promise<DatasetSummary> {
  const res = await apiClient.get(`/api/wizard/dataset-summary/${datasetId}`)
  return res.data
}

/** 获取 AI 预处理建议卡片 */
export async function getPreprocessSuggestions(datasetId: number): Promise<PreprocessSuggestionsResult> {
  const res = await apiClient.get(`/api/wizard/preprocess-suggestions/${datasetId}`)
  return res.data
}

/** 基于数据划分推荐参数 */
export async function getQuickConfig(splitId: number): Promise<QuickConfigResult> {
  const res = await apiClient.post('/api/wizard/quick-config', { split_id: splitId })
  return res.data
}

/** 一键训练+评估+报告流水线（SSE） */
export function runPipeline(
  payload: {
    split_id: number
    params: Record<string, unknown>
    report_title?: string
  },
  onEvent: (event: PipelineProgress) => void,
  onDone: (result: PipelineProgress) => void,
  onError: (err: string) => void,
): () => void {
  const controller = new AbortController()

  const run = async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/wizard/run-pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        onError(`HTTP ${response.status}`)
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as PipelineProgress
              if (event.type === 'done') {
                onDone(event)
              } else if (event.type === 'error') {
                onError(event.message ?? '未知错误')
              } else {
                onEvent(event)
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        onError(e.message)
      }
    }
  }

  run()
  return () => controller.abort()
}

// ── 参数对比实验 ──────────────────────────────────────────────────────────────

export interface LabRoundEvent {
  type: 'round'
  round: number
  total: number
  val_loss: number
}

export interface LabDoneEvent {
  type: 'done'
  model_id: number
  metrics: Record<string, number>
}

/** 参数对比实验训练（SSE），只做训练，不生成报告 */
export function runLabExperiment(
  payload: { split_id: number; params: Record<string, unknown> },
  onRound: (event: LabRoundEvent) => void,
  onDone: (event: LabDoneEvent) => void,
  onError: (err: string) => void,
): () => void {
  const controller = new AbortController()

  const run = async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/wizard/run-lab`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (!response.ok || !response.body) {
        onError(`HTTP ${response.status}`)
        return
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6))
              if (event.type === 'round') {
                onRound(event as LabRoundEvent)
              } else if (event.type === 'done') {
                onDone(event as LabDoneEvent)
              } else if (event.type === 'error') {
                onError(event.message ?? '未知错误')
              }
            } catch { /* ignore */ }
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        onError(e.message)
      }
    }
  }

  run()
  return () => controller.abort()
}
