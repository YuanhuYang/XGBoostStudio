import axios from 'axios'
import { useAppStore } from '../store/appStore'

const BASE_URL = 'http://127.0.0.1:18899'

const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器
apiClient.interceptors.request.use(
  (config) => config,
  (error) => Promise.reject(error)
)

// 响应拦截器 - 统一错误处理
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.detail ||
      error.response?.data?.message ||
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
