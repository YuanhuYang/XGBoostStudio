import React, { useState, useEffect } from 'react'
import {
  Card, Table, Button, Space, Typography, Modal, Form, Input,
  InputNumber, message, Popconfirm, Tag, Row, Col, Statistic, Empty
} from 'antd'
import { FileTextOutlined, DownloadOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import apiClient from '../../api/client'
import { useAppStore } from '../../store/appStore'

const { Title, Text } = Typography

interface ReportRecord {
  id: number; name: string; model_id: number | null; path: string; created_at: string
}

const ReportPage: React.FC = () => {
  const activeModelId = useAppStore(s => s.activeModelId)
  const [reports, setReports] = useState<ReportRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [genModal, setGenModal] = useState(false)
  const [genLoading, setGenLoading] = useState(false)
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [form] = Form.useForm()

  const fetchReports = async () => {
    setLoading(true)
    try {
      const r = await apiClient.get('/api/reports')
      setReports(r.data || [])
    } catch { message.error('获取报告列表失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchReports() }, [])

  // 报告生成对话框打开时，预填当前活跃模型 ID
  useEffect(() => {
    if (genModal && activeModelId !== null) {
      form.setFieldsValue({ model_id: activeModelId })
    }
  }, [genModal, activeModelId, form])

  const handleGenerate = async () => {
    const values = await form.validateFields()
    setGenLoading(true)
    try {
      await apiClient.post('/api/reports/generate', {
        model_id: values.model_id,
        title: values.title || `模型${values.model_id}报告`,
        notes: values.notes || '',
      })
      message.success('报告生成成功')
      setGenModal(false)
      form.resetFields()
      fetchReports()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '生成失败')
    } finally {
      setGenLoading(false)
    }
  }

  const handleDownload = async (id: number, name: string) => {
    try {
      const r = await apiClient.get(`/api/reports/${id}/download`, { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a'); a.href = url; a.download = `${name}.html`; a.click()
      URL.revokeObjectURL(url)
    } catch { message.error('下载失败') }
  }

  const handlePreview = async (id: number) => {
    try {
      const r = await apiClient.get(`/api/reports/${id}/download`, { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      setPreviewUrl(url)
      setPreviewId(id)
    } catch { message.error('预览失败') }
  }

  const handleDelete = async (id: number) => {
    try {
      await apiClient.delete(`/api/reports/${id}`)
      message.success('已删除')
      fetchReports()
    } catch { message.error('删除失败') }
  }

  const columns: ColumnsType<ReportRecord> = [
    { title: '报告名称', dataIndex: 'name', key: 'name', render: v => <Text strong style={{ color: '#60a5fa' }}>{v}</Text> },
    { title: '关联模型 ID', dataIndex: 'model_id', key: 'model_id', render: v => v ? <Tag color="blue">Model #{v}</Tag> : '-' },
    { title: '生成时间', dataIndex: 'created_at', key: 'created_at', render: v => v?.slice(0, 19) },
    {
      title: '操作', key: 'action',
      render: (_, r) => (
        <Space>
          <Button size="small" onClick={() => handlePreview(r.id)}>预览</Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(r.id, r.name)}>下载</Button>
          <Popconfirm title="确认删除此报告？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ color: '#60a5fa', marginBottom: 24 }}>
        <FileTextOutlined /> 报告管理
      </Title>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
            <Statistic title="报告总数" value={reports.length} valueStyle={{ color: '#60a5fa' }} />
          </Card>
        </Col>
        <Col span={18} style={{ display: 'flex', alignItems: 'center' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setGenModal(true)} size="large">
            生成新报告
          </Button>
        </Col>
      </Row>

      <Card style={{ background: '#1e293b', border: '1px solid #334155' }}
        extra={<Button size="small" onClick={fetchReports}>刷新</Button>}>
        <Table
          columns={columns}
          dataSource={reports}
          loading={loading}
          rowKey="id"
          size="small"
          locale={{ emptyText: <Empty description="暂无报告，点击「生成新报告」创建" /> }}
        />
      </Card>

      <Modal
        title="生成报告"
        open={genModal}
        onOk={handleGenerate}
        confirmLoading={genLoading}
        onCancel={() => { setGenModal(false); form.resetFields() }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="model_id" label="模型 ID" rules={[{ required: true, message: '请输入模型ID' }]}>
            <InputNumber min={1} style={{ width: '100%' }} placeholder="输入模型ID" />
          </Form.Item>
          <Form.Item name="title" label="报告标题">
            <Input placeholder="如：泰坦尼克生存预测模型报告" />
          </Form.Item>
          <Form.Item name="notes" label="备注说明">
            <Input.TextArea rows={3} placeholder="可输入模型说明、实验背景等" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="报告预览"
        open={previewId !== null}
        onCancel={() => { setPreviewId(null); if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null) }}
        footer={null}
        width="90vw"
        style={{ top: 20 }}
      >
        {previewUrl && (
          <iframe
            src={previewUrl}
            style={{ width: '100%', height: '70vh', border: 'none', borderRadius: 4 }}
            title="报告预览"
          />
        )}
      </Modal>
    </div>
  )
}

export default ReportPage
