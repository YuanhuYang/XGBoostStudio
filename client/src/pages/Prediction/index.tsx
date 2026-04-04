import React, { useState, useEffect } from 'react'
import {
  Card, Row, Col, Button, Typography, Space, InputNumber, Select, Form, Input,
  Table, Tag, Alert, message, Tabs, Upload
} from 'antd'
import { UploadOutlined, DownloadOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { UploadProps } from 'antd'
import ReactECharts from 'echarts-for-react'
import apiClient from '../../api/client'
import { getRequestErrorMessage } from '../../utils/apiError'
import HelpButton from '../../components/HelpButton'

const { Title, Text } = Typography

interface PredictSummary {
  task_id: string
  total_rows: number
  distribution: { label: string; count: number; ratio: number }[]
  has_probability: boolean
  probability_columns: string[]
}

interface ModelOption { value: number; label: string }
interface FeatureColumn { name: string; dtype: string }

const PredictionPage: React.FC = () => {
  const [modelId, setModelId] = useState<number | null>(null)
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [featureColumns, setFeatureColumns] = useState<FeatureColumn[]>([])
  const [featureValues, setFeatureValues] = useState<Record<string, unknown>>({})

  // 加载模型列表
  useEffect(() => {
    apiClient.get('/api/models').then(r => {
      const list = (r.data || []) as { id: number; name: string; task_type: string }[]
      setModelOptions(list.map(m => ({ value: m.id, label: `#${m.id} ${m.name} [${m.task_type}]` })))
    }).catch(() => {})
  }, [])

  // 选择模型时，加载该模型对应数据集的特征列
  const handleModelSelect = async (id: number | null) => {
    setModelId(id)
    setFeatureColumns([])
    setFeatureValues({})
    if (!id) return
    try {
      const mr = await apiClient.get(`/api/models/${id}`)
      const datasetId = mr.data?.dataset_id
      const targetCol: string = mr.data?.target_column || ''
      if (datasetId) {
        const sr = await apiClient.get(`/api/datasets/${datasetId}/stats`)
        const cols: FeatureColumn[] = (sr.data?.columns ?? []).filter(
          (c: { name: string }) => c.name !== targetCol
        )
        setFeatureColumns(cols)
        const initVals: Record<string, unknown> = {}
        cols.forEach((c: FeatureColumn) => { initVals[c.name] = /int|float/.test(c.dtype) ? 0 : '' })
        setFeatureValues(initVals)
      }
    } catch { /* 静默失败，降级到 JSON 模式 */ }
  }

  // 单样本
  const [featuresJson, setFeaturesJson] = useState('{}')
  const [singleResult, setSingleResult] = useState<{
    prediction: unknown
    probabilities?: number[]
    shap_values?: Record<string, number>
  } | null>(null)
  const [singleLoading, setSingleLoading] = useState(false)

  // 批量预测
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchResult, setBatchResult] = useState<{
    task_id: string; total_rows: number; preview: Record<string, unknown> []
  } | null>(null)
  const [predictSummary, setPredictSummary] = useState<PredictSummary | null>(null)

  const handleSingle = async () => {
    if (!modelId) { message.warning('请选择模型'); return }
    setSingleLoading(true)
    try {
      // 优先使用动态表单值，否则解析 JSON
      let features: Record<string, unknown>
      if (featureColumns.length > 0) {
        features = featureValues
      } else {
        try { features = JSON.parse(featuresJson) } catch { message.error('JSON 格式错误'); setSingleLoading(false); return }
      }
      const r = await apiClient.post('/api/prediction/single', { model_id: modelId, features })
      setSingleResult(r.data)
    } catch (e: unknown) {
      message.error(getRequestErrorMessage(e, '预测失败'))
    } finally {
      setSingleLoading(false)
    }
  }

  const handleBatch: UploadProps['customRequest'] = async ({ file, onSuccess, onError }) => {
    if (!modelId) { message.warning('请先选择模型'); return }
    setBatchLoading(true)
    const form = new FormData()
    form.append('model_id', String(modelId))
    form.append('file', file as File)
    try {
      const r = await apiClient.post('/api/prediction/batch', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      setBatchResult(r.data)
      message.success(`批量预测完成，共 ${r.data.total_rows} 行`)
      onSuccess?.({})
      // 获取分布摘要
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
      const a = document.createElement('a'); a.href = url; a.download = `prediction_${batchResult.task_id}.csv`; a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      message.error(getRequestErrorMessage(e, '下载失败'))
    }
  }

  const previewCols = batchResult?.preview?.[0]
    ? Object.keys(batchResult.preview[0]).slice(0, 10).map(k => ({
      title: k, dataIndex: k, key: k, ellipsis: true,
      render: (v: unknown) => v === null ? <Text type="secondary">-</Text> : String(v)
    }))
    : []

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ color: '#60a5fa', marginBottom: 24 }}>
        <ThunderboltOutlined /> 预测推断
      </Title>
      <HelpButton pageTitle="预测推断" items={[
        { title: '如何单样本预测？', content: '在左侧输入特征 JSON，格式如 {"feature1": 1.0}，点击「执行预测」。' },
        { title: '如何批量预测？', content: '切换到「批量预测」Tab，上传 CSV 或 Excel 文件，系统自动预测并展示分布图。' },
        { title: '模型 ID 从哪里找？', content: '到「模型管理」页面查看已训练的模型，复制对应 ID 填入即可。' },
      ]} />

      <Card style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
        <Space>
          <Text style={{ color: '#94a3b8' }}>选择模型：</Text>
          <Select
            showSearch
            allowClear
            placeholder="选择已训练的模型"
            value={modelId ?? undefined}
            onChange={v => handleModelSelect(v ?? null)}
            options={modelOptions}
            style={{ width: 340 }}
            filterOption={(input, opt) => (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
          />
        </Space>
      </Card>

      <Tabs
        items={[
          {
            key: 'single', label: '单样本预测',
            children: (
              <Row gutter={16}>
                <Col span={12}>
                  <Card title={<Text style={{ color: '#e2e8f0' }}>输入特征</Text>}
                    style={{ background: '#1e293b', border: '1px solid #334155' }}>
                    {featureColumns.length > 0 ? (
                      <Form layout="vertical" size="small">
                        {featureColumns.map(col => (
                          <Form.Item key={col.name} label={<Text style={{ color: '#94a3b8', fontSize: 12 }}>{col.name} <Tag style={{ fontSize: 10 }}>{col.dtype}</Tag></Text>} style={{ marginBottom: 8 }}>
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
                        style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', fontFamily: 'monospace', fontSize: 13, padding: 8, borderRadius: 4 }}
                        placeholder='{"feature1": 1.0, "feature2": 2.5, ...}'
                      />
                    )}
                    <Button type="primary" style={{ marginTop: 12 }} onClick={handleSingle} loading={singleLoading} block>
                      执行预测
                    </Button>
                  </Card>
                </Col>
                <Col span={12}>
                  <Card title={<Text style={{ color: '#e2e8f0' }}>预测结果</Text>}
                    style={{ background: '#1e293b', border: '1px solid #334155' }}>
                    {singleResult ? (
                      <div>
                        <div style={{ marginBottom: 12 }}>
                          <Text style={{ color: '#94a3b8' }}>预测值：</Text>
                          <Text style={{ color: '#34d399', fontSize: 28, fontWeight: 700, marginLeft: 8 }}>
                            {String(singleResult.prediction)}
                          </Text>
                        </div>
                        {singleResult.probabilities && (
                          <div style={{ marginBottom: 12 }}>
                            <Text style={{ color: '#94a3b8', display: 'block', marginBottom: 4 }}>各类别概率：</Text>
                            {(singleResult.probabilities as number[]).map((p, i) => (
                              <Tag key={i} color="blue">Class {i}: {(p * 100).toFixed(1)}%</Tag>
                            ))}
                          </div>
                        )}
                        {singleResult.shap_values && (
                          <div>
                            <Text style={{ color: '#94a3b8', display: 'block', marginBottom: 4 }}>SHAP 贡献（前10）：</Text>
                            {Object.entries(singleResult.shap_values as Record<string, number>)
                              .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                              .slice(0, 10)
                              .map(([k, v]) => (
                                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                                  <Text style={{ color: '#94a3b8' }}>{k}</Text>
                                  <Text style={{ color: v >= 0 ? '#34d399' : '#f87171' }}>{v >= 0 ? '+' : ''}{v.toFixed(4)}</Text>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    ) : <Text style={{ color: '#475569' }}>结果将在此显示</Text>}
                  </Card>
                </Col>
              </Row>
            )
          },
          {
            key: 'batch', label: '批量预测',
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
                  <p style={{ color: '#e2e8f0' }}>上传 CSV / Excel 文件进行批量预测</p>
                </Upload.Dragger>

                {batchResult && (
                  <div>
                    <Space style={{ marginBottom: 12 }}>
                      <Tag color="green">共 {batchResult.total_rows} 行</Tag>
                      <Button icon={<DownloadOutlined />} onClick={handleDownload} type="primary" size="small">
                        下载结果 CSV
                      </Button>
                    </Space>

                    {/* 预测分布图 */}
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
                        type="info" showIcon
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
            )
          }
        ]}
      />
    </div>
  )
}

export default PredictionPage
