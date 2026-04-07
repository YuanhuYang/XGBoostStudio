import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Card, Row, Col, Button, Typography, Space, InputNumber, Select, Form, Input,
  Table, Tag, Alert, message, Tabs, Upload, Collapse,
} from 'antd'
import { UploadOutlined, DownloadOutlined, StepBackwardOutlined, StepForwardOutlined, SyncOutlined } from '@ant-design/icons'
import type { UploadProps } from 'antd'
import ReactECharts from 'echarts-for-react'
import apiClient from '../../api/client'
import { fetchSplitTestRow } from '../../api/datasets'
import { getRequestErrorMessage } from '../../utils/apiError'
import { useAppStore } from '../../store/appStore'

const { Text } = Typography

const MAX_COMPARE_MODELS = 5

interface PredictSummary {
  task_id: string
  total_rows: number
  distribution: { label: string; count: number; ratio: number }[]
  has_probability: boolean
  probability_columns: string[]
}

interface ModelOption { value: number; label: string }
interface FeatureColumn { name: string; dtype: string }

interface MainModelMeta {
  id: number
  name: string
  task_type: string
  dataset_id: number | null
  split_id: number | null
}

interface SinglePredictResponse {
  prediction: unknown
  probabilities?: number[]
  shap_values?: Record<string, number>
}

interface ComparePredictRow {
  modelId: number
  label: string
  ok: boolean
  data?: SinglePredictResponse
  error?: string
}

function buildFeaturesPayload(
  featureColumns: FeatureColumn[],
  featureValues: Record<string, unknown>,
  featuresJson: string,
): Record<string, unknown> {
  if (featureColumns.length === 0) {
    return JSON.parse(featuresJson) as Record<string, unknown>
  }
  const out: Record<string, unknown> = {}
  for (const col of featureColumns) {
    if (!/int|float/.test(col.dtype)) continue
    const v = featureValues[col.name]
    if (v === '' || v === undefined || v === null) {
      out[col.name] = 0
    } else if (typeof v === 'number') {
      out[col.name] = v
    } else {
      const n = Number(v)
      out[col.name] = Number.isFinite(n) ? n : 0
    }
  }
  const extra = JSON.parse(featuresJson || '{}') as Record<string, unknown>
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    return { ...out, ...extra }
  }
  return out
}

const PredictionPage: React.FC = () => {
  const activeModelId = useAppStore(s => s.activeModelId)
  const activeSplitId = useAppStore(s => s.activeSplitId)
  const expertCompareModelIds = useAppStore(s => s.expertCompareModelIds)

  const [modelId, setModelId] = useState<number | null>(null)
  const [mainMeta, setMainMeta] = useState<MainModelMeta | null>(null)
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [compareOptions, setCompareOptions] = useState<ModelOption[]>([])
  const [compareModelIds, setCompareModelIds] = useState<number[]>([])
  const [featureColumns, setFeatureColumns] = useState<FeatureColumn[]>([])
  const [featureValues, setFeatureValues] = useState<Record<string, unknown>>({})

  const [featuresJson, setFeaturesJson] = useState('{}')
  const [singleMainResult, setSingleMainResult] = useState<SinglePredictResponse | null>(null)
  const [compareResults, setCompareResults] = useState<ComparePredictRow[]>([])
  const [singleLoading, setSingleLoading] = useState(false)

  const [testRowIndex, setTestRowIndex] = useState(0)
  const [testRowMeta, setTestRowMeta] = useState<{
    row_index: number
    total_rows: number
    target: string | number | boolean | null
  } | null>(null)
  const [testRowLoading, setTestRowLoading] = useState(false)

  const expertSyncedForModelRef = useRef<number | null>(null)
  const prevHeaderModelIdRef = useRef<number | null | undefined>(undefined)

  const [batchLoading, setBatchLoading] = useState(false)
  const [batchResult, setBatchResult] = useState<{
    task_id: string; total_rows: number; preview: Record<string, unknown>[]
  } | null>(null)
  const [predictSummary, setPredictSummary] = useState<PredictSummary | null>(null)

  const effectiveSplitId = useMemo(() => {
    if (mainMeta?.split_id != null) return mainMeta.split_id
    return activeSplitId
  }, [mainMeta?.split_id, activeSplitId])

  const reloadModelOptions = useCallback(() => {
    apiClient.get('/api/models').then(r => {
      const list = (r.data || []) as { id: number; name: string; task_type: string }[]
      setModelOptions(list.map(m => ({ value: m.id, label: `#${m.id} ${m.name} [${m.task_type}]` })))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    reloadModelOptions()
  }, [reloadModelOptions])

  const handleModelSelect = useCallback(async (id: number | null) => {
    setModelId(id)
    setMainMeta(null)
    setFeatureColumns([])
    setFeatureValues({})
    setFeaturesJson('{}')
    setTestRowMeta(null)
    setCompareOptions([])
    setSingleMainResult(null)
    setCompareResults([])
    if (!id) return
    try {
      const mr = await apiClient.get(`/api/models/${id}`)
      const row = mr.data as {
        id: number
        name: string
        task_type: string
        dataset_id: number | null
        split_id: number | null
      }
      setMainMeta({
        id: row.id,
        name: row.name,
        task_type: row.task_type,
        dataset_id: row.dataset_id ?? null,
        split_id: row.split_id ?? null,
      })

      const datasetId = row.dataset_id
      if (datasetId) {
        const [dsR, sr] = await Promise.all([
          apiClient.get(`/api/datasets/${datasetId}`),
          apiClient.get(`/api/datasets/${datasetId}/stats`),
        ])
        const targetCol: string = (dsR.data as { target_column?: string })?.target_column || ''
        const cols: FeatureColumn[] = (sr.data?.columns ?? []).filter(
          (c: { name: string }) => !targetCol || c.name !== targetCol,
        )
        setFeatureColumns(cols)
        const initVals: Record<string, unknown> = {}
        cols.forEach((c: FeatureColumn) => {
          initVals[c.name] = /int|float/.test(c.dtype) ? 0 : ''
        })
        setFeatureValues(initVals)
      }

      const params: Record<string, string | number> = {}
      if (row.dataset_id != null) params.dataset_id = row.dataset_id
      if (row.split_id != null) params.split_id = row.split_id
      params.task_type = row.task_type
      const cr = await apiClient.get('/api/models', { params })
      const clist = (cr.data || []) as { id: number; name: string; task_type: string }[]
      setCompareOptions(
        clist
          .filter(m => m.id !== id)
          .map(m => ({ value: m.id, label: `#${m.id} ${m.name} [${m.task_type}]` })),
      )
    } catch {
      /* 静默失败，降级到 JSON 模式 */
    }
  }, [])

  useEffect(() => {
    if (activeModelId == null || modelOptions.length === 0) return
    const exists = modelOptions.some(o => o.value === activeModelId)
    if (!exists) return
    const headerChanged = prevHeaderModelIdRef.current !== activeModelId
    prevHeaderModelIdRef.current = activeModelId
    if (headerChanged) {
      void handleModelSelect(activeModelId)
    }
  }, [activeModelId, modelOptions, handleModelSelect])

  useEffect(() => {
    if (modelId == null) {
      expertSyncedForModelRef.current = null
      return
    }
    if (expertSyncedForModelRef.current === modelId) return
    const fromExpert = expertCompareModelIds.filter(mid => mid !== modelId).slice(0, MAX_COMPARE_MODELS)
    if (fromExpert.length > 0) {
      setCompareModelIds(fromExpert)
      expertSyncedForModelRef.current = modelId
    }
  }, [modelId, expertCompareModelIds])

  useEffect(() => {
    setCompareModelIds(prev => {
      const allowed = new Set(compareOptions.map(o => o.value))
      const next = prev.filter(x => allowed.has(x)).slice(0, MAX_COMPARE_MODELS)
      return next.length === prev.length && next.every((v, i) => v === prev[i]) ? prev : next
    })
  }, [compareOptions])

  const applySyncExpertCompare = () => {
    if (modelId == null) return
    const allowed = new Set(compareOptions.map(o => o.value))
    const next = expertCompareModelIds
      .filter(mid => mid !== modelId && allowed.has(mid))
      .slice(0, MAX_COMPARE_MODELS)
    setCompareModelIds(next)
    if (next.length === 0) message.info('专家工作台当前无可用对比模型，或列表与主模型数据域不一致')
    else message.success('已同步专家对比列表')
  }

  const loadTestRow = async (index: number) => {
    const sid = effectiveSplitId
    if (sid == null) {
      message.warning('主模型未绑定划分时，请先在顶栏选择训练划分，或选用带 split_id 的模型')
      return
    }
    setTestRowLoading(true)
    try {
      const data = await fetchSplitTestRow(sid, index)
      setTestRowIndex(data.row_index)
      setTestRowMeta({
        row_index: data.row_index,
        total_rows: data.total_rows,
        target: data.target,
      })
      if (featureColumns.length > 0) {
        setFeatureValues(prev => {
          const next = { ...prev }
          for (const [k, v] of Object.entries(data.features)) {
            if (k in next) next[k] = v
          }
          return next
        })
      } else {
        setFeaturesJson(JSON.stringify(data.features, null, 2))
      }
    } catch (e: unknown) {
      message.error(getRequestErrorMessage(e, '载入测试行失败'))
    } finally {
      setTestRowLoading(false)
    }
  }

  const handleRandomTestRow = async () => {
    const sid = effectiveSplitId
    if (sid == null) {
      message.warning('无法抽样：缺少划分上下文')
      return
    }
    setTestRowLoading(true)
    try {
      const head = await fetchSplitTestRow(sid, 0)
      const total = head.total_rows
      if (total <= 0) {
        message.warning('测试集为空')
        return
      }
      const idx = Math.floor(Math.random() * total)
      await loadTestRow(idx)
    } catch (e: unknown) {
      message.error(getRequestErrorMessage(e, '随机抽样失败'))
    } finally {
      setTestRowLoading(false)
    }
  }

  const handleSingle = async () => {
    if (!modelId) {
      message.warning('请选择主模型')
      return
    }
    let features: Record<string, unknown>
    try {
      features = buildFeaturesPayload(featureColumns, featureValues, featuresJson)
    } catch {
      message.error('JSON 格式错误或特征无效')
      return
    }
    const orderedIds = [modelId, ...compareModelIds.filter(id => id !== modelId)].slice(
      0,
      1 + MAX_COMPARE_MODELS,
    )
    const labelFor = (mid: number) =>
      modelOptions.find(o => o.value === mid)?.label
      ?? compareOptions.find(o => o.value === mid)?.label
      ?? `#${mid}`

    setSingleLoading(true)
    setSingleMainResult(null)
    setCompareResults([])
    try {
      const settled = await Promise.allSettled(
        orderedIds.map(mid =>
          apiClient.post('/api/prediction/single', { model_id: mid, features }),
        ),
      )
      const mainSettled = settled[0]
      if (mainSettled?.status === 'fulfilled') {
        setSingleMainResult(mainSettled.value.data as SinglePredictResponse)
      } else {
        message.error(
          getRequestErrorMessage(
            mainSettled && 'reason' in mainSettled ? mainSettled.reason : undefined,
            '主模型预测失败',
          ),
        )
      }
      const rest: ComparePredictRow[] = orderedIds.slice(1).map((mid, i) => {
        const s = settled[i + 1]
        if (s?.status === 'fulfilled') {
          return {
            modelId: mid,
            label: labelFor(mid),
            ok: true,
            data: s.value.data as SinglePredictResponse,
          }
        }
        return {
          modelId: mid,
          label: labelFor(mid),
          ok: false,
          error: getRequestErrorMessage(
            s && 'reason' in s ? s.reason : undefined,
            '预测失败',
          ),
        }
      })
      setCompareResults(rest)
    } finally {
      setSingleLoading(false)
    }
  }

  const handleBatch: UploadProps['customRequest'] = async ({ file, onSuccess, onError }) => {
    if (!modelId) {
      message.warning('请先选择主模型')
      return
    }
    setBatchLoading(true)
    const form = new FormData()
    form.append('model_id', String(modelId))
    form.append('file', file as File)
    try {
      const r = await apiClient.post('/api/prediction/batch', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      setBatchResult(r.data)
      message.success(`批量预测完成，共 ${r.data.total_rows} 行`)
      onSuccess?.({})
      try {
        const sr = await apiClient.get(`/api/prediction/${r.data.task_id}/summary`)
        setPredictSummary(sr.data)
      } catch { /* 摘要可选 */ }
    } catch (e: unknown) {
      message.error(getRequestErrorMessage(e, '批量预测失败'))
      onError?.(e instanceof Error ? e : new Error(getRequestErrorMessage(e, '批量预测失败')))
    } finally {
      setBatchLoading(false)
    }
  }

  const handleDownload = async () => {
    if (!batchResult?.task_id) return
    try {
      const r = await apiClient.get(`/api/prediction/${batchResult.task_id}/download`, { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `prediction_${batchResult.task_id}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      message.error(getRequestErrorMessage(e, '下载失败'))
    }
  }

  const previewCols = batchResult?.preview?.[0]
    ? Object.keys(batchResult.preview[0]).slice(0, 10).map(k => ({
      title: k, dataIndex: k, key: k, ellipsis: true,
      render: (v: unknown) => v === null ? <Text type="secondary">-</Text> : String(v),
    }))
    : []

  const compareTableColumns = [
    {
      title: '模型',
      dataIndex: 'label',
      key: 'label',
      ellipsis: true,
    },
    {
      title: '预测值',
      key: 'pred',
      render: (_: unknown, r: ComparePredictRow) =>
        r.ok && r.data ? <Text style={{ color: '#34d399', fontWeight: 600 }}>{String(r.data.prediction)}</Text>
          : <Text type="danger">{r.error || '-'}</Text>,
    },
    {
      title: '概率（摘要）',
      key: 'proba',
      ellipsis: true,
      render: (_: unknown, r: ComparePredictRow) => {
        if (!r.ok || !r.data?.probabilities?.length) return <Text type="secondary">-</Text>
        const arr = r.data.probabilities as number[]
        return (
          <Space size={[4, 4]} wrap>
            {arr.slice(0, 6).map((p, i) => (
              <Tag key={i} style={{ margin: 0 }}>c{i}: {(p * 100).toFixed(1)}%</Tag>
            ))}
            {arr.length > 6 ? <Tag>…</Tag> : null}
          </Space>
        )
      },
    },
  ]

  const canSampleTest = effectiveSplitId != null

  return (
    <div style={{ padding: 24 }}>
      <Card style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space wrap align="center">
            <Text style={{ color: '#94a3b8' }}>主模型：</Text>
            <Select
              showSearch
              allowClear
              placeholder="选择已训练的模型（默认顶栏当前模型）"
              value={modelId ?? undefined}
              onChange={v => void handleModelSelect(v ?? null)}
              options={modelOptions}
              style={{ minWidth: 320, maxWidth: 420 }}
              filterOption={(input, opt) => (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            />
            <Text style={{ color: '#94a3b8' }}>对比模型：</Text>
            <Select
              mode="multiple"
              allowClear
              placeholder="可选，最多 5 个"
              value={compareModelIds}
              onChange={v => setCompareModelIds((v as number[]).slice(0, MAX_COMPARE_MODELS))}
              options={compareOptions}
              style={{ minWidth: 280, maxWidth: 480 }}
              maxTagCount="responsive"
              disabled={!modelId}
            />
            <Button size="small" icon={<SyncOutlined />} onClick={applySyncExpertCompare} disabled={!modelId}>
              同步专家对比
            </Button>
          </Space>
          <div>
            <Space wrap align="center">
              <Text style={{ color: '#94a3b8' }}>测试集样本：</Text>
              <Tag color={canSampleTest ? 'blue' : 'default'}>
                划分 ID {effectiveSplitId ?? '—'}
              </Tag>
              {!canSampleTest ? (
                <Text type="secondary" style={{ fontSize: 12 }}>需模型绑定 split 或顶栏选择划分</Text>
              ) : null}
              <Button
                size="small"
                icon={<StepBackwardOutlined />}
                disabled={!canSampleTest || testRowLoading || (testRowMeta != null && testRowIndex <= 0)}
                onClick={() => void loadTestRow(Math.max(0, testRowIndex - 1))}
              >
                上一行
              </Button>
              <Button
                size="small"
                icon={<StepForwardOutlined />}
                disabled={
                  !canSampleTest
                  || testRowLoading
                  || (testRowMeta != null && testRowIndex >= testRowMeta.total_rows - 1)
                }
                onClick={() => void loadTestRow(
                  testRowMeta ? Math.min(testRowMeta.total_rows - 1, testRowIndex + 1) : 0,
                )}
              >
                下一行
              </Button>
              <Button size="small" disabled={!canSampleTest || testRowLoading} onClick={() => void handleRandomTestRow()}>
                随机一行
              </Button>
              <Space size={4}>
                <Text style={{ color: '#64748b', fontSize: 12 }}>指定行</Text>
                <InputNumber
                  min={0}
                  size="small"
                  disabled={!canSampleTest || testRowLoading}
                  value={testRowIndex}
                  onChange={v => {
                    if (v != null && Number.isFinite(v)) setTestRowIndex(Math.max(0, Math.floor(v)))
                  }}
                />
                <Button
                  size="small"
                  type="primary"
                  ghost
                  disabled={!canSampleTest || testRowLoading}
                  loading={testRowLoading}
                  onClick={() => void loadTestRow(testRowIndex)}
                >
                  载入
                </Button>
              </Space>
            </Space>
            {testRowMeta ? (
              <Text style={{ display: 'block', marginTop: 8, color: '#64748b', fontSize: 12 }}>
                已载入测试集第 {testRowMeta.row_index + 1} / {testRowMeta.total_rows} 行（0-based 索引 {testRowMeta.row_index}）
                {testRowMeta.target !== null && testRowMeta.target !== undefined
                  ? ` · 该样本真实标签（只读）：${String(testRowMeta.target)}`
                  : ''}
              </Text>
            ) : null}
          </div>
        </Space>
      </Card>

      <Tabs
        items={[
          {
            key: 'single',
            label: '单样本预测',
            children: (
              <Row gutter={16}>
                <Col xs={24} lg={11}>
                  <Card
                    title={<Text style={{ color: '#e2e8f0' }}>输入特征</Text>}
                    style={{ background: '#1e293b', border: '1px solid #334155' }}
                  >
                    {featureColumns.length > 0 ? (
                      <Form layout="vertical" size="small">
                        {featureColumns.map(col => (
                          <Form.Item
                            key={col.name}
                            label={(
                              <Text style={{ color: '#94a3b8', fontSize: 12 }}>
                                {col.name} <Tag style={{ fontSize: 10 }}>{col.dtype}</Tag>
                              </Text>
                            )}
                            style={{ marginBottom: 8 }}
                          >
                            {/int|float/.test(col.dtype) ? (
                              <InputNumber
                                style={{ width: '100%' }}
                                value={featureValues[col.name] as number}
                                onChange={v => setFeatureValues(prev => ({ ...prev, [col.name]: v ?? 0 }))}
                              />
                            ) : (
                              <Input
                                style={{ background: '#0f172a', borderColor: '#334155', color: '#e2e8f0' }}
                                value={featureValues[col.name] as string}
                                onChange={e => setFeatureValues(prev => ({ ...prev, [col.name]: e.target.value }))}
                              />
                            )}
                          </Form.Item>
                        ))}
                      </Form>
                    ) : (
                      <textarea
                        rows={10}
                        value={featuresJson}
                        onChange={e => setFeaturesJson(e.target.value)}
                        style={{
                          width: '100%',
                          background: '#0f172a',
                          border: '1px solid #334155',
                          color: '#e2e8f0',
                          fontFamily: 'monospace',
                          fontSize: 13,
                          padding: 8,
                          borderRadius: 4,
                        }}
                        placeholder='{"feature1": 1.0, "feature2": 2.5, ...}'
                      />
                    )}
                    {featureColumns.length > 0 ? (
                      <Collapse
                        ghost
                        items={[{
                          key: 'json',
                          label: <Text style={{ color: '#94a3b8', fontSize: 12 }}>高级：JSON 覆盖</Text>,
                          children: (
                            <textarea
                              rows={6}
                              value={featuresJson}
                              onChange={e => setFeaturesJson(e.target.value)}
                              style={{
                                width: '100%',
                                background: '#0f172a',
                                border: '1px solid #334155',
                                color: '#e2e8f0',
                                fontFamily: 'monospace',
                                fontSize: 12,
                                padding: 8,
                                borderRadius: 4,
                              }}
                            />
                          ),
                        }]}
                        style={{ marginBottom: 8 }}
                      />
                    ) : null}
                    <Button type="primary" style={{ marginTop: 12 }} onClick={() => void handleSingle()} loading={singleLoading} block>
                      执行预测
                    </Button>
                  </Card>
                </Col>
                <Col xs={24} lg={13}>
                  <Card
                    title={<Text style={{ color: '#e2e8f0' }}>预测结果（主模型）</Text>}
                    style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}
                  >
                    {singleMainResult ? (
                      <div>
                        {testRowMeta && testRowMeta.target !== null && testRowMeta.target !== undefined ? (
                          <Alert
                            type="info"
                            showIcon
                            style={{ marginBottom: 12 }}
                            message={`该测试样本真实标签（只读）：${String(testRowMeta.target)}`}
                          />
                        ) : null}
                        <div style={{ marginBottom: 12 }}>
                          <Text style={{ color: '#94a3b8' }}>预测值：</Text>
                          <Text style={{ color: '#34d399', fontSize: 28, fontWeight: 700, marginLeft: 8 }}>
                            {String(singleMainResult.prediction)}
                          </Text>
                        </div>
                        {singleMainResult.probabilities && (
                          <div style={{ marginBottom: 12 }}>
                            <Text style={{ color: '#94a3b8', display: 'block', marginBottom: 4 }}>各类别概率：</Text>
                            {(singleMainResult.probabilities as number[]).map((p, i) => (
                              <Tag key={i} color="blue">Class {i}: {(p * 100).toFixed(1)}%</Tag>
                            ))}
                          </div>
                        )}
                        {singleMainResult.shap_values && (
                          <div>
                            <Text style={{ color: '#94a3b8', display: 'block', marginBottom: 4 }}>SHAP 贡献（前10）：</Text>
                            {Object.entries(singleMainResult.shap_values as Record<string, number>)
                              .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                              .slice(0, 10)
                              .map(([k, v]) => (
                                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                                  <Text style={{ color: '#94a3b8' }}>{k}</Text>
                                  <Text style={{ color: v >= 0 ? '#34d399' : '#f87171' }}>
                                    {v >= 0 ? '+' : ''}{v.toFixed(4)}
                                  </Text>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <Text style={{ color: '#475569' }}>主模型结果将在此显示</Text>
                    )}
                  </Card>
                  {compareResults.length > 0 ? (
                    <Card title={<Text style={{ color: '#e2e8f0' }}>对比模型</Text>} style={{ background: '#1e293b', border: '1px solid #334155' }}>
                      <Table<ComparePredictRow>
                        size="small"
                        rowKey="modelId"
                        pagination={false}
                        dataSource={compareResults}
                        columns={compareTableColumns}
                      />
                    </Card>
                  ) : null}
                </Col>
              </Row>
            ),
          },
          {
            key: 'batch',
            label: '批量预测',
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Upload.Dragger
                  name="file"
                  accept=".csv,.xlsx"
                  customRequest={handleBatch}
                  showUploadList={false}
                  style={{ background: '#0f172a', border: '2px dashed #334155', marginBottom: 16 }}
                >
                  <p style={{ color: '#60a5fa', fontSize: 32 }}><UploadOutlined /></p>
                  <p style={{ color: '#e2e8f0' }}>上传 CSV / Excel 文件进行批量预测（使用当前主模型）</p>
                </Upload.Dragger>

                {batchResult && (
                  <div>
                    <Space style={{ marginBottom: 12 }}>
                      <Tag color="green">共 {batchResult.total_rows} 行</Tag>
                      <Button icon={<DownloadOutlined />} onClick={handleDownload} type="primary" size="small">
                        下载结果 CSV
                      </Button>
                    </Space>

                    {predictSummary && predictSummary.distribution.length > 0 && (
                      <ReactECharts
                        option={{
                          title: { text: '预测结果分布', textStyle: { color: '#e2e8f0', fontSize: 13 } },
                          tooltip: { formatter: (p: { name: string; value: number; data: { ratio: number } }) => `${p.name}: ${p.value} 条（${(p.data.ratio * 100).toFixed(1)}%）` },
                          xAxis: { type: 'category', data: predictSummary.distribution.map(d => String(d.label)), axisLabel: { color: '#94a3b8' } },
                          yAxis: { type: 'value', name: '数量', axisLabel: { color: '#94a3b8' } },
                          series: [{
                            type: 'bar',
                            data: predictSummary.distribution.map(d => ({ value: d.count, ratio: d.ratio })),
                            itemStyle: { color: '#1677ff' },
                            label: { show: true, position: 'top', formatter: '{c}', color: '#e2e8f0' },
                          }],
                          backgroundColor: 'transparent',
                          grid: { left: 48, right: 16, bottom: 32, top: 48 },
                        }}
                        style={{ height: 220, marginBottom: 12 }}
                      />
                    )}
                    {predictSummary?.has_probability && predictSummary.probability_columns.length > 0 && (
                      <Alert
                        type="info"
                        showIcon
                        message={`结果包含概率列：${predictSummary.probability_columns.join('  /  ')}`}
                        style={{ marginBottom: 12 }}
                      />
                    )}

                    <Table
                      dataSource={batchResult.preview.map((r, i) => ({ ...r, _key: i }))}
                      columns={previewCols}
                      rowKey="_key"
                      size="small"
                      pagination={false}
                      scroll={{ x: true }}
                    />
                  </div>
                )}
              </Card>
            ),
          },
        ]}
      />
    </div>
  )
}

export default PredictionPage
