import React, { useState } from 'react'
import {
  Card, Row, Col, Button, Typography, Space, InputNumber,
  Table, Tag, Alert, message, Tabs, Upload, Form, Input, Divider
} from 'antd'
import { UploadOutlined, DownloadOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { UploadProps } from 'antd'
import apiClient from '../../api/client'

const { Title, Text } = Typography

const PredictionPage: React.FC = () => {
  const [modelId, setModelId] = useState<number | null>(null)

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

  const handleSingle = async () => {
    if (!modelId) { message.warning('请输入模型 ID'); return }
    setSingleLoading(true)
    try {
      let features: Record<string, unknown>
      try { features = JSON.parse(featuresJson) } catch { message.error('JSON 格式错误'); setSingleLoading(false); return }
      const r = await apiClient.post('/api/prediction/single', { model_id: modelId, features })
      setSingleResult(r.data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '预测失败')
    } finally {
      setSingleLoading(false)
    }
  }

  const handleBatch: UploadProps['customRequest'] = async ({ file, onSuccess, onError }) => {
    if (!modelId) { message.warning('请先输入模型 ID'); return }
    setBatchLoading(true)
    const form = new FormData()
    form.append('model_id', String(modelId))
    form.append('file', file as File)
    try {
      const r = await apiClient.post('/api/prediction/batch', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      setBatchResult(r.data)
      message.success(`批量预测完成，共 ${r.data.total_rows} 行`)
      onSuccess?.({})
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '批量预测失败')
      onError?.(new Error('失败'))
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
    } catch { message.error('下载失败') }
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

      <Card style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
        <Space>
          <Text style={{ color: '#94a3b8' }}>模型 ID：</Text>
          <InputNumber min={1} value={modelId || undefined} onChange={v => setModelId(v)} placeholder="输入模型ID" />
        </Space>
      </Card>

      <Tabs
        items={[
          {
            key: 'single', label: '单样本预测',
            children: (
              <Row gutter={16}>
                <Col span={12}>
                  <Card title={<Text style={{ color: '#e2e8f0' }}>输入特征（JSON）</Text>}
                    style={{ background: '#1e293b', border: '1px solid #334155' }}>
                    <textarea
                      rows={10}
                      value={featuresJson}
                      onChange={e => setFeaturesJson(e.target.value)}
                      style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', fontFamily: 'monospace', fontSize: 13, padding: 8, borderRadius: 4 }}
                      placeholder='{"feature1": 1.0, "feature2": 2.5, ...}'
                    ></textarea>
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
