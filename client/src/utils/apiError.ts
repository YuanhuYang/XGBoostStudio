/**
 * 将 FastAPI / Axios 错误体中的 detail 转为可展示的单行或多行中文文案。
 * detail 可能是 string、校验错误对象数组、或嵌套对象。
 */
export function formatApiErrorDetail(detail: unknown): string {
  if (detail == null || detail === '') return '请求失败'
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'msg' in item) {
        const o = item as { msg?: string; loc?: unknown[] }
        const locTail = Array.isArray(o.loc)
          ? o.loc.slice(1).filter((x) => x != null && x !== '').join('.')
          : ''
        const msg = o.msg != null ? String(o.msg) : ''
        return locTail ? `${locTail}: ${msg}` : msg || JSON.stringify(item)
      }
      try {
        return JSON.stringify(item)
      } catch {
        return String(item)
      }
    })
    return parts.filter(Boolean).join('；') || '请求失败'
  }
  if (typeof detail === 'object' && detail !== null && 'message' in detail) {
    return formatApiErrorDetail((detail as { message: unknown }).message)
  }
  try {
    return JSON.stringify(detail)
  } catch {
    return String(detail)
  }
}

/**
 * 与 `api/client` 拦截器配合：reject 多为 `Error(已格式化 message)`，此时无 `response`；
 * 少数路径仍可能拿到原始 Axios 错误，则再解析 `detail`。
 */
export function getRequestErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  const ax = error as {
    response?: { data?: { detail?: unknown; message?: unknown } }
    message?: string
  }
  const raw = ax.response?.data?.detail ?? ax.response?.data?.message
  if (raw !== undefined && raw !== null && raw !== '') return formatApiErrorDetail(raw)
  if (typeof ax.message === 'string' && ax.message.trim()) return ax.message
  return fallback
}
