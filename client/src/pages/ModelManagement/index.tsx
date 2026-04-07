import React, { useState, useEffect, useMemo } from 'react'
import {
  Card, Table, Button, Space, Tag, Typography, Popconfirm,
  Modal, Form, Input, Row, Col, Statistic, message, Tooltip, Empty, Tabs
} from 'antd'
import { DeleteOutlined, EditOutlined, DownloadOutlined, DiffOutlined, FilePdfOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import ReactECharts from 'echarts-for-react'
import apiClient, { BASE_URL } from '../../api/client'
import { formatUtcToBeijing } from '../../utils/datetime'
import PDFViewer from '../../components/PDFViewer'
import { useAppStore } from '../../store/appStore'

const { Text } = Typography

// 过滤内部指标（不应展示在对比图中）
const INTERNAL_METRIC_KEYS = new Set([
  'overfitting_level', 'overfitting_gap', 'train_accuracy', 'train_rmse',
  'early_stopped', 'best_round',
])
// 越小越好的指标（用于雷达图反向处理）
const LOWER_IS_BETTER = new Set(['rmse', 'mse', 'mae', 'log_loss', 'logloss'])

interface ModelRecord {
  id: number; name: string; task_type: string
  metrics: Record<string, number>; params: Record<string, unknown>
  dataset_id: number | null; created_at: string; notes?: string
}

const { TextArea } = Input

const ModelManagementPage: React.FC = () => {
  const workflowMode = useAppStore(s => s.workflowMode)
  const isExpert = workflowMode === 'expert'
  const [models, setModels] = useState<ModelRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [renameModal, setRenameModal] = useState<{ open: boolean; id: number | null; name: string; notes: string }>({ open: false, id: null, name: '', notes: '' })
  const [compareIds, setCompareIds] = useState<number[]>([])
  const [compareData, setCompareData] = useState<ModelRecord[]>([])
  const [compareVisible, setCompareVisible] = useState(false)
  const [compareReportLoading, setCompareReportLoading] = useState(false)
  const [comparePdfModalOpen, setComparePdfModalOpen] = useState(false)
  const [comparePdfReportId, setComparePdfReportId] = useState<number | null>(null)
  const [comparePdfFilename, setComparePdfFilename] = useState('compare_report.pdf')
  const [lastComparePdfMeta, setLastComparePdfMeta] = useState<{ id: number; idsKey: string } | null>(null)
  const [form] = Form.useForm()

  const compareIdsKey = useMemo(
    () => [...compareIds].sort((a, b) => a - b).join(','),
    [compareIds],
  )

  useEffect(() => {
    setLastComparePdfMeta(null)
  }, [compareIdsKey])

  const filteredModels = models.filter(m =>
    !searchText || m.name.toLowerCase().includes(searchText.toLowerCase())
  )

  const fetchModels = async () => {
    setLoading(true)
    try {
      const r = await apiClient.get('/api/models')
      setModels(r.data || [])
    } catch { message.error('获取模型列表失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchModels() }, [])

  const handleDelete = async (id: number) => {
    try {
      await apiClient.delete(`/api/models/${id}`)
      message.success('已删除')
      setCompareIds(prev => prev.filter(i => i !== id))
      fetchModels()
    } catch { message.error('删除失败') }
  }

  const handleBatchDelete = async () => {
    if (compareIds.length === 0) return
    const ids = [...compareIds]
    setLoading(true)
    try {
      const results = await Promise.allSettled(ids.map(id => apiClient.delete(`/api/models/${id}`)))
      const ok = results.filter(r => r.status === 'fulfilled').length
      const fail = results.length - ok
      if (ok > 0) message.success(`已删除 ${ok} 个模型`)
      if (fail > 0) message.error(`${fail} 个删除失败`)
      setCompareIds([])
      fetchModels()
    } catch {
      message.error('批量删除失败')
      fetchModels()
    } finally {
      setLoading(false)
    }
  }

  const handleRename = async () => {
    const values = await form.validateFields()
    try {
      await apiClient.patch(`/api/models/${renameModal.id}`, { name: values.name, notes: values.notes ?? '' })
      message.success('保存成功')
      setRenameModal({ open: false, id: null, name: '', notes: '' })
      fetchModels()
    } catch { message.error('保存失败') }
  }

  const handleExport = async (id: number, name: string) => {
    try {
      const r = await apiClient.post(`/api/models/${id}/export`, {}, { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a'); a.href = url; a.download = `${name}.ubj`; a.click()
      URL.revokeObjectURL(url)
    } catch { message.error('导出失败') }
  }

  const handleCompare = async () => {
    if (compareIds.length < 2) { message.warning('请至少选择2个模型进行对比'); return }
    try {
      const r = await apiClient.get('/api/models/compare', { params: { ids: compareIds.join(',') } })
      setCompareData(r.data)
      setCompareVisible(true)
    } catch { message.error('对比失败') }
  }

  const postCompareReport = async () => {
    if (compareIds.length < 2) return null
    const names = compareData.map((m) => m.name).join(' vs ')
    const resp = await apiClient.post('/api/reports/compare', {
      model_ids: compareIds,
      title: `多模型对比报告 — ${names}`,
    })
    return { id: resp.data.id as number }
  }

  const handleCompareReportPreview = async () => {
    if (compareIds.length < 2) {
      message.warning('请至少选择2个模型')
      return
    }
    setCompareReportLoading(true)
    try {
      const result = await postCompareReport()
      if (!result) return
      setComparePdfReportId(result.id)
      setLastComparePdfMeta({ id: result.id, idsKey: compareIdsKey })
      setComparePdfFilename(`compare_report_${compareIds.join('_')}.pdf`)
      setComparePdfModalOpen(true)
      message.success('对比报告已生成，可在预览中查看或下载')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '生成对比报告失败')
    } finally {
      setCompareReportLoading(false)
    }
  }

  const handleCompareReportDownload = async () => {
    if (compareIds.length < 2) {
      message.warning('请至少选择2个模型')
      return
    }
    setCompareReportLoading(true)
    try {
      let reportId: number
      if (lastComparePdfMeta && lastComparePdfMeta.idsKey === compareIdsKey) {
        reportId = lastComparePdfMeta.id
      } else {
        const result = await postCompareReport()
        if (!result) return
        reportId = result.id
        setLastComparePdfMeta({ id: reportId, idsKey: compareIdsKey })
      }
      const r = await apiClient.get(`/api/reports/${reportId}/download`, { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `compare_report_${compareIds.join('_')}.pdf`
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

  const columns: ColumnsType<ModelRecord> = [
    {
      title: '模型编号',
      dataIndex: 'id',
      key: 'id',
      width: 96,
      fixed: 'left' as const,
      render: (v: number) => (
        <Tooltip title="与 API、导出文件名等一致的数据库主键">
          <Text code copyable={{ text: String(v) }} style={{ color: '#94a3b8', fontSize: 12 }}>
            {v}
          </Text>
        </Tooltip>
      ),
    },
    { title: '模型名称', dataIndex: 'name', key: 'name', render: v => <Text strong style={{ color: '#60a5fa' }}>{v}</Text> },
    { title: '任务类型', dataIndex: 'task_type', key: 'task_type', render: v => <Tag color={v === 'classification' ? 'blue' : 'orange'}>{v}</Tag> },
    {
      title: '主要指标', key: 'metrics', render: (_, r) => {
        const m = r.metrics || {}
        const PREFER = ['auc', 'accuracy', 'r2', 'f1']
        const mainKey = PREFER.find(k => k in m) || Object.keys(m).find(k => !INTERNAL_METRIC_KEYS.has(k))
        if (!mainKey) return <span>-</span>
        const val = Number(m[mainKey])
        const lowerBetter = LOWER_IS_BETTER.has(mainKey.toLowerCase())
        let level = '待提升', levelColor: 'default' | 'success' | 'processing' | 'warning' | 'error' = 'error'
        if (!lowerBetter) {
          if (val >= 0.9) { level = '优秀'; levelColor = 'success' }
          else if (val >= 0.75) { level = '良好'; levelColor = 'processing' }
          else if (val >= 0.6) { level = '尚可'; levelColor = 'warning' }
        }
        return (
          <Space size={4}>
            <Tag color="purple">{mainKey.toUpperCase()}: {val.toFixed(4)}</Tag>
            {!lowerBetter && <Tag color={levelColor}>{level}</Tag>}
          </Space>
        )
      }
    },
    {
      title: '备注', dataIndex: 'notes', key: 'notes',
      render: (v: string | undefined) => v ? <Text style={{ color: '#94a3b8', fontSize: 12 }}>{v}</Text> : <Text style={{ color: '#334155' }}>-</Text>
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (v: string) => (
        <Tooltip title="北京时间 (UTC+8)">
          <span>{formatUtcToBeijing(v)}</span>
        </Tooltip>
      ),
    },
    {
      title: '操作', key: 'action',
      width: 160,
      fixed: 'right' as const,
      render: (_, r) => (
        <Space wrap={false}>
          <Tooltip title="编辑名称/备注"><Button size="small" icon={<EditOutlined />} onClick={() => { form.setFieldsValue({ name: r.name, notes: r.notes || '' }); setRenameModal({ open: true, id: r.id, name: r.name, notes: r.notes || '' }) }} /></Tooltip>
          <Tooltip title="导出模型"><Button size="small" icon={<DownloadOutlined />} onClick={() => handleExport(r.id, r.name)} /></Tooltip>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  // 对比雷达图（过滤内部指标，动态 max 值）
  const compareMetricKeys = compareData.length > 0
    ? [...new Set(compareData.flatMap(m => Object.keys(m.metrics || {})))].filter(k => !INTERNAL_METRIC_KEYS.has(k))
    : []

  const radarOption = compareData.length > 0 && compareMetricKeys.length > 0 ? (() => {
    // 每个指标的最大值（动态 max，对 RMSE 类取实际 max 再乘 1.2）
    const metricMax: Record<string, number> = {}
    compareMetricKeys.forEach(k => {
      const vals = compareData.map(m => m.metrics[k] ?? 0)
      const actualMax = Math.max(...vals)
      metricMax[k] = LOWER_IS_BETTER.has(k.toLowerCase())
        ? actualMax * 1.3   // RMSE 类不反转，直接用实际范围
        : Math.max(1, actualMax * 1.1) // AUC/Acc 类 max 至少 1
    })
    // 雷达图中对"越小越好"的指标取反：使用 max - val 映射让最优值在外边
    return {
      tooltip: {},
      legend: { textStyle: { color: '#94a3b8' }, data: compareData.map(m => m.name) },
      radar: {
        indicator: compareMetricKeys.map(k => ({
          name: LOWER_IS_BETTER.has(k.toLowerCase()) ? `${k} ↓` : k,
          max: metricMax[k],
        })),
        axisName: { color: '#94a3b8', fontSize: 12 },
      },
      series: [{
        type: 'radar',
        data: compareData.map((m, idx) => ({
          name: m.name,
          value: compareMetricKeys.map(k => {
            const v = m.metrics[k] ?? 0
            // 越小越好：映射为 max - v（让最优在外）
            return LOWER_IS_BETTER.has(k.toLowerCase()) ? Math.max(0, metricMax[k] - v) : v
          }),
          areaStyle: { opacity: 0.15 },
          itemStyle: { color: ['#3b82f6', '#f59e0b', '#34d399', '#a855f7', '#f43f5e'][idx % 5] },
        })),
      }],
    }
  })() : null

  // 柱状图（对比各模型的每个指标）
  const barOption = compareData.length > 0 && compareMetricKeys.length > 0 ? {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { textStyle: { color: '#94a3b8' }, data: compareData.map(m => m.name) },
    xAxis: { type: 'category', data: compareMetricKeys, axisLabel: { color: '#94a3b8', rotate: 20 } },
    yAxis: { type: 'value', axisLabel: { color: '#94a3b8' } },
    series: compareData.map((m, idx) => ({
      name: m.name,
      type: 'bar',
      data: compareMetricKeys.map(k => typeof m.metrics[k] === 'number' ? Number(m.metrics[k].toFixed(4)) : 0),
      itemStyle: { color: ['#3b82f6', '#f59e0b', '#34d399', '#a855f7', '#f43f5e'][idx % 5] },
    })),
  } : null

  return (
    <div style={{ padding: 24 }}>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card style={{ background: '#1e293b', border: '1px solid #334155' }}><Statistic title="模型总数" value={models.length} valueStyle={{ color: '#60a5fa' }} /></Card></Col>
        <Col span={6}><Card style={{ background: '#1e293b', border: '1px solid #334155' }}><Statistic title="分类模型" value={models.filter(m => m.task_type === 'classification').length} valueStyle={{ color: '#3b82f6' }} /></Card></Col>
        <Col span={6}><Card style={{ background: '#1e293b', border: '1px solid #334155' }}><Statistic title="回归模型" value={models.filter(m => m.task_type === 'regression').length} valueStyle={{ color: '#f59e0b' }} /></Card></Col>
        <Col span={6}>
          <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
            <Button type="primary" icon={<DiffOutlined />} onClick={handleCompare} disabled={compareIds.length < 2} block>
              对比已选 ({compareIds.length})
            </Button>
          </Card>
        </Col>
      </Row>

      <Card style={{ background: '#1e293b', border: '1px solid #334155' }} extra={
        <Space>
          <Input.Search
            placeholder="搜索模型名称"
            allowClear
            size="small"
            style={{ width: 200 }}
            onSearch={v => setSearchText(v)}
            onChange={e => setSearchText(e.target.value)}
          />
          <Popconfirm
            title={`确认删除选中的 ${compareIds.length} 个模型？`}
            description="删除为软删除，记录仍保留在库中但不再显示。"
            okText="删除"
            okButtonProps={{ danger: true }}
            disabled={compareIds.length === 0}
            onConfirm={handleBatchDelete}
          >
            <Button size="small" danger disabled={compareIds.length === 0}>
              批量删除{compareIds.length > 0 ? ` (${compareIds.length})` : ''}
            </Button>
          </Popconfirm>
          <Button size="small" onClick={fetchModels}>刷新</Button>
        </Space>
      }>
        <Table
          columns={columns}
          dataSource={filteredModels}
          loading={loading}
          rowKey="id"
          size="small"
          scroll={{ x: 'max-content' }}
          rowSelection={{
            selectedRowKeys: compareIds,
            onChange: (keys) => setCompareIds(keys.map(k => Number(k))),
            preserveSelectedRowKeys: true,
          }}
        />
      </Card>

      <Modal title="编辑模型" open={renameModal.open} onOk={handleRename} onCancel={() => setRenameModal({ open: false, id: null, name: '', notes: '' })}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="模型名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="notes" label="备注（可选）">
            <TextArea rows={3} placeholder="添加模型备注，如训练目的、数据版本等" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="模型对比" open={compareVisible} onCancel={() => setCompareVisible(false)} width={860} footer={null}>
        <Tabs
          items={[
            {
              key: 'radar', label: '雷达图',
              children: radarOption
                ? <ReactECharts option={radarOption} style={{ height: 360 }} />
                : <Empty description="无可对比的指标" />,
            },
            {
              key: 'bar', label: '柱状图',
              children: barOption
                ? <ReactECharts option={barOption} style={{ height: 360 }} />
                : <Empty description="无可对比的指标" />,
            },
            {
              key: 'table', label: '数据表',
              children: (() => {
                // F3: 专家模式下计算 AUC/KS 差值（以第一个模型为基准）
                const baseModel = compareData[0]
                const baseAuc = baseModel?.metrics?.auc ?? null
                const baseKs = baseModel?.metrics?.ks ?? null
                const tableData = compareData.map((m, idx) => {
                  const aucDiff = isExpert && baseAuc !== null && m.metrics?.auc !== undefined && idx > 0
                    ? (m.metrics.auc - baseAuc)
                    : null
                  const ksDiff = isExpert && baseKs !== null && m.metrics?.ks !== undefined && idx > 0
                    ? (m.metrics.ks - baseKs)
                    : null
                  return {
                    key: m.id, id: m.id, name: m.name, task_type: m.task_type,
                    _aucDiff: aucDiff,
                    _ksDiff: ksDiff,
                    ...Object.fromEntries(
                      Object.entries(m.metrics)
                        .filter(([k]) => !INTERNAL_METRIC_KEYS.has(k))
                        .map(([k, v]) => [k, typeof v === 'number' ? v.toFixed(4) : v])
                    )
                  }
                })
                const expertExtraColumns = isExpert ? [
                  {
                    title: <Tooltip title="相对第一个模型的 AUC 差值">AUC 差值</Tooltip>,
                    dataIndex: '_aucDiff', key: '_aucDiff',
                    render: (v: number | null) => v === null ? <Text style={{ color: '#475569' }}>—（基准）</Text> : (
                      <Text style={{ color: v >= 0 ? '#34d399' : '#f87171', fontWeight: 600 }}>
                        {v >= 0 ? '+' : ''}{v.toFixed(4)}
                      </Text>
                    ),
                  },
                  {
                    title: <Tooltip title="相对第一个模型的 KS 差值">KS 差值</Tooltip>,
                    dataIndex: '_ksDiff', key: '_ksDiff',
                    render: (v: number | null) => v === null ? <Text style={{ color: '#475569' }}>—（基准）</Text> : (
                      <Text style={{ color: v >= 0 ? '#34d399' : '#f87171', fontWeight: 600 }}>
                        {v >= 0 ? '+' : ''}{v.toFixed(4)}
                      </Text>
                    ),
                  },
                ] : []
                return (
                  <Table
                    size="small"
                    dataSource={tableData}
                    columns={[
                      { title: '模型编号', dataIndex: 'id', key: 'id', width: 88, render: v => <Text code style={{ color: '#94a3b8', fontSize: 12 }}>{v}</Text> },
                      { title: '模型', dataIndex: 'name', key: 'name', render: v => <Text style={{ color: '#60a5fa' }}>{v}</Text> },
                      { title: '类型', dataIndex: 'task_type', key: 'task_type', render: v => <Tag color={v === 'classification' ? 'blue' : 'orange'}>{v}</Tag> },
                      ...compareMetricKeys.map(k => ({
                        title: <span>{k}{LOWER_IS_BETTER.has(k.toLowerCase()) ? ' ↓' : ' ↑'}</span>,
                        dataIndex: k, key: k,
                      })),
                      ...expertExtraColumns,
                    ]}
                    pagination={false}
                  />
                )
              })(),
            },
          ]}
        />
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#475569' }}>
            ↑ 越大越好 &nbsp;|&nbsp; ↓ 越小越好（雷达图中已反向映射，外圈 = 更优）
          </span>
          <Space wrap>
            <Button
              type="primary"
              icon={<FilePdfOutlined />}
              loading={compareReportLoading}
              onClick={handleCompareReportPreview}
              disabled={compareIds.length < 2}
            >
              预览对比 PDF
            </Button>
            <Button
              icon={<DownloadOutlined />}
              loading={compareReportLoading}
              onClick={handleCompareReportDownload}
              disabled={compareIds.length < 2}
            >
              下载 PDF
            </Button>
          </Space>
        </div>
      </Modal>

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

export default ModelManagementPage
