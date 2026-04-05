import React, { useState, useEffect } from 'react'
import {
  Card, Row, Col, Button, Typography, Space, Select, Steps,
  Tabs, Table, Tag, Alert, message, Statistic, Divider, Slider, Progress,
} from 'antd'
import { ExperimentOutlined, BarChartOutlined, SafetyOutlined, DatabaseOutlined, ToolOutlined, SettingOutlined, PlayCircleOutlined } from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import apiClient from '../../api/client'
import { getLearningCurve } from '../../api/models'
import { useAppStore } from '../../store/appStore'
import HelpButton, { HelpItem } from '../../components/HelpButton'
const { Title, Text } = Typography

const ModelEvalPage: React.FC = () => {
  const activeModelId = useAppStore(s => s.activeModelId)
  const [modelId, setModelId] = useState<number | null>(null)
  const [modelOptions, setModelOptions] = useState<{ value: number; label: string }[]>([])

  useEffect(() => {
    if (activeModelId !== null && modelId === null) setModelId(activeModelId)
  }, [activeModelId]) // eslint-disable-line react-hooks/exhaustive-deps

  // modelId 变化时自动加载评估（从向导/训练页跳转后无需手动点「加载评估」）
  useEffect(() => {
    if (modelId !== null) {
      setEvalData(null)
      setShapData(null)
      setLcData(null)
      // 延迟一帧，避免与模型列表请求并发竞争（fetchEval 依赖 modelId 已被 setState 更新）
      setTimeout(() => fetchEval(), 0)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId])

  // 加载模型列表
  useEffect(() => {
    apiClient.get('/api/models').then(r => {
      const list = (r.data || []) as { id: number; name: string; task_type: string; metrics: Record<string, number> }[]
      setModelOptions(list.map(m => {
        const mainMetric = Object.entries(m.metrics || {}).find(([k]) => !['overfitting_level','overfitting_gap','train_accuracy','train_rmse','early_stopped','best_round'].includes(k))
        const metricStr = mainMetric ? ` | ${mainMetric[0]}=${mainMetric[1]?.toFixed(4)}` : ''
        return { value: m.id, label: `#${m.id} ${m.name}${metricStr}` }
      }))
    }).catch(() => {})
  }, [])
  const [evalData, setEvalData] = useState<Record<string, unknown> | null>(null)
  const [shapData, setShapData] = useState<Record<string, unknown> | null>(null)
  const [lcData, setLcData] = useState<Record<string, unknown> | null>(null)
  const [modelMeta, setModelMeta] = useState<{
    split_id?: number
    params?: Record<string, unknown>
  } | null>(null)
  const [kfoldData, setKfoldData] = useState<Record<string, unknown> | null>(null)
  const [kfoldLoading, setKfoldLoading] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!modelId) {
      setModelMeta(null)
      return
    }
    apiClient.get(`/api/models/${modelId}`).then(r => {
      setModelMeta(r.data as { split_id?: number; params?: Record<string, unknown> })
    }).catch(() => setModelMeta(null))
  }, [modelId])

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

  const runKfold = async () => {
    if (!modelMeta?.split_id) {
      message.warning('当前模型无划分信息，无法做 K 折（需训练时关联 split）')
      return
    }
    setKfoldLoading(true)
    try {
      const r = await apiClient.post('/api/training/kfold', {
        split_id: modelMeta.split_id,
        k: 5,
        params: modelMeta.params || {},
      })
      setKfoldData(r.data as Record<string, unknown>)
      message.success('K 折交叉验证完成（训练集）')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || 'K 折失败')
    } finally {
      setKfoldLoading(false)
    }
  }

  const fetchLearningCurve = async () => {
    if (!modelId) { message.warning('请输入模型 ID'); return }
    setLoading(true)
    try {
      const data = await getLearningCurve(modelId)
      setLcData(data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '获取学习曲线失败')
    } finally {
      setLoading(false)
    }
  }

  // 混淆矩阵
  const confData = evalData?.confusion_matrix as { labels: string[]; matrix: number[][] } | undefined
  const confMatrix = confData?.matrix
  const confLabels = confData?.labels
  const confOption = confMatrix ? {
    tooltip: { formatter: (p: { value: number[] }) => `预测: ${p.value[0]}, 实际: ${p.value[1]}, 数量: ${p.value[2]}` },
    visualMap: { min: 0, max: Math.max(...confMatrix.flat()), calculable: true, inRange: { color: ['#1e293b', '#3b82f6'] } },
    xAxis: { type: 'category', name: '预测', data: confLabels || confMatrix[0].map((_, i) => `Class ${i}`) },
    yAxis: { type: 'category', name: '实际', data: (confLabels || confMatrix.map((_, i) => `Class ${i}`)).slice().reverse() },
    series: [{
      type: 'heatmap',
      data: confMatrix.flatMap((row, i) => row.map((v, j) => [j, confMatrix.length - 1 - i, v])),
      label: { show: true, color: '#fff', fontWeight: 700 }
    }]
  } : null

  // ROC 曲线
  const roc = evalData?.roc_curve as { fpr: number[]; tpr: number[]; auc: number } | undefined
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
  const residuals = evalData?.residuals as { predicted: number[]; values: number[] } | undefined
  const residualOption = residuals ? {
    tooltip: { trigger: 'item' },
    xAxis: { type: 'value', name: '预测值', axisLabel: { color: '#94a3b8' } },
    yAxis: { type: 'value', name: '残差', axisLabel: { color: '#94a3b8' } },
    series: [{
      type: 'scatter',
      data: residuals.predicted.map((p, i) => [p, residuals.values[i]]),
      symbolSize: 4, itemStyle: { color: '#3b82f6', opacity: 0.6 }
    }]
  } : null

  // PR 曲线
  const prData = evalData?.pr_curve as { precision: number[]; recall: number[]; ap: number } | undefined
  const prOption = prData ? {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'value', name: 'Recall', min: 0, max: 1, axisLabel: { color: '#94a3b8' } },
    yAxis: { type: 'value', name: 'Precision', min: 0, max: 1, axisLabel: { color: '#94a3b8' } },
    series: [{
      type: 'line', showSymbol: false, lineStyle: { color: '#f59e0b' },
      data: prData.recall.map((r, i) => [r, prData.precision[i]]),
      name: `PR (AP=${prData.ap.toFixed(3)})`,
    }],
    legend: { textStyle: { color: '#94a3b8' } },
  } : null

  // 校准曲线
  const calData = evalData?.calibration as { mean_predicted: number[]; fraction_positive: number[]; brier_score: number } | undefined
  const calOption = calData ? {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'value', name: '预测概率均值', min: 0, max: 1, axisLabel: { color: '#94a3b8' } },
    yAxis: { type: 'value', name: '实际正样本率', min: 0, max: 1, axisLabel: { color: '#94a3b8' } },
    series: [
      {
        type: 'line', name: '模型校准', lineStyle: { color: '#34d399' }, symbol: 'circle', symbolSize: 6,
        data: calData.mean_predicted.map((x, i) => [x, calData.fraction_positive[i]]),
      },
      {
        type: 'line', name: '完美校准', lineStyle: { color: '#475569', type: 'dashed' }, showSymbol: false,
        data: [[0, 0], [1, 1]],
      },
    ],
    legend: { textStyle: { color: '#94a3b8' } },
  } : null

  // 阈值分析
  const thrData = evalData?.threshold_metrics as { threshold: number; precision: number; recall: number; f1: number }[] | undefined

  // 基线对比
  const baseline = evalData?.baseline as Record<string, unknown> | undefined

  // SHAP 条形图 — 优先用 /evaluation 中的 shap_summary，否则从 shapData 计算均值(|SHAP|)
  const shapSummary = evalData?.shap_summary as { feature: string; importance: number }[] | undefined
  const shapDataTyped = shapData as { features: string[]; shap_values: number[][] } | null
  const shapFromDetail: { feature: string; importance: number }[] | undefined = shapDataTyped
    ? shapDataTyped.features
        .map((feat, i) => ({
          feature: feat,
          importance:
            shapDataTyped.shap_values.reduce((sum, row) => sum + Math.abs(row[i]), 0) /
            shapDataTyped.shap_values.length,
        }))
        .sort((a, b) => b.importance - a.importance)
    : undefined
  const activeShapSummary = shapSummary ?? shapFromDetail
  const shapOption = activeShapSummary ? {
    tooltip: {},
    grid: { left: 150 },
    xAxis: { type: 'value', axisLabel: { color: '#94a3b8' } },
    yAxis: { type: 'category', data: activeShapSummary.slice(0, 20).map(d => d.feature), axisLabel: { color: '#94a3b8', fontSize: 11 } },
    series: [{ type: 'bar', data: activeShapSummary.slice(0, 20).map(d => d.importance), itemStyle: { color: '#a78bfa' } }]
  } : null

  const metrics = evalData?.metrics as Record<string, number> | undefined

  const cvKfoldEval = evalData?.cv_kfold as {
    k?: number
    fold_metrics?: Record<string, unknown>[]
    summary?: Record<string, unknown>
  } | undefined

  const boxFiveStats = (vals: number[]): [number, number, number, number, number] => {
    const s = [...vals].filter(v => !Number.isNaN(v)).sort((a, b) => a - b)
    const n = s.length
    if (n === 0) return [0, 0, 0, 0, 0]
    if (n === 1) return [s[0], s[0], s[0], s[0], s[0]]
    if (n === 2) return [s[0], s[0], (s[0] + s[1]) / 2, s[1], s[1]]
    const q = (p: number) => s[Math.min(n - 1, Math.round(p * (n - 1)))]
    return [s[0], q(0.25), q(0.5), q(0.75), s[n - 1]]
  }

  const cvBoxplotOption = (() => {
    const rows = cvKfoldEval?.fold_metrics
    if (!rows?.length) return null
    const first = rows[0]
    const keys = Object.keys(first).filter(k => k !== 'fold' && k !== 'outlier_highlight')
    if (!keys.length) return null
    return {
      tooltip: { trigger: 'item' },
      grid: { left: 48, right: 16, bottom: 40 },
      xAxis: { type: 'category', data: keys, axisLabel: { color: '#94a3b8' } },
      yAxis: { type: 'value', axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: '#334155' } } },
      series: [{
        type: 'boxplot' as const,
        name: 'K 折分布',
        data: keys.map(k => boxFiveStats(rows.map(r => Number(r[k])))),
        itemStyle: { color: '#3b82f6', borderColor: '#60a5fa' },
      }],
    }
  })()

  // 指标评级
  const getMetricRating = (key: string, val: number): { color: string; label: string } => {
    if (key === 'auc') {
      if (val >= 0.9) return { color: '#52c41a', label: '优秀' }
      if (val >= 0.8) return { color: '#1677ff', label: '良好' }
      if (val >= 0.7) return { color: '#faad14', label: '尚可' }
      return { color: '#ff4d4f', label: '待提升' }
    }
    if (key === 'accuracy' || key === 'f1') {
      if (val >= 0.9) return { color: '#52c41a', label: '优秀' }
      if (val >= 0.75) return { color: '#1677ff', label: '良好' }
      return { color: '#faad14', label: '尚可' }
    }
    if (key === 'r2') {
      if (val >= 0.9) return { color: '#52c41a', label: '优秀' }
      if (val >= 0.7) return { color: '#1677ff', label: '良好' }
      if (val >= 0.5) return { color: '#faad14', label: '尚可' }
      return { color: '#ff4d4f', label: '待提升' }
    }
    return { color: '#94a3b8', label: '' }
  }

  const activeDatasetId = useAppStore(s => s.activeDatasetId)
  const activeSplitId = useAppStore(s => s.activeSplitId)
  // activeModelId already declared at top

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
    if (!activeModelId) return 4
    return 4 // 模型评估在训练之后
  })()

  const helpItems: HelpItem[] = [
    {
      title: '如何理解模型准确性？',
      content: '模型准确性通过多个指标综合衡量：分类任务看 Accuracy 和 AUC，回归任务看 RMSE 和 R²。每个指标都有评级标准（优秀/良好/尚可/待提升），帮助你快速判断模型水平。置信区间表示估计的不确定性，区间越窄结果越可靠。',
    },
    {
      title: '结果准确性如何证明？',
      content: 'XGBoost Studio 使用独立测试集评估（从未见过的数据），这种方法能 unbiased 估计泛化能力。如果启用 K-Fold 交叉验证，会给出多次评估的均值和标准差，结果更稳定。Bootstrap 方法为每个指标计算 95% 置信区间。',
    },
    {
      title: '过拟合诊断怎么看？',
      content: '过拟合就是训练集表现好，但测试集表现差。系统通过训练集和验证集的性能差距自动诊断：差距越大过拟合越严重。解决方法：增加正则化（调大 reg_lambda）、减小 max_depth、增加训练数据、早停。',
    },
    {
      title: 'SHAP 特征重要性说明',
      content: 'SHAP 是一种先进的可解释性方法，它量化每个特征对预测结果的平均贡献。绝对值越大，特征对模型预测的影响越大。XGBoost 内置重要性和 SHAP 结论互补，可以交叉验证。',
    },
    {
      title: '更多文档在哪里？',
      content: '完整的报告解读指南请看项目文档 docs/guides/report-interpretation.md，包含各个指标详细定义和评级标准。',
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ color: '#60a5fa', margin: 0 }}>
          <ExperimentOutlined /> 模型评估
        </Title>
        <HelpButton pageTitle="模型评估" items={helpItems} inHeader={true} />
      </div>

      {/* 专家流程进度概览 */}
      <Card style={{ marginBottom: 24, background: '#1e293b', border: '1px solid #334155' }}>
        <Steps current={currentStep} size="small" items={expertSteps} />
      </Card>

      <Card style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
        <Space>
          <Text style={{ color: '#94a3b8' }}>选择模型：</Text>
          <Select
            showSearch
            allowClear
            placeholder="选择模型"
            value={modelId ?? undefined}
            onChange={v => setModelId(v ?? null)}
            options={modelOptions}
            style={{ width: 340 }}
            filterOption={(input, opt) => (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
          />
          <Button type="primary" onClick={fetchEval} loading={loading}>加载评估</Button>
          <Button onClick={fetchShap} loading={loading}>加载SHAP详情</Button>
          <Button onClick={fetchLearningCurve} loading={loading}>加载学习曲线</Button>
          <Button onClick={runKfold} loading={kfoldLoading} disabled={!modelMeta?.split_id}>
            K 折交叉验证（训练集）
          </Button>
        </Space>
      </Card>

      {evalData?.evaluation_protocol && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={<Text strong>评估协议（G2-Auth-2）</Text>}
          description={
            <Text style={{ fontSize: 13 }}>
              {(evalData.evaluation_protocol as { notes_zh?: string }).notes_zh}
              {' '}
              {(evalData.evaluation_protocol as { current_split_is_time_ordered?: boolean }).current_split_is_time_ordered
                ? '（当前划分为时间序列顺序）'
                : ''}
            </Text>
          }
        />
      )}

      {cvKfoldEval?.fold_metrics?.length ? (
        <Card
          title={`训练期 K 折结果（AC-6-03，k=${cvKfoldEval.k ?? '?'})`}
          style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}
        >
          <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
            汇总（均值 ± 标准差）：{' '}
            {Object.entries(cvKfoldEval.summary || {})
              .filter(([k]) => k.endsWith('_mean'))
              .map(([k, v]) => {
                const base = k.replace(/_mean$/, '')
                const sd = (cvKfoldEval.summary || {})[`${base}_std`]
                return `${base}: ${Number(v).toFixed(4)} ± ${sd !== undefined ? Number(sd).toFixed(4) : '-'}`
              })
              .join(' | ')}
          </Text>
          <Table
            size="small"
            pagination={false}
            dataSource={cvKfoldEval.fold_metrics}
            rowKey={r => String(r.fold)}
            onRow={r => ({
              style: r.outlier_highlight ? { background: 'rgba(127, 29, 29, 0.35)' } : undefined,
            })}
            columns={(() => {
              const rows = cvKfoldEval.fold_metrics || []
              if (!rows.length) return []
              return Object.keys(rows[0]).map(k => ({
                title: k === 'outlier_highlight' ? '异常折(>2σ)' : k,
                dataIndex: k,
                key: k,
                render: (v: unknown) => {
                  if (k === 'outlier_highlight') return v ? <Tag color="volcano">是</Tag> : <Tag>否</Tag>
                  return typeof v === 'number' ? v.toFixed(4) : String(v)
                },
              }))
            })()}
          />
          {cvBoxplotOption && (
            <>
              <Divider style={{ borderColor: '#334155' }} />
              <Text style={{ color: '#94a3b8', display: 'block', marginBottom: 8 }}>各指标 K 折箱线图</Text>
              <ReactECharts option={cvBoxplotOption} style={{ height: 280 }} />
            </>
          )}
        </Card>
      ) : null}

      {kfoldData && (
        <Card title="K 折结果（训练集内划分）" style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 16 }}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
            summary: {JSON.stringify(kfoldData.summary)}
          </Text>
          <Table
            size="small"
            pagination={false}
            dataSource={(kfoldData.fold_metrics as Record<string, unknown>[]) || []}
            rowKey={(_, i) => String(i)}
            columns={(() => {
              const rows = (kfoldData.fold_metrics as Record<string, unknown>[]) || []
              if (!rows.length) return []
              return Object.keys(rows[0]).map(k => ({
                title: k,
                dataIndex: k,
                key: k,
                render: (v: unknown) => (typeof v === 'number' ? v.toFixed(4) : String(v)),
              }))
            })()}
          />
        </Card>
      )}

      {metrics && (
        <>
          <Row gutter={12} style={{ marginBottom: 8 }}>
            {Object.entries(metrics).map(([k, v]) => {
              const rating = getMetricRating(k, v)
              return (
                <Col span={4} key={k} style={{ marginBottom: 8 }}>
                  <Card size="small" style={{ background: '#1e293b', border: '1px solid #334155', textAlign: 'center' }}>
                    <Text style={{ color: '#94a3b8', fontSize: 11, display: 'block' }}>{k.toUpperCase()}</Text>
                    <Text style={{ color: rating.color || '#60a5fa', fontSize: 20, fontWeight: 700 }}>
                      {typeof v === 'number' ? v.toFixed(4) : String(v)}
                    </Text>
                    {rating.label && (
                      <Tag color={rating.color} style={{ marginTop: 2, fontSize: 10 }}>{rating.label}</Tag>
                    )}
                  </Card>
                </Col>
              )
            })}
          </Row>

          {/* 基线对比 */}
          {baseline && (
            <Alert
              type="info"
              style={{ marginBottom: 16 }}
              message={
                <Space>
                  <SafetyOutlined />
                  <Text strong>基线对比</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>（{String(baseline.strategy)}）</Text>
                </Space>
              }
              description={
                <Row gutter={16}>
                  {Object.entries(baseline).filter(([k]) => k !== 'strategy' && k !== 'fit_scope').map(([k, v]) => (
                    <Col key={k}>
                      <Text type="secondary" style={{ fontSize: 12 }}>{k.toUpperCase()} 基线: </Text>
                      <Text strong style={{ color: '#faad14' }}>{typeof v === 'number' ? v.toFixed(4) : String(v)}</Text>
                      {metrics[k] !== undefined && (
                        <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                          → 模型提升 +{(metrics[k] - (v as number)).toFixed(4)}
                        </Text>
                      )}
                    </Col>
                  ))}
                </Row>
              }
            />
          )}

          {/* 过拟合诊断（数据分析专家 + 模型训练专家）*/}
          {(() => {
            const diag = evalData?.overfitting_diagnosis as {
              level: string; gap: number; message: string
              early_stopped?: boolean; best_round?: number
            } | undefined
            if (!diag) return null
            const alertType = diag.level === 'high' ? 'error' : diag.level === 'medium' ? 'warning' : 'success'
            return (
              <Alert
                type={alertType}
                showIcon
                style={{ marginBottom: 16 }}
                message={<Text strong>过拟合诊断</Text>}
                description={
                  <Space direction="vertical" size={2}>
                    <Text>{diag.message}</Text>
                    {diag.early_stopped && diag.best_round && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        🛑 训练时早停于第 {diag.best_round} 轮（自动保护模型泛化能力）
                      </Text>
                    )}
                  </Space>
                }
              />
            )
          })()}
        </>
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
            key: 'pr', label: 'PR 曲线',
            children: prOption
              ? (
                <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                    Precision-Recall 曲线适用于类别不平衡场景；Average Precision (AP) = {prData?.ap.toFixed(3)}
                  </Text>
                  <ReactECharts option={prOption} style={{ height: 380 }} />
                </Card>
              )
              : <Alert type="info" message="仅支持二分类 PR 曲线" />
          },
          {
            key: 'cal', label: '校准曲线',
            children: calOption
              ? (
                <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                    Brier Score = {calData?.brier_score.toFixed(4)}（越小越好，完美=0，随机=0.25）
                  </Text>
                  <ReactECharts option={calOption} style={{ height: 380 }} />
                </Card>
              )
              : <Alert type="info" message="仅支持二分类校准曲线" />
          },
          {
            key: 'thr', label: '阈值分析',
            children: thrData
              ? (
                <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                    不同决策阈值下的 Precision / Recall / F1 变化，默认阈值 = 0.5
                  </Text>
                  <Table
                    size="small"
                    dataSource={thrData.map((r, i) => ({ ...r, key: i }))}
                    columns={[
                      { title: '阈值', dataIndex: 'threshold', render: v => <Tag>{v}</Tag> },
                      { title: 'Precision', dataIndex: 'precision', render: v => <Text style={{ color: '#3b82f6' }}>{v.toFixed(4)}</Text> },
                      { title: 'Recall', dataIndex: 'recall', render: v => <Text style={{ color: '#f59e0b' }}>{v.toFixed(4)}</Text> },
                      { title: 'F1', dataIndex: 'f1', render: v => <Text style={{ color: '#34d399', fontWeight: 700 }}>{v.toFixed(4)}</Text> },
                    ]}
                    pagination={false}
                  />
                </Card>
              )
              : <Alert type="info" message="仅支持二分类阈值分析" />
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
              : <Alert type="info" message="点击「加载SHAP详情」获取SHAP数据" />
          },
          {
            key: 'lc', label: '学习曲线',
            children: (() => {
              if (!lcData) return (
                <Card style={{ background: '#1e293b', border: '1px solid #334155', textAlign: 'center', padding: 40 }}>
                  <Text style={{ color: '#64748b' }}>点击「加载学习曲线」开始分析</Text>
                </Card>
              )
              const lc = lcData as { sample_counts: number[]; train_sizes_pct: number[]; train_scores: number[]; val_scores: number[]; metric: string; task_type: string }
              const isRegression = lc.task_type === 'regression'
              // 回归任务 RMSE 越小越好，分类 Accuracy 越大越好
              const lcOption = {
                tooltip: { trigger: 'axis', formatter: (params: { seriesName: string; value: number }[]) =>
                  params.map(p => `${p.seriesName}: ${p.value.toFixed(4)}`).join('<br>')
                },
                legend: { data: ['训练集', '验证集'], textStyle: { color: '#94a3b8' } },
                xAxis: {
                  type: 'category',
                  data: lc.train_sizes_pct.map(p => `${p}%`),
                  name: '训练集规模',
                  nameTextStyle: { color: '#94a3b8' },
                  axisLabel: { color: '#94a3b8' },
                },
                yAxis: {
                  type: 'value',
                  name: lc.metric,
                  nameTextStyle: { color: '#94a3b8' },
                  axisLabel: { color: '#94a3b8' },
                },
                series: [
                  {
                    name: '训练集', type: 'line', data: lc.train_scores,
                    symbol: 'circle', symbolSize: 7,
                    lineStyle: { color: '#3b82f6', width: 2 },
                    itemStyle: { color: '#3b82f6' },
                  },
                  {
                    name: '验证集', type: 'line', data: lc.val_scores,
                    symbol: 'circle', symbolSize: 7,
                    lineStyle: { color: '#f59e0b', width: 2 },
                    itemStyle: { color: '#f59e0b' },
                  },
                ],
              }
              // 评判收敛趋势
              const gap = Math.abs(lc.train_scores[lc.train_scores.length - 1] - lc.val_scores[lc.val_scores.length - 1])
              const convergeTip = isRegression
                ? (gap < 0.05 ? '模型收敛良好，训练集与验证集 RMSE 接近' : '训练集与验证集 RMSE 差异较大，建议增加正则化或数据量')
                : (gap < 0.05 ? '模型收敛良好，训练集与验证集 Accuracy 接近' : '训练集与验证集 Accuracy 差异较大，建议调低 max_depth 或增大数据量')
              return (
                <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                  <Alert
                    type={gap < 0.05 ? 'success' : 'warning'}
                    message={convergeTip}
                    style={{ marginBottom: 16 }}
                    showIcon
                  />
                  <ReactECharts option={lcOption} style={{ height: 380 }} />
                </Card>
              )
            })()
          }
        ]} />
      )}
    </div>
  )
}

export default ModelEvalPage
