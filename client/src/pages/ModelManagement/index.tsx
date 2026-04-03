import React, { useState, useEffect } from 'react'
import {
  Card, Table, Button, Space, Tag, Typography, Popconfirm,
  Modal, Form, Input, Row, Col, Statistic, message, Tooltip, Empty, Select
} from 'antd'
import { AppstoreOutlined, DeleteOutlined, EditOutlined, DownloadOutlined, DiffOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import ReactECharts from 'echarts-for-react'
import apiClient from '../../api/client'

const { Title, Text } = Typography

interface ModelRecord {
  id: number; name: string; task_type: string
  metrics: Record<string, number>; params: Record<string, unknown>
  dataset_id: number | null; created_at: string
}

const ModelManagementPage: React.FC = () => {
  const [models, setModels] = useState<ModelRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [renameModal, setRenameModal] = useState<{ open: boolean; id: number | null; name: string }>({ open: false, id: null, name: '' })
  const [compareIds, setCompareIds] = useState<number[]>([])
  const [compareData, setCompareData] = useState<ModelRecord[]>([])
  const [compareVisible, setCompareVisible] = useState(false)
  const [form] = Form.useForm()

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
      render: (_, r) => (
        <Space>
          <Tooltip title="重命名"><Button size="small" icon={<EditOutlined />} onClick={() => { form.setFieldsValue({ name: r.name }); setRenameModal({ open: true, id: r.id, name: r.name }) }} /></Tooltip>
          <Tooltip title="导出模型"><Button size="small" icon={<DownloadOutlined />} onClick={() => handleExport(r.id, r.name)} /></Tooltip>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  // 对比雷达图
  const radarOption = compareData.length > 0 ? (() => {
    const allMetricKeys = [...new Set(compareData.flatMap(m => Object.keys(m.metrics || {})))]
    return {
      tooltip: {},
      legend: { textStyle: { color: '#94a3b8' }, data: compareData.map(m => m.name) },
      radar: { indicator: allMetricKeys.map(k => ({ name: k, max: 1 })) },
      series: [{
        type: 'radar',
        data: compareData.map(m => ({
          name: m.name,
          value: allMetricKeys.map(k => m.metrics[k] || 0)
        }))
      }]
    }
  })() : null

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

      <Card style={{ background: '#1e293b', border: '1px solid #334155' }} extra={<Button size="small" onClick={fetchModels}>刷新</Button>}>
        <Table columns={columns} dataSource={models} loading={loading} rowKey="id" size="small" />
      </Card>

      <Modal title="重命名模型" open={renameModal.open} onOk={handleRename} onCancel={() => setRenameModal({ open: false, id: null, name: '' })}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="新名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="模型对比" open={compareVisible} onCancel={() => setCompareVisible(false)} width={800} footer={null}>
        {radarOption && <ReactECharts option={radarOption} style={{ height: 350 }} />}
        <Table
          size="small"
          dataSource={compareData.map(m => ({
            key: m.id, name: m.name, task_type: m.task_type,
            ...Object.fromEntries(Object.entries(m.metrics).map(([k, v]) => [k, v.toFixed(4)]))
          }))}
          columns={[
            { title: '模型', dataIndex: 'name', key: 'name' },
            { title: '类型', dataIndex: 'task_type', key: 'task_type' },
            ...[...new Set(compareData.flatMap(m => Object.keys(m.metrics)))].map(k => ({
              title: k, dataIndex: k, key: k
            }))
          ]}
        />
      </Modal>
    </div>
  )
}

export default ModelManagementPage
