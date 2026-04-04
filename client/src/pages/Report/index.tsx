import React, { useState, useEffect } from 'react'
import {
  Card, Table, Button, Space, Typography, Modal, Form, Input,
  InputNumber, message, Popconfirm, Tag, Row, Col, Empty,
  Checkbox
} from 'antd'
import { FileTextOutlined, DownloadOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import apiClient from '../../api/client'
import { useAppStore } from '../../store/appStore'
import HelpButton from '../../components/HelpButton'

const { Title, Text } = Typography

const SECTION_OPTIONS = [
  { label: '执行摘要', value: 'executive_summary' },
  { label: '数据概览', value: 'data_overview' },
  { label: '模型参数', value: 'model_params' },
  { label: '评估指标', value: 'evaluation' },
  { label: 'SHAP 特征重要性', value: 'shap' },
  { label: '学习曲线', value: 'learning_curve' },
  { label: '过拟合分析', value: 'overfitting' },
  { label: '基线对比', value: 'baseline' },
  { label: '业务建议', value: 'business_advice' },
  { label: '数据来源', value: 'data_source' },
]

interface ReportRecord {
  id: number; name: string; model_id: number | null; path: string; created_at: string
}

const ReportPage: React.FC = () => {
  const activeModelId = useAppStore(s => s.activeModelId)
  const [reports, setReports] = useState<ReportRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [genModal, setGenModal] = useState(false)
  const [genLoading, setGenLoading] = useState(false)
  const [selectedSections, setSelectedSections] = useState<string[]>(SECTION_OPTIONS.map(o => o.value))
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
        include_sections: selectedSections.length < SECTION_OPTIONS.length ? selectedSections : undefined,
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
      const a = document.createElement('a'); a.href = url; a.download = `${name}.pdf`; a.click()
      URL.revokeObjectURL(url)
    } catch { message.error('下载失败') }
  }

  const handlePreview = (id: number) => {
    // Electron 内无内置 PDF 插件，使用系统默认 PDF 阅览器打开
    const url = `http://127.0.0.1:18899/api/reports/${id}/preview`
    const w = window as unknown as { electron?: { openExternal: (u: string) => void } }
    if (w.electron?.openExternal) {
      w.electron.openExternal(url)
    } else {
      // 非 Electron 环境（浏览器开发模式）
      window.open(url, '_blank')
    }
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
      <HelpButton pageTitle="报告管理" items={[
        { title: '如何生成报告？', content: '点击「生成新报告」，输入模型 ID 并选择所需章节，系统将自动生成 PDF 报告。' },
        { title: '如何选择包含章节？', content: '在生成对话框中勾选/反选对应章节，支持自定义 PDF 内容。' },
        { title: '如何预览 PDF？', content: '点击操作列的「预览」按鈕，将在弹框中内嵌展示 PDF。' },
      ]} />

      <Row gutter={16} style={{ marginBottom: 16 }} align="middle">
        <Col>
          <Space align="center" style={{ marginRight: 16 }}>
            <Text style={{ color: '#94a3b8', fontSize: 14 }}>报告总数：</Text>
            <Text style={{ color: '#60a5fa', fontSize: 22, fontWeight: 700, lineHeight: '1' }}>{reports.length}</Text>
          </Space>
        </Col>
        <Col>
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
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="model_id" label="模型 ID" rules={[{ required: true, message: '请输入模型ID' }]}>
            <InputNumber min={1} style={{ width: '100%' }} placeholder="输入模型ID" />
          </Form.Item>
          <Form.Item name="title" label="报告标题">
            <Input placeholder="如：泰坦尼克生存预测模型报告" />
          </Form.Item>
          <Form.Item name="notes" label="备注说明">
            <Input.TextArea rows={2} placeholder="可输入模型说明、实验背景等" />
          </Form.Item>
        </Form>
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500 }}>包含章节</span>
            <span>
              <Button size="small" type="link" style={{ padding: '0 4px' }}
                onClick={() => setSelectedSections(SECTION_OPTIONS.map(o => o.value))}>全选</Button>
              <Button size="small" type="link" style={{ padding: '0 4px' }}
                onClick={() => setSelectedSections([])}>清空</Button>
            </span>
          </div>
          <Checkbox.Group
            options={SECTION_OPTIONS}
            value={selectedSections}
            onChange={v => setSelectedSections(v as string[])}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 0' }}
          />
        </div>
      </Modal>


    </div>
  )
}

export default ReportPage
