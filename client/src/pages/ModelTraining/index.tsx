import React, { useState, useEffect, useRef } from 'react'
import {
  Card, Row, Col, Button, Typography, Space, Tag, Alert,
  InputNumber, Progress, Statistic, message, Divider, Badge
} from 'antd'
import { PlayCircleOutlined, StopOutlined, ThunderboltOutlined } from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import apiClient from '../../api/client'

const { Title, Text } = Typography

interface ProgressEvent {
  round?: number; total_rounds?: number
  train_metric?: number; val_metric?: number; metric_name?: string
  elapsed_s?: number; eta_s?: number
  completed?: boolean; model_id?: number; metrics?: Record<string, number>
  error?: string; stopped?: boolean
}

const ModelTrainingPage: React.FC = () => {
  const [splitId, setSplitId] = useState<number | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'error' | 'stopped'>('idle')
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [trainHistory, setTrainHistory] = useState<number[]>([])
  const [valHistory, setValHistory] = useState<number[]>([])
  const [rounds, setRounds] = useState<number[]>([])
  const [metrics, setMetrics] = useState<Record<string, number> | null>(null)
  const [modelId, setModelId] = useState<number | null>(null)
  const [log, setLog] = useState<string[]>([])
  const esRef = useRef<EventSource | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const PORT = 18899

  const startTraining = async () => {
    if (!splitId) { message.warning('请输入 Split ID'); return }
    setStatus('running')
    setTrainHistory([])
    setValHistory([])
    setRounds([])
    setMetrics(null)
    setLog([])
    try {
      const r = await apiClient.post('/api/training/start', { split_id: splitId })
      const tid = r.data.task_id
      setTaskId(tid)
      setLog(prev => [...prev, `✅ 任务创建成功: ${tid}`])
      // 使用 EventSource 连接 SSE
      const es = new EventSource(`http://127.0.0.1:${PORT}/api/training/${tid}/progress`)
      esRef.current = es
      es.onmessage = (e) => {
        try {
          const data: ProgressEvent = JSON.parse(e.data)
          setProgress(data)
          if (data.round !== undefined) {
            setRounds(prev => [...prev, data.round!])
            setTrainHistory(prev => [...prev, data.train_metric!])
            if (data.val_metric !== undefined) setValHistory(prev => [...prev, data.val_metric!])
            setLog(prev => [...prev, `[${data.round}/${data.total_rounds}] train: ${data.train_metric?.toFixed(4)} val: ${data.val_metric?.toFixed(4)}`].slice(-100))
          }
          if (data.completed) {
            setStatus('completed')
            setMetrics(data.metrics || null)
            setModelId(data.model_id || null)
            es.close()
            message.success(`训练完成！模型 ID: ${data.model_id}`)
          }
          if (data.stopped) { setStatus('stopped'); es.close() }
          if (data.error) { setStatus('error'); setLog(prev => [...prev, `❌ ${data.error}`]); es.close() }
        } catch { /* ignore */ }
      }
      es.onerror = () => { setStatus('error'); es.close() }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '启动失败')
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
    } catch { message.error('停止失败') }
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  const lossOption = rounds.length > 0 ? {
    tooltip: { trigger: 'axis' },
    legend: { textStyle: { color: '#94a3b8' } },
    xAxis: { type: 'category', data: rounds, axisLabel: { color: '#94a3b8' } },
    yAxis: { type: 'value', axisLabel: { color: '#94a3b8' } },
    series: [
      { name: '训练集', type: 'line', data: trainHistory, smooth: true, showSymbol: false, lineStyle: { color: '#3b82f6' } },
      ...(valHistory.length > 0 ? [{ name: '验证集', type: 'line', data: valHistory, smooth: true, showSymbol: false, lineStyle: { color: '#f59e0b' } }] : [])
    ]
  } : null

  const pct = progress?.round && progress?.total_rounds ? Math.round((progress.round / progress.total_rounds) * 100) : 0

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ color: '#60a5fa', marginBottom: 24 }}>
        <ThunderboltOutlined /> 模型训练
      </Title>

      <Row gutter={16}>
        <Col span={8}>
          <Card style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text style={{ color: '#94a3b8' }}>Split ID（先在特征工程页完成划分）：</Text>
              <InputNumber min={1} value={splitId || undefined} onChange={v => setSplitId(v)} style={{ width: '100%' }} placeholder="Split ID" />
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={startTraining}
                disabled={status === 'running'} block loading={status === 'running'}>
                开始训练
              </Button>
              <Button danger icon={<StopOutlined />} onClick={stopTraining}
                disabled={status !== 'running'} block>
                停止训练
              </Button>
            </Space>
          </Card>

          {metrics && (
            <Card title={<Text style={{ color: '#e2e8f0' }}>评估指标</Text>}
              style={{ background: '#1e293b', border: '1px solid #334155' }}>
              {Object.entries(metrics).map(([k, v]) => (
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
                <Statistic title="总轮次" value={progress?.total_rounds || '-'} valueStyle={{ color: '#94a3b8' }} />
              </Col>
              <Col span={6}>
                <Statistic title="训练指标" value={progress?.train_metric?.toFixed(4) || '-'} valueStyle={{ color: '#34d399' }} />
              </Col>
              <Col span={6}>
                <Statistic title="验证指标" value={progress?.val_metric?.toFixed(4) || '-'} valueStyle={{ color: '#f59e0b' }} />
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
