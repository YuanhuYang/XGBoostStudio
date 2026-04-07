import React, { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Upload, Table, Button, Space, Tag, Modal, Form, Select, Typography,
  Card, Statistic, Row, Col, Progress, message, Popconfirm, Tooltip,
  Badge, Divider, List, Steps
} from 'antd'
import {
  InboxOutlined, DatabaseOutlined, EyeOutlined, DeleteOutlined,
  CheckCircleOutlined, WarningOutlined, FileTextOutlined, SafetyOutlined,
  BarChartOutlined, ToolOutlined, SettingOutlined, PlayCircleOutlined,
} from '@ant-design/icons'
import type { UploadProps } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  datasetsApi,
  fetchBuiltinSamples,
  builtinDifficultyColor,
  type BuiltinSampleItem,
} from '../../api/datasets'
import { getDatasetSummary, type CandidateTarget } from '../../api/wizard'
import apiClient from '../../api/client'
import { getRequestErrorMessage } from '../../utils/apiError'
import { formatUtcToBeijing } from '../../utils/datetime'
import { useAppStore } from '../../store/appStore'
import type { QualityScore } from '../../types'
const { Dragger } = Upload
const { Text } = Typography

const DIFFICULTY_ORDER = ['入门', '进阶', '挑战'] as const
const DIFFICULTY_TIER_HINT: Record<(typeof DIFFICULTY_ORDER)[number], string> = {
  入门: '小样本 · 上手快',
  进阶: '典型业务表格',
  挑战: '更复杂或更大规模',
}

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
  const [candidateTargets, setCandidateTargets] = useState<CandidateTarget[]>([])
  const [form] = Form.useForm()
  const activeDatasetId = useAppStore(s => s.activeDatasetId)
  const activeModelId = useAppStore(s => s.activeModelId)
  const setActiveDatasetId = useAppStore(s => s.setActiveDatasetId)
  const activeSplitId = useAppStore(s => s.activeSplitId)
  const setActiveSplitId = useAppStore(s => s.setActiveSplitId)
  const setActiveModelId = useAppStore(s => s.setActiveModelId)

  const clearSplitContextIfDatasetMismatch = useCallback(async (newDatasetId: number) => {
    if (activeSplitId === null) return
    try {
      const r = await apiClient.get<Array<{ id: number; dataset_id: number }>>('/api/datasets/splits/list')
      const list = Array.isArray(r.data) ? r.data : []
      const row = list.find(s => s.id === activeSplitId)
      if (row && row.dataset_id !== newDatasetId) {
        setActiveSplitId(null)
        setActiveModelId(null)
      }
    } catch {
      /* 静默失败，仍允许切换数据集 */
    }
  }, [activeSplitId, setActiveSplitId, setActiveModelId])
  const [qualityScores, setQualityScores] = useState<Record<number, QualityScore>>({})
  const [qualityModal, setQualityModal] = useState<{ open: boolean; datasetId: number | null; data: QualityScore | null; name: string }>({ open: false, datasetId: null, data: null, name: '' })
  const [deduping, setDeduping] = useState(false)
  const [sampleKeyLoading, setSampleKeyLoading] = useState<string | null>(null)
  const [sampleSelectNonce, setSampleSelectNonce] = useState(0)
  const [builtinSamples, setBuiltinSamples] = useState<BuiltinSampleItem[]>([])
  const [builtinCatalogLoading, setBuiltinCatalogLoading] = useState(true)

  React.useEffect(() => {
    void fetchBuiltinSamples().then((items) => {
      setBuiltinSamples(items)
      setBuiltinCatalogLoading(false)
    })
  }, [])

  const sampleGroupedOptions = useMemo(
    () =>
      DIFFICULTY_ORDER.map(d => ({
        label: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <Tag color={builtinDifficultyColor(d)}>{d}</Tag>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {DIFFICULTY_TIER_HINT[d]}
            </Text>
          </span>
        ),
        options: builtinSamples
          .filter(s => s.difficulty === d)
          .map(s => {
            const searchText =
              `${s.title} ${s.task} ${s.scenario} ${s.key} ${s.suggested_target ?? ''}`.toLowerCase()
            return {
              value: s.key,
              title: `${s.title}（${s.task}）`,
              searchText,
              label: (
                <div style={{ padding: '2px 0', lineHeight: 1.35 }}>
                  <div>
                    <Text strong style={{ color: '#e2e8f0' }}>{s.title}</Text>
                    <Tag
                      color="processing"
                      style={{ marginLeft: 6, fontSize: 10, lineHeight: '16px' }}
                    >
                      {s.task}
                    </Tag>
                  </div>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                    {s.scenario}
                  </Text>
                </div>
              ),
            }
          }),
      })),
    [builtinSamples],
  )

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
      const [previewRes, summaryRes] = await Promise.all([
        datasetsApi.preview(record.id),
        getDatasetSummary(record.id).catch(() => null),
      ])
      setColumnOptions(previewRes.data?.columns || [])
      const cands = summaryRes?.candidate_targets ?? []
      setCandidateTargets(cands)
      setTargetModal({ open: true, datasetId: record.id })
      const autoTarget = record.target_column || (cands[0]?.col ?? null)
      form.setFieldsValue({ target_column: autoTarget })
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
      message.error(getRequestErrorMessage(e, '上传失败'))
      onError?.(new Error('上传失败'))
    } finally {
      setUploading(false)
    }
  }

  const handleImportSample = async (key: string) => {
    const label = builtinSamples.find(s => s.key === key)?.title ?? key
    setSampleKeyLoading(key)
    try {
      await datasetsApi.importSample(key)
      message.success(`已添加示例数据集「${label}」，可在列表中设置目标列`)
      await fetchDatasets()
    } catch (e: unknown) {
      message.error(getRequestErrorMessage(e, '添加示例数据失败'))
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
    const did = targetModal.datasetId!
    try {
      await datasetsApi.setTarget(did, values.target_column)
      message.success('目标列已设置')
      setTargetModal({ open: false, datasetId: null })
      await clearSplitContextIfDatasetMismatch(did)
      setActiveDatasetId(did)
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
    { title: '上传时间', dataIndex: 'created_at', key: 'created_at', render: (v) => formatUtcToBeijing(v) },
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
            <Button
              size="small"
              type="primary"
              ghost
              onClick={async () => {
                await clearSplitContextIfDatasetMismatch(record.id)
                setActiveDatasetId(record.id)
                message.success('已设为当前数据集')
              }}
            >
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
  const expertSteps = [
    { title: '数据工作台', icon: <DatabaseOutlined /> },
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
        extra={(
          <Space size={8} wrap>
            <Tooltip title="按难度分组；可输入关键词筛选名称、任务类型或场景说明。随包 CSV，无需上传。">
              <Select
                key={sampleSelectNonce}
                size="small"
                placeholder={
                  builtinCatalogLoading
                    ? '正在加载示例目录…'
                    : builtinSamples.length === 0
                      ? '暂无可用示例（请确认后端已启动且版本匹配）'
                      : '添加示例数据（可搜索）'
                }
                style={{ minWidth: 240 }}
                loading={builtinCatalogLoading || sampleKeyLoading !== null}
                disabled={
                  builtinCatalogLoading ||
                  sampleKeyLoading !== null ||
                  builtinSamples.length === 0
                }
                optionLabelProp="title"
                popupMatchSelectWidth={false}
                listHeight={320}
                styles={{ popup: { root: { minWidth: 460, maxHeight: 400 } } }}
                showSearch
                filterOption={(input: string, option) => {
                  const q = input.trim().toLowerCase()
                  if (!q) return true
                  const st = (option as { searchText?: string }).searchText
                  if (st) return st.includes(q)
                  const t = String((option as { title?: string }).title ?? '').toLowerCase()
                  return t.includes(q)
                }}
                options={sampleGroupedOptions}
                onChange={(k) => {
                  if (!k) return
                  void handleImportSample(k).then(() => setSampleSelectNonce(n => n + 1))
                }}
                allowClear={false}
              />
            </Tooltip>
            <Button size="small" onClick={fetchDatasets}>刷新</Button>
          </Space>
        )}
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
        onCancel={() => { setTargetModal({ open: false, datasetId: null }); setCandidateTargets([]) }}
      >
        {candidateTargets.length > 0 && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: '#1e293b', borderRadius: 6, border: '1px solid #334155' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              智能推荐：<Text strong style={{ color: '#60a5fa' }}>{candidateTargets[0].col}</Text>
              <Tag color="blue" style={{ fontSize: 10, marginLeft: 6 }}>
                {Math.round(candidateTargets[0].confidence * 100)}%
              </Tag>
              <span style={{ marginLeft: 4, color: '#94a3b8' }}>— {candidateTargets[0].reason}</span>
            </Text>
          </div>
        )}
        <Form form={form} layout="vertical">
          <Form.Item name="target_column" label="目标列" rules={[{ required: true, message: '请选择要预测的目标列' }]}>
            <Select
              placeholder="选择目标列"
              showSearch
              filterOption={(input, option) =>
                String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
              }
            >
              {columnOptions.map(c => {
                const cand = candidateTargets.find(ct => ct.col === c)
                return (
                  <Select.Option key={c} value={c}>
                    <Space>
                      <span>{c}</span>
                      {cand && (
                        <Tag color="blue" style={{ fontSize: 10 }}>
                          推荐 {Math.round(cand.confidence * 100)}%
                        </Tag>
                      )}
                    </Space>
                  </Select.Option>
                )
              })}
            </Select>
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
