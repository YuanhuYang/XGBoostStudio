import React, { useState, useEffect, useRef } from 'react'
import {
  Card, Row, Col, Button, Typography, Space,
  Slider, Select, Alert, message, Statistic, Progress, Form, Popconfirm
} from 'antd'
import { RocketOutlined, StopOutlined } from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import apiClient from '../../api/client'
import { useAppStore } from '../../store/appStore'
import HelpButton from '../../components/HelpButton'

const { Title, Text } = Typography

interface TrialEvent {
  trial?: number; total?: number; score?: number; params?: Record<string, unknown>
  best_score?: number; elapsed_s?: number
  completed?: boolean; best_params?: Record<string, unknown>
  error?: string; stopped?: boolean
}

interface SplitItem {
  id: number
  dataset_id: number
  dataset_name: string
  train_rows: number | null
  test_rows: number | null
  created_at: string | null
}

const ModelTuningPage: React.FC = () => {
  const activeSplitId = useAppStore(s => s.activeSplitId)
  const setActiveModelId = useAppStore(s => s.setActiveModelId)

  // ── 状态声明（所有 useState/useRef 必须在 useEffect 之前） ──────────────────
  const [splitId, setSplitId] = useState<number | null>(null)
  const [splitList, setSplitList] = useState<SplitItem[]>([])
  const [lastResultAt, setLastResultAt] = useState<string | null>(null)
  const [nTrials, setNTrials] = useState(30)
  const [strategy, setStrategy] = useState('tpe')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'error' | 'stopped'>('idle')
  const [trialHistory, setTrialHistory] = useState<TrialEvent[]>([])
  const [bestScore, setBestScore] = useState<number | null>(null)
  const [bestParams, setBestParams] = useState<Record<string, unknown> | null>(null)
  const [resultModelId, setResultModelId] = useState<number | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const sseRetryRef = useRef(0)
  const MAX_SSE_RETRIES = 3
  const PORT = 18899

  // ── Effects ──────────────────────────────────────────────────────────────────

  // 加载所有可用 split 列表
  useEffect(() => {
    apiClient.get('/api/datasets/splits/list').then(r => {
      setSplitList(r.data)
    }).catch(() => { /* 静默失败 */ })
  }, [])

  // 有 activeSplitId 时预选
  useEffect(() => {
    if (activeSplitId !== null && splitId === null) setSplitId(activeSplitId)
  }, [activeSplitId]) // eslint-disable-line react-hooks/exhaustive-deps

  // splitId 变化时加载上次调优结果
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
      } else {
        setTaskId(null)
        setBestScore(null)
        setBestParams(null)
        setResultModelId(null)
        setStatus('idle')
        setLastResultAt(null)
      }
    }).catch(() => { /* 静默失败 */ })
  }, [splitId]) // eslint-disable-line react-hooks/exhaustive-deps

  // SSE 清理
  useEffect(() => {
    return () => { esRef.current?.close() }
  }, [])

  const start = async () => {
    if (!splitId) { message.warning('请输入 Split ID'); return }
    if (status === 'running') { message.warning('调优正在进行中'); return }
    setStatus('running')
    setTrialHistory([])
    setBestScore(null)
    setBestParams(null)
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
              if (data.trial !== undefined) {
                setTrialHistory(prev => [...prev, data])
                setBestScore(data.best_score || null)
              }
              if (data.completed) {
                setStatus('completed')
                setBestParams(data.best_params || null)
                message.success('调优完成！')
                es.close()
              }
              if (data.stopped) { setStatus('stopped'); es.close() }
              if (data.error) { setStatus('error'); message.error(data.error); es.close() }
            } catch { /* ignore */ }
          }
          es.onerror = () => {
            es.close()
            if (sseRetryRef.current < MAX_SSE_RETRIES) {
              sseRetryRef.current += 1
              const delay = Math.pow(2, sseRetryRef.current) * 1000
              message.warning(`SSE 连接中断，${delay / 1000}s 后第 ${sseRetryRef.current} 次重连...`)
              connectSSE(delay)
            } else {
              setStatus('error')
              message.error('SSE 重连失败（已重试 3 次），请检查后端服务')
            }
          }
        }, retryDelay)
      }
      connectSSE()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '启动失败')
      setStatus('error')
    }
  }

  const stop = async () => {
    if (!taskId) return
    try {
      await apiClient.post(`/api/tuning/${taskId}/stop`)
      esRef.current?.close()
      setStatus('stopped')
    } catch { message.error('停止失败') }
  }

  const getResult = async () => {
    if (!taskId) return
    try {
      const r = await apiClient.get(`/api/tuning/${taskId}/result`)
      setBestParams(r.data.best_params)
      setBestScore(r.data.best_score)
      setResultModelId(r.data.model_id)
      if (r.data.model_id) setActiveModelId(r.data.model_id)
    } catch { message.error('获取结果失败') }
  }

  const scoreHistory = trialHistory.map((t, i) => [i + 1, t.score || 0])
  const bestHistory = trialHistory.map((t, i) => [i + 1, t.best_score || 0])

  const chartOption = trialHistory.length > 0 ? {
    tooltip: { trigger: 'axis' },
    legend: { textStyle: { color: '#94a3b8' } },
    xAxis: { type: 'value', name: 'Trial', axisLabel: { color: '#94a3b8' } },
    yAxis: { type: 'value', name: '得分', axisLabel: { color: '#94a3b8' } },
    series: [
      { name: '本轮得分', type: 'scatter', data: scoreHistory, symbolSize: 6, itemStyle: { color: '#60a5fa', opacity: 0.6 } },
      { name: '最优得分', type: 'line', data: bestHistory, showSymbol: false, lineStyle: { color: '#34d399', width: 2 } }
    ]
  } : null

  const pct = trialHistory.length > 0 ? Math.round((trialHistory.length / nTrials) * 100) : 0

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ color: '#60a5fa', marginBottom: 24 }}>
        <RocketOutlined /> 超参数调优
      </Title>
      <HelpButton pageTitle="超参数调优" items={[
        { title: 'TPE 策略与随机搜索何受？', content: 'TPE（Tree Parzen）是智能调优，会从历史 trial 學习并聚焦在好区域，通常 50 轮内收敛。' },
        { title: '调优Trials设置多少合适？', content: '建议 30-100；超过 200 收益递减明显，同时训练时间把控在 10 分钟内。' },
        { title: '调优完成后如何使用最优参数？', content: '点击「应用最优参数＋训练」，系统自动用最优参数训练最终模型。' },
      ]} />

      <Row gutter={16}>
        <Col span={7}>
          <Card style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
            <Form layout="vertical">
              <Form.Item label={<Text style={{ color: '#94a3b8' }}>选择数据集划分</Text>}>
                <Select
                  value={splitId ?? undefined}
                  onChange={(v: number) => setSplitId(v)}
                  placeholder="选择划分"
                  style={{ width: '100%' }}
                  options={splitList.map(s => ({
                    value: s.id,
                    label: `${s.dataset_name}  / Split #${s.id}（训练 ${s.train_rows ?? '?'} 行）`,
                  }))}
                />
              </Form.Item>
              <Form.Item label={<Text style={{ color: '#94a3b8' }}>搜索策略</Text>}>
                <Select value={strategy} onChange={setStrategy} style={{ width: '100%' }}
                  options={[{ value: 'tpe', label: 'TPE (贝叶斯)' }, { value: 'random', label: '随机搜索' }]} />
              </Form.Item>
              <Form.Item label={<Text style={{ color: '#94a3b8' }}>试验次数: {nTrials}</Text>}>
                <Slider min={5} max={200} step={5} value={nTrials} onChange={setNTrials} />
              </Form.Item>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Button type="primary" icon={<RocketOutlined />} onClick={start} disabled={status === 'running'} block loading={status === 'running'}>
                  开始调优
                </Button>
                <Popconfirm
                  title="确认停止调优？"
                  description="停止后已完成的试验数据将保留。"
                  onConfirm={stop}
                  okText="停止"
                  cancelText="继续"
                  okButtonProps={{ danger: true }}
                  disabled={status !== 'running'}
                >
                  <Button danger icon={<StopOutlined />} disabled={status !== 'running'} block>
                    停止调优
                  </Button>
                </Popconfirm>
                <Button onClick={getResult} disabled={!taskId} block>
                  获取最终结果
                </Button>
              </Space>
            </Form>
          </Card>

          {bestScore !== null && (
            <Card title={<Text style={{ color: '#e2e8f0' }}>最优结果</Text>}
              style={{ background: '#1e293b', border: '1px solid #334155' }}>
              {lastResultAt && status === 'completed' && trialHistory.length === 0 && (
                <Alert
                  type="info"
                  message={`上次调优结果（${new Date(lastResultAt).toLocaleString('zh-CN')}）`}
                  style={{ marginBottom: 10, fontSize: 12 }}
                  showIcon
                />
              )}
              <Statistic title="最优得分" value={bestScore.toFixed(4)} valueStyle={{ color: '#34d399', fontSize: 28 }} />
              {resultModelId && <Alert type="success" message={`模型已保存 ID: ${resultModelId}`} style={{ marginTop: 8 }} />}
              {bestParams && (
                <div style={{ marginTop: 12 }}>
                  <Text style={{ color: '#94a3b8', fontSize: 12 }}>最优参数：</Text>
                  <pre style={{ background: '#0f172a', color: '#60a5fa', padding: 8, borderRadius: 4, fontSize: 11, overflow: 'auto' }}>
                    {JSON.stringify(bestParams, null, 2)}
                  </pre>
                </div>
              )}
            </Card>
          )}
        </Col>

        <Col span={17}>
          <Card style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
            <Row gutter={16}>
              <Col span={6}><Statistic title="已完成轮次" value={trialHistory.length} valueStyle={{ color: '#60a5fa' }} /></Col>
              <Col span={6}><Statistic title="总轮次" value={nTrials} valueStyle={{ color: '#94a3b8' }} /></Col>
              <Col span={12}>
                <Progress percent={pct} strokeColor="#3b82f6" trailColor="#334155" />
              </Col>
            </Row>
          </Card>

          {chartOption ? (
            <Card title={<Text style={{ color: '#e2e8f0' }}>调优进度曲线</Text>}
              style={{ background: '#1e293b', border: '1px solid #334155' }}>
              <ReactECharts option={chartOption} style={{ height: 350 }} />
            </Card>
          ) : (
            <Card style={{ background: '#1e293b', border: '1px solid #334155', textAlign: 'center', padding: 60 }}>
              <Text style={{ color: '#475569' }}>配置参数后点击「开始调优」</Text>
            </Card>
          )}
        </Col>
      </Row>
    </div>
  )
}

export default ModelTuningPage
