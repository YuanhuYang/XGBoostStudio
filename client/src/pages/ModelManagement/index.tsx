import React, { useState, useEffect } from 'react'
import {
  Card, Table, Button, Space, Tag, Typography, Popconfirm,
  Modal, Form, Input, Row, Col, Statistic, message, Tooltip, Empty, Tabs
} from 'antd'
import { AppstoreOutlined, DeleteOutlined, EditOutlined, DownloadOutlined, DiffOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import ReactECharts from 'echarts-for-react'
import apiClient from '../../api/client'

const { Title, Text } = Typography

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
  dataset_id: number | null; created_at: string
}

const ModelManagementPage: React.FC = () => {
  const [models, setModels] = useState<ModelRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [renameModal, setRenameModal] = useState<{ open: boolean; id: number | null; name: string }>({ open: false, id: null, name: '' })
  const [compareIds, setCompareIds] = useState<number[]>([])
  const [compareData, setCompareData] = useState<ModelRecord[]>([])
  const [compareVisible, setCompareVisible] = useState(false)
  const [form] = Form.useForm()

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
      fetchModels()
    } catch { message.error('删除失败') }
  }

  const handleRename = async () => {
    const values = await form.validateFields()
    try {
      await apiClient.put(`/api/models/${renameModal.id}/rename`, { name: values.name })
      message.success('重命名成功')
      setRenameModal({ open: false, id: null, name: '' })
      fetchModels()
    } catch { message.error('重命名失败') }
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

  const columns: ColumnsType<ModelRecord> = [
    { title: '模型名称', dataIndex: 'name', key: 'name', render: v => <Text strong style={{ color: '#60a5fa' }}>{v}</Text> },
    { title: '任务类型', dataIndex: 'task_type', key: 'task_type', render: v => <Tag color={v === 'classification' ? 'blue' : 'orange'}>{v}</Tag> },
    {
      title: '主要指标', key: 'metrics', render: (_, r) => {
        const m = r.metrics || {}
        const key = Object.keys(m)[0]
        return key ? <span><Tag color="purple">{key}: {m[key]?.toFixed(4)}</Tag></span> : '-'
      }
    },
    {
      title: '备注', dataIndex: 'notes', key: 'notes',
      render: (v: string | undefined) => v ? <Text style={{ color: '#94a3b8', fontSize: 12 }}>{v}</Text> : <Text style={{ color: '#334155' }}>-</Text>
    },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', render: v => v?.slice(0, 19) },
    {
      title: '对比', key: 'compare',
      render: (_, r) => (
        <input type="checkbox" checked={compareIds.includes(r.id)}
          onChange={e => setCompareIds(prev => e.target.checked ? [...prev, r.id] : prev.filter(i => i !== r.id))} />
      )
    },
    {
      title: '操作', key: 'action',
      width: 160,
      fixed: 'right' as const,
      render: (_, r) => (
        <Space wrap={false}>
          <Tooltip title="重命名"><Button size="small" icon={<EditOutlined />} onClick={() => { form.setFieldsValue({ name: r.name }); setRenameModal({ open: true, id: r.id, name: r.name }) }} /></Tooltip>
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
      <Title level={4} style={{ color: '#60a5fa', marginBottom: 24 }}>
        <AppstoreOutlined /> 模型管理
      </Title>

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
          <Button size="small" onClick={fetchModels}>刷新</Button>
        </Space>
      }>
        <Table columns={columns} dataSource={filteredModels} loading={loading} rowKey="id" size="small" scroll={{ x: 'max-content' }} />
      </Card>

      <Modal title="重命名模型" open={renameModal.open} onOk={handleRename} onCancel={() => setRenameModal({ open: false, id: null, name: '' })}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="新名称" rules={[{ required: true }]}>
            <Input />
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
              children: (
                <Table
                  size="small"
                  dataSource={compareData.map(m => ({
                    key: m.id, name: m.name, task_type: m.task_type,
                    ...Object.fromEntries(
                      Object.entries(m.metrics)
                        .filter(([k]) => !INTERNAL_METRIC_KEYS.has(k))
                        .map(([k, v]) => [k, typeof v === 'number' ? v.toFixed(4) : v])
                    )
                  }))}
                  columns={[
                    { title: '模型', dataIndex: 'name', key: 'name', render: v => <Text style={{ color: '#60a5fa' }}>{v}</Text> },
                    { title: '类型', dataIndex: 'task_type', key: 'task_type', render: v => <Tag color={v === 'classification' ? 'blue' : 'orange'}>{v}</Tag> },
                    ...compareMetricKeys.map(k => ({
                      title: <span>{k}{LOWER_IS_BETTER.has(k.toLowerCase()) ? ' ↓' : ' ↑'}</span>,
                      dataIndex: k, key: k,
                    }))
                  ]}
                  pagination={false}
                />
              ),
            },
          ]}
        />
        <div style={{ marginTop: 8, fontSize: 12, color: '#475569' }}>
          ↑ 越大越好 &nbsp;|&nbsp; ↓ 越小越好（雷达图中已反向映射，外圈 = 更优）
        </div>
      </Modal>
    </div>
  )
}

export default ModelManagementPage
