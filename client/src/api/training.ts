import apiClient from './client'
import type { Model, TrainingTask, TrainingProgress } from '../types'

/** 启动训练 */
export async function startTraining(payload: {
  split_id: number
  params: Record<string, unknown>
  model_name?: string
}): Promise<{ task_id: string }> {
  const res = await apiClient.post('/api/training/start', payload)
  return res.data
}

/** SSE 训练进度 */
export function subscribeTrainingProgress(
  taskId: string,
  onMessage: (progress: TrainingProgress) => void,
  onDone: () => void,
  onError: (err: Event) => void
): EventSource {
  const es = new EventSource(`http://127.0.0.1:18899/api/training/${taskId}/progress`)
  es.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data) as TrainingProgress)
    } catch {
      // 忽略解析错误
    }
  }
  es.addEventListener('done', () => { onDone(); es.close() })
  es.onerror = (e) => { onError(e); es.close() }
  return es
}

/** 停止训练 */
export async function stopTraining(taskId: string): Promise<void> {
  await apiClient.post(`/api/training/${taskId}/stop`)
}

/** 获取训练结果 */
export async function getTrainingResult(taskId: string): Promise<{
  task: TrainingTask
  model: Model
}> {
  const res = await apiClient.get(`/api/training/${taskId}/result`)
  return res.data
}
