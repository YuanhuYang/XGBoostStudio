import apiClient from './client'

export interface AutoMLCandidate {
  model_id: number
  name: string
  metrics: Record<string, unknown>
  task_type: string
  rationale: string
  overfitting_level?: string
  score_for_rank: number
}

export interface AutoMLJobResult {
  dataset_id: number
  target_column: string
  split_id: number
  task_type: string
  candidates: AutoMLCandidate[]
  chosen_recommendation: { model_id: number; name: string; reason: string }
  warnings: string[]
  param_notes?: string[]
}

export async function startAutoMLJob(body: {
  dataset_id: number
  target_column?: string | null
  train_ratio?: number
  random_seed?: number
  max_tuning_trials?: number
  skip_tuning?: boolean
}): Promise<{ job_id: string }> {
  const r = await apiClient.post<{ job_id: string }>('/api/automl/jobs', body)
  return r.data
}

export async function getAutoMLJobResult(jobId: string): Promise<AutoMLJobResult> {
  const r = await apiClient.get<AutoMLJobResult>(`/api/automl/jobs/${jobId}/result`)
  return r.data
}
