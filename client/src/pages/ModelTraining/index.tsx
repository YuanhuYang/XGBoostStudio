import React, { useState, useEffect, useRef } from 'react'
import {
  Card, Row, Col, Button, Typography, Space, Tag, Alert, Steps,
  InputNumber, Select, Progress, Statistic, message, Divider, Badge,
  Popconfirm, Empty, Tooltip, Checkbox,
} from 'antd'
import {
  PlayCircleOutlined, StopOutlined,
  ExclamationCircleOutlined, CheckCircleOutlined,
  DatabaseOutlined, BarChartOutlined, ToolOutlined, SettingOutlined,
} from '@ant-design/icons'
import apiClient from '../../api/client'
import { getRequestErrorMessage } from '../../utils/apiError'
import { useAppStore } from '../../store/appStore'
import ReactECharts from 'echarts-for-react'
import { showTeachingUi } from '../../utils/teachingUi'

const { Text } = Typography

interface ProgressEvent {
  round?: number
  total?: number
  train_logloss?: number; train_rmse?: number
  val_logloss?: number; val_rmse?: number
  elapsed_s?: number; eta_s?: number
  completed?: boolean; model_id?: number; metrics?: Record<string, number>
  error?: string; stopped?: boolean
  early_stopping_hint?: boolean
  early_stopped?: boolean; best_round?: number
  cv_phase?: boolean
  cv_done?: boolean
  message?: string
  cv_k?: number
  cv_summary?: Record<string, number>
  cv_fold_metrics?: unknown[]
}

interface SplitItem {
  id: number
  dataset_id: number
  dataset_name: string
  train_rows: number | null
  test_rows: number | null
  created_at: string | null
}

const ModelTrainingPage: React.FC = () => {
  const activeSplitId = useAppStore(s => s.activeSplitId)
  const setActiveSplitId = useAppStore(s => s.setActiveSplitId)
  const setActiveModelId = useAppStore(s => s.setActiveModelId)
  const setIsTraining = useAppStore(s => s.setIsTraining)
  const workflowMode = useAppStore(s => s.workflowMode)
  const showTeaching = showTeachingUi(workflowMode)
  const [splitId, setSplitId] = useState<number | null>(null)
  const [splitList, setSplitList] = useState<SplitItem[]>([])

  useEffect(() => {
    apiClient.get('/api/datasets/splits/list').then(r => setSplitList(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (activeSplitId !== null && splitId === null) setSplitId(activeSplitId)
  }, [activeSplitId]) // eslint-disable-line react-hooks/exhaustive-deps

  const [taskId, setTaskId] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'error' | 'stopped'>('idle')
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [trainHistory, setTrainHistory] = useState<number[]>([])
  const [valHistory, setValHistory] = useState<number[]>([])
  const [rounds, setRounds] = useState<number[]>([])
  const [metrics, setMetrics] = useState<Record<string, number> | null>(null)
  const [modelId, setModelId] = useState<number | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [earlyStoppedRound, setEarlyStoppedRound] = useState<number | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const sseRetryRef = useRef(0)
  const MAX_SSE_RETRIES = 3
  const PORT = 18899
  const [useKfoldCv, setUseKfoldCv] = useState(true)
  const [kfoldK, setKfoldK] = useState(5)

  // SSE 清理（测试专家：防止组件卸载后连接泄漏）
  useEffect(() => {
    return () => {
      esRef.current?.close()
    }
  }, [])

  const startTraining = async () => {
    if (!splitId) { message.warning('请选择数据集划分'); return }
    // 防止重复点击（测试专家）
    if (status === 'running') { message.warning('训练正在进行中'); return }
    setStatus('running')
    setIsTraining(true)
    setTrainHistory([])
    setValHistory([])
    setRounds([])
    setMetrics(null)
    setLog([])
    setEarlyStoppedRound(null)
    try {
      const r = await apiClient.post('/api/training/start', {
        split_id: splitId,
        use_kfold_cv: useKfoldCv,
        kfold_k: kfoldK,
      })
      const tid = r.data.task_id
      setTaskId(tid)
      setLog(prev => [...prev, `✅ 任务创建成功: ${tid}`])
      // 关闭已有连接再创建新连接
      sseRetryRef.current = 0
      esRef.current?.close()

      const connectSSE = (retryDelay = 0) => {
        setTimeout(() => {
          const es = new EventSource(`http://127.0.0.1:${PORT}/api/training/${tid}/progress`)
          esRef.current = es
          es.onmessage = (e) => {
            sseRetryRef.current = 0 // 收到消息则重置重试计数
            try {
              const data: ProgressEvent = JSON.parse(e.data)
              setProgress(data)
              if (data.cv_phase) {
                setLog(prev => [...prev, `📊 ${data.message || 'K 折交叉验证进行中...'}`])
                return
              }
              if (data.cv_done) {
                setLog(prev => [...prev, `✅ K 折完成 (k=${data.cv_k}) summary: ${JSON.stringify(data.cv_summary)}`])
                return
              }
              if (data.round !== undefined) {
                const trainVal = data.train_logloss ?? data.train_rmse ?? 0
                const valVal = data.val_logloss ?? data.val_rmse
                setRounds(prev => [...prev, data.round!])
                setTrainHistory(prev => [...prev, trainVal])
                if (valVal !== undefined) setValHistory(prev => [...prev, valVal])
                setLog(prev => [...prev, `[${data.round}/${data.total}] train: ${trainVal.toFixed(4)} val: ${valVal?.toFixed(4) ?? '-'}`].slice(-100))
                if (data.early_stopping_hint) {
                  setEarlyStoppedRound(data.round!)
                  setLog(prev => [...prev, `🛑 早停触发：第 ${data.round} 轮验证指标未改善，已停止`])
                }
              }
              if (data.completed) {
                setStatus('completed')
                setMetrics(data.metrics || null)
                setModelId(data.model_id || null)
                if (data.model_id) setActiveModelId(data.model_id)
                if (data.early_stopped && data.best_round) setEarlyStoppedRound(data.best_round)
                es.close()
                setIsTraining(false)
                message.success(`训练完成！模型 ID: ${data.model_id}`)
              }
              if (data.stopped) { setStatus('stopped'); setIsTraining(false); es.close() }
              if (data.error) {
                setStatus('error')
                setLog(prev => [...prev, `❌ ${data.error}`])
                setIsTraining(false)
                es.close()
              }
            } catch { /* ignore */ }
          }
          es.onerror = () => {
            es.close()
            if (sseRetryRef.current < MAX_SSE_RETRIES) {
              sseRetryRef.current += 1
              const delay = Math.pow(2, sseRetryRef.current) * 1000 // 2s, 4s, 8s
              setLog(prev => [...prev, `⚠️ SSE 连接中断，${delay / 1000}s 后第 ${sseRetryRef.current} 次重连...`])
              connectSSE(delay)
            } else {
              setStatus('error')
              setLog(prev => [...prev, '❌ SSE 重连失败（已重试 3 次），请检查后端服务'])
            }
          }
        }, retryDelay)
      }
      connectSSE()
    } catch (e: unknown) {
      message.error(getRequestErrorMessage(e, '启动失败，请确认所选划分是否有效'))
      setStatus('error')
    }
  }

  const stopTraining = async () => {
    if (!taskId) return
    try {
      await apiClient.post(`/api/training/${taskId}/stop`)
      esRef.current?.close()
      setStatus('stopped')
      message.info('已发送停止指令')
    } catch (e: unknown) {
      message.error(getRequestErrorMessage(e, '停止失败'))
    }
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  const lossOption = rounds.length > 0 ? {
    tooltip: { trigger: 'axis' },
    legend: { textStyle: { color: '#94a3b8' } },
    xAxis: { type: 'category', data: rounds, axisLabel: { color: '#94a3b8' } },
    yAxis: { type: 'value', axisLabel: { color: '#94a3b8' } },
    // 早停标记线
    ...(earlyStoppedRound ? {
      graphic: [],
    } : {}),
    series: [
      {
        name: '训练集', type: 'line', data: trainHistory, smooth: true, showSymbol: false,
        lineStyle: { color: '#3b82f6' },
      },
      ...(valHistory.length > 0 ? [{
        name: '验证集', type: 'line', data: valHistory, smooth: true, showSymbol: false,
        lineStyle: { color: '#f59e0b' },
        markLine: earlyStoppedRound ? {
          silent: true,
          data: [{ xAxis: earlyStoppedRound, name: '早停' }],
          lineStyle: { color: '#ef4444', type: 'dashed', width: 2 },
          label: { formatter: '🛑 早停: {c}轮', color: '#ef4444' },
        } : undefined,
      }] : []),
    ],
  } : null

  const pct = progress?.round && progress?.total ? Math.round((progress.round / progress.total) * 100) : 0

  // 过拟合等级展示（数据分析专家）
  const overfittingLevel = metrics?.overfitting_level as string | undefined
  const overfittingColor = overfittingLevel === 'high' ? '#ef4444' : overfittingLevel === 'medium' ? '#f59e0b' : '#52c41a'
  const overfittingLabel = overfittingLevel === 'high' ? '过拟合' : overfittingLevel === 'medium' ? '轻微过拟合' : '泛化良好'

  const activeDatasetId = useAppStore(s => s.activeDatasetId)
  const activeModelId = useAppStore(s => s.activeModelId)
  // activeSplitId already declared at top

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

      <Row gutter={16}>
        <Col span={8}>
          <Card style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text style={{ color: '#94a3b8' }}>数据集划分（先在特征工程页完成划分）：</Text>
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
              <Checkbox checked={useKfoldCv} onChange={e => setUseKfoldCv(e.target.checked)}>
                <Text style={{ color: '#94a3b8' }}>训练前对训练集做 K 折交叉验证（AC-6-03，写入模型）</Text>
              </Checkbox>
              {useKfoldCv && (
                <Space>
                  <Text style={{ color: '#94a3b8' }}>折数 K：</Text>
                  <InputNumber min={2} max={10} value={kfoldK} onChange={v => setKfoldK(v ?? 5)} />
                </Space>
              )}
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={startTraining}
                disabled={status === 'running'} block loading={status === 'running'}>
                开始训练
              </Button>
              {/* 产品设计专家：停止前二次确认，防止误操作 */}
              <Popconfirm
                title="确认停止训练？"
                description="停止后当前轮次数据将保留，但训练无法继续。"
                onConfirm={stopTraining}
                okText="停止"
                cancelText="继续训练"
                okButtonProps={{ danger: true }}
                disabled={status !== 'running'}
              >
                <Button danger icon={<StopOutlined />} disabled={status !== 'running'} block>
                  停止训练
                </Button>
              </Popconfirm>
            </Space>
          </Card>

          {/* 产品设计专家：空状态引导 */}
          {status === 'idle' && rounds.length === 0 && (
            <Card style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span style={{ color: '#64748b' }}>
                    尚未开始训练 — 选择划分并点击「开始训练」
                  </span>
                }
              />
            </Card>
          )}

          {/* 过拟合状态（数据分析专家）*/}
          {metrics && overfittingLevel && (
            <Tooltip title={`训练集与验证集指标差距: ${(metrics.overfitting_gap as number)?.toFixed(4)}`}>
              <Card style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
                <Space>
                  {overfittingLevel === 'high'
                    ? <ExclamationCircleOutlined style={{ color: overfittingColor, fontSize: 20 }} />
                    : <CheckCircleOutlined style={{ color: overfittingColor, fontSize: 20 }} />}
                  <Text style={{ color: overfittingColor, fontWeight: 600 }}>泛化评估：{overfittingLabel}</Text>
                  {earlyStoppedRound && (
                    <Tag color="volcano">🛑 早停于第 {earlyStoppedRound} 轮</Tag>
                  )}
                </Space>
              </Card>
            </Tooltip>
          )}

          {metrics && (
            <Card title={<Text style={{ color: '#e2e8f0' }}>评估指标</Text>}
              style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: showTeaching && status === 'completed' ? 16 : 0 }}>
              {Object.entries(metrics)
                .filter(([k]) => !['overfitting_level', 'overfitting_gap', 'train_accuracy', 'train_rmse'].includes(k))
                .map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={{ color: '#94a3b8' }}>{k}</Text>
                    <Text style={{ color: '#60a5fa', fontWeight: 600 }}>{typeof v === 'number' ? v.toFixed(4) : String(v)}</Text>
                  </div>
                ))}
              {modelId && <Alert type="success" message={`模型已保存 ID: ${modelId}`} style={{ marginTop: 8 }} />}
            </Card>
          )}

          {/* E5: 向导/调优：训练完成后的收敛解读卡 */}
          {showTeaching && status === 'completed' && metrics && (() => {
            const trainLoss = trainHistory.length > 0 ? trainHistory[trainHistory.length - 1] : null
            const valLoss = valHistory.length > 0 ? valHistory[valHistory.length - 1] : null
            const gap = (trainLoss !== null && valLoss !== null) ? Math.abs(valLoss - trainLoss) : null
            const overfitLevel = metrics.overfitting_level as string | undefined
            let convergenceExplanation = '模型训练曲线分析：'
            if (gap !== null) {
              if (gap < 0.02) {
                convergenceExplanation += `训练集与验证集损失差距极小（${gap.toFixed(4)}），模型泛化能力优秀。曲线同步下降表明参数配置恰当，没有明显过拟合。`
              } else if (gap < 0.1) {
                convergenceExplanation += `训练集与验证集损失有轻微差距（${gap.toFixed(4)}）。这是正常现象，模型在训练数据上表现更好，但验证集性能仍可接受。`
              } else {
                convergenceExplanation += `训练集与验证集损失差距较大（${gap.toFixed(4)}），存在过拟合迹象。建议降低 max_depth、增大 reg_lambda 或减少 n_estimators。`
              }
            }
            const totalRounds = rounds.length
            const convergenceRound = earlyStoppedRound ?? totalRounds
            if (earlyStoppedRound) {
              convergenceExplanation += ` 早停在第 ${earlyStoppedRound} 轮触发，避免了进一步的过拟合。`
            }
            return (
              <Card
                title={
                  <Space>
                    <span>📖</span>
                    <Text style={{ color: '#a78bfa' }}>学习解读：为什么曲线这样变化？</Text>
                  </Space>
                }
                style={{
                  background: 'linear-gradient(135deg, #1a1f35 0%, #1e2a45 100%)',
                  border: '1px solid #3b4f7a',
                  marginTop: 0,
                }}
              >
                <Space direction="vertical" style={{ width: '100%' }} size={8}>
                  <Text style={{ color: '#cbd5e1', fontSize: 13 }}>{convergenceExplanation}</Text>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 4 }}>
                    <div style={{ background: '#0f172a', borderRadius: 6, padding: '6px 12px' }}>
                      <Text style={{ color: '#64748b', fontSize: 11 }}>收敛轮次</Text>
                      <Text style={{ color: '#93c5fd', fontWeight: 600, display: 'block' }}>{convergenceRound} / {totalRounds}</Text>
                    </div>
                    {gap !== null && (
                      <div style={{ background: '#0f172a', borderRadius: 6, padding: '6px 12px' }}>
                        <Text style={{ color: '#64748b', fontSize: 11 }}>Train/Val 差距</Text>
                        <Text style={{ color: gap < 0.05 ? '#34d399' : gap < 0.1 ? '#f59e0b' : '#f87171', fontWeight: 600, display: 'block' }}>{gap.toFixed(4)}</Text>
                      </div>
                    )}
                    {overfitLevel && (
                      <div style={{ background: '#0f172a', borderRadius: 6, padding: '6px 12px' }}>
                        <Text style={{ color: '#64748b', fontSize: 11 }}>过拟合评估</Text>
                        <Text style={{ color: overfitLevel === 'high' ? '#f87171' : overfitLevel === 'medium' ? '#f59e0b' : '#34d399', fontWeight: 600, display: 'block' }}>
                          {overfitLevel === 'high' ? '高风险' : overfitLevel === 'medium' ? '中等' : '良好'}
                        </Text>
                      </div>
                    )}
                  </div>
                  {overfitLevel === 'high' && (
                    <Alert
                      type="warning"
                      message="学习建议：如何改善过拟合？"
                      description="尝试：① 降低 max_depth（减少树的复杂度）② 增大 reg_lambda/reg_alpha（正则化） ③ 提高 subsample（随机采样）④ 降低 learning_rate 并增加 n_estimators。"
                      style={{ marginTop: 4 }}
                      showIcon
                    />
                  )}
                </Space>
              </Card>
            )
          })()}
        </Col>

        <Col span={16}>
          <Card style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={6}>
                <Statistic title="当前轮次" value={progress?.round || 0} valueStyle={{ color: '#60a5fa' }} />
              </Col>
              <Col span={6}>
                <Statistic title="总轮次" value={progress?.total || '-'} valueStyle={{ color: '#94a3b8' }} />
              </Col>
              <Col span={6}>
                <Statistic title="训练指标" value={(progress?.train_logloss ?? progress?.train_rmse)?.toFixed(4) || '-'} valueStyle={{ color: '#34d399' }} />
              </Col>
              <Col span={6}>
                <Statistic title="验证指标" value={(progress?.val_logloss ?? progress?.val_rmse)?.toFixed(4) || '-'} valueStyle={{ color: '#f59e0b' }} />
              </Col>
            </Row>
            <Progress percent={pct} strokeColor="#3b82f6" trailColor="#334155" />
          </Card>

          {lossOption && (
            <Card title={<Text style={{ color: '#e2e8f0' }}>训练曲线</Text>}
              style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
              <ReactECharts option={lossOption} style={{ height: 280 }} />
            </Card>
          )}

          <Card title={<Text style={{ color: '#e2e8f0' }}>训练日志</Text>}
            style={{ background: '#1e293b', border: '1px solid #334155' }}>
            <div ref={logRef} style={{ height: 160, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12, color: '#94a3b8', background: '#0f172a', padding: 8, borderRadius: 4 }}>
              {log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  )
}

export default ModelTrainingPage
