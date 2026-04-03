import React, { useState, useEffect } from 'react'
import {
  Card, Row, Col, Button, Table, Typography, Space,
  InputNumber, Select, Slider, Tooltip, Tag, Alert, message,
  Tabs, Statistic, Badge, Divider, Form
} from 'antd'
import { SettingOutlined, BulbOutlined, CheckCircleOutlined, WarningOutlined } from '@ant-design/icons'
import apiClient from '../../api/client'

const { Title, Text } = Typography

interface ParamSchema {
  name: string; label: string; type: string; default: unknown
  min?: number; max?: number; step?: number; log_scale?: boolean
  options?: string[]; tooltip: string
}

const ParamConfigPage: React.FC = () => {
  const [schema, setSchema] = useState<ParamSchema[]>([])
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [splitId, setSplitId] = useState<number | null>(null)
  const [recommendation, setRecommendation] = useState<{ params: Record<string, unknown>; notes: string[] } | null>(null)
  const [validation, setValidation] = useState<{ valid: boolean; errors: Record<string, string> } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    apiClient.get('/api/params/schema').then(r => {
      setSchema(r.data)
      const defaults: Record<string, unknown> = {}
      r.data.forEach((p: ParamSchema) => { defaults[p.name] = p.default })
      setParams(defaults)
    }).catch(() => message.error('获取参数Schema失败'))
  }, [])

  const handleRecommend = async () => {
    if (!splitId) { message.warning('请输入 Split ID'); return }
    setLoading(true)
    try {
      const r = await apiClient.get('/api/params/recommend', { params: { split_id: splitId } })
      setRecommendation(r.data)
      setParams(prev => ({ ...prev, ...r.data.params }))
      message.success('已应用推荐参数')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '推荐失败')
    } finally {
      setLoading(false)
    }
  }

  const handleValidate = async () => {
    try {
      const r = await apiClient.post('/api/params/validate', params)
      setValidation(r.data)
    } catch {
      message.error('验证失败')
    }
  }

  const handleParamChange = (name: string, value: unknown) => {
    setParams(prev => ({ ...prev, [name]: value }))
    setValidation(null)
  }

  const renderControl = (p: ParamSchema) => {
    const val = params[p.name]
    if (p.type === 'select') {
      return <Select value={val as string} onChange={v => handleParamChange(p.name, v)} style={{ width: '100%' }}
        options={(p.options || []).map(o => ({ value: o, label: o }))} />
    }
    if (p.type === 'int') {
      return <InputNumber min={p.min} max={p.max} step={p.step} value={val as number} onChange={v => handleParamChange(p.name, v)} style={{ width: '100%' }} />
    }
    return <InputNumber min={p.min} max={p.max} step={p.step} value={val as number} precision={4}
      onChange={v => handleParamChange(p.name, v)} style={{ width: '100%' }} />
  }

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ color: '#60a5fa', marginBottom: 24 }}>
        <SettingOutlined /> 超参数配置
      </Title>

      <Row gutter={16}>
        <Col span={8}>
          <Card title={<Text style={{ color: '#e2e8f0' }}>智能推荐</Text>}
            style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text style={{ color: '#94a3b8' }}>Split ID（已划分的数据集）：</Text>
              <InputNumber min={1} value={splitId || undefined} onChange={v => setSplitId(v)} style={{ width: '100%' }} placeholder="输入Split ID" />
              <Button type="primary" icon={<BulbOutlined />} onClick={handleRecommend} loading={loading} block>
                获取智能推荐
              </Button>
              {recommendation?.notes?.map((n, i) => (
                <Alert key={i} type="info" message={n} style={{ fontSize: 12 }} />
              ))}
            </Space>
          </Card>

          <Card title={<Text style={{ color: '#e2e8f0' }}>验证结果</Text>}
            style={{ background: '#1e293b', border: '1px solid #334155' }}>
            <Button icon={<CheckCircleOutlined />} onClick={handleValidate} block style={{ marginBottom: 12 }}>
              验证当前参数
            </Button>
            {validation && (
              validation.valid
                ? <Alert type="success" message="✅ 参数合法" />
                : <div>
                  <Alert type="error" message="参数有误" />
                  {Object.entries(validation.errors).map(([k, v]) => (
                    <div key={k} style={{ marginTop: 4 }}><Tag color="red">{k}</Tag><Text style={{ color: '#fca5a5', fontSize: 12 }}> {v}</Text></div>
                  ))}
                </div>
            )}
          </Card>
        </Col>

        <Col span={16}>
          <Card title={<Text style={{ color: '#e2e8f0' }}>参数设置</Text>}
            style={{ background: '#1e293b', border: '1px solid #334155' }}>
            <Row gutter={[16, 8]}>
              {schema.map(p => (
                <Col span={12} key={p.name}>
                  <Tooltip title={p.tooltip}>
                    <div style={{ marginBottom: 8 }}>
                      <Text style={{ color: '#94a3b8', fontSize: 12 }}>{p.label}</Text>
                      {validation?.errors?.[p.name] && <WarningOutlined style={{ color: '#fca5a5', marginLeft: 4 }} />}
                      <div style={{ marginTop: 4 }}>{renderControl(p)}</div>
                    </div>
                  </Tooltip>
                </Col>
              ))}
            </Row>
            <Divider style={{ borderColor: '#334155' }} />
            <Card style={{ background: '#0f172a', border: '1px solid #334155' }}>
              <Text style={{ color: '#34d399', fontFamily: 'monospace', fontSize: 12 }}>
                {JSON.stringify(params, null, 2)}
              </Text>
            </Card>
          </Card>
        </Col>
      </Row>
    </div>
  )
}

export default ParamConfigPage
