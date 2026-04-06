import React, { useState, useEffect } from 'react'
import {
  Card, Row, Col, Button, Typography, Space, Steps,
  Select, Tag, Alert, message,
  Statistic, Badge, Divider, Collapse
} from 'antd'
import { SettingOutlined, BulbOutlined, CheckCircleOutlined, WarningOutlined, DownOutlined, ThunderboltOutlined, AimOutlined, ExperimentOutlined, DatabaseOutlined, BarChartOutlined, ToolOutlined, PlayCircleOutlined, ReadOutlined } from '@ant-design/icons'
import apiClient from '../../api/client'
import { useAppStore } from '../../store/appStore'
import ParamExplainCard from '../../components/ParamExplainCard'
import ParamLabModal from '../../components/ParamLabModal'
import HelpButton from '../../components/HelpButton'
import type { ParamSchema } from '../../components/ParamExplainCard'
import { showTeachingUi } from '../../utils/teachingUi'

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

// 从 localStorage 恢复上次选中的预设
const STORAGE_KEY = 'xgboost-studio:last-selected-preset'

interface SplitItem {
  id: number
  dataset_id: number
  dataset_name: string
  train_rows: number | null
  test_rows: number | null
  created_at: string | null
}

const ParamConfigPage: React.FC = () => {
  const activeSplitId = useAppStore(s => s.activeSplitId)
  const setActiveSplitId = useAppStore(s => s.setActiveSplitId)
  const workflowMode = useAppStore(s => s.workflowMode)
  const showTeaching = showTeachingUi(workflowMode)
  const [labOpen, setLabOpen] = useState(false)
  const [schema, setSchema] = useState<ParamSchema[]>([])
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [splitId, setSplitId] = useState<number | null>(null)
  const [splitList, setSplitList] = useState<SplitItem[]>([])
  const [selectedPreset, setSelectedPreset] = useState<string | null>(() => {
    // 从 localStorage 恢复上次选中
    try {
      return localStorage.getItem(STORAGE_KEY) || null
    } catch {
      return null
    }
  })
  const [recommendation, setRecommendation] = useState<{ params: Record<string, unknown>; notes: string[]; explanations?: Record<string, string> } | null>(null)
  const [validation, setValidation] = useState<{ valid: boolean; errors: Record<string, string> } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (activeSplitId !== null && splitId === null) setSplitId(activeSplitId)
  }, [activeSplitId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    apiClient.get('/api/datasets/splits/list').then(r => setSplitList(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    apiClient.get('/api/params/schema').then(r => {
      setSchema(r.data)
      const defaults: Record<string, unknown> = {}
      r.data.forEach((p: ParamSchema) => { defaults[p.name] = p.default })
      // 如果有选中的预设，覆盖默认值
      if (selectedPreset) {
        const preset = PRESETS.find(p => p.key === selectedPreset)
        if (preset) {
          Object.assign(defaults, preset.params)
        }
      }
      setParams(defaults)
    }).catch(() => message.error('获取参数Schema失败'))
  }, [])

  const handleRecommend = async () => {
    if (!splitId) { message.warning('请选择数据集划分'); return }
    setLoading(true)
    try {
      const r = await apiClient.get('/api/params/recommend', { params: { split_id: splitId } })
      setRecommendation(r.data)
      setParams(prev => ({ ...prev, ...r.data.params }))
      // AI 推荐覆盖了预设参数，清除预设选中状态
      setSelectedPreset(null)
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {}
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
    // 保存选中状态到 localStorage
    try {
      localStorage.setItem(STORAGE_KEY, preset.key)
    } catch {}
    message.success(`已应用「${preset.label}」预设`)
  }

  const coreSchema = schema.filter(p => CORE_PARAM_NAMES.includes(p.name))
  const advancedSchema = schema.filter(p => !CORE_PARAM_NAMES.includes(p.name))

  const activeDatasetId = useAppStore(s => s.activeDatasetId)
  const activeModelId = useAppStore(s => s.activeModelId)
  // activeSplitId already declared at top

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
    if (!activeModelId) return 3
    return 4
  })()

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ color: '#60a5fa', marginBottom: 16 }}>
        <SettingOutlined /> 超参数配置
      </Title>
      <HelpButton pageTitle="超参数配置" items={[
        { title: '应该用哪个预设？', content: '分类任务推荐「均衡推荐」；回归任务推荐「快速训练」；数据量大（>1万行）用「大数据」。' },
        { title: '最重要的参数是哪些？', content: 'n_estimators（迭代次数）、max_depth（树深）、learning_rate（学习率）是最关键的三个参数。' },
        { title: '参数配置好后如何使用？', content: '点击「下载 JSON」保存当前配置，其内容可直接粘贴到「模型训练」页面的参数输入框。' },
      ]} />

      {/* E3: 向导 / 模型调优：教学卡片与参数实验（专家模式不展示） */}
      {showTeaching && (
        <Alert
          type="success"
          showIcon
          icon={<ReadOutlined />}
          message="参数教学已开启"
          description="智能向导与模型调优模式下默认展示教学卡片（算法直觉、调参效果、过拟合风险）。点击「⚗️ 参数实验」可对比两套参数的训练效果。"
          style={{ marginBottom: 16 }}
          action={
            <Button
              size="small"
              icon={<ExperimentOutlined />}
              onClick={() => setLabOpen(true)}
              disabled={!splitId && !activeSplitId}
            >
              ⚗️ 参数实验
            </Button>
          }
        />
      )}

      {/* 专家流程进度概览 */}
      <Card style={{ marginBottom: 24, background: '#1e293b', border: '1px solid #334155' }}>
        <Steps current={currentStep} size="small" items={expertSteps} />
      </Card>

      {/* 预设方案快捷入口 */}
      <Row gutter={12} style={{ marginBottom: 20 }}>
        {PRESETS.map(preset => (
          <Col span={8} key={preset.key}>
            <Card
              onClick={() => handlePresetSelect(preset)}
              style={{
                background: selectedPreset === preset.key ? `${preset.color}14` : '#1e293b',
                border: '1px solid #334155',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: 'none',
              }}
              styles={{ body: { padding: '12px 16px' } }}
            >
              <Space>
                <span
                  style={{
                    width: 30,
                    height: 30,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 999,
                    fontSize: 18,
                    color: preset.color,
                    border: `1px solid ${selectedPreset === preset.key ? preset.color : '#334155'}`,
                    background: selectedPreset === preset.key ? `${preset.color}1f` : 'transparent',
                  }}
                >
                  {preset.icon}
                </span>
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
              <Text style={{ color: '#94a3b8' }}>数据集划分（已划分的数据集）：</Text>
              <Select
                showSearch
                placeholder="选择划分"
                value={splitId ?? undefined}
                onChange={(v: number) => {
                  setSplitId(v)
                  setActiveSplitId(v)
                }}
                style={{ width: '100%' }}
                options={splitList.map(s => ({
                  value: s.id,
                  label: `${s.dataset_name} / Split #${s.id}（训练 ${s.train_rows ?? '?'} / 测试 ${s.test_rows ?? '?'}）`,
                }))}
                filterOption={(input, opt) => (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              />
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

      {/* E4: 参数对比实验（向导 / 模型调优） */}
      <ParamLabModal
        open={labOpen}
        onClose={() => setLabOpen(false)}
        splitId={splitId ?? activeSplitId}
        paramValues={params as Record<string, number | string>}
        onApplyParams={(newParams) => setParams(prev => ({ ...prev, ...newParams }))}
      />
    </div>
  )
}

export default ParamConfigPage
