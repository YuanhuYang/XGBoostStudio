import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Button, Card, Col, Empty, Row, Space, Statistic, Select, Table, Tabs, Tag, Typography, message,
} from 'antd'
import {
  AppstoreOutlined, BarChartOutlined, DownloadOutlined, FilePdfOutlined, ThunderboltOutlined,
  LineChartOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import ReactECharts from 'echarts-for-react'
import apiClient from '../../api/client'
import HelpButton from '../../components/HelpButton'
import { useAppStore } from '../../store/appStore'

const { Title, Text } = Typography

const INTERNAL_METRIC_KEYS = new Set([
  'overfitting_level', 'overfitting_gap', 'train_accuracy', 'train_rmse',
  'early_stopped', 'best_round',
])
const LOWER_IS_BETTER = new Set(['rmse', 'mse', 'mae', 'log_loss', 'logloss'])

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

const ExpertWorkbenchPage: React.FC = () => {
  const activeDatasetId = useAppStore(s => s.activeDatasetId)
  const activeDatasetName = useAppStore(s => s.activeDatasetName)
  const activeSplitId = useAppStore(s => s.activeSplitId)
  const activeModelId = useAppStore(s => s.activeModelId)
  const expertCompareModelIds = useAppStore(s => s.expertCompareModelIds)
  const setActiveModelId = useAppStore(s => s.setActiveModelId)

  const effectiveIds = useMemo(() => {
    if (expertCompareModelIds.length > 0) return expertCompareModelIds
    if (activeModelId !== null) return [activeModelId]
    return []
  }, [expertCompareModelIds, activeModelId])

  const [singleMeta, setSingleMeta] = useState<ModelRecord | null>(null)
  const [compareRows, setCompareRows] = useState<ModelRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [compareReportLoading, setCompareReportLoading] = useState(false)

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
    if (compareRows.length < 2) return
    const ids = compareRows.map(m => m.id)
    if (activeModelId !== null && ids.includes(activeModelId)) return
    setActiveModelId(ids[0])
  }, [compareRows, activeModelId, setActiveModelId])

  const compareMetricKeys = compareRows.length > 0
    ? [...new Set(compareRows.flatMap(m => Object.keys(m.metrics || {})))].filter(k => !INTERNAL_METRIC_KEYS.has(k))
    : []

  const baseModel = compareRows.find(m => m.id === primaryId) ?? compareRows[0]
  const baseAuc = baseModel?.metrics?.auc ?? null
  const baseKs = baseModel?.metrics?.ks ?? null

  const radarOption = compareRows.length > 0 && compareMetricKeys.length > 0 ? (() => {
    const metricMax: Record<string, number> = {}
    compareMetricKeys.forEach(k => {
      const vals = compareRows.map(m => m.metrics[k] ?? 0)
      const actualMax = Math.max(...vals)
      metricMax[k] = LOWER_IS_BETTER.has(k.toLowerCase())
        ? actualMax * 1.3
        : Math.max(1, actualMax * 1.1)
    })
    return {
      tooltip: {},
      legend: { textStyle: { color: '#94a3b8' }, data: compareRows.map(m => m.name) },
      radar: {
        indicator: compareMetricKeys.map(k => ({
          name: LOWER_IS_BETTER.has(k.toLowerCase()) ? `${k} ↓` : k,
          max: metricMax[k],
        })),
        axisName: { color: '#94a3b8', fontSize: 12 },
      },
      series: [{
        type: 'radar',
        data: compareRows.map((m, idx) => ({
          name: m.name,
          value: compareMetricKeys.map(k => {
            const v = m.metrics[k] ?? 0
            return LOWER_IS_BETTER.has(k.toLowerCase()) ? Math.max(0, metricMax[k] - v) : v
          }),
          areaStyle: { opacity: 0.15 },
          itemStyle: { color: ['#3b82f6', '#f59e0b', '#34d399', '#a855f7', '#f43f5e'][idx % 5] },
        })),
      }],
    }
  })() : null

  const barOption = compareRows.length > 0 && compareMetricKeys.length > 0 ? {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { textStyle: { color: '#94a3b8' }, data: compareRows.map(m => m.name) },
    xAxis: { type: 'category', data: compareMetricKeys, axisLabel: { color: '#94a3b8', rotate: 20 } },
    yAxis: { type: 'value', axisLabel: { color: '#94a3b8' } },
    series: compareRows.map((m, idx) => ({
      name: m.name,
      type: 'bar',
      data: compareMetricKeys.map(k => typeof m.metrics[k] === 'number' ? Number(m.metrics[k].toFixed(4)) : 0),
      itemStyle: { color: ['#3b82f6', '#f59e0b', '#34d399', '#a855f7', '#f43f5e'][idx % 5] },
    })),
  } : null

  const handleExportUbj = async (id: number, name: string) => {
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
  }

  const exportCompareJson = () => {
    const payload = compareRows.map(m => ({
      id: m.id,
      name: m.name,
      task_type: m.task_type,
      metrics: m.metrics,
      primary_model_id: primaryId,
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

  const handleComparePdf = async () => {
    if (compareRows.length < 2) return
    const ids = compareRows.map(m => m.id)
    setCompareReportLoading(true)
    try {
      const names = compareRows.map(m => m.name).join(' vs ')
      const resp = await apiClient.post('/api/reports/compare', {
        model_ids: ids,
        title: `多模型对比报告 — ${names}`,
      })
      const r = await apiClient.get(`/api/reports/${resp.data.id}/download`, { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `compare_report_${ids.join('_')}.pdf`
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

  const compareTableColumns: ColumnsType<Record<string, unknown>> = [
    {
      title: '角色',
      key: 'role',
      width: 88,
      render: (_, row) => (
        (row.id as number) === activeModelId
          ? <Tag color="gold">基准</Tag>
          : <Tag>候选</Tag>
      ),
    },
    { title: '模型', dataIndex: 'name', key: 'name', render: v => <Text strong style={{ color: '#60a5fa' }}>{v as string}</Text> },
    { title: '类型', dataIndex: 'task_type', key: 'task_type', render: v => <Tag color={v === 'classification' ? 'blue' : 'orange'}>{v as string}</Tag> },
    ...compareMetricKeys.map(k => ({
      title: <span>{k}{LOWER_IS_BETTER.has(k.toLowerCase()) ? ' ↓' : ' ↑'}</span>,
      dataIndex: k,
      key: k,
    })),
    {
      title: 'AUC 差值',
      dataIndex: '_aucDiff',
      key: '_aucDiff',
      render: (v: number | null) => v === null ? <Text style={{ color: '#475569' }}>—（基准）</Text> : (
        <Text style={{ color: v >= 0 ? '#34d399' : '#f87171', fontWeight: 600 }}>
          {v >= 0 ? '+' : ''}{v.toFixed(4)}
        </Text>
      ),
    },
    {
      title: 'KS 差值',
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
  ]

  if (effectiveIds.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <Title level={4} style={{ color: '#60a5fa', marginBottom: 16 }}>
          <LineChartOutlined /> 模型工作台
        </Title>
        <HelpButton pageTitle="模型工作台" items={[
          { title: '这个页面做什么？', content: '在专家模式下集中完成多模型对比、选定主模型、导出指标与模型文件；适合 CLI AutoML 跑完后从深链进入。' },
          { title: '如何传入模型？', content: '使用 CLI 打印的前端深链，或在「模型管理」中训练多个模型后回到此处（需在侧栏选择模型上下文）。' },
        ]} />
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 16, background: '#1e293b', borderColor: '#334155' }}
          message="尚未选择模型"
          description="请通过命令行深链（含 modelIds）进入，或先到「模型管理」训练并勾选多个模型进行对比。"
        />
        <Space style={{ marginTop: 16 }}>
          <Button type="primary" onClick={() => go('model-management')}>前往模型管理</Button>
          <Button onClick={() => go('data-import')}>数据导入</Button>
        </Space>
      </div>
    )
  }

  if (effectiveIds.length === 1 && singleMeta) {
    const m = singleMeta
    const mainKeys = Object.keys(m.metrics || {}).filter(k => !INTERNAL_METRIC_KEYS.has(k))
    return (
      <div style={{ padding: 24 }}>
        <Title level={4} style={{ color: '#60a5fa', marginBottom: 8 }}>
          <LineChartOutlined /> 模型工作台
        </Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          上下文：{activeDatasetName ?? (activeDatasetId ? `数据集#${activeDatasetId}` : '—')} · 划分#{activeSplitId ?? '—'} · 主模型#{m.id}
        </Text>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16, background: '#1e293b', borderColor: '#854d0e' }}
          message="当前仅有 1 个模型，无法做并排对比"
          description="建议提高 AutoML 试验数或到「超参数调优」再产出备选模型，然后在「模型管理」多选后对比，或使用 CLI 深链携带多个 model_id。"
        />
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
        <Card title="验证指标摘要" loading={loading} style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
          <Space wrap>
            {mainKeys.map(k => (
              <Tag key={k} color="purple">{k}: {typeof m.metrics[k] === 'number' ? (m.metrics[k] as number).toFixed(4) : m.metrics[k]}</Tag>
            ))}
          </Space>
        </Card>
        <Space wrap>
          <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => go('model-tuning')}>超参数调优</Button>
          <Button icon={<AppstoreOutlined />} onClick={() => go('model-management')}>模型管理</Button>
          <Button icon={<DownloadOutlined />} onClick={() => handleExportUbj(m.id, m.name)}>导出 .ubj</Button>
          <Button icon={<LineChartOutlined />} onClick={() => go('model-eval')}>模型评估</Button>
        </Space>
      </div>
    )
  }

  if (effectiveIds.length === 1 && !singleMeta && loading) {
    return (
      <div style={{ padding: 24 }}>
        <Title level={4} style={{ color: '#60a5fa' }}><LineChartOutlined /> 模型工作台</Title>
        <Card loading style={{ background: '#1e293b', border: '1px solid #334155', marginTop: 16 }} />
      </div>
    )
  }

  if (effectiveIds.length >= 2) {
    return (
      <div style={{ padding: 24 }}>
        <Title level={4} style={{ color: '#60a5fa', marginBottom: 8 }}>
          <BarChartOutlined /> 模型工作台 · 多模型对比
        </Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          共 {compareRows.length} 个模型 · 主模型（基准）#
          {activeModelId ?? '—'} · {activeDatasetName ?? (activeDatasetId ? `数据集#${activeDatasetId}` : '—')}
        </Text>
        <HelpButton pageTitle="模型工作台" items={[
          { title: '基准模型', content: '上方下拉框可切换主模型，AUC/KS 差值相对该模型计算，并同步到顶部全局「模型#」标签。' },
          { title: '导出', content: 'CSV/JSON 导出当前表中的指标列；.ubj 为 XGBoost 模型文件；PDF 为服务端生成的多模型对比报告。' },
        ]} />
        <Row gutter={16} style={{ marginBottom: 16 }} align="middle">
          <Col flex="none">
            <Space align="center">
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
              <Button type="primary" icon={<FilePdfOutlined />} loading={compareReportLoading} onClick={handleComparePdf}>
                导出对比 PDF
              </Button>
            </Space>
          </Col>
        </Row>
        <Card loading={loading} style={{ background: '#1e293b', border: '1px solid #334155' }}>
          <Tabs
            items={[
              {
                key: 'radar',
                label: '雷达图',
                children: radarOption
                  ? <ReactECharts option={radarOption} style={{ height: 380 }} />
                  : <Empty description="无可对比指标" />,
              },
              {
                key: 'bar',
                label: '柱状图',
                children: barOption
                  ? <ReactECharts option={barOption} style={{ height: 380 }} />
                  : <Empty description="无可对比指标" />,
              },
              {
                key: 'table',
                label: '数据表',
                children: (
                  <Table
                    size="small"
                    dataSource={tableData}
                    columns={compareTableColumns}
                    pagination={false}
                    scroll={{ x: 'max-content' }}
                  />
                ),
              },
            ]}
          />
          <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
            相对差值以主模型为基准；雷达图中「越小越好」类指标已反向映射。
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ color: '#60a5fa' }}><LineChartOutlined /> 模型工作台</Title>
      <Empty description="加载失败或模型不存在" />
    </div>
  )
}

export default ExpertWorkbenchPage
