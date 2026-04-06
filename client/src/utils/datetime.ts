/**
 * 将后端返回的 UTC 时间格式化为北京时间（Asia/Shanghai），输出 YYYY-MM-DD HH:mm:ss。
 * 兼容无时区的 `YYYY-MM-DD HH:mm:ss`（按 UTC 解析，与 ORM 默认一致）。
 */
export function formatUtcToBeijing(value: string | undefined | null): string {
  if (value == null || !String(value).trim()) return '-'
  const raw = String(value).trim()

  let date: Date
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    date = new Date(raw.replace(' ', 'T'))
  } else {
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/)
    if (m) {
      date = new Date(`${m[1]}T${m[2]}Z`)
    } else {
      date = new Date(raw)
    }
  }

  if (Number.isNaN(date.getTime())) return raw.slice(0, 19)

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(p => p.type === type)?.value ?? ''

  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}
