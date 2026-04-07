import axios from 'axios'
import { useAppStore } from '../store/appStore'
import { formatApiErrorDetail } from '../utils/apiError'

const BASE_URL = 'http://127.0.0.1:18899'

/** 本地 ML / SQLite 持锁时，并发 API 可能排队较久；过短超时易误报。 */
export const API_REQUEST_TIMEOUT_MS = 15 * 60 * 1000

// 仍可能有个别路径或旧合并结果带上 axios 默认 30s，请求拦截器会对「过短超时」统一抬高。
const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: API_REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器
apiClient.interceptors.request.use(
  (config) => {
    const t = config.timeout
    if (t === undefined || t === 0 || t <= 60_000) {
      config.timeout = API_REQUEST_TIMEOUT_MS
    }
    return config
  },
  (error) => Promise.reject(error)
)

// 响应拦截器 - 统一错误处理
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const isTimeout =
      error.code === 'ECONNABORTED' ||
      (typeof error.message === 'string' && error.message.toLowerCase().includes('timeout'))
    const raw = error.response?.data?.detail ?? error.response?.data?.message
    const message =
      isTimeout
        ? `请求超时（当前上限约 ${API_REQUEST_TIMEOUT_MS / 60000} 分钟）。若正在智能清洗或训练，可稍后重试；并确认已重新构建/刷新客户端。`
        : (raw !== undefined && raw !== null && raw !== ''
          ? formatApiErrorDetail(raw)
          : null) ||
        error.message ||
        '请求失败'
    // 将全局错误写入 store（只针对非 401/404 业务错误）
    const status = error.response?.status
    if (!status || status >= 500) {
      useAppStore.getState().setGlobalError(message)
    }
    return Promise.reject(new Error(message))
  }
)

// 网络离线/恢复检测
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => {
    useAppStore.getState().setIsOffline(true)
    useAppStore.getState().setGlobalError('网络已断开，请检查连接后重试')
  })
  window.addEventListener('online', () => {
    useAppStore.getState().setIsOffline(false)
    useAppStore.getState().setGlobalError(null)
  })
}

export default apiClient
export { BASE_URL }
