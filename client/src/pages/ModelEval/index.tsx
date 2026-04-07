import React, { useState, useEffect, useMemo } from 'react'
import {
  Card, Row, Col, Button, Typography, Space, Select,
  Tabs, Table, Tag, Alert, message, Statistic, Divider, Slider, Progress,
  Badge, Spin,
} from 'antd'
import {
  SafetyOutlined, BugOutlined,
  LineChartOutlined, WarningOutlined, TeamOutlined, ReadOutlined,
} from '@ant-design/icons'
import { Tooltip } from 'antd'
import ReactECharts from 'echarts-for-react'
import apiClient from '../../api/client'
import { getLearningCurve } from '../../api/models'
import { useAppStore } from '../../store/appStore'
import { showTeachingUi } from '../../utils/teachingUi'
const { Text } = Typography

// ─── G3-B 新增类型 ────────────────────────────────────────────────────────────
interface PdpIceResult {
  feature: string; grid_values: number[]; pdp_mean: number[]; pdp_std: number[]
  ice_lines: number[][]; task_type: string; interpretation: string
}
interface RobustnessResult {
  test_type: string; baseline_score: number; metric: string; task_type: string
  overall_robustness: string
  perturbation_results: { perturbation: string; degradation?: number; severity: string; [key: string]: unknown }[]
}
interface BadSampleResult {
  fp_count: number; fn_count: number; error_rate: number
  bad_sample_analysis: { type: string; count: number; pct_of_test: number; root_causes: string[]; common_features: { feature: string; bad_mean: number; normal_mean: number }[] }[]
  recommendations: string[]
}
interface FairnessResult {
  group_column: string; fairness_concern: string; interpretation: string
  group_metrics: { group: string; n: number; accuracy?: number; f1?: number; positive_rate?: number; rmse?: number; r2?: number }[]
  fairness_gap: number | null
}

/** 是否与 SHAP 条形图一致：评估接口的 shap_summary 或「加载 SHAP 详情」后的明细 */
function hasEvalShapChartData(
  evalData: Record<string, unknown> | null,
  shapDetail: Record<string, unknown> | null,
): boolean {
  const summary = evalData?.shap_summary as { feature: string; importance: number }[] | undefined
  if (Array.isArray(summary) && summary.length > 0) return true
  const d = shapDetail as { features?: string[]; shap_values?: number[][] } | null
  return Boolean(d?.features?.length && d?.shap_values?.length)
}

const EVAL_CHART_TAB_ORDER = [
  'cm', 'roc', 'pr', 'cal', 'thr', 'res', 'shap', 'lc', 'pdp', 'robust', 'badsample', 'fairness',
] as const

// 向导/模型调优：指标 Tooltip 解读文案
const metricExplanations: Record<string, string> = {
  auc: 'AUC（ROC曲线下面积）：衡量模型区分正负样本的能力。0.5=随机猜测，0.7=尚可，0.8=良好，0.9以上=优秀。数值越高说明模型在不同阈值下的区分能力越强。',
  ks: 'KS统计量：模型预测概率在正负样本上累计分布的最大差距。KS>0.3表示较强区分能力，KS>0.5表示优秀。',
  f1: 'F1分数：Precision（精确率）和Recall（召回率）的调和平均值。适合类别不均衡时使用，同时关注假正和假负的代价。',
  accuracy: '准确率：预测正确的样本占总样本的比例。适合类别均衡时使用，类别不均衡时可能产生误导。',
  rmse: 'RMSE（均方根误差）：预测值与真实值差异的平方根均值。数值越小说明模型预测越准确，单位与目标变量相同。',
  r2: 'R²（决定系数）：模型解释的方差比例。R²=1表示完美预测，R²=0表示和均值预测一样差，负值表示比均值更差。',
  logloss: 'Log Loss（对数损失）：衡量概率预测的准确度，对置信度错误的预测施以更大惩罚。值越小越好，0为完美预测。',
  mae: 'MAE（平均绝对误差）：预测值与真实值之差绝对值的平均。与RMSE相比，对异常值不那么敏感。',
}

const ModelEvalPage: React.FC = () => {
  const activeModelId = useAppStore(s => s.activeModelId)
  const activeSplitId = useAppStore(s => s.activeSplitId)
  const workflowMode = useAppStore(s => s.workflowMode)
  const showTeaching = showTeachingUi(workflowMode)
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
  /** 学习曲线独立 loading，避免与评估/SHAP 互斥，且支持评估成功后后台拉取 */
  const [lcLoading, setLcLoading] = useState(false)

  // G3-B 新增状态
  const [pdpFeature, setPdpFeature] = useState('')
  const [pdpData, setPdpData] = useState<PdpIceResult | null>(null)
  const [pdpLoading, setPdpLoading] = useState(false)
  const [robustnessType, setRobustnessType] = useState('feature_perturbation')
  const [robustnessData, setRobustnessData] = useState<RobustnessResult | null>(null)
  const [robustnessLoading, setRobustnessLoading] = useState(false)
  const [badSampleData, setBadSampleData] = useState<BadSampleResult | null>(null)
  const [badSampleLoading, setBadSampleLoading] = useState(false)
  const [fairnessGroupCol, setFairnessGroupCol] = useState('')
  const [fairnessData, setFairnessData] = useState<FairnessResult | null>(null)
  const [fairnessLoading, setFairnessLoading] = useState(false)
  const [evalColumns, setEvalColumns] = useState<string[]>([])
  /** 评估图表 Tabs：按模型任务与接口返回数据隐藏不适用的标签，避免空 Tab 导致页面高度跳动 */
  const [evalChartTabKey, setEvalChartTabKey] = useState<string | null>(null)

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
    setLcLoading(true)
    try {
      const data = await getLearningCurve(modelId)
      setLcData(data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '获取学习曲线失败')
    } finally {
      setLcLoading(false)
    }
  }

  // 评估数据就绪后自动拉取学习曲线（切换模型时已清空 lcData，会重新请求）
  useEffect(() => {
    if (!modelId || !evalData) return
    let cancelled = false
    setLcLoading(true)
    getLearningCurve(modelId)
      .then(data => {
        if (!cancelled) setLcData(data)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const err = e as { response?: { data?: { detail?: string } } }
          message.error(err.response?.data?.detail || '获取学习曲线失败')
        }
      })
      .finally(() => {
        if (!cancelled) setLcLoading(false)
      })
    return () => { cancelled = true }
  }, [modelId, evalData])

  // G3-B 新增数据加载函数
  const fetchPdpIce = async () => {
    if (!modelId || !pdpFeature) { message.warning('请输入模型 ID 和特征名'); return }
    setPdpLoading(true)
    try {
      const r = await apiClient.get(`/api/models/${modelId}/pdp-ice/${encodeURIComponent(pdpFeature)}`)
      setPdpData(r.data as PdpIceResult)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || 'PDP/ICE 分析失败')
    } finally { setPdpLoading(false) }
  }

  const fetchRobustness = async () => {
    if (!modelId) { message.warning('请先加载模型评估'); return }
    setRobustnessLoading(true)
    try {
      const r = await apiClient.post(`/api/models/${modelId}/robustness-test`, { test_type: robustnessType })
      setRobustnessData(r.data as RobustnessResult)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '鲁棒性测试失败')
    } finally { setRobustnessLoading(false) }
  }

  const fetchBadSample = async () => {
    if (!modelId) { message.warning('请先加载模型评估'); return }
    setBadSampleLoading(true)
    try {
      const r = await apiClient.get(`/api/models/${modelId}/bad-sample-diagnosis`)
      setBadSampleData(r.data as BadSampleResult)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '坏样本诊断失败')
    } finally { setBadSampleLoading(false) }
  }

  const fetchFairness = async () => {
    if (!modelId || !fairnessGroupCol) { message.warning('请选择分组列'); return }
    setFairnessLoading(true)
    try {
      const r = await apiClient.post(`/api/models/${modelId}/fairness-analysis`, { group_col: fairnessGroupCol })
      setFairnessData(r.data as FairnessResult)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '公平性分析失败')
    } finally { setFairnessLoading(false) }
  }

  // 加载模型特征列（用于 PDP 特征选择）
  useEffect(() => {
    if (!modelId) { setEvalColumns([]); return }
    apiClient.get(`/api/models/${modelId}/evaluation`).then(r => {
      const shap = (r.data as Record<string, unknown>)?.shap_summary as Array<{feature: string}> | undefined
      if (shap) setEvalColumns(shap.map(s => s.feature).filter(Boolean))
    }).catch(() => {})
  }, [modelId])

  const visibleEvalChartKeys = useMemo(() => {
    if (!evalData) return [] as string[]
    const available = new Set<string>()
    const cm = evalData.confusion_matrix as { matrix?: number[][] } | undefined
    if (cm?.matrix?.length) available.add('cm')
    if (evalData.roc_curve) available.add('roc')
    if (evalData.pr_curve) available.add('pr')
    if (evalData.calibration) available.add('cal')
    const thr = evalData.threshold_metrics as unknown[] | undefined
    if (Array.isArray(thr) && thr.length > 0) available.add('thr')
    const res = evalData.residuals as { predicted?: number[] } | undefined
    if (res?.predicted?.length) available.add('res')
    if (hasEvalShapChartData(evalData, shapData)) available.add('shap')
    available.add('lc')
    available.add('pdp')
    available.add('robust')
    if (evalData.task_type === 'classification') available.add('badsample')
    available.add('fairness')
    return EVAL_CHART_TAB_ORDER.filter(k => available.has(k))
  }, [evalData, shapData])

  useEffect(() => { setEvalChartTabKey(null) }, [modelId])

  useEffect(() => {
    if (!visibleEvalChartKeys.length) return
    if (evalChartTabKey === null || !visibleEvalChartKeys.includes(evalChartTabKey)) {
      setEvalChartTabKey(visibleEvalChartKeys[0])
    }
  }, [visibleEvalChartKeys, evalChartTabKey])

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

  return (
    <div style={{ padding: 24 }}>
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
          <Button onClick={fetchLearningCurve} loading={lcLoading}>重新加载学习曲线</Button>
          <Button onClick={runKfold} loading={kfoldLoading} disabled={!modelMeta?.split_id}>
            K 折交叉验证（训练集）
          </Button>
        </Space>
        {modelId != null && modelMeta?.split_id != null && (
          <div style={{ marginTop: 12 }}>
            <Text style={{ color: '#94a3b8' }}>
              本模型训练使用划分：
              <Text strong style={{ color: '#5eead4' }}> #{modelMeta.split_id}</Text>
            </Text>
          </div>
        )}
        {modelId != null && modelMeta?.split_id != null && activeSplitId != null && modelMeta.split_id !== activeSplitId && (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 12 }}
            message="与顶栏当前划分不一致"
            description={`顶栏上下文为划分 #${activeSplitId}，当前所选模型基于划分 #${modelMeta.split_id} 训练。评估指标始终对应下方所选模型。`}
          />
        )}
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
              const explanation = metricExplanations[k.toLowerCase()]
              return (
                <Col span={4} key={k} style={{ marginBottom: 8 }}>
                  <Card size="small" style={{ background: '#1e293b', border: '1px solid #334155', textAlign: 'center' }}>
                    {showTeaching && explanation ? (
                      <Tooltip title={
                        <div style={{ maxWidth: 280 }}>
                          <div style={{ color: '#a78bfa', marginBottom: 4 }}><ReadOutlined /> 指标解读</div>
                          <div style={{ fontSize: 12 }}>{explanation}</div>
                        </div>
                      } placement="top">
                        <Text style={{ color: '#a78bfa', fontSize: 11, display: 'block', cursor: 'help', textDecoration: 'underline dotted' }}>
                          {k.toUpperCase()} 📖
                        </Text>
                      </Tooltip>
                    ) : (
                      <Text style={{ color: '#94a3b8', fontSize: 11, display: 'block' }}>{k.toUpperCase()}</Text>
                    )}
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

      {evalData && visibleEvalChartKeys.length > 0 && (
        <Tabs
          activeKey={evalChartTabKey ?? visibleEvalChartKeys[0]}
          onChange={k => {
            setEvalChartTabKey(k)
            // 若自动请求失败或未命中（极少），切到本 Tab 时再尝试一次
            if (k === 'lc' && modelId && evalData && !lcData && !lcLoading) {
              void fetchLearningCurve()
            }
          }}
          items={[
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
              if (!lcData) {
                return (
                  <Card style={{ background: '#1e293b', border: '1px solid #334155', textAlign: 'center', padding: 40 }}>
                    {lcLoading ? (
                      <Spin tip="正在加载学习曲线…" />
                    ) : (
                      <Text style={{ color: '#64748b' }}>学习曲线加载失败，请点击上方「重新加载学习曲线」重试</Text>
                    )}
                  </Card>
                )
              }
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
          },

          // ─── G3-B: PDP / ICE ─────────────────────────────────────────────
          {
            key: 'pdp',
            label: <span><LineChartOutlined /> PDP/ICE</span>,
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="偏依赖图（PDP）显示单个特征对预测结果的边际影响；ICE 图显示每个样本的个体条件期望曲线。可用于验证特征影响趋势与业务逻辑的一致性。" />
                <Space style={{ marginBottom: 16 }} wrap>
                  <Text style={{ color: '#94a3b8' }}>选择特征：</Text>
                  <Select showSearch placeholder="选择要分析的特征" value={pdpFeature || undefined}
                    onChange={v => setPdpFeature(v)}
                    options={evalColumns.map(c => ({ value: c, label: c }))}
                    style={{ width: 220 }} allowClear />
                  <Button type="primary" icon={<LineChartOutlined />} onClick={fetchPdpIce} loading={pdpLoading}>
                    生成 PDP/ICE
                  </Button>
                </Space>
                {pdpData && (
                  <Space direction="vertical" style={{ width: '100%' }} size={16}>
                    <Alert type="info" message={pdpData.interpretation} showIcon />
                    <ReactECharts
                      option={{
                        title: { text: `${pdpData.feature} 的偏依赖图（PDP）与 ICE 曲线`, textStyle: { color: '#94a3b8', fontSize: 13 } },
                        tooltip: { trigger: 'axis' },
                        legend: { data: ['PDP均值', ...pdpData.ice_lines.slice(0, 5).map((_, i) => `ICE样本${i+1}`)], textStyle: { color: '#94a3b8' } },
                        xAxis: { type: 'category', data: pdpData.grid_values.map(v => v.toFixed(2)), name: pdpData.feature, axisLabel: { color: '#94a3b8', rotate: 30 } },
                        yAxis: { type: 'value', name: '预测值', axisLabel: { color: '#94a3b8' } },
                        series: [
                          {
                            name: 'PDP均值', type: 'line', data: pdpData.pdp_mean,
                            lineStyle: { color: '#f59e0b', width: 3 }, symbol: 'none',
                          },
                          ...pdpData.ice_lines.slice(0, 20).map((line, i) => ({
                            name: i < 5 ? `ICE样本${i+1}` : undefined,
                            type: 'line', data: line,
                            lineStyle: { color: '#3b82f6', width: 0.5, opacity: 0.3 },
                            symbol: 'none', showInLegend: i < 5,
                          })),
                        ],
                        backgroundColor: 'transparent',
                      }}
                      style={{ height: 360 }}
                    />
                  </Space>
                )}
              </Card>
            )
          },

          // ─── G3-B: 鲁棒性测试 ────────────────────────────────────────────
          {
            key: 'robust',
            label: <span><SafetyOutlined /> 鲁棒性测试</span>,
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="鲁棒性压力测试：评估模型对特征扰动、样本扰动和极端值的抗干扰能力，验证生产环境的稳定性。" />
                <Space style={{ marginBottom: 16 }} wrap>
                  <Select value={robustnessType} onChange={setRobustnessType} style={{ width: 220 }}
                    options={[
                      { value: 'feature_perturbation', label: '特征扰动（噪声+缺失）' },
                      { value: 'sample_perturbation', label: '样本扰动（随机剔除）' },
                      { value: 'extreme', label: '极端值样本测试' },
                    ]} />
                  <Button type="primary" icon={<SafetyOutlined />} onClick={fetchRobustness} loading={robustnessLoading}>
                    开始鲁棒性测试
                  </Button>
                </Space>
                {robustnessData && (
                  <Space direction="vertical" style={{ width: '100%' }} size={16}>
                    <Alert type={robustnessData.overall_robustness.includes('稳定') ? 'success' : 'warning'}
                      message={robustnessData.overall_robustness} showIcon />
                    <Row gutter={16}>
                      <Col span={8}><Statistic title="基准得分" value={robustnessData.baseline_score.toFixed(4)} valueStyle={{ color: '#60a5fa' }} /></Col>
                      <Col span={8}><Statistic title="测试指标" value={robustnessData.metric} /></Col>
                      <Col span={8}><Statistic title="测试样本数" value={robustnessData.n_test_samples} /></Col>
                    </Row>
                    <Table size="small" pagination={false}
                      dataSource={robustnessData.perturbation_results.map((r, i) => ({ ...r, key: i }))}
                      columns={[
                        { title: '扰动类型', dataIndex: 'perturbation', key: 'p' },
                        { title: robustnessData.metric, dataIndex: robustnessData.metric, key: 'score', render: (v: number) => v != null ? v.toFixed(4) : '-' },
                        { title: '相对基准偏差', dataIndex: 'degradation', key: 'deg', render: (v: number) => {
                          if (v == null) return '-'
                          const color = Math.abs(v) > 0.05 ? 'red' : Math.abs(v) > 0.02 ? 'orange' : 'green'
                          return <Tag color={color}>{v > 0 ? `↓-${v.toFixed(4)}` : `↑+${Math.abs(v).toFixed(4)}`}</Tag>
                        }},
                        { title: '稳定性评级', dataIndex: 'severity', key: 'sev', render: (v: string) => (
                          <Tag color={v === '稳定' || v === '基准' ? 'green' : v === '中等' ? 'orange' : 'red'}>{v}</Tag>
                        )},
                      ]} />
                  </Space>
                )}
              </Card>
            )
          },

          // ─── G3-B: 坏样本诊断 ────────────────────────────────────────────
          {
            key: 'badsample',
            label: <span><BugOutlined /> 坏样本诊断</span>,
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="坏样本根因诊断（仅分类任务）：自动识别 FP/FN 错误预测样本，通过 K-Means 聚类发现共性特征，输出根因分析和优化建议。" />
                <Button type="primary" icon={<BugOutlined />} onClick={fetchBadSample} loading={badSampleLoading} style={{ marginBottom: 16 }}>
                  开始坏样本诊断
                </Button>
                {badSampleData && (
                  <Space direction="vertical" style={{ width: '100%' }} size={16}>
                    <Row gutter={16}>
                      <Col span={6}><Statistic title="假阳性 FP" value={badSampleData.fp_count} valueStyle={{ color: '#ff4d4f' }} /></Col>
                      <Col span={6}><Statistic title="假阴性 FN" value={badSampleData.fn_count} valueStyle={{ color: '#faad14' }} /></Col>
                      <Col span={6}><Statistic title="整体错误率" value={`${badSampleData.error_rate.toFixed(2)}%`} valueStyle={{ color: badSampleData.error_rate > 20 ? '#ff4d4f' : '#52c41a' }} /></Col>
                    </Row>
                    {badSampleData.recommendations.length > 0 && (
                      <Alert type="warning" showIcon icon={<WarningOutlined />}
                        message="优化建议"
                        description={<ul style={{ margin: 0, paddingLeft: 16 }}>{badSampleData.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>} />
                    )}
                    {badSampleData.bad_sample_analysis.map(ba => (
                      <Card key={ba.type} size="small"
                        title={<Space><Badge color={ba.type.includes('FP') ? 'red' : 'orange'} /><Text style={{ color: '#e2e8f0' }}>{ba.type}（{ba.count} 个，占测试集 {ba.pct_of_test}%）</Text></Space>}
                        style={{ background: '#0f172a' }}>
                        {ba.root_causes.length > 0 && (
                          <div style={{ marginBottom: 8 }}>
                            <Text style={{ color: '#94a3b8', fontSize: 12 }}>根因分析：</Text>
                            {ba.root_causes.map((rc, i) => <div key={i} style={{ color: '#fbbf24', fontSize: 12 }}>{rc}</div>)}
                          </div>
                        )}
                        {ba.common_features.length > 0 && (
                          <Table size="small" pagination={false}
                            dataSource={ba.common_features.map((f, i) => ({ ...f, key: i }))}
                            columns={[
                              { title: '特征', dataIndex: 'feature', key: 'f' },
                              { title: '坏样本均值', dataIndex: 'bad_mean', key: 'bm', render: (v: number) => <Text style={{ color: '#ff4d4f' }}>{v.toFixed(4)}</Text> },
                              { title: '正常样本均值', dataIndex: 'normal_mean', key: 'nm', render: (v: number) => <Text style={{ color: '#52c41a' }}>{v.toFixed(4)}</Text> },
                            ]} />
                        )}
                      </Card>
                    ))}
                  </Space>
                )}
              </Card>
            )
          },

          // ─── G3-B: 公平性分析 ────────────────────────────────────────────
          {
            key: 'fairness',
            label: <span><TeamOutlined /> 公平性分析</span>,
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="算法公平性分析：按分组字段（如性别、年龄段、地区）计算各子群的预测准确性偏差，验证模型无歧视性预测偏差，输出人口统计公平差异（DPD）。" />
                <Space style={{ marginBottom: 16 }} wrap>
                  <Text style={{ color: '#94a3b8' }}>分组列：</Text>
                  <Select showSearch placeholder="选择分组字段（如 Sex、Age 等）"
                    value={fairnessGroupCol || undefined}
                    onChange={v => setFairnessGroupCol(v)}
                    options={evalColumns.map(c => ({ value: c, label: c }))}
                    style={{ width: 220 }} allowClear />
                  <Button type="primary" icon={<TeamOutlined />} onClick={fetchFairness} loading={fairnessLoading}>
                    运行公平性分析
                  </Button>
                </Space>
                {fairnessData && (
                  <Space direction="vertical" style={{ width: '100%' }} size={16}>
                    <Alert
                      type={fairnessData.fairness_concern === '低' ? 'success' : fairnessData.fairness_concern === '中' ? 'warning' : 'error'}
                      message={fairnessData.interpretation} showIcon
                      description={fairnessData.demographic_parity_difference != null ? `人口统计公平差异（DPD）= ${fairnessData.demographic_parity_difference.toFixed(4)}（理想值 < 0.1）` : undefined}
                    />
                    <Table size="small" pagination={false}
                      dataSource={fairnessData.group_metrics.map((r, i) => ({ ...r, key: i }))}
                      columns={[
                        { title: '分组', dataIndex: 'group', key: 'g' },
                        { title: '样本数', dataIndex: 'n', key: 'n' },
                        { title: 'Accuracy', dataIndex: 'accuracy', key: 'acc', render: (v?: number) => v != null ? <Tag color={v >= 0.8 ? 'green' : v >= 0.6 ? 'blue' : 'red'}>{v.toFixed(4)}</Tag> : '-' },
                        { title: 'F1', dataIndex: 'f1', key: 'f1', render: (v?: number) => v != null ? v.toFixed(4) : '-' },
                        { title: '正向预测率', dataIndex: 'positive_rate', key: 'pr', render: (v?: number) => v != null ? `${(v * 100).toFixed(1)}%` : '-' },
                        { title: 'RMSE', dataIndex: 'rmse', key: 'rmse', render: (v?: number) => v != null ? v.toFixed(4) : '-' },
                        { title: 'R²', dataIndex: 'r2', key: 'r2', render: (v?: number) => v != null ? v.toFixed(4) : '-' },
                      ]} />
                  </Space>
                )}
              </Card>
            )
          },
        ].filter(t => visibleEvalChartKeys.includes(String(t.key)))}
        />
      )}
    </div>
  )
}

export default ModelEvalPage
