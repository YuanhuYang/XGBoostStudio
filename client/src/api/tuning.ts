import apiClient from './client'
import type { TuningProgress } from '../types'

/** 启动调优 */
export async function startTuning(payload: {
  split_id: number
  search_space: Record<string, unknown>
  strategy: 'tpe' | 'random' | 'grid'
  n_trials: number
  metric?: string
}): Promise<{ task_id: string }> {
  const res = await apiClient.post('/api/tuning/start', payload)
  return res.data
}

/** SSE 调优进度 */
export function subscribeTuningProgress(
  taskId: string,
  onMessage: (progress: TuningProgress) => void,
  onDone: () => void,
  onError: (err: Event) => void
): EventSource {
  const es = new EventSource(`http://127.0.0.1:18899/api/tuning/${taskId}/progress`)
  es.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data) as TuningProgress)
    } catch {
      // 忽略解析错误
    }
  }
  es.addEventListener('done', () => { onDone(); es.close() })
  es.onerror = (e) => { onError(e); es.close() }
  return es
}

/** 停止调优 */
export async function stopTuning(taskId: string): Promise<void> {
  await apiClient.post(`/api/tuning/${taskId}/stop`)
}

/** 获取调优结果 */
export async function getTuningResult(taskId: string): Promise<{
  best_params: Record<string, unknown>
  best_score: number
  history: TuningProgress[]
}> {
  const res = await apiClient.get(`/api/tuning/${taskId}/result`)
  return res.data
}

/** 获取参数重要性 */
export async function getTuningImportance(
  taskId: string
): Promise<{ param: string; importance: number }[]> {
  const res = await apiClient.get(`/api/tuning/${taskId}/importance`)
  return res.data
}
