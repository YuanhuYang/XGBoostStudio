import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Button, Card, Col, Collapse, Empty, Modal, Row, Space, Statistic, Select, Table, Tabs, Tag, Tooltip, Typography, message,
} from 'antd'
import { DashboardOutlined, DownloadOutlined, FilePdfOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import ReactECharts from 'echarts-for-react'
import apiClient, { BASE_URL } from '../../api/client'
import PDFViewer from '../../components/PDFViewer'
import { useAppStore, type PageHelpPayload } from '../../store/appStore'

const { Text } = Typography

const INTERNAL_METRIC_KEYS = new Set([
  'overfitting_level', 'overfitting_gap', 'train_accuracy', 'train_rmse',
  'early_stopped', 'best_round',
])
const LOWER_IS_BETTER = new Set(['rmse', 'mse', 'mae', 'mape', 'log_loss', 'logloss'])
/** 总览中小图最多直接展示的数量，其余收入「其它指标」折叠区 */
const OVERVIEW_CHART_LIMIT = 8
/** 主模型相对全局最优劣化超过该比例时标为「需关注」 */
const PRIMARY_GAP_ATTENTION = 0.05
const REGRESSION_FOCUS_KEYS = ['rmse', 'mse', 'mae', 'mape', 'r2', 'r_squared'] as const
const CLASSIFICATION_FOCUS_KEYS = ['auc', 'ks', 'accuracy', 'logloss', 'log_loss'] as const
const BAR_COLORS = ['#3b82f6', '#f59e0b', '#34d399', '#a855f7', '#f43f5e'] as const
/** 与 server/services/report_service.generate_comparison_report 参数表白名单一致 */
const COMPARE_PARAM_KEYS = [
  'n_estimators', 'max_depth', 'learning_rate', 'subsample', 'colsample_bytree', 'reg_alpha', 'reg_lambda',
] as const
interface ModelRecord {
  id: number
  name: string
  task_type: string
  metrics: Record<string, number>
  params: Record<string, unknown>
  dataset_id: number | null
  split_id?: number | null
  created_at: string
  notes?: string
}

function formatParamCell(v: unknown): string {
  if (v === undefined || v === null || v === '') return '-'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function computeMetricWinners(rows: ModelRecord[], keys: string[]): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const k of keys) {
    const lower = LOWER_IS_BETTER.has(k.toLowerCase())
    let bestId: number | null = null
    let bestVal: number | null = null
    for (const m of rows) {
      const v = m.metrics[k]
      if (typeof v !== 'number' || Number.isNaN(v)) continue
      if (bestVal === null) {
        bestVal = v
        bestId = m.id
      } else if (lower) {
        if (v < bestVal) {
          bestVal = v
          bestId = m.id
        }
      } else if (v > bestVal) {
        bestVal = v
        bestId = m.id
      }
    }
    out[k] = bestId
  }
  return out
}

function orderModelsByIds(rows: ModelRecord[], ids: number[]): ModelRecord[] {
  const map = new Map(rows.map(r => [r.id, r]))
  return ids.map(id => map.get(id)).filter((x): x is ModelRecord => x !== undefined)
}

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function orderMetricKeysForOverview(keys: string[], taskType: string): string[] {
  const focus = (taskType === 'classification' ? CLASSIFICATION_FOCUS_KEYS : REGRESSION_FOCUS_KEYS) as readonly string[]
  const picked: string[] = []
  for (const f of focus) {
    const hit = keys.find((k) => k.toLowerCase() === f)
    if (hit) picked.push(hit)
  }
  const rest = keys.filter((k) => !picked.includes(k))
  return [...picked, ...rest]
}

function getBestNumericValue(rows: ModelRecord[], key: string, lower: boolean): number | null {
  let best: number | null = null
  for (const m of rows) {
    const v = m.metrics[key]
    if (typeof v !== 'number' || Number.isNaN(v)) continue
    if (best === null) {
      best = v
    } else if (lower && v < best) {
      best = v
    } else if (!lower && v > best) {
      best = v
    }
  }
  return best
}

function relativeDeficitVsBest(primaryVal: number, bestVal: number, lowerBetter: boolean): number {
  const denom = Math.max(Math.abs(bestVal), 1e-12)
  if (lowerBetter) {
    return Math.max(0, primaryVal - bestVal) / denom
  }
  return Math.max(0, bestVal - primaryVal) / denom
}

interface PrimaryMetricLoss {
  key: string
  winnerName: string
  primaryVal: number
  bestVal: number
  relativeDeficit: number
  needsAttention: boolean
}

function computePrimaryModelInsights(
  rows: ModelRecord[],
  keys: string[],
  winners: Record<string, number | null>,
  primaryId: number | null,
  attentionThreshold: number,
): { winCount: number; comparable: number; losses: PrimaryMetricLoss[]; attention: PrimaryMetricLoss[] } {
  if (primaryId === null || rows.length === 0) {
    return { winCount: 0, comparable: 0, losses: [], attention: [] }
  }
  const primary = rows.find((r) => r.id === primaryId)
  if (!primary) return { winCount: 0, comparable: 0, losses: [], attention: [] }

  let winCount = 0
  let comparable = 0
  const losses: PrimaryMetricLoss[] = []

  for (const k of keys) {
    const pv = primary.metrics[k]
    if (typeof pv !== 'number' || Number.isNaN(pv)) continue
    comparable += 1
    const wid = winners[k]
    if (wid === primaryId) {
      winCount += 1
      continue
    }
    const lower = LOWER_IS_BETTER.has(k.toLowerCase())
    const bestVal = getBestNumericValue(rows, k, lower)
    if (bestVal === null) continue
    const winner = rows.find((r) => r.id === wid)
    const winnerName = winner?.name ?? `模型#${wid ?? '?'}`

    const rel = relativeDeficitVsBest(pv, bestVal, lower)
    const needsAttention = rel > attentionThreshold
    losses.push({
      key: k,
      winnerName,
      primaryVal: pv,
      bestVal,
      relativeDeficit: rel,
      needsAttention,
    })
  }

  const attention = losses.filter((l) => l.needsAttention)
  return { winCount, comparable, losses, attention }
}

/** 表头悬停说明：指标含义 + 优劣方向（与 LOWER_IS_BETTER 一致） */
function getMetricColumnTooltip(key: string): string {
  const lower = key.toLowerCase()
  const lowerBetter = LOWER_IS_BETTER.has(lower)
  const meaningByKey: Record<string, string> = {
    mse: '均方误差（Mean Squared Error）：预测误差平方的平均，整体误差规模。',
    rmse: '均方根误差（RMSE）：MSE 的平方根，与目标变量同量纲。',
    mae: '平均绝对误差（MAE）：绝对误差的平均，对离群点相对稳健。',
    mape: '平均绝对百分比误差（MAPE）：相对误差的平均，便于跨量级比较。',
    r2: '决定系数 R²：模型解释方差的比例，越接近 1 表示拟合越好。',
    r_squared: '决定系数 R²：与 r2 同义。',
    auc: 'AUC：ROC 曲线下面积，衡量排序/区分能力。',
    ks: 'KS 统计量：正负样本累积分布的最大分离程度。',
    accuracy: '准确率：预测正确的样本比例。',
    logloss: '对数损失（Log Loss）：概率预测与真实标签的差异，概率校准越差损失越大。',
    log_loss: '对数损失：与 logloss 同义。',
  }
  const meaning = meaningByKey[lower] ?? `验证集指标「${key}」。`
  const impact = lowerBetter
    ? '影响方向：越小越好（列标题 ↓）。在对比集合中，该列绿色加粗为全局最优。'
    : '影响方向：越大越好（列标题 ↑）。在对比集合中，该列绿色加粗为全局最优。'
  return `${meaning}\n${impact}`
}

/** 在可比较指标上「获胜」次数最多的模型作为系统推荐（并列时取较小模型 ID，结果稳定） */
function computeRecommendedModelId(
  rows: ModelRecord[],
  keys: string[],
  winners: Record<string, number | null>,
): number | null {
  if (rows.length === 0 || keys.length === 0) return null
  const winCounts = new Map<number, number>()
  for (const m of rows) winCounts.set(m.id, 0)
  for (const k of keys) {
    const wid = winners[k]
    if (wid !== null) winCounts.set(wid, (winCounts.get(wid) ?? 0) + 1)
  }
  let bestId: number | null = null
  let bestCount = -1
  for (const m of rows) {
    const c = winCounts.get(m.id) ?? 0
    if (c > bestCount) {
      bestCount = c
      bestId = m.id
    } else if (c === bestCount && bestId !== null && m.id < bestId) {
      bestId = m.id
    }
  }
  return bestId
}

function buildMetricMiniBarOption(metricKey: string, rows: ModelRecord[], winners: Record<string, number | null>) {
  const winnerId = winners[metricKey]
  const labelSuffix = LOWER_IS_BETTER.has(metricKey.toLowerCase()) ? ' ↓' : ' ↑'
  const longNames = rows.some((m) => m.name.length > 14)
  return {
    title: {
      text: `${metricKey}${labelSuffix}`,
      left: 'center',
      textStyle: { color: '#94a3b8', fontSize: 12 },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (items: { seriesName?: string; value?: number; dataIndex?: number }[]) => {
        if (!items?.length) return ''
        const idx = items[0].dataIndex ?? 0
        const m = rows[idx]
        const v = m?.metrics[metricKey]
        const isWin = m && winnerId === m.id
        const valStr = typeof v === 'number' && !Number.isNaN(v) ? Number(v.toFixed(6)) : String(v ?? '—')
        const winHint = isWin ? '（全局最优）' : ''
        return `${m?.name ?? ''}${winHint}<br/>${metricKey}: ${valStr}`
      },
    },
    grid: { left: 52, right: 12, top: 40, bottom: longNames ? 52 : 32 },
    xAxis: {
      type: 'category',
      data: rows.map((m) => m.name),
      axisLabel: { color: '#94a3b8', fontSize: 10, rotate: longNames ? 28 : 0, interval: 0 },
    },
    yAxis: { type: 'value', axisLabel: { color: '#94a3b8', fontSize: 10 } },
    series: [
      {
        type: 'bar',
        name: metricKey,
        data: rows.map((m, idx) => {
          const raw = m.metrics[metricKey]
          const v = typeof raw === 'number' && !Number.isNaN(raw) ? Number(raw.toFixed(4)) : 0
          const isWinner = winnerId === m.id
          return {
            value: v,
            itemStyle: {
              color: isWinner ? '#34d399' : BAR_COLORS[idx % BAR_COLORS.length],
            },
          }
        }),
      },
    ],
  }
}

function buildRadarOption(rows: ModelRecord[], metricKeys: string[]) {
  if (rows.length === 0 || metricKeys.length === 0) return null
  const metricMax: Record<string, number> = {}
  metricKeys.forEach((k) => {
    const vals = rows.map((m) => m.metrics[k] ?? 0)
    const actualMax = Math.max(...vals)
    metricMax[k] = LOWER_IS_BETTER.has(k.toLowerCase())
      ? actualMax * 1.3
      : Math.max(1, actualMax * 1.1)
  })
  return {
    tooltip: {},
    legend: { textStyle: { color: '#94a3b8' }, data: rows.map((m) => m.name) },
    radar: {
      indicator: metricKeys.map((k) => ({
        name: LOWER_IS_BETTER.has(k.toLowerCase()) ? `${k} ↓` : k,
        max: metricMax[k],
      })),
      axisName: { color: '#94a3b8', fontSize: 12 },
    },
    series: [
      {
        type: 'radar',
        data: rows.map((m, idx) => ({
          name: m.name,
          value: metricKeys.map((k) => {
            const v = m.metrics[k] ?? 0
            return LOWER_IS_BETTER.has(k.toLowerCase()) ? Math.max(0, metricMax[k] - v) : v
          }),
          areaStyle: { opacity: 0.15 },
          itemStyle: { color: ['#3b82f6', '#f59e0b', '#34d399', '#a855f7', '#f43f5e'][idx % 5] },
        })),
      },
    ],
  }
}

function buildSingleModelMetricColumns(
  metricKeys: string[],
  metricWinners: Record<string, number | null>,
): ColumnsType<Record<string, unknown>> {
  return metricKeys.map((k) => ({
    title: (
      <Tooltip
        title={<span style={{ whiteSpace: 'pre-line' }}>{getMetricColumnTooltip(k)}</span>}
        placement="topLeft"
      >
        <span style={{ cursor: 'help', borderBottom: '1px dotted #64748b' }}>
          {k}{LOWER_IS_BETTER.has(k.toLowerCase()) ? ' ↓' : ' ↑'}
        </span>
      </Tooltip>
    ),
    dataIndex: k,
    key: k,
    render: (_: unknown, row: Record<string, unknown>) => {
      const cell = row[k]
      const wid = metricWinners[k]
      const isWinner = wid !== null && wid === row.id
      return (
        <Text style={isWinner ? { color: '#34d399', fontWeight: 700 } : undefined}>
          {cell as string}
        </Text>
      )
    },
  }))
}

const EXPERT_HELP_EMPTY: PageHelpPayload = {
  pageTitle: '模型工作台',
  items: [
    {
      title: '这个页面做什么？',
      content:
        '在专家分析模式下查看当前主模型的验证指标摘要，并快捷跳转模型评估、分析报告、交互预测与导出 .ubj；训练与超参请切换到「模型调优」。适合 CLI AutoML 跑完后从深链进入。',
    },
    {
      title: '如何选定模型？',
      content: '在顶栏选择主模型与训练划分，或从「模型管理」进入；本工作台始终只展示一个主模型上下文。',
    },
    {
      title: '结果还在哪看？',
      content:
        '更完整的单模型性能图表与说明在「模型评估」；含预处理审计与数据统计的 PDF 在「报告」页生成（需勾选数据关系相关章节）。',
    },
  ],
}

const EXPERT_HELP_SINGLE: PageHelpPayload = {
  pageTitle: '模型工作台',
  items: [
    {
      title: '单模型时怎么看全？',
      content:
        '「总览」提供指标明细表与各指标小图（表头悬停可看说明）；另有雷达图、单指标柱状、训练参数等标签。学习曲线、混淆矩阵等深度图表见「模型评估」；专业 PDF 在「报告」页生成。',
    },
    {
      title: '如何切换模型？',
      content:
        '本页只展示顶栏当前主模型。要查看其它训练结果，请在顶栏更换主模型，或到「模型管理」选定后再回到专家分析。',
    },
    {
      title: '多模型对比在哪？',
      content:
        '在专家分析模式顶栏「对比模型」多选同划分下的其它模型（含主模型至多 8 个），本页会切换为多模型并排对比（含差值列与推荐标签）；也可在「模型管理」勾选多个模型打开弹窗对比（与工作台状态独立）。',
    },
  ],
}

const EXPERT_HELP_COMPARE: PageHelpPayload = {
  pageTitle: '模型工作台',
  items: [
    {
      title: '总览',
      content:
        '默认打开「总览」：先展示指标明细表（表头悬停可看指标说明），再展示各指标小柱状图（独立纵轴），并有主模型相对全局最优的提示。超过 8 个指标时其余收入「其它指标」折叠区。',
    },
    {
      title: '基准模型',
      content:
        '顶栏「主模型」为基准；工作台内也可切换基准。AUC/KS 差值相对基准计算，并同步顶栏主模型上下文。',
    },
    {
      title: '导出与预览',
      content:
        'CSV/JSON 导出当前表中的指标列；.ubj 为 XGBoost 模型文件；「预览对比 PDF」在页面内打开，可在预览工具栏下载；「下载 PDF」直接落盘。参数对比见「参数对比」标签，与 PDF 第二节一致。',
    },
    {
      title: '与报告、评估的分工',
      content:
        '本页侧重多模型横向对比；单模型深度图表在「模型评估」。含数据叙事与预处理审计的单模型 PDF 在「报告」页生成（对比 PDF 此处为指标与参数对照）。',
    },
  ],
}

const ExpertWorkbenchPage: React.FC = () => {
  const activeDatasetId = useAppStore(s => s.activeDatasetId)
  const activeDatasetName = useAppStore(s => s.activeDatasetName)
  const activeSplitId = useAppStore(s => s.activeSplitId)
  const activeModelId = useAppStore(s => s.activeModelId)
  const expertCompareModelIds = useAppStore(s => s.expertCompareModelIds)
  const setActiveModelId = useAppStore(s => s.setActiveModelId)
  const setPageHelpOverride = useAppStore(s => s.setPageHelpOverride)
  const effectiveIds = useMemo(() => {
    if (expertCompareModelIds.length > 0) return expertCompareModelIds
    if (activeModelId !== null) return [activeModelId]
    return []
  }, [expertCompareModelIds, activeModelId])

  const [singleMeta, setSingleMeta] = useState<ModelRecord | null>(null)
  const [compareRows, setCompareRows] = useState<ModelRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [compareReportLoading, setCompareReportLoading] = useState(false)
  const [comparePdfModalOpen, setComparePdfModalOpen] = useState(false)
  const [comparePdfReportId, setComparePdfReportId] = useState<number | null>(null)
  const [comparePdfFilename, setComparePdfFilename] = useState('compare_report.pdf')
  /** 与当前对比集合一致时，「下载 PDF」可复用已生成报告，避免重复 POST */
  const [lastComparePdfMeta, setLastComparePdfMeta] = useState<{ id: number; idsKey: string } | null>(null)
  const [barMetricKey, setBarMetricKey] = useState<string | null>(null)
  /** 单模型「单指标柱状」所选指标（与多模型对比的 barMetricKey 分离，避免单模型时 compareMetricKeys 为空被清空） */
  const [singleBarMetricKey, setSingleBarMetricKey] = useState<string | null>(null)
  const loadSingle = useCallback(async (id: number) => {
    setLoading(true)
    try {
      const r = await apiClient.get(`/api/models/${id}`)
      setSingleMeta(r.data as ModelRecord)
      setCompareRows([])
    } catch {
      message.error('加载模型失败')
      setSingleMeta(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadCompare = useCallback(async (ids: number[]) => {
    if (ids.length < 2) return
    setLoading(true)
    try {
      const r = await apiClient.get('/api/models/compare', { params: { ids: ids.join(',') } })
      const raw = (r.data || []) as ModelRecord[]
      setCompareRows(orderModelsByIds(raw, ids))
      setSingleMeta(null)
    } catch {
      message.error('加载对比数据失败')
      setCompareRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (effectiveIds.length === 0) {
      setSingleMeta(null)
      setCompareRows([])
      return
    }
    if (effectiveIds.length === 1) {
      void loadSingle(effectiveIds[0])
      return
    }
    void loadCompare(effectiveIds)
  }, [effectiveIds.join(','), loadSingle, loadCompare])

  useEffect(() => {
    if (effectiveIds.length === 0) setPageHelpOverride(EXPERT_HELP_EMPTY)
    else if (effectiveIds.length >= 2) setPageHelpOverride(EXPERT_HELP_COMPARE)
    else setPageHelpOverride(EXPERT_HELP_SINGLE)
  }, [effectiveIds.length, effectiveIds.join(','), setPageHelpOverride])

  useEffect(() => {
    return () => {
      setPageHelpOverride(null)
    }
  }, [setPageHelpOverride])

  useEffect(() => {
    if (compareRows.length < 2) return
    const ids = compareRows.map(m => m.id)
    if (activeModelId !== null && ids.includes(activeModelId)) return
    setActiveModelId(ids[0])
  }, [compareRows, activeModelId, setActiveModelId])

  const compareRowsIdsKey = useMemo(
    () => [...compareRows.map((m) => m.id)].sort((a, b) => a - b).join(','),
    [compareRows],
  )

  useEffect(() => {
    setLastComparePdfMeta(null)
  }, [compareRowsIdsKey])

  const compareMetricKeys = compareRows.length > 0
    ? [...new Set(compareRows.flatMap(m => Object.keys(m.metrics || {})))].filter(k => !INTERNAL_METRIC_KEYS.has(k))
    : []

  useEffect(() => {
    if (compareMetricKeys.length === 0) {
      setBarMetricKey(null)
      return
    }
    setBarMetricKey((prev) => (prev && compareMetricKeys.includes(prev) ? prev : compareMetricKeys[0]))
  }, [compareMetricKeys.join(',')])

  const metricWinners = useMemo(
    () => computeMetricWinners(compareRows, compareMetricKeys),
    [compareRows, compareMetricKeys.join(',')],
  )

  const singleMetricKeys = useMemo(() => {
    if (!singleMeta) return [] as string[]
    return [...new Set(Object.keys(singleMeta.metrics || {}))].filter((k) => !INTERNAL_METRIC_KEYS.has(k))
  }, [singleMeta])

  useEffect(() => {
    if (effectiveIds.length !== 1) return
    if (singleMetricKeys.length === 0) {
      setSingleBarMetricKey(null)
      return
    }
    setSingleBarMetricKey((prev) => (prev && singleMetricKeys.includes(prev) ? prev : singleMetricKeys[0] ?? null))
  }, [effectiveIds.join(','), singleMetricKeys.join(',')])

  const singleMetricWinners = useMemo(
    () => (singleMeta && singleMetricKeys.length > 0 ? computeMetricWinners([singleMeta], singleMetricKeys) : {}),
    [singleMeta, singleMetricKeys.join(',')],
  )

  const singleOverviewOrderedMetricKeys = useMemo(
    () => orderMetricKeysForOverview(singleMetricKeys, singleMeta?.task_type ?? 'regression'),
    [singleMetricKeys.join(','), singleMeta?.task_type],
  )
  const singleOverviewCoreKeys = singleOverviewOrderedMetricKeys.slice(0, OVERVIEW_CHART_LIMIT)
  const singleOverviewExtraKeys = singleOverviewOrderedMetricKeys.slice(OVERVIEW_CHART_LIMIT)

  const singleTableData = useMemo(() => {
    if (!singleMeta) return [] as Record<string, unknown>[]
    const m = singleMeta
    return [
      {
        key: m.id,
        id: m.id,
        name: m.name,
        task_type: m.task_type,
        ...Object.fromEntries(
          Object.entries(m.metrics)
            .filter(([k]) => !INTERNAL_METRIC_KEYS.has(k))
            .map(([k, v]) => [k, typeof v === 'number' ? v.toFixed(4) : v]),
        ),
      },
    ]
  }, [singleMeta])

  const singleParamRows = useMemo(() => {
    if (!singleMeta) return [] as { key: string; param: string; value: string }[]
    const p = singleMeta.params || {}
    return COMPARE_PARAM_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(p, k)).map((k) => ({
      key: k,
      param: k,
      value: formatParamCell(p[k]),
    }))
  }, [singleMeta])

  const paramCompareRows = useMemo(() => {
    if (compareRows.length === 0) return []
    const allParams = compareRows.map((r) => r.params || {})
    const keys = COMPARE_PARAM_KEYS.filter((k) => allParams.some((p) => Object.prototype.hasOwnProperty.call(p, k)))
    return keys.map((k) => {
      const row: Record<string, unknown> = { key: k, param: k }
      for (const m of compareRows) {
        row[`mid_${m.id}`] = formatParamCell(m.params?.[k])
      }
      return row
    })
  }, [compareRows])

  const paramCompareColumns: ColumnsType<Record<string, unknown>> = useMemo(
    () => [
      {
        title: '参数',
        dataIndex: 'param',
        key: 'param',
        width: 160,
        fixed: 'left' as const,
        render: (v) => <Text code style={{ color: '#e2e8f0' }}>{v as string}</Text>,
      },
      ...compareRows.map((m) => ({
        title: `${m.name} (#${m.id})`,
        dataIndex: `mid_${m.id}`,
        key: `mid_${m.id}`,
      })),
    ],
    [compareRows],
  )

  const baseModel = compareRows.find(m => m.id === activeModelId) ?? compareRows[0]
  const baseAuc = baseModel?.metrics?.auc ?? null
  const baseKs = baseModel?.metrics?.ks ?? null

  const overviewOrderedMetricKeys = useMemo(
    () => orderMetricKeysForOverview(compareMetricKeys, baseModel?.task_type ?? 'regression'),
    [compareMetricKeys.join(','), baseModel?.task_type],
  )
  const overviewCoreKeys = overviewOrderedMetricKeys.slice(0, OVERVIEW_CHART_LIMIT)
  const overviewExtraKeys = overviewOrderedMetricKeys.slice(OVERVIEW_CHART_LIMIT)

  const primaryInsights = useMemo(
    () => computePrimaryModelInsights(compareRows, compareMetricKeys, metricWinners, activeModelId, PRIMARY_GAP_ATTENTION),
    [compareRows, compareMetricKeys.join(','), metricWinners, activeModelId],
  )

  const recommendedModelId = useMemo(
    () => computeRecommendedModelId(compareRows, compareMetricKeys, metricWinners),
    [compareRows, compareMetricKeys.join(','), metricWinners],
  )

  const radarOption = useMemo(
    () => buildRadarOption(compareRows, compareMetricKeys),
    [compareRows, compareMetricKeys.join(',')],
  )

  const singleRadarOption = useMemo(
    () => (singleMeta ? buildRadarOption([singleMeta], singleMetricKeys) : null),
    [singleMeta, singleMetricKeys.join(',')],
  )

  const effectiveBarKey =
    barMetricKey && compareMetricKeys.includes(barMetricKey) ? barMetricKey : compareMetricKeys[0]
  const barSingleOption =
    compareRows.length > 0 && effectiveBarKey
      ? {
          tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
          legend: { textStyle: { color: '#94a3b8' }, data: compareRows.map((m) => m.name) },
          xAxis: { type: 'category', data: [effectiveBarKey], axisLabel: { color: '#94a3b8' } },
          yAxis: { type: 'value', axisLabel: { color: '#94a3b8' } },
          series: compareRows.map((m, idx) => ({
            name: m.name,
            type: 'bar',
            data: [
              typeof m.metrics[effectiveBarKey] === 'number'
                ? Number(m.metrics[effectiveBarKey].toFixed(4))
                : 0,
            ],
            itemStyle: { color: ['#3b82f6', '#f59e0b', '#34d399', '#a855f7', '#f43f5e'][idx % 5] },
          })),
        }
      : null

  const effectiveSingleBarKey =
    singleBarMetricKey && singleMetricKeys.includes(singleBarMetricKey)
      ? singleBarMetricKey
      : singleMetricKeys[0] ?? null

  const singleBarOption = useMemo(() => {
    if (!singleMeta || !effectiveSingleBarKey) return null
    const raw = singleMeta.metrics[effectiveSingleBarKey]
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { textStyle: { color: '#94a3b8' }, data: [singleMeta.name] },
      xAxis: { type: 'category', data: [effectiveSingleBarKey], axisLabel: { color: '#94a3b8' } },
      yAxis: { type: 'value', axisLabel: { color: '#94a3b8' } },
      series: [
        {
          name: singleMeta.name,
          type: 'bar',
          data: [typeof raw === 'number' ? Number(raw.toFixed(4)) : 0],
          itemStyle: { color: '#3b82f6' },
        },
      ],
    }
  }, [singleMeta, effectiveSingleBarKey])

  const handleExportUbj = useCallback(async (id: number, name: string) => {
    try {
      const r = await apiClient.post(`/api/models/${id}/export`, {}, { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name}.ubj`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      message.error('导出模型文件失败')
    }
  }, [])

  const exportCompareJson = () => {
    const payload = compareRows.map(m => ({
      id: m.id,
      name: m.name,
      task_type: m.task_type,
      metrics: m.metrics,
      primary_model_id: activeModelId ?? compareRows[0]?.id ?? null,
    }))
    downloadText(`model_compare_${compareRows.map(m => m.id).join('_')}.json`, JSON.stringify(payload, null, 2), 'application/json')
    message.success('已导出 JSON')
  }

  const exportCompareCsv = () => {
    if (compareRows.length === 0) return
    const keys = [...new Set(compareRows.flatMap(m => Object.keys(m.metrics || {})))].filter(k => !INTERNAL_METRIC_KEYS.has(k))
    const header = ['id', 'name', 'task_type', ...keys]
    const lines = [header.join(',')]
    for (const m of compareRows) {
      const cells = [
        String(m.id),
        JSON.stringify(m.name),
        m.task_type,
        ...keys.map(k => {
          const v = m.metrics[k]
          return v === undefined ? '' : String(v)
        }),
      ]
      lines.push(cells.join(','))
    }
    downloadText(`model_compare_${compareRows.map(m => m.id).join('_')}.csv`, lines.join('\n'), 'text/csv;charset=utf-8')
    message.success('已导出 CSV')
  }

  const postCompareReport = async () => {
    if (compareRows.length < 2) return null
    const ids = compareRows.map((m) => m.id)
    const names = compareRows.map((m) => m.name).join(' vs ')
    const resp = await apiClient.post('/api/reports/compare', {
      model_ids: ids,
      title: `多模型对比报告 — ${names}`,
    })
    return { id: resp.data.id as number, ids }
  }

  const handleComparePdfPreview = async () => {
    if (compareRows.length < 2) return
    setCompareReportLoading(true)
    try {
      const result = await postCompareReport()
      if (!result) return
      const idsKey = [...result.ids].sort((a, b) => a - b).join(',')
      setComparePdfReportId(result.id)
      setLastComparePdfMeta({ id: result.id, idsKey })
      setComparePdfFilename(`compare_report_${result.ids.join('_')}.pdf`)
      setComparePdfModalOpen(true)
      message.success('对比报告已生成，可在预览中查看或下载')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '生成对比报告失败')
    } finally {
      setCompareReportLoading(false)
    }
  }

  const handleComparePdfDownloadOnly = async () => {
    if (compareRows.length < 2) return
    setCompareReportLoading(true)
    try {
      let reportId: number
      let fileIds: number[]
      if (lastComparePdfMeta && lastComparePdfMeta.idsKey === compareRowsIdsKey) {
        reportId = lastComparePdfMeta.id
        fileIds = compareRows.map((m) => m.id)
      } else {
        const result = await postCompareReport()
        if (!result) return
        reportId = result.id
        fileIds = result.ids
        const idsKey = [...result.ids].sort((a, b) => a - b).join(',')
        setLastComparePdfMeta({ id: reportId, idsKey })
      }
      const r = await apiClient.get(`/api/reports/${reportId}/download`, { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `compare_report_${fileIds.join('_')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      message.success('对比 PDF 已下载')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '生成对比报告失败')
    } finally {
      setCompareReportLoading(false)
    }
  }

  const go = (page: string) => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: page }))
  }

  const tableData = compareRows.map(m => {
    const isBase = m.id === baseModel?.id
    const aucDiff = !isBase && baseAuc !== null && m.metrics?.auc !== undefined
      ? m.metrics.auc - baseAuc
      : null
    const ksDiff = !isBase && baseKs !== null && m.metrics?.ks !== undefined
      ? m.metrics.ks - baseKs
      : null
    return {
      key: m.id,
      id: m.id,
      name: m.name,
      task_type: m.task_type,
      isBase,
      _aucDiff: aucDiff,
      _ksDiff: ksDiff,
      ...Object.fromEntries(
        Object.entries(m.metrics)
          .filter(([k]) => !INTERNAL_METRIC_KEYS.has(k))
          .map(([k, v]) => [k, typeof v === 'number' ? v.toFixed(4) : v]),
      ),
    }
  })

  const compareTableColumns: ColumnsType<Record<string, unknown>> = useMemo(
    () => [
      {
        title: '角色',
        key: 'role',
        width: 108,
        render: (_, row) => {
          const id = row.id as number
          const isBase = id === activeModelId
          const isRec = recommendedModelId !== null && id === recommendedModelId
          const label = `${isBase ? '基准' : '候选'}${isRec ? '（推荐）' : ''}`
          const tagColor = isBase ? 'gold' : isRec ? 'green' : 'default'
          return <Tag color={tagColor}>{label}</Tag>
        },
      },
      { title: '模型', dataIndex: 'name', key: 'name', render: v => <Text strong style={{ color: '#60a5fa' }}>{v as string}</Text> },
      { title: '类型', dataIndex: 'task_type', key: 'task_type', render: v => <Tag color={v === 'classification' ? 'blue' : 'orange'}>{v as string}</Tag> },
      ...compareMetricKeys.map((k) => ({
        title: (
          <Tooltip
            title={<span style={{ whiteSpace: 'pre-line' }}>{getMetricColumnTooltip(k)}</span>}
            placement="topLeft"
          >
            <span style={{ cursor: 'help', borderBottom: '1px dotted #64748b' }}>
              {k}{LOWER_IS_BETTER.has(k.toLowerCase()) ? ' ↓' : ' ↑'}
            </span>
          </Tooltip>
        ),
        dataIndex: k,
        key: k,
        render: (_: unknown, row: Record<string, unknown>) => {
          const cell = row[k]
          const wid = metricWinners[k]
          const isWinner = wid !== null && wid === row.id
          return (
            <Text style={isWinner ? { color: '#34d399', fontWeight: 700 } : undefined}>
              {cell as string}
            </Text>
          )
        },
      })),
      {
        title: (
          <Tooltip
            title="相对当前「主模型（基准）」的 AUC 差值：候选模型 AUC − 基准 AUC；正表示该候选在 AUC 上优于基准。"
            placement="topLeft"
          >
            <span style={{ cursor: 'help', borderBottom: '1px dotted #64748b' }}>AUC 差值</span>
          </Tooltip>
        ),
        dataIndex: '_aucDiff',
        key: '_aucDiff',
        render: (v: number | null) => v === null ? <Text style={{ color: '#475569' }}>—（基准）</Text> : (
          <Text style={{ color: v >= 0 ? '#34d399' : '#f87171', fontWeight: 600 }}>
            {v >= 0 ? '+' : ''}{v.toFixed(4)}
          </Text>
        ),
      },
      {
        title: (
          <Tooltip
            title="相对当前「主模型（基准）」的 KS 差值：候选 KS − 基准 KS；正表示该候选在 KS 上优于基准。"
            placement="topLeft"
          >
            <span style={{ cursor: 'help', borderBottom: '1px dotted #64748b' }}>KS 差值</span>
          </Tooltip>
        ),
        dataIndex: '_ksDiff',
        key: '_ksDiff',
        render: (v: number | null) => v === null ? <Text style={{ color: '#475569' }}>—（基准）</Text> : (
          <Text style={{ color: v >= 0 ? '#34d399' : '#f87171', fontWeight: 600 }}>
            {v >= 0 ? '+' : ''}{v.toFixed(4)}
          </Text>
        ),
      },
      {
        title: '导出',
        key: 'exp',
        width: 100,
        render: (_, row) => (
          <Button size="small" icon={<DownloadOutlined />} onClick={() => handleExportUbj(row.id as number, row.name as string)}>
            .ubj
          </Button>
        ),
      },
    ],
    [compareMetricKeys, metricWinners, activeModelId, recommendedModelId, handleExportUbj],
  )

  const singleTableColumns: ColumnsType<Record<string, unknown>> = useMemo(
    () => [
      {
        title: '模型',
        dataIndex: 'name',
        key: 'name',
        render: (v) => <Text strong style={{ color: '#60a5fa' }}>{v as string}</Text>,
      },
      {
        title: '类型',
        dataIndex: 'task_type',
        key: 'task_type',
        render: (v) => <Tag color={v === 'classification' ? 'blue' : 'orange'}>{v as string}</Tag>,
      },
      ...buildSingleModelMetricColumns(singleMetricKeys, singleMetricWinners),
      {
        title: '导出',
        key: 'exp',
        width: 100,
        render: (_, row) => (
          <Button size="small" icon={<DownloadOutlined />} onClick={() => handleExportUbj(row.id as number, row.name as string)}>
            .ubj
          </Button>
        ),
      },
    ],
    [singleMetricKeys, singleMetricWinners, handleExportUbj],
  )

  const singleParamColumns: ColumnsType<{ key: string; param: string; value: string }> = [
    {
      title: '参数',
      dataIndex: 'param',
      key: 'param',
      width: 180,
      fixed: 'left' as const,
      render: (v) => <Text code style={{ color: '#e2e8f0' }}>{v as string}</Text>,
    },
    { title: '值', dataIndex: 'value', key: 'value' },
  ]

  if (effectiveIds.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 16, background: '#1e293b', borderColor: '#334155' }}
          message="尚未选择模型"
          description="请先在顶栏选择主模型与训练划分，或到「模型管理」选定模型后再使用专家分析模式。"
        />
        <Space style={{ marginTop: 16 }}>
          <Button type="primary" onClick={() => go('model-management')}>前往模型管理</Button>
          <Button onClick={() => go('data-import')}>数据工作台</Button>
        </Space>
      </div>
    )
  }

  if (effectiveIds.length === 1 && singleMeta) {
    const m = singleMeta
    const singleMetricsTable = (
      <Table
        size="small"
        dataSource={singleTableData}
        columns={singleTableColumns}
        pagination={false}
        scroll={{ x: 'max-content' }}
      />
    )
    const singleOverviewPanel =
      singleMetricKeys.length === 0 ? (
        <Empty description="无验证指标" />
      ) : (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div>
            <Text strong style={{ color: '#e2e8f0', display: 'block', marginBottom: 8 }}>指标明细</Text>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12, color: '#94a3b8' }}>
              表头指标名可悬停查看含义与优劣方向。在顶栏「对比模型」多选同划分模型时，本页会切换为并排对比与差值列。
            </Text>
            {singleMetricsTable}
          </div>
          <div>
            <Text style={{ color: '#94a3b8', display: 'block', marginBottom: 12 }}>
              各指标可视化（每张子图独立纵轴；单模型下该模型即为各指标上的参照）
            </Text>
            <Row gutter={[12, 12]}>
              {singleOverviewCoreKeys.map((k) => (
                <Col xs={24} sm={12} lg={8} key={k}>
                  <div style={{ background: '#0f172a', borderRadius: 8, border: '1px solid #334155', padding: '4px 4px 0' }}>
                    <ReactECharts
                      option={buildMetricMiniBarOption(k, [m], singleMetricWinners)}
                      style={{ height: 240 }}
                    />
                  </div>
                </Col>
              ))}
            </Row>
            {singleOverviewExtraKeys.length > 0 && (
              <Collapse
                style={{ marginTop: 12, background: '#0f172a', borderColor: '#334155' }}
                items={[
                  {
                    key: 'single-more-metrics',
                    label: `其它指标（${singleOverviewExtraKeys.length}）`,
                    children: (
                      <Row gutter={[12, 12]}>
                        {singleOverviewExtraKeys.map((k) => (
                          <Col xs={24} sm={12} lg={8} key={k}>
                            <div style={{ background: '#0f172a', borderRadius: 8, border: '1px solid #334155', padding: '4px 4px 0' }}>
                              <ReactECharts
                                option={buildMetricMiniBarOption(k, [m], singleMetricWinners)}
                                style={{ height: 240 }}
                              />
                            </div>
                          </Col>
                        ))}
                      </Row>
                    ),
                  },
                ]}
              />
            )}
          </div>
        </Space>
      )
    return (
      <div style={{ padding: 24 }}>
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={8}>
            <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
              <Statistic title="模型" value={m.name} valueStyle={{ color: '#60a5fa', fontSize: 16 }} />
            </Card>
          </Col>
          <Col span={8}>
            <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
              <Statistic title="任务类型" value={m.task_type} valueStyle={{ fontSize: 16 }} />
            </Card>
          </Col>
          <Col span={8}>
            <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
              <Statistic title="模型 ID" value={m.id} valueStyle={{ fontSize: 16 }} />
            </Card>
          </Col>
        </Row>
        <Card loading={loading} style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
          <Tabs
            defaultActiveKey="overview"
            items={[
              {
                key: 'overview',
                label: (
                  <span>
                    <DashboardOutlined /> 总览
                  </span>
                ),
                children: singleOverviewPanel,
              },
              {
                key: 'radar',
                label: '雷达图',
                children: singleRadarOption ? (
                  <ReactECharts option={singleRadarOption} style={{ height: 380 }} />
                ) : (
                  <Empty description="无可展示指标" />
                ),
              },
              {
                key: 'bar',
                label: '单指标柱状',
                children:
                  singleBarOption && effectiveSingleBarKey ? (
                    <Space direction="vertical" style={{ width: '100%' }} size="middle">
                      <Space align="center" wrap>
                        <Text style={{ color: '#94a3b8' }}>指标</Text>
                        <Select
                          style={{ minWidth: 200 }}
                          value={effectiveSingleBarKey}
                          options={singleMetricKeys.map((k) => ({
                            value: k,
                            label: `${k}${LOWER_IS_BETTER.has(k.toLowerCase()) ? ' ↓' : ' ↑'}`,
                          }))}
                          onChange={(v) => setSingleBarMetricKey(v)}
                        />
                      </Space>
                      <ReactECharts option={singleBarOption} style={{ height: 380 }} />
                    </Space>
                  ) : (
                    <Empty description="无可展示指标" />
                  ),
              },
              {
                key: 'table',
                label: '数据表',
                children: singleMetricKeys.length === 0 ? <Empty description="无验证指标" /> : singleMetricsTable,
              },
              {
                key: 'params',
                label: '训练参数',
                children:
                  singleParamRows.length > 0 ? (
                    <Table
                      size="small"
                      dataSource={singleParamRows}
                      columns={singleParamColumns}
                      pagination={false}
                      scroll={{ x: 'max-content' }}
                    />
                  ) : (
                    <Empty description="当前模型无白名单内的训练参数键（与对比报告参数表范围一致）" />
                  ),
              },
            ]}
          />
          <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
            「总览」含指标明细与各指标小图；表头悬停可查看含义与方向。学习曲线等深度分析见「模型评估」。
          </div>
        </Card>
      </div>
    )
  }

  if (effectiveIds.length === 1 && !singleMeta && loading) {
    return (
      <div style={{ padding: 24 }}>
        <Card loading style={{ background: '#1e293b', border: '1px solid #334155' }} />
      </div>
    )
  }

  if (effectiveIds.length >= 2) {
    return (
      <div style={{ padding: 24 }}>
        <Row gutter={16} style={{ marginBottom: 16 }} align="middle">
          <Col flex="none">
            <Space align="center" wrap size="middle">
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 {compareRows.length} 个模型 · {activeDatasetName ?? (activeDatasetId ? `数据集#${activeDatasetId}` : '—')}
              </Text>
              <Text style={{ color: '#94a3b8' }}>主模型（基准）</Text>
              <Select
                style={{ minWidth: 220 }}
                value={activeModelId ?? undefined}
                options={compareRows.map(m => ({ value: m.id, label: `${m.name} (#${m.id})` }))}
                onChange={v => setActiveModelId(v)}
              />
            </Space>
          </Col>
          <Col flex="auto">
            <Space wrap>
              <Button onClick={exportCompareCsv}>导出对比 CSV</Button>
              <Button onClick={exportCompareJson}>导出对比 JSON</Button>
              <Button type="primary" icon={<FilePdfOutlined />} loading={compareReportLoading} onClick={handleComparePdfPreview}>
                预览对比 PDF
              </Button>
              <Button icon={<DownloadOutlined />} loading={compareReportLoading} onClick={handleComparePdfDownloadOnly}>
                下载 PDF
              </Button>
            </Space>
          </Col>
        </Row>
        {(() => {
          const metricsCompareTable = (
            <Table
              size="small"
              dataSource={tableData}
              columns={compareTableColumns}
              pagination={false}
              scroll={{ x: 'max-content' }}
            />
          )
          const overviewPanel =
            compareMetricKeys.length === 0 ? (
              <Empty description="无可对比指标" />
            ) : (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <div>
                  {primaryInsights.comparable === 0 ? null : primaryInsights.winCount === primaryInsights.comparable ? (
                    <Alert
                      type="success"
                      showIcon
                      style={{ background: 'rgba(22, 163, 74, 0.12)', borderColor: '#166534' }}
                      message="主模型（基准）在所有可比较指标上均为全局最优"
                      description={`共 ${primaryInsights.comparable} 个指标；与「数据表」中绿色加粗语义一致。`}
                    />
                  ) : (
                    <Space direction="vertical" size="small" style={{ width: '100%' }}>
                      <Alert
                        type="info"
                        showIcon
                        style={{ background: '#1e293b', borderColor: '#334155' }}
                        message={`主模型（基准）在 ${primaryInsights.winCount} / ${primaryInsights.comparable} 个可比较指标上为全局最优`}
                        description="未达最优的指标见下方说明；相对差距为相对「全局最优值」的劣化比例。"
                      />
                      {primaryInsights.attention.length > 0 && (
                        <Alert
                          type="warning"
                          showIcon
                          message="需关注（相对劣于全局最优超过 5%）"
                          description={
                            <ul style={{ margin: 0, paddingLeft: 20 }}>
                              {primaryInsights.attention.map((l) => (
                                <li key={l.key}>
                                  <Text strong style={{ color: '#fbbf24' }}>{l.key}</Text>
                                  {'：劣于最优约 '}
                                  <Text strong>{(l.relativeDeficit * 100).toFixed(1)}%</Text>
                                  {`（最优：${l.winnerName}；基准 ${l.primaryVal.toFixed(4)} vs 最优 ${l.bestVal.toFixed(4)}）`}
                                </li>
                              ))}
                            </ul>
                          }
                        />
                      )}
                      {primaryInsights.losses.filter((l) => !l.needsAttention).length > 0 && (
                        <Alert
                          type="info"
                          showIcon
                          style={{ background: '#1e293b', borderColor: '#334155' }}
                          message="未达最优但差距在 5% 以内"
                          description={
                            <Space wrap size="small">
                              {primaryInsights.losses
                                .filter((l) => !l.needsAttention)
                                .map((l) => (
                                  <Tag key={l.key} color="default">
                                    {l.key} +{(l.relativeDeficit * 100).toFixed(1)}%
                                  </Tag>
                                ))}
                            </Space>
                          }
                        />
                      )}
                    </Space>
                  )}
                </div>
                <div>
                  <Text strong style={{ color: '#e2e8f0', display: 'block', marginBottom: 8 }}>指标明细</Text>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12, color: '#94a3b8' }}>
                    表头指标名可悬停查看含义与优劣方向；「（推荐）」表示在可对比指标上获胜次数最多的模型。
                  </Text>
                  {metricsCompareTable}
                </div>
                <div>
                  <Text style={{ color: '#94a3b8', display: 'block', marginBottom: 12 }}>
                    各指标并排对比（每张子图独立纵轴；绿色柱为当前指标的全局最优模型）
                  </Text>
                  <Row gutter={[12, 12]}>
                    {overviewCoreKeys.map((k) => (
                      <Col xs={24} sm={12} lg={8} key={k}>
                        <div style={{ background: '#0f172a', borderRadius: 8, border: '1px solid #334155', padding: '4px 4px 0' }}>
                          <ReactECharts
                            option={buildMetricMiniBarOption(k, compareRows, metricWinners)}
                            style={{ height: 240 }}
                          />
                        </div>
                      </Col>
                    ))}
                  </Row>
                  {overviewExtraKeys.length > 0 && (
                    <Collapse
                      style={{ marginTop: 12, background: '#0f172a', borderColor: '#334155' }}
                      items={[
                        {
                          key: 'more-metrics',
                          label: `其它指标（${overviewExtraKeys.length}）`,
                          children: (
                            <Row gutter={[12, 12]}>
                              {overviewExtraKeys.map((k) => (
                                <Col xs={24} sm={12} lg={8} key={k}>
                                  <div style={{ background: '#0f172a', borderRadius: 8, border: '1px solid #334155', padding: '4px 4px 0' }}>
                                    <ReactECharts
                                      option={buildMetricMiniBarOption(k, compareRows, metricWinners)}
                                      style={{ height: 240 }}
                                    />
                                  </div>
                                </Col>
                              ))}
                            </Row>
                          ),
                        },
                      ]}
                    />
                  )}
                </div>
              </Space>
            )
          return (
        <Card loading={loading} style={{ background: '#1e293b', border: '1px solid #334155' }}>
          <Tabs
            defaultActiveKey="overview"
            items={[
              {
                key: 'overview',
                label: (
                  <span>
                    <DashboardOutlined /> 总览
                  </span>
                ),
                children: overviewPanel,
              },
              {
                key: 'radar',
                label: '雷达图',
                children: radarOption
                  ? <ReactECharts option={radarOption} style={{ height: 380 }} />
                  : <Empty description="无可对比指标" />,
              },
              {
                key: 'bar',
                label: '单指标柱状',
                children:
                  compareRows.length > 0 && compareMetricKeys.length > 0 && barSingleOption ? (
                    <Space direction="vertical" style={{ width: '100%' }} size="middle">
                      <Space align="center" wrap>
                        <Text style={{ color: '#94a3b8' }}>对比指标</Text>
                        <Select
                          style={{ minWidth: 200 }}
                          value={effectiveBarKey}
                          options={compareMetricKeys.map((k) => ({
                            value: k,
                            label: `${k}${LOWER_IS_BETTER.has(k.toLowerCase()) ? ' ↓' : ' ↑'}`,
                          }))}
                          onChange={(v) => setBarMetricKey(v)}
                        />
                      </Space>
                      <ReactECharts option={barSingleOption} style={{ height: 380 }} />
                    </Space>
                  ) : (
                    <Empty description="无可对比指标" />
                  ),
              },
              {
                key: 'table',
                label: '数据表',
                children: metricsCompareTable,
              },
              {
                key: 'params',
                label: '参数对比',
                children:
                  paramCompareRows.length > 0 ? (
                    <Table
                      size="small"
                      dataSource={paramCompareRows}
                      columns={paramCompareColumns}
                      pagination={false}
                      scroll={{ x: 'max-content' }}
                    />
                  ) : (
                    <Empty description="当前对比模型无重叠的训练参数键（与对比 PDF 参数表范围一致）" />
                  ),
              },
            ]}
          />
          <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
            「总览」先展示指标明细表、再展示各指标小图；表头悬停可查看含义与优劣方向。相对差值以主模型为基准（AUC/KS 差值列）；雷达图中「越小越好」类指标已反向映射。指标列绿色加粗表示该指标在对比集合中全局最优（与对比 PDF 高亮语义一致）。「（推荐）」按各指标全局最优次数统计。
          </div>
        </Card>
          )
        })()}
        <Modal
          title={`预览: ${comparePdfFilename}`}
          open={comparePdfModalOpen}
          onCancel={() => {
            setComparePdfModalOpen(false)
            setComparePdfReportId(null)
          }}
          footer={null}
          width="90%"
          style={{ top: 20 }}
          bodyStyle={{ height: 'calc(100vh - 120px)', overflow: 'hidden' }}
        >
          {comparePdfReportId !== null ? (
            <PDFViewer
              source={`${BASE_URL}/api/reports/${comparePdfReportId}/preview`}
              downloadUrl={`${BASE_URL}/api/reports/${comparePdfReportId}/download`}
              filename={comparePdfFilename}
              showDownload
              showFullscreen
              onError={() => message.error('PDF 加载失败')}
            />
          ) : (
            <Empty description="未能加载 PDF" />
          )}
        </Modal>
      </div>
    )
  }

  return (
    <div style={{ padding: 24 }}>
      <Empty description="加载失败或模型不存在" />
    </div>
  )
}

export default ExpertWorkbenchPage
