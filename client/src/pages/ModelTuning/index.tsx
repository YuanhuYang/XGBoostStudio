import React, { useState, useEffect, useRef } from 'react'
import {
  Card, Row, Col, Button, Typography, Space, Steps,
  Slider, Select, Alert, message, Statistic, Progress,
  Form, Popconfirm, Tag, Table, Collapse, Descriptions, Badge,
} from 'antd'
import {
  RocketOutlined, StopOutlined, DatabaseOutlined, BarChartOutlined,
  ToolOutlined, SettingOutlined, PlayCircleOutlined, CheckCircleOutlined,
  LoadingOutlined, ClockCircleOutlined,
} from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import apiClient from '../../api/client'
import { getRequestErrorMessage } from '../../utils/apiError'
import { useAppStore } from '../../store/appStore'
import HelpButton from '../../components/HelpButton'

const { Title, Text } = Typography
const { Panel } = Collapse

// ─── 5 阶段定义（与后端保持一致） ────────────────────────────────────────────
const PHASE_DEFS = [
  { id: 1, name: "迭代次数与学习率基准调优", params: ["n_estimators", "learning_rate"], color: "#3b82f6" },
  { id: 2, name: "树结构复杂度调优", params: ["max_depth", "min_child_weight", "gamma"], color: "#8b5cf6" },
  { id: 3, name: "采样策略调优", params: ["subsample", "colsample_bytree", "colsample_bylevel"], color: "#f59e0b" },
  { id: 4, name: "正则化参数调优", params: ["reg_alpha", "reg_lambda"], color: "#ef4444" },
  { id: 5, name: "精细化收尾调优", params: ["n_estimators", "learning_rate"], color: "#10b981" },
]

interface TrialEvent {
  trial?: number; total?: number; score?: number; params?: Record<string, unknown>
  best_score?: number; best_so_far?: number; elapsed_s?: number
  completed?: boolean; best_params?: Record<string, unknown>
  error?: string; stopped?: boolean
  trial_failed?: boolean; n_failed?: number; n_completed?: number
  phase_id?: number; phase_name?: string
  phase_start?: boolean; phase_end?: boolean
  phase_goal?: string; params_to_tune?: string[]; phase_trials?: number
  effect_improvement?: number | null
  phases_completed?: number
  diagnostics?: { phase_records?: PhaseRecord[]; trial_points?: TrialPoint[] }
}

interface PhaseRecord {
  phase_id: number; phase_name: string; phase_goal: string
  params_tuned: string[]; n_trials: number; n_completed: number; n_failed: number
  best_score: number | null; best_params: Record<string, unknown>
  effect_improvement: number | null; selection_rationale: string
  trials: TrialPoint[]
}

interface TrialPoint {
  trial: number; score?: number; best_so_far?: number
  trial_failed?: boolean; phase_id?: number
}

interface SplitItem {
  id: number; dataset_id: number; dataset_name: string
  train_rows: number | null; test_rows: number | null; created_at: string | null
}

const PHASE_COLORS = PHASE_DEFS.reduce((acc, p) => ({ ...acc, [p.id]: p.color }), {} as Record<number, string>)

const ModelTuningPage: React.FC = () => {
  const activeSplitId = useAppStore(s => s.activeSplitId)
  const setActiveModelId = useAppStore(s => s.setActiveModelId)
  const activeDatasetId = useAppStore(s => s.activeDatasetId)
  const activeModelId = useAppStore(s => s.activeModelId)

  const [splitId, setSplitId] = useState<number | null>(null)
  const [splitList, setSplitList] = useState<SplitItem[]>([])
  const [nTrials, setNTrials] = useState(50)
  const [strategy, setStrategy] = useState('tpe')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'error' | 'stopped'>('idle')
  const [trialHistory, setTrialHistory] = useState<TrialEvent[]>([])
  const [bestScore, setBestScore] = useState<number | null>(null)
  const [bestParams, setBestParams] = useState<Record<string, unknown> | null>(null)
  const [resultModelId, setResultModelId] = useState<number | null>(null)
  const [lastResultAt, setLastResultAt] = useState<string | null>(null)

  // 5 阶段状态
  const [currentPhase, setCurrentPhase] = useState<number>(0)  // 0=未开始
  const [phaseGoal, setPhaseGoal] = useState<string>('')
  const [phaseRecords, setPhaseRecords] = useState<PhaseRecord[]>([])
  const [phaseSummaries, setPhaseSummaries] = useState<Record<number, { best_score: number | null; best_params: Record<string, unknown> }>>({})

  const esRef = useRef<EventSource | null>(null)
  const sseRetryRef = useRef(0)
  const MAX_SSE_RETRIES = 3
  const PORT = 18899

  useEffect(() => {
    apiClient.get('/api/datasets/splits/list').then(r => setSplitList(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (activeSplitId !== null && splitId === null) setSplitId(activeSplitId)
  }, [activeSplitId]) // eslint-disable-line

  useEffect(() => {
    if (!splitId) return
    apiClient.get(`/api/tuning/latest?split_id=${splitId}`).then(r => {
      const d = r.data
      if (d.task_id) {
        setTaskId(d.task_id)
        setBestScore(d.best_score ?? null)
        setBestParams(d.best_params ?? null)
        setResultModelId(d.model_id ?? null)
        if (d.model_id) setActiveModelId(d.model_id)
        setStatus('completed')
        setLastResultAt(d.completed_at ?? null)
        if (d.n_trials) setNTrials(d.n_trials)
        if (d.strategy) setStrategy(d.strategy)
        // 恢复 phase_records
        if (d.phase_records) {
          setPhaseRecords(d.phase_records)
          setCurrentPhase(5)
        }
      } else {
        setTaskId(null); setBestScore(null); setBestParams(null)
        setResultModelId(null); setStatus('idle'); setLastResultAt(null)
        setPhaseRecords([]); setCurrentPhase(0)
      }
    }).catch(() => {})
  }, [splitId]) // eslint-disable-line

  useEffect(() => { return () => { esRef.current?.close() } }, [])

  const start = async () => {
    if (!splitId) { message.warning('请选择数据集划分'); return }
    if (status === 'running') { message.warning('调优正在进行中'); return }
    setStatus('running')
    setTrialHistory([])
    setBestScore(null)
    setBestParams(null)
    setPhaseRecords([])
    setCurrentPhase(1)
    setPhaseGoal(PHASE_DEFS[0].phase_goal || '')

    try {
      const r = await apiClient.post('/api/tuning/start', { split_id: splitId, n_trials: nTrials, strategy })
      const tid = r.data.task_id
      setTaskId(tid)
      sseRetryRef.current = 0
      esRef.current?.close()

      const connectSSE = (retryDelay = 0) => {
        setTimeout(() => {
          const es = new EventSource(`http://127.0.0.1:${PORT}/api/tuning/${tid}/progress`)
          esRef.current = es
          es.onmessage = (e) => {
            sseRetryRef.current = 0
            try {
              const data: TrialEvent = JSON.parse(e.data)

              // 阶段开始事件
              if (data.phase_start) {
                setCurrentPhase(data.phase_id || 1)
                setPhaseGoal(data.phase_goal || '')
                return
              }

              // 阶段结束事件
              if (data.phase_end) {
                if (data.phase_id) {
                  setPhaseSummaries(prev => ({
                    ...prev,
                    [data.phase_id!]: {
                      best_score: data.best_score ?? null,
                      best_params: data.best_params || {},
                    }
                  }))
                }
                return
              }

              // 普通 trial 事件
              if (data.trial !== undefined) {
                setTrialHistory(prev => [...prev, data])
                setBestScore(data.best_score ?? data.best_so_far ?? null)
              }

              // 调优完成
              if (data.completed) {
                setStatus('completed')
                setBestParams(data.best_params || null)
                if (data.diagnostics?.phase_records) {
                  setPhaseRecords(data.diagnostics.phase_records)
                }
                setCurrentPhase(5)
                if (data.diagnostics?.phase_records) {
                  setResultModelId(null)
                }
                message.success(`调优完成！共完成 ${data.phases_completed ?? 5} 个阶段`)
                es.close()
                // 获取最终模型ID
                apiClient.get(`/api/tuning/${tid}/result`).then(res => {
                  if (res.data.model_id) {
                    setResultModelId(res.data.model_id)
                    setActiveModelId(res.data.model_id)
                  }
                }).catch(() => {})
              }
              if (data.stopped) { setStatus('stopped'); setCurrentPhase(0); es.close() }
              if (data.error) { setStatus('error'); message.error(data.error); es.close() }
            } catch { /* ignore */ }
          }
          es.onerror = () => {
            es.close()
            if (sseRetryRef.current < MAX_SSE_RETRIES) {
              sseRetryRef.current += 1
              const delay = Math.pow(2, sseRetryRef.current) * 1000
              connectSSE(delay)
            } else {
              setStatus('error')
              message.error('SSE 重连失败，请检查后端服务')
            }
          }
        }, retryDelay)
      }
      connectSSE()
    } catch (e: unknown) {
      message.error(getRequestErrorMessage(e, '启动失败'))
      setStatus('error')
    }
  }

  const stop = async () => {
    if (!taskId) return
    try {
      await apiClient.post(`/api/tuning/${taskId}/stop`)
      esRef.current?.close()
      setStatus('stopped')
    } catch (e: unknown) {
      message.error(getRequestErrorMessage(e, '停止失败'))
    }
  }

  // ── 图表数据 ─────────────────────────────────────────────────────────────────
  const phase1Trials = trialHistory.filter(t => (t.phase_id || 1) === 1 && !t.trial_failed && t.score !== undefined)
  const phase2Trials = trialHistory.filter(t => t.phase_id === 2 && !t.trial_failed && t.score !== undefined)
  const phase3Trials = trialHistory.filter(t => t.phase_id === 3 && !t.trial_failed && t.score !== undefined)
  const phase4Trials = trialHistory.filter(t => t.phase_id === 4 && !t.trial_failed && t.score !== undefined)
  const phase5Trials = trialHistory.filter(t => t.phase_id === 5 && !t.trial_failed && t.score !== undefined)

  const chartOption = trialHistory.length > 0 ? {
    tooltip: { trigger: 'axis' },
    legend: { data: PHASE_DEFS.map(p => p.name), textStyle: { color: '#94a3b8' }, type: 'scroll' },
    xAxis: { type: 'value', name: 'Trial #', axisLabel: { color: '#94a3b8' } },
    yAxis: { type: 'value', name: '得分', axisLabel: { color: '#94a3b8' } },
    series: [
      ...PHASE_DEFS.map((pd, idx) => {
        const pts = [phase1Trials, phase2Trials, phase3Trials, phase4Trials, phase5Trials][idx]
        return {
          name: pd.name,
          type: 'scatter',
          data: pts.map(t => [t.trial!, t.score!]),
          symbolSize: 5,
          itemStyle: { color: pd.color, opacity: 0.7 },
        }
      }),
      {
        name: '全局最优',
        type: 'line',
        data: trialHistory.filter(t => !t.trial_failed && (t.best_score !== undefined || t.best_so_far !== undefined))
                          .map(t => [t.trial!, (t.best_score ?? t.best_so_far)!]),
        showSymbol: false,
        lineStyle: { color: '#34d399', width: 2.5 },
        itemStyle: { color: '#34d399' },
      },
    ],
    backgroundColor: 'transparent',
  } : null

  const pct = trialHistory.length > 0 ? Math.round((trialHistory.length / nTrials) * 100) : 0

  const workflowSteps = [
    { title: '数据导入', icon: <DatabaseOutlined /> },
    { title: '特征分析', icon: <BarChartOutlined /> },
    { title: '特征工程', icon: <ToolOutlined /> },
    { title: '参数配置', icon: <SettingOutlined /> },
    { title: '模型训练', icon: <PlayCircleOutlined /> },
  ]
  const currentWorkflowStep = !activeDatasetId ? 0 : !activeSplitId ? 2 : !activeModelId ? 4 : 4

  const getPhaseStatusIcon = (phaseId: number) => {
    if (status === 'completed' || phaseId < currentPhase) return <CheckCircleOutlined style={{ color: '#52c41a' }} />
    if (phaseId === currentPhase && status === 'running') return <LoadingOutlined style={{ color: '#1677ff' }} />
    return <ClockCircleOutlined style={{ color: '#94a3b8' }} />
  }

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ color: '#60a5fa', marginBottom: 16 }}>
        <RocketOutlined /> 超参数调优（5 阶段分层调优）
      </Title>
      <HelpButton pageTitle="超参数调优" items={[
        { title: '为什么要分 5 个阶段调优？', content: '分层调优遵循 XGBoost 专家调优逻辑：先确定迭代次数基准，再优化树结构，再调采样策略，再加正则化，最后精细收尾。每阶段锁定最优参数传入下一阶段，逐步缩小搜索空间，效率远高于全参数同时搜索。' },
        { title: '每个阶段调优什么参数？', content: '阶段1：n_estimators+learning_rate | 阶段2：max_depth+min_child_weight+gamma | 阶段3：subsample+colsample_bytree | 阶段4：reg_alpha+reg_lambda | 阶段5：降低lr+提高轮数精细化' },
        { title: '试验次数设置多少合适？', content: '建议 50-100；系统自动将总次数均分到 5 个阶段（每阶段至少 5 次）。试验总次数越多，搜索越充分，但耗时也越长。' },
      ]} />

      <Card style={{ marginBottom: 24, background: '#1e293b', border: '1px solid #334155' }}>
        <Steps current={currentWorkflowStep} size="small" items={workflowSteps} />
      </Card>

      <Row gutter={16}>
        {/* 左侧：配置面板 + 5 阶段进度 */}
        <Col span={8}>
          <Card style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
            <Form layout="vertical">
              <Form.Item label={<Text style={{ color: '#94a3b8' }}>选择数据集划分</Text>}>
                <Select value={splitId ?? undefined} onChange={(v: number) => setSplitId(v)}
                  placeholder="选择划分" style={{ width: '100%' }}
                  options={splitList.map(s => ({ value: s.id, label: `${s.dataset_name} / Split #${s.id}（训练 ${s.train_rows ?? '?'} 行）` }))} />
              </Form.Item>
              <Form.Item label={<Text style={{ color: '#94a3b8' }}>搜索策略</Text>}>
                <Select value={strategy} onChange={setStrategy} style={{ width: '100%' }}
                  options={[{ value: 'tpe', label: 'TPE (贝叶斯，推荐)' }, { value: 'random', label: '随机搜索' }]} />
              </Form.Item>
              <Form.Item label={<Text style={{ color: '#94a3b8' }}>总试验次数: {nTrials}（每阶段约 {Math.max(5, Math.floor(nTrials/5))} 次）</Text>}>
                <Slider min={10} max={200} step={5} value={nTrials} onChange={setNTrials} />
              </Form.Item>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Button type="primary" icon={<RocketOutlined />} onClick={start}
                  disabled={status === 'running'} block loading={status === 'running'}>
                  开始 5 阶段调优
                </Button>
                <Popconfirm title="确认停止调优？" onConfirm={stop} okText="停止" cancelText="继续" okButtonProps={{ danger: true }} disabled={status !== 'running'}>
                  <Button danger icon={<StopOutlined />} disabled={status !== 'running'} block>停止调优</Button>
                </Popconfirm>
              </Space>
            </Form>
          </Card>

          {/* 5 阶段步骤卡片 */}
          <Card title={<Text style={{ color: '#e2e8f0' }}>调优阶段进度</Text>}
            style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
            {PHASE_DEFS.map(pd => {
              const summary = phaseSummaries[pd.id]
              const phaseRec = phaseRecords.find(r => r.phase_id === pd.id)
              const isDone = phaseRec || (status === 'completed')
              const isCurrent = currentPhase === pd.id && status === 'running'
              const score = phaseRec?.best_score ?? summary?.best_score

              return (
                <div key={pd.id} style={{ marginBottom: 10, padding: 10, borderRadius: 6, background: isCurrent ? '#1e3a5f' : '#0f172a', border: `1px solid ${isCurrent ? pd.color : '#334155'}` }}>
                  <Space>
                    {getPhaseStatusIcon(pd.id)}
                    <Text style={{ color: isCurrent ? pd.color : (isDone ? '#52c41a' : '#94a3b8'), fontWeight: isCurrent ? 600 : 400, fontSize: 13 }}>
                      阶段{pd.id}：{pd.name}
                    </Text>
                  </Space>
                  <div style={{ marginTop: 4 }}>
                    {pd.params.map(p => <Tag key={p} color="blue" style={{ fontSize: 11 }}>{p}</Tag>)}
                  </div>
                  {isCurrent && phaseGoal && <Text style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginTop: 4 }}>{phaseGoal}</Text>}
                  {score != null && <Text style={{ fontSize: 12, color: '#34d399' }}>最优得分: {score.toFixed(4)}</Text>}
                  {phaseRec?.effect_improvement != null && (
                    <Text style={{ fontSize: 11, color: phaseRec.effect_improvement > 0 ? '#52c41a' : '#94a3b8', marginLeft: 8 }}>
                      {phaseRec.effect_improvement > 0 ? `↑+${phaseRec.effect_improvement.toFixed(4)}` : `↓${phaseRec.effect_improvement.toFixed(4)}`}
                    </Text>
                  )}
                </div>
              )
            })}
          </Card>

          {/* 最终结果 */}
          {bestScore !== null && (
            <Card title={<Text style={{ color: '#e2e8f0' }}>最终最优参数</Text>}
              style={{ background: '#1e293b', border: '1px solid #334155' }}>
              {lastResultAt && status === 'completed' && trialHistory.length === 0 && (
                <Alert type="info" message={`上次调优结果（${new Date(lastResultAt).toLocaleString('zh-CN')}）`} style={{ marginBottom: 10, fontSize: 12 }} showIcon />
              )}
              <Statistic title="全局最优得分" value={bestScore.toFixed(4)} valueStyle={{ color: '#34d399', fontSize: 28 }} />
              {resultModelId && <Alert type="success" message={`模型已保存 ID: ${resultModelId}`} style={{ marginTop: 8 }} />}
              {bestParams && (
                <div style={{ marginTop: 12 }}>
                  <Text style={{ color: '#94a3b8', fontSize: 12 }}>最优参数汇总：</Text>
                  <pre style={{ background: '#0f172a', color: '#60a5fa', padding: 8, borderRadius: 4, fontSize: 11, overflow: 'auto', maxHeight: 200 }}>
                    {JSON.stringify(bestParams, null, 2)}
                  </pre>
                </div>
              )}
            </Card>
          )}
        </Col>

        {/* 右侧：调优轨迹图 + 阶段详情 */}
        <Col span={16}>
          <Card style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
            <Row gutter={16}>
              <Col span={6}><Statistic title="已完成试验" value={trialHistory.filter(t => !t.trial_failed).length} valueStyle={{ color: '#60a5fa' }} /></Col>
              <Col span={6}><Statistic title="总试验次数" value={nTrials} valueStyle={{ color: '#94a3b8' }} /></Col>
              <Col span={6}><Statistic title="当前阶段" value={currentPhase > 0 ? `阶段 ${currentPhase}/5` : '未开始'} valueStyle={{ color: currentPhase > 0 ? PHASE_COLORS[currentPhase] || '#94a3b8' : '#94a3b8' }} /></Col>
              <Col span={6}><Progress percent={pct} strokeColor="#3b82f6" trailColor="#334155" /></Col>
            </Row>
          </Card>

          {chartOption ? (
            <Card title={<Text style={{ color: '#e2e8f0' }}>调优轨迹图（按阶段着色）</Text>}
              style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
              <ReactECharts option={chartOption} style={{ height: 320 }} />
              <div style={{ marginTop: 8 }}>
                {PHASE_DEFS.map(pd => <Tag key={pd.id} color={pd.color}>阶段{pd.id}: {pd.name}</Tag>)}
              </div>
            </Card>
          ) : (
            <Card style={{ background: '#1e293b', border: '1px solid #334155', textAlign: 'center', padding: 60, marginBottom: 16 }}>
              <Text style={{ color: '#475569' }}>选择划分后点击「开始 5 阶段调优」，系统将按专家级调优逻辑分阶段搜索最优参数</Text>
            </Card>
          )}

          {/* 各阶段详细记录 */}
          {phaseRecords.length > 0 && (
            <Card title={<Text style={{ color: '#e2e8f0' }}>各阶段调优详细记录</Text>}
              style={{ background: '#1e293b', border: '1px solid #334155' }}>
              <Collapse accordion>
                {phaseRecords.map(pr => (
                  <Panel
                    key={pr.phase_id}
                    header={
                      <Space>
                        <Badge color={pr.best_score != null ? 'green' : 'gray'} />
                        <Text style={{ color: '#e2e8f0' }}>阶段{pr.phase_id}：{pr.phase_name}</Text>
                        {pr.best_score != null && <Tag color="green">最优: {pr.best_score.toFixed(4)}</Tag>}
                        {pr.effect_improvement != null && (
                          <Tag color={pr.effect_improvement > 0 ? 'green' : 'default'}>
                            {pr.effect_improvement > 0 ? `↑ +${pr.effect_improvement.toFixed(4)}` : `↓ ${pr.effect_improvement.toFixed(4)}`}
                          </Tag>
                        )}
                        <Tag color="blue">{pr.n_completed}/{pr.n_trials} 完成</Tag>
                      </Space>
                    }
                  >
                    <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
                      <Descriptions.Item label="调优目标">{pr.phase_goal}</Descriptions.Item>
                      <Descriptions.Item label="调优参数">{pr.params_tuned.map(p => <Tag key={p} color="blue">{p}</Tag>)}</Descriptions.Item>
                      <Descriptions.Item label="完成/失败">{pr.n_completed} / {pr.n_failed}</Descriptions.Item>
                      <Descriptions.Item label="选择依据">{pr.selection_rationale}</Descriptions.Item>
                    </Descriptions>
                    {pr.best_params && Object.keys(pr.best_params).length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <Text style={{ color: '#94a3b8', fontSize: 12 }}>本阶段最优参数（锁定传入下一阶段）：</Text>
                        <div style={{ marginTop: 4 }}>
                          {Object.entries(pr.best_params).map(([k, v]) => (
                            <Tag key={k} color="purple">{k} = {typeof v === 'number' ? v.toFixed(4) : String(v)}</Tag>
                          ))}
                        </div>
                      </div>
                    )}
                    {pr.trials && pr.trials.length > 0 && (
                      <Table size="small" pagination={{ pageSize: 5, size: 'small' }}
                        dataSource={pr.trials.slice(0, 20).map((t, i) => ({ ...t, key: i }))}
                        columns={[
                          { title: 'Trial', dataIndex: 'trial', key: 'trial', width: 70 },
                          { title: '得分', dataIndex: 'score', key: 'score', render: (v: number) => v != null ? v.toFixed(4) : '-', width: 80 },
                          { title: '最优至今', dataIndex: 'best_so_far', key: 'bsf', render: (v: number) => v != null ? <Text style={{ color: '#34d399' }}>{v.toFixed(4)}</Text> : '-', width: 100 },
                          { title: '参数', dataIndex: 'params', key: 'params', render: (v: Record<string, unknown>) => v ? (
                            <Space wrap size={2}>
                              {Object.entries(v).map(([k, val]) => <Tag key={k} style={{ fontSize: 10 }}>{k}={typeof val === 'number' ? (val as number).toFixed(3) : String(val)}</Tag>)}
                            </Space>
                          ) : '-' },
                        ]}
                      />
                    )}
                  </Panel>
                ))}
              </Collapse>
            </Card>
          )}
        </Col>
      </Row>
    </div>
  )
}

export default ModelTuningPage
