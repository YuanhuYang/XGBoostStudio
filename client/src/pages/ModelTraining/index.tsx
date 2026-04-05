import React, { useState, useEffect, useRef } from 'react'
import {
  Card, Row, Col, Button, Typography, Space, Tag, Alert,
  InputNumber, Progress, Statistic, message, Divider, Badge,
  Popconfirm, Empty, Tooltip, Checkbox,
} from 'antd'
import {
  PlayCircleOutlined, StopOutlined, ThunderboltOutlined,
  ExclamationCircleOutlined, CheckCircleOutlined,
} from '@ant-design/icons'
import apiClient from '../../api/client'
import { getRequestErrorMessage } from '../../utils/apiError'
import { useAppStore } from '../../store/appStore'
import HelpButton from '../../components/HelpButton'
import ReactECharts from 'echarts-for-react'

const { Title, Text } = Typography

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

const ModelTrainingPage: React.FC = () => {
  const activeSplitId = useAppStore(s => s.activeSplitId)
  const setActiveModelId = useAppStore(s => s.setActiveModelId)
  const [splitId, setSplitId] = useState<number | null>(null)

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
    if (!splitId) { message.warning('请输入 Split ID'); return }
    // 防止重复点击（测试专家）
    if (status === 'running') { message.warning('训练正在进行中'); return }
    setStatus('running')
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
                message.success(`训练完成！模型 ID: ${data.model_id}`)
              }
              if (data.stopped) { setStatus('stopped'); es.close() }
              if (data.error) {
                setStatus('error')
                setLog(prev => [...prev, `❌ ${data.error}`])
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
      message.error(getRequestErrorMessage(e, '启动失败，请确认 Split ID 是否正确'))
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

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ color: '#60a5fa', marginBottom: 24 }}>
        <ThunderboltOutlined /> 模型训练
      </Title>
      <HelpButton pageTitle="模型训练" items={[
        { title: '训练前需要什么？', content: '必须先完成「特征工程」页面的数据划分，获取 Split ID 后填入左侧输入框。' },
        { title: '训练很慢怎么办？', content: '尝试将 n_estimators 降低至 100，或在参数配置页选右测快速预设。' },
        { title: '训练完成后如何查睟效果？', content: '点击左产「查看详细」跳转到「模型评估」页面，可查看 ROC 曲线、混淆矩阵、SHAP 等。' },
      ]} />

      <Row gutter={16}>
        <Col span={8}>
          <Card style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text style={{ color: '#94a3b8' }}>Split ID（先在特征工程页完成划分）：</Text>
              <InputNumber min={1} value={splitId || undefined} onChange={v => setSplitId(v)} style={{ width: '100%' }} placeholder="Split ID" />
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
                    尚未开始训练 — 输入 Split ID 并点击「开始训练」
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
              style={{ background: '#1e293b', border: '1px solid #334155' }}>
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
