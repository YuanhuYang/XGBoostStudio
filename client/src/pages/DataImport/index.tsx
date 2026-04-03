import React, { useState, useCallback } from 'react'
import {
  Upload, Table, Button, Space, Tag, Modal, Form, Select, Typography,
  Card, Statistic, Row, Col, Progress, message, Popconfirm, Tooltip,
  Badge, Divider
} from 'antd'
import {
  InboxOutlined, DatabaseOutlined, EyeOutlined, DeleteOutlined,
  CheckCircleOutlined, WarningOutlined, FileTextOutlined
} from '@ant-design/icons'
import type { UploadProps } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { datasetsApi } from '../../api/datasets'
import { useAppStore } from '../../store/appStore'

const { Dragger } = Upload
const { Title, Text } = Typography

interface DatasetRow {
  id: number
  name: string
  original_filename: string
  rows: number
  cols: number
  target_column: string | null
  created_at: string
  quality_score?: number
}

const DataImportPage: React.FC = () => {
  const [datasets, setDatasets] = useState<DatasetRow[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewData, setPreviewData] = useState<{ columns: string[]; rows: Record<string, unknown>[] } | null>(null)
  const [targetModal, setTargetModal] = useState<{ open: boolean; datasetId: number | null }>({ open: false, datasetId: null })
  const [selectedDataset, setSelectedDataset] = useState<DatasetRow | null>(null)
  const [columnOptions, setColumnOptions] = useState<string[]>([])
  const [form] = Form.useForm()
  const setActiveDatasetId = useAppStore(s => s.setActiveDatasetId)

  const fetchDatasets = useCallback(async () => {
    setLoading(true)
    try {
      const res = await datasetsApi.list()
      setDatasets(res.data || [])
    } catch {
      message.error('获取数据集列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { fetchDatasets() }, [fetchDatasets])

  const handleUpload: UploadProps['customRequest'] = async ({ file, onSuccess, onError }) => {
    setUploading(true)
    const formData = new FormData()
    formData.append('file', file as File)
    try {
      await datasetsApi.upload(formData)
      message.success('上传成功')
      fetchDatasets()
      onSuccess?.({})
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '上传失败')
      onError?.(new Error('上传失败'))
    } finally {
      setUploading(false)
    }
  }

  const handlePreview = async (record: DatasetRow) => {
    try {
      const res = await datasetsApi.preview(record.id)
      setPreviewData(res.data)
      setSelectedDataset(record)
      setPreviewVisible(true)
    } catch {
      message.error('获取预览失败')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await datasetsApi.delete(id)
      message.success('已删除')
      fetchDatasets()
    } catch {
      message.error('删除失败')
    }
  }

  const openTargetModal = async (record: DatasetRow) => {
    try {
      const res = await datasetsApi.preview(record.id)
      setColumnOptions(res.data?.columns || [])
      setTargetModal({ open: true, datasetId: record.id })
      form.setFieldsValue({ target_column: record.target_column })
    } catch {
      message.error('获取列信息失败')
    }
  }

  const handleSetTarget = async () => {
    const values = await form.validateFields()
    try {
      await datasetsApi.setTarget(targetModal.datasetId!, values.target_column)
      message.success('目标列已设置')
      setTargetModal({ open: false, datasetId: null })
      setActiveDatasetId(targetModal.datasetId!)
      fetchDatasets()
    } catch {
      message.error('设置失败')
    }
  }

  const columns: ColumnsType<DatasetRow> = [
    { title: '数据集名称', dataIndex: 'name', key: 'name', render: (v) => <Text strong>{v}</Text> },
    { title: '原始文件', dataIndex: 'original_filename', key: 'original_filename', ellipsis: true },
    { title: '行数', dataIndex: 'rows', key: 'rows', render: (v) => v?.toLocaleString() || '-' },
    { title: '列数', dataIndex: 'cols', key: 'cols' },
    {
      title: '目标列', dataIndex: 'target_column', key: 'target_column',
      render: (v) => v ? <Tag color="blue">{v}</Tag> : <Tag color="default">未设置</Tag>
    },
    { title: '上传时间', dataIndex: 'created_at', key: 'created_at', render: (v) => v?.slice(0, 19) },
    {
      title: '操作', key: 'action',
      render: (_, record) => (
        <Space>
          <Tooltip title="预览数据">
            <Button size="small" icon={<EyeOutlined />} onClick={() => handlePreview(record)} />
          </Tooltip>
          <Tooltip title="设置目标列">
            <Button size="small" icon={<CheckCircleOutlined />} onClick={() => openTargetModal(record)} />
          </Tooltip>
          <Tooltip title="设为当前数据集">
            <Button size="small" type="primary" ghost onClick={() => { setActiveDatasetId(record.id); message.success('已设为当前数据集') }}>
              使用
            </Button>
          </Tooltip>
          <Popconfirm title="确认删除此数据集？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  const previewColumns = previewData?.columns?.map(col => ({
    title: col, dataIndex: col, key: col, ellipsis: true,
    render: (v: unknown) => v === null || v === undefined ? <Text type="secondary">-</Text> : String(v)
  })) || []

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ color: '#60a5fa', marginBottom: 24 }}>
        <DatabaseOutlined /> 数据导入
      </Title>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
            <Statistic title="数据集总数" value={datasets.length} valueStyle={{ color: '#60a5fa' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
            <Statistic title="已设目标列" value={datasets.filter(d => d.target_column).length} valueStyle={{ color: '#34d399' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
            <Statistic title="总行数" value={datasets.reduce((s, d) => s + (d.rows || 0), 0)} valueStyle={{ color: '#a78bfa' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
            <Statistic title="支持格式" value="CSV / Excel" valueStyle={{ color: '#fbbf24', fontSize: 18 }} />
          </Card>
        </Col>
      </Row>

      <Card style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 24 }}>
        <Dragger
          name="file"
          multiple={false}
          accept=".csv,.xlsx,.xls"
          customRequest={handleUpload}
          showUploadList={true}
          style={{ background: '#0f172a', border: '2px dashed #334155' }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined style={{ color: '#60a5fa', fontSize: 48 }} />
          </p>
          <p className="ant-upload-text" style={{ color: '#e2e8f0' }}>
            点击或拖拽文件到此区域上传
          </p>
          <p className="ant-upload-hint" style={{ color: '#94a3b8' }}>
            支持 CSV、Excel（.xlsx/.xls）格式，文件大小不超过 200MB
          </p>
        </Dragger>
      </Card>

      <Card
        title={<Text style={{ color: '#e2e8f0' }}><FileTextOutlined /> 数据集列表</Text>}
        style={{ background: '#1e293b', border: '1px solid #334155' }}
        extra={<Button size="small" onClick={fetchDatasets}>刷新</Button>}
      >
        <Table
          columns={columns}
          dataSource={datasets}
          loading={loading}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title="数据预览"
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
        width={1100}
      >
        {selectedDataset && (
          <Space style={{ marginBottom: 12 }}>
            <Tag color="blue">行: {selectedDataset.rows}</Tag>
            <Tag color="purple">列: {selectedDataset.cols}</Tag>
            {selectedDataset.target_column && <Tag color="green">目标列: {selectedDataset.target_column}</Tag>}
          </Space>
        )}
        <Table
          columns={previewColumns}
          dataSource={previewData?.rows?.map((r, i) => ({ ...r, _key: i })) || []}
          rowKey="_key"
          size="small"
          scroll={{ x: true }}
          pagination={{ pageSize: 10 }}
        />
      </Modal>

      <Modal
        title="设置目标列（标签列）"
        open={targetModal.open}
        onOk={handleSetTarget}
        onCancel={() => setTargetModal({ open: false, datasetId: null })}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="target_column" label="目标列" rules={[{ required: true }]}>
            <Select placeholder="选择目标列" options={columnOptions.map(c => ({ label: c, value: c }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default DataImportPage
