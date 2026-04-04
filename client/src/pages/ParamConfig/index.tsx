import React, { useState, useEffect } from 'react'
import {
  Card, Row, Col, Button, Typography, Space,
  InputNumber, Tag, Alert, message,
  Statistic, Badge, Divider, Collapse
} from 'antd'
import { SettingOutlined, BulbOutlined, CheckCircleOutlined, WarningOutlined, DownOutlined, ThunderboltOutlined, AimOutlined, ExperimentOutlined } from '@ant-design/icons'
import apiClient from '../../api/client'
import { useAppStore } from '../../store/appStore'
import ParamExplainCard from '../../components/ParamExplainCard'
import type { ParamSchema } from '../../components/ParamExplainCard'

const { Title, Text } = Typography

// 核心参数（面向所有用户）
const CORE_PARAM_NAMES = ['n_estimators', 'max_depth', 'learning_rate', 'subsample', 'colsample_bytree', 'reg_lambda']

// 预设方案
const PRESETS = [
  {
    key: 'fast',
    label: '快速验证',
    desc: '小数据集/初步探索',
    icon: <ThunderboltOutlined />,
    color: '#f59e0b',
    params: { n_estimators: 50, max_depth: 4, learning_rate: 0.3, subsample: 0.8, colsample_bytree: 0.8, reg_lambda: 1 }
  },
  {
    key: 'balanced',
    label: '均衡推荐',
    desc: '大多数场景首选',
    icon: <AimOutlined />,
    color: '#3b82f6',
    params: { n_estimators: 200, max_depth: 6, learning_rate: 0.1, subsample: 0.8, colsample_bytree: 0.8, reg_lambda: 1 }
  },
  {
    key: 'deep',
    label: '深度训练',
    desc: '追求最高精度（较慢）',
    icon: <ExperimentOutlined />,
    color: '#8b5cf6',
    params: { n_estimators: 500, max_depth: 8, learning_rate: 0.05, subsample: 0.7, colsample_bytree: 0.7, reg_lambda: 1 }
  },
]

const ParamConfigPage: React.FC = () => {
  const activeSplitId = useAppStore(s => s.activeSplitId)
  const [schema, setSchema] = useState<ParamSchema[]>([])
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [splitId, setSplitId] = useState<number | null>(null)
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [recommendation, setRecommendation] = useState<{ params: Record<string, unknown>; notes: string[]; explanations?: Record<string, string> } | null>(null)
  const [validation, setValidation] = useState<{ valid: boolean; errors: Record<string, string> } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (activeSplitId !== null && splitId === null) setSplitId(activeSplitId)
  }, [activeSplitId]) // eslint-disable-line react-hooks/exhaustive-deps

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
    setSelectedPreset(null)
    setValidation(null)
  }

  const handlePresetSelect = (preset: typeof PRESETS[0]) => {
    setSelectedPreset(preset.key)
    setParams(prev => ({ ...prev, ...preset.params }))
    setValidation(null)
    message.success(`已应用「${preset.label}」预设`)
  }

  const coreSchema = schema.filter(p => CORE_PARAM_NAMES.includes(p.name))
  const advancedSchema = schema.filter(p => !CORE_PARAM_NAMES.includes(p.name))

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ color: '#60a5fa', marginBottom: 24 }}>
        <SettingOutlined /> 超参数配置
      </Title>

      {/* 预设方案快捷入口 */}
      <Row gutter={12} style={{ marginBottom: 20 }}>
        {PRESETS.map(preset => (
          <Col span={8} key={preset.key}>
            <Card
              onClick={() => handlePresetSelect(preset)}
              style={{
                background: selectedPreset === preset.key ? `${preset.color}22` : '#1e293b',
                border: `2px solid ${selectedPreset === preset.key ? preset.color : '#334155'}`,
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: selectedPreset === preset.key ? `0 0 0 1px ${preset.color}` : 'none',
              }}
              styles={{ body: { padding: '12px 16px' } }}
            >
              <Space>
                <span style={{ fontSize: 20, color: preset.color }}>{preset.icon}</span>
                <div>
                  <Text strong style={{ color: preset.color, display: 'block' }}>{preset.label}</Text>
                  <Text style={{ color: '#64748b', fontSize: 12 }}>{preset.desc}</Text>
                </div>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

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

          <Card title={<Text style={{ color: '#e2e8f0' }}>参数验证</Text>}
            style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
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

          <Card title={<Text style={{ color: '#e2e8f0' }}>当前参数（JSON）</Text>}
            style={{ background: '#1e293b', border: '1px solid #334155' }}>
            <pre style={{ color: '#34d399', fontFamily: 'monospace', fontSize: 11, margin: 0, overflow: 'auto', maxHeight: 300 }}>
              {JSON.stringify(params, null, 2)}
            </pre>
          </Card>
        </Col>

        <Col span={16}>
          <Card
            title={
              <Space>
                <Text style={{ color: '#e2e8f0' }}>核心参数</Text>
                <Badge count="6" style={{ backgroundColor: '#3b82f6' }} />
                <Text style={{ color: '#64748b', fontSize: 12 }}>滑块颜色表示过拟合风险：🟢 安全 🟡 注意 🔴 高风险</Text>
              </Space>
            }
            style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}
          >
            {coreSchema.map(p => (
              <div key={p.name} style={{ position: 'relative' }}>
                {validation?.errors?.[p.name] && (
                  <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
                    <Tag color="red" style={{ fontSize: 11 }}><WarningOutlined /> 参数错误</Tag>
                  </div>
                )}
                <ParamExplainCard
                  schema={p}
                  value={params[p.name] as number | string ?? p.default}
                  onChange={v => handleParamChange(p.name, v)}
                  explanation={recommendation?.explanations?.[p.name]}
                />
              </div>
            ))}
          </Card>

          <Collapse
            ghost
            size="small"
            items={[{
              key: 'advanced',
              label: (
                <Space>
                  <DownOutlined style={{ color: '#64748b', fontSize: 11 }} />
                  <Text style={{ color: '#64748b', fontSize: 13 }}>高级参数（{advancedSchema.length} 个，通常无需修改）</Text>
                </Space>
              ),
              children: (
                <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                  {advancedSchema.map(p => (
                    <ParamExplainCard
                      key={p.name}
                      schema={p}
                      value={params[p.name] as number | string ?? p.default}
                      onChange={v => handleParamChange(p.name, v)}
                      explanation={recommendation?.explanations?.[p.name]}
                    />
                  ))}
                </Card>
              ),
            }]}
          />
        </Col>
      </Row>
    </div>
  )
}

export default ParamConfigPage
