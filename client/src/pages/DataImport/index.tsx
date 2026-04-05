import React, { useState, useCallback, useEffect } from 'react'
import {
  Upload, Table, Button, Space, Tag, Modal, Form, Select, Typography,
  Card, Statistic, Row, Col, Progress, message, Popconfirm, Tooltip,
  Badge, Divider, List, Steps
} from 'antd'
import {
  InboxOutlined, DatabaseOutlined, EyeOutlined, DeleteOutlined,
  CheckCircleOutlined, WarningOutlined, FileTextOutlined, SafetyOutlined,
  ImportOutlined, BarChartOutlined, ToolOutlined, SettingOutlined, PlayCircleOutlined,
} from '@ant-design/icons'
import type { UploadProps } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { datasetsApi } from '../../api/datasets'
import { useAppStore } from '../../store/appStore'
import type { QualityScore } from '../../types'
import HelpButton from '../../components/HelpButton'

const { Dragger } = Upload
const { Title, Text } = Typography

const BUILTIN_SAMPLES = [
  { key: 'titanic' as const, label: 'Titanic', task: '二分类' },
  { key: 'boston' as const, label: 'Boston Housing', task: '回归' },
  { key: 'iris' as const, label: 'Iris', task: '多分类' },
]

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
  const [previewData, setPreviewData] = useState<{ columns: string[]; data: Record<string, unknown>[]; total: number } | null>(null)
  const [targetModal, setTargetModal] = useState<{ open: boolean; datasetId: number | null }>({ open: false, datasetId: null })
  const [selectedDataset, setSelectedDataset] = useState<DatasetRow | null>(null)
  const [columnOptions, setColumnOptions] = useState<string[]>([])
  const [form] = Form.useForm()
  const setActiveDatasetId = useAppStore(s => s.setActiveDatasetId)
  const [qualityScores, setQualityScores] = useState<Record<number, QualityScore>>({})
  const [qualityModal, setQualityModal] = useState<{ open: boolean; datasetId: number | null; data: QualityScore | null; name: string }>({ open: false, datasetId: null, data: null, name: '' })
  const [deduping, setDeduping] = useState(false)
  const [sampleKeyLoading, setSampleKeyLoading] = useState<string | null>(null)

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

  const openTargetModal = useCallback(async (record: DatasetRow) => {
    try {
      const res = await datasetsApi.preview(record.id)
      setColumnOptions(res.data?.columns || [])
      setTargetModal({ open: true, datasetId: record.id })
      form.setFieldsValue({ target_column: record.target_column })
    } catch {
      message.error('获取列信息失败')
    }
  }, [form])

  /** 欢迎页一键导入后跳转：自动弹出目标列设置 */
  useEffect(() => {
    let sid: string | null = null
    try {
      sid = sessionStorage.getItem('xgb_open_target_for_dataset')
    } catch {
      return
    }
    if (!sid || loading || datasets.length === 0) return
    const id = Number(sid)
    if (Number.isNaN(id)) {
      try {
        sessionStorage.removeItem('xgb_open_target_for_dataset')
      } catch {
        /* ignore */
      }
      return
    }
    const row = datasets.find(d => d.id === id)
    if (row) {
      try {
        sessionStorage.removeItem('xgb_open_target_for_dataset')
      } catch {
        /* ignore */
      }
      void openTargetModal(row)
    }
  }, [datasets, loading, openTargetModal])

  const handleUpload: UploadProps['customRequest'] = async ({ file, onSuccess, onError }) => {
    setUploading(true)
    const formData = new FormData()
    formData.append('file', file as File)
    try {
      const res = await datasetsApi.upload(formData)
      message.success('上传成功 — 请设置目标列')
      fetchDatasets()
      onSuccess?.({})
      // 上传成功后自动打开设置目标列对话框
      if (res.data?.id) {
        const newRecord = res.data as DatasetRow
        openTargetModal(newRecord)
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '上传失败')
      onError?.(new Error('上传失败'))
    } finally {
      setUploading(false)
    }
  }

  const handleImportSample = async (key: (typeof BUILTIN_SAMPLES)[number]['key']) => {
    setSampleKeyLoading(key)
    try {
      const res = await datasetsApi.importSample(key)
      message.success('已导入内置示例（本地资源，无需联网）')
      await fetchDatasets()
      openTargetModal(res.data as DatasetRow)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '导入内置示例失败')
    } finally {
      setSampleKeyLoading(null)
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

  const handleCheckQuality = async (record: DatasetRow) => {
    try {
      const res = await datasetsApi.qualityScore(record.id)
      const data: QualityScore = res.data
      setQualityScores(prev => ({ ...prev, [record.id]: data }))
      setQualityModal({ open: true, datasetId: record.id, data, name: record.name })
    } catch {
      message.error('获取质量评分失败')
    }
  }

  const handleDropDuplicates = async () => {
    if (!qualityModal.datasetId) return
    setDeduping(true)
    try {
      await datasetsApi.dropDuplicates(qualityModal.datasetId)
      message.success('已删除重复行')
      setQualityModal(prev => ({ ...prev, open: false }))
      fetchDatasets()
    } catch {
      message.error('去重失败')
    } finally {
      setDeduping(false)
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
      title: '数据质量', key: 'quality',
      render: (_: unknown, record: DatasetRow) => {
        const qs = qualityScores[record.id]
        if (!qs) return (
          <Button size="small" icon={<SafetyOutlined />} onClick={() => handleCheckQuality(record)}>检测</Button>
        )
        const color = qs.score >= 80 ? 'success' : qs.score >= 60 ? 'warning' : 'error'
        return (
          <Tag color={color} style={{ cursor: 'pointer' }} onClick={() => handleCheckQuality(record)}>
            {Math.round(qs.score)} 分
          </Tag>
        )
      }
    },
    {
      title: '操作', key: 'action',
      width: 180,
      fixed: 'right' as const,
      render: (_, record) => (
        <Space wrap={false}>
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

  // 专家模式流程进度
  const activeDatasetId = useAppStore(s => s.activeDatasetId)
  const activeSplitId = useAppStore(s => s.activeSplitId)
  const activeModelId = useAppStore(s => s.activeModelId)

  const expertSteps = [
    { title: '数据导入', icon: <DatabaseOutlined /> },
    { title: '特征分析', icon: <BarChartOutlined /> },
    { title: '特征工程', icon: <ToolOutlined /> },
    { title: '参数配置', icon: <SettingOutlined /> },
    { title: '模型训练', icon: <PlayCircleOutlined /> },
  ]

  // 计算当前进度：找到第一个未完成的步骤
  const currentStep = (() => {
    if (!activeDatasetId) return 0
    if (!activeSplitId) return 2
    if (!activeModelId) return 4
    return 4
  })()

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ color: '#60a5fa', marginBottom: 16 }}>
        <DatabaseOutlined /> 数据导入
      </Title>
      <HelpButton pageTitle="数据导入" items={[
        { title: '支持怎样的文件？', content: '支持 CSV、Excel（.xlsx / .xls），单文件不超过 200MB。' },
        { title: '上传后必须设置目标列', content: '目标列（要预测的列）是模型训练的必要条件，上传后系统会自动弹出设置对话框。' },
        { title: '数据质量检测是什么？', content: '点击表格中的「检测」按鈕，系统会评分缺失率、异常率、重复行等指标。' },
      ]} />

      {/* 专家流程进度概览 */}
      <Card style={{ marginBottom: 24, background: '#1e293b', border: '1px solid #334155' }}>
        <Steps current={currentStep} size="small" items={expertSteps} />
      </Card>

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

      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: 8,
        }}
      >
        <Text type="secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0 }}>
          <ImportOutlined style={{ color: '#1677ff' }} />
          内置示例（离线）：
        </Text>
        <Space size={8} wrap>
          {BUILTIN_SAMPLES.map(s => (
            <Button
              key={s.key}
              size="small"
              type="default"
              loading={sampleKeyLoading === s.key}
              disabled={sampleKeyLoading !== null && sampleKeyLoading !== s.key}
              onClick={() => void handleImportSample(s.key)}
            >
              {s.label}（{s.task}）
            </Button>
          ))}
        </Space>
      </div>

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
          scroll={{ x: 'max-content' }}
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
          dataSource={previewData?.data?.map((r, i) => ({ ...r, _key: i })) || []}
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

      <Modal
        title={<Space><SafetyOutlined />数据质量报告 — {qualityModal.name}</Space>}
        open={qualityModal.open}
        onCancel={() => setQualityModal(prev => ({ ...prev, open: false }))}
        footer={[
          qualityModal.data && qualityModal.data.duplicate_rate > 0 && (
            <Popconfirm
              key="dedup"
              title={`确认删除 ${Math.round(qualityModal.data.duplicate_rate * 100)}% 的重复行？`}
              onConfirm={handleDropDuplicates}
            >
              <Button danger loading={deduping}>删除重复行</Button>
            </Popconfirm>
          ),
          <Button key="close" onClick={() => setQualityModal(prev => ({ ...prev, open: false }))}>关闭</Button>,
        ].filter(Boolean)}
        width={520}
      >
        {qualityModal.data && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Row gutter={16}>
              <Col span={6}>
                <Statistic
                  title="综合质量"
                  value={Math.round(qualityModal.data.score)}
                  suffix="/ 100"
                  valueStyle={{ color: qualityModal.data.score >= 80 ? '#52c41a' : qualityModal.data.score >= 60 ? '#faad14' : '#ff4d4f' }}
                />
              </Col>
              <Col span={6}>
                <Statistic title="缺失率" value={`${(qualityModal.data.missing_rate * 100).toFixed(1)}%`}
                  valueStyle={{ color: qualityModal.data.missing_rate > 0.1 ? '#faad14' : '#52c41a' }} />
              </Col>
              <Col span={6}>
                <Statistic title="异常率" value={`${(qualityModal.data.outlier_rate * 100).toFixed(1)}%`}
                  valueStyle={{ color: qualityModal.data.outlier_rate > 0.05 ? '#faad14' : '#52c41a' }} />
              </Col>
              <Col span={6}>
                <Statistic title="重复行" value={`${(qualityModal.data.duplicate_rate * 100).toFixed(1)}%`}
                  valueStyle={{ color: qualityModal.data.duplicate_rate > 0 ? '#ff4d4f' : '#52c41a' }} />
              </Col>
            </Row>
            {qualityModal.data.suggestions.length > 0 && (
              <>
                <Divider style={{ margin: '12px 0' }}>改善建议</Divider>
                <List
                  size="small"
                  dataSource={qualityModal.data.suggestions}
                  renderItem={(s) => <List.Item><WarningOutlined style={{ color: '#faad14', marginRight: 8 }} />{s}</List.Item>}
                />
              </>
            )}
            {qualityModal.data.duplicate_rate === 0 && qualityModal.data.suggestions.length === 0 && (
              <Tag icon={<CheckCircleOutlined />} color="success" style={{ padding: '4px 12px', fontSize: 13 }}>
                数据质量优良，无需额外处理
              </Tag>
            )}
          </Space>
        )}
      </Modal>
    </div>
  )
}

export default DataImportPage
