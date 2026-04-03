import React, { useState } from 'react'
import {
  Card, Row, Col, Button, Typography, Space, InputNumber,
  Tabs, Table, Tag, Alert, message, Statistic, Divider
} from 'antd'
import { ExperimentOutlined, BarChartOutlined } from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import apiClient from '../../api/client'

const { Title, Text } = Typography

const ModelEvalPage: React.FC = () => {
  const [modelId, setModelId] = useState<number | null>(null)
  const [evalData, setEvalData] = useState<Record<string, unknown> | null>(null)
  const [shapData, setShapData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchEval = async () => {
    if (!modelId) { message.warning('请输入模型 ID'); return }
    setLoading(true)
    try {
      const r = await apiClient.get(`/api/models/${modelId}/evaluation`)
      setEvalData(r.data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '获取评估失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchShap = async () => {
    if (!modelId) { message.warning('请输入模型 ID'); return }
    setLoading(true)
    try {
      const r = await apiClient.get(`/api/models/${modelId}/shap`)
      setShapData(r.data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '获取SHAP失败')
    } finally {
      setLoading(false)
    }
  }

  // 混淆矩阵
  const confMatrix = evalData?.confusion_matrix as number[][] | undefined
  const confOption = confMatrix ? {
    tooltip: { formatter: (p: { value: number[] }) => `预测: ${p.value[0]}, 实际: ${p.value[1]}, 数量: ${p.value[2]}` },
    visualMap: { min: 0, max: Math.max(...confMatrix.flat()), calculable: true, inRange: { color: ['#1e293b', '#3b82f6'] } },
    xAxis: { type: 'category', name: '预测', data: confMatrix[0].map((_, i) => `Class ${i}`) },
    yAxis: { type: 'category', name: '实际', data: confMatrix.map((_, i) => `Class ${i}`).reverse() },
    series: [{
      type: 'heatmap',
      data: confMatrix.flatMap((row, i) => row.map((v, j) => [j, confMatrix.length - 1 - i, v])),
      label: { show: true, color: '#fff', fontWeight: 700 }
    }]
  } : null

  // ROC 曲线
  const roc = evalData?.roc as { fpr: number[]; tpr: number[]; auc: number } | undefined
  const rocOption = roc ? {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'value', name: 'FPR', min: 0, max: 1 },
    yAxis: { type: 'value', name: 'TPR', min: 0, max: 1 },
    series: [
      { type: 'line', data: roc.fpr.map((v, i) => [v, roc.tpr[i]]), showSymbol: false, lineStyle: { color: '#3b82f6' }, name: `ROC (AUC=${roc.auc.toFixed(3)})` },
      { type: 'line', data: [[0, 0], [1, 1]], showSymbol: false, lineStyle: { color: '#475569', type: 'dashed' }, name: '随机' }
    ],
    legend: { textStyle: { color: '#94a3b8' } }
  } : null

  // 残差图
  const residuals = evalData?.residuals as { predicted: number[]; residual: number[] } | undefined
  const residualOption = residuals ? {
    tooltip: { trigger: 'item' },
    xAxis: { type: 'value', name: '预测值', axisLabel: { color: '#94a3b8' } },
    yAxis: { type: 'value', name: '残差', axisLabel: { color: '#94a3b8' } },
    series: [{
      type: 'scatter',
      data: residuals.predicted.map((p, i) => [p, residuals.residual[i]]),
      symbolSize: 4, itemStyle: { color: '#3b82f6', opacity: 0.6 }
    }]
  } : null

  // SHAP 条形图
  const shapSummary = evalData?.shap_summary as { feature: string; mean_abs_shap: number }[] | undefined
  const shapOption = shapSummary ? {
    tooltip: {},
    grid: { left: 150 },
    xAxis: { type: 'value', axisLabel: { color: '#94a3b8' } },
    yAxis: { type: 'category', data: shapSummary.slice(0, 20).map(d => d.feature), axisLabel: { color: '#94a3b8', fontSize: 11 } },
    series: [{ type: 'bar', data: shapSummary.slice(0, 20).map(d => d.mean_abs_shap), itemStyle: { color: '#a78bfa' } }]
  } : null

  const metrics = evalData?.metrics as Record<string, number> | undefined

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ color: '#60a5fa', marginBottom: 24 }}>
        <ExperimentOutlined /> 模型评估
      </Title>

      <Card style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
        <Space>
          <Text style={{ color: '#94a3b8' }}>模型 ID：</Text>
          <InputNumber min={1} value={modelId || undefined} onChange={v => setModelId(v)} placeholder="输入模型ID" />
          <Button type="primary" onClick={fetchEval} loading={loading}>加载评估</Button>
          <Button onClick={fetchShap} loading={loading}>加载SHAP详情</Button>
        </Space>
      </Card>

      {metrics && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          {Object.entries(metrics).map(([k, v]) => (
            <Col span={4} key={k}>
              <Card style={{ background: '#1e293b', border: '1px solid #334155', textAlign: 'center' }}>
                <Text style={{ color: '#94a3b8', fontSize: 12, display: 'block' }}>{k}</Text>
                <Text style={{ color: '#60a5fa', fontSize: 22, fontWeight: 700 }}>
                  {typeof v === 'number' ? v.toFixed(4) : String(v)}
                </Text>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {evalData && (
        <Tabs items={[
          {
            key: 'cm', label: '混淆矩阵',
            children: confOption
              ? <Card style={{ background: '#1e293b', border: '1px solid #334155' }}><ReactECharts option={confOption} style={{ height: 400 }} /></Card>
              : <Alert type="info" message="该模型为回归任务，无混淆矩阵" />
          },
          {
            key: 'roc', label: 'ROC 曲线',
            children: rocOption
              ? <Card style={{ background: '#1e293b', border: '1px solid #334155' }}><ReactECharts option={rocOption} style={{ height: 400 }} /></Card>
              : <Alert type="info" message="仅支持二分类 ROC 曲线" />
          },
          {
            key: 'res', label: '残差图',
            children: residualOption
              ? <Card style={{ background: '#1e293b', border: '1px solid #334155' }}><ReactECharts option={residualOption} style={{ height: 400 }} /></Card>
              : <Alert type="info" message="仅回归任务有残差图" />
          },
          {
            key: 'shap', label: 'SHAP 重要性',
            children: shapOption
              ? <Card style={{ background: '#1e293b', border: '1px solid #334155' }}><ReactECharts option={shapOption} style={{ height: 500 }} /></Card>
              : <Alert type="info" message="点击「加载评估」获取SHAP数据" />
          }
        ]} />
      )}
    </div>
  )
}

export default ModelEvalPage
