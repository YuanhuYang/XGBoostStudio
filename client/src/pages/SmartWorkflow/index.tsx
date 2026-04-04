import React, { useState, useEffect, useRef } from 'react'
import {
  Steps, Card, Button, Select, Alert, Progress, Typography, Space, Tag, Row, Col,
  Divider, Spin, Statistic, Switch, message, Collapse, Badge, Modal, InputNumber, Table,
} from 'antd'
import {
  RocketOutlined, CheckCircleOutlined, BookOutlined,
  FileTextOutlined, ThunderboltOutlined, BarChartOutlined, ExperimentOutlined,
} from '@ant-design/icons'
import HelpButton from '../../components/HelpButton'
import ReactECharts from 'echarts-for-react'
import { useAppStore } from '../../store/appStore'
import { listDatasets } from '../../api/datasets'
import apiClient from '../../api/client'
import { getDatasetSummary, getQuickConfig, getPreprocessSuggestions, runPipeline, runLabExperiment } from '../../api/wizard'
import { getParamsSchema } from '../../api/params'
import ParamExplainCard from '../../components/ParamExplainCard'
import type { Dataset } from '../../types'
import type { DatasetSummary, QuickConfigResult, PipelineProgress, PreprocessSuggestion, LabDoneEvent } from '../../api/wizard'
import type { ParamSchema } from '../../components/ParamExplainCard'

const { Title, Text, Paragraph } = Typography
const { Option } = Select

// ── 向导历史记录 ──────────────────────────────────────────────────────────────

interface WizardHistoryEntry {
  id: string
  timestamp: string
  datasetName: string
  targetColumn: string
  model_id: number
  report_id: number | null
  metrics: Record<string, unknown>
  natural_summary: string
}

const HISTORY_KEY = 'xgbs_wizard_history'
const MAX_HISTORY = 10

/** 需求文档：质量评分低于 70 时橙色警示及建议；Alert 使用 success / warning 分档 */
function qualityScoreAlert(score: number): {
  type: 'success' | 'warning'
  message: string
  description: string
} {
  if (score >= 80) {
    return {
      type: 'success',
      message: `数据质量评分：${score}/100（良好）`,
      description: '可进入下一步；若后续指标不佳，仍可在预处理中优化数据。',
    }
  }
  if (score >= 70) {
    return {
      type: 'warning',
      message: `数据质量评分：${score}/100（一般）`,
      description: '建议进入下一步查看 AI 预处理建议，处理缺失值、重复行或异常值后再训练。',
    }
  }
  return {
    type: 'warning',
    message: `数据质量评分：${score}/100（偏低，需关注）`,
    description:
      '按产品规范，评分低于 70 时应优先完成「数据分析与预处理」：检查缺失、异常值与类别不平衡，再划分数据集与训练，否则模型效果可能明显受限。',
  }
}

// ── 核心参数（面向初学者展示）────────────────────────────────────────────────
const CORE_PARAM_NAMES = ['n_estimators', 'max_depth', 'learning_rate', 'subsample', 'colsample_bytree']
const ADVANCED_PARAM_NAMES = ['min_child_weight', 'reg_alpha', 'reg_lambda', 'gamma', 'scale_pos_weight']

const SmartWorkflow: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const workflowMode = useAppStore(s => s.workflowMode)
  const setWorkflowMode = useAppStore(s => s.setWorkflowMode)

  // 历史记录
  const [wizardHistory, setWizardHistory] = useState<WizardHistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      return raw ? (JSON.parse(raw) as WizardHistoryEntry[]) : []
    } catch { return [] }
  })
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
  const setActiveDatasetId = useAppStore(s => s.setActiveDatasetId)
  const setActiveSplitId = useAppStore(s => s.setActiveSplitId)
  const setActiveModelId = useAppStore(s => s.setActiveModelId)
  const setActiveDatasetName = useAppStore(s => s.setActiveDatasetName)

  // Step 0 - 数据选择
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null)

  // Step 1 - 数据分析 & AI 预处理
  const [summary, setSummary] = useState<DatasetSummary | null>(null)
  const [preprocessSuggestions, setPreprocessSuggestions] = useState<PreprocessSuggestion[]>([])
  const [preprocessLoading, setPreprocessLoading] = useState(false)
  const [appliedItems, setAppliedItems] = useState<Set<number>>(new Set())
  const [appliedAll, setAppliedAll] = useState(false)

  // Step 2 - 目标列 & 划分
  const [targetColumn, setTargetColumn] = useState<string>('')

  // Step 2 - 数据划分
  const [selectedSplitId, setSelectedSplitId] = useState<number | null>(null)
  const [splitRatio, setSplitRatio] = useState(0.8)
  const [splitLoading, setSplitLoading] = useState(false)
  const [splitInfo, setSplitInfo] = useState<{ train_rows: number; test_rows: number } | null>(null)

  // Step 3 - 参数配置
  const [paramSchemas, setParamSchemas] = useState<ParamSchema[]>([])
  const [paramValues, setParamValues] = useState<Record<string, number | string>>({})
  const [explanations, setExplanations] = useState<Record<string, string>>({})
  const [configNotes, setConfigNotes] = useState<string[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [balancedParams, setBalancedParams] = useState<Record<string, number | string> | null>(null)
  const [selectedPreset, setSelectedPreset] = useState<'quick' | 'balanced' | 'deep'>('balanced')

  // Step 4 - 训练流水线
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [pipelinePercent, setPipelinePercent] = useState(0)
  const [pipelineLogs, setPipelineLogs] = useState<string[]>([])
  const [pipelineResult, setPipelineResult] = useState<PipelineProgress | null>(null)
  const [nlStatus, setNlStatus] = useState<string>('')
  const [optimizeCount, setOptimizeCount] = useState(0)
  const [lastOptimizeSummary, setLastOptimizeSummary] = useState<string>('')
  const cancelPipelineRef = useRef<(() => void) | null>(null)

  const logsEndRef = useRef<HTMLDivElement | null>(null)

  // ── Lab 参数实验 ──────────────────────────────────────────────────────────
  const [labOpen, setLabOpen] = useState(false)
  const [labParam, setLabParam] = useState<string>('max_depth')
  const [labValueA, setLabValueA] = useState<number>(3)
  const [labValueB, setLabValueB] = useState<number>(10)
  const [labStep, setLabStep] = useState<'config' | 'runningA' | 'runningB' | 'done'>('config')
  const [labCurveA, setLabCurveA] = useState<number[]>([])
  const [labCurveB, setLabCurveB] = useState<number[]>([])
  const [labMetricsA, setLabMetricsA] = useState<Record<string, number> | null>(null)
  const [labMetricsB, setLabMetricsB] = useState<Record<string, number> | null>(null)
  const [labProgressA, setLabProgressA] = useState(0)
  const [labProgressB, setLabProgressB] = useState(0)
  const cancelLabRef = useRef<(() => void) | null>(null)

  const isLearning = workflowMode === 'learning'

  // ── sessionStorage 持久化：离开页面再回来时恢复训练状态 ───────────────────
  const SESSION_KEY = 'xgbs_workflow_state'

  // 组件初次挂载时从 localStorage 恢复
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY)
      if (saved) {
        const s = JSON.parse(saved) as {
          currentStep?: number
          selectedDatasetId?: number | null
          targetColumn?: string
          selectedSplitId?: number | null
          splitInfo?: { train_rows: number; test_rows: number } | null
          pipelineResult?: PipelineProgress | null
          pipelinePercent?: number
          paramValues?: Record<string, number | string>
        }
        if (s.currentStep !== undefined) setCurrentStep(s.currentStep)
        if (s.selectedDatasetId !== undefined) setSelectedDatasetId(s.selectedDatasetId)
        if (s.targetColumn) setTargetColumn(s.targetColumn)
        if (s.selectedSplitId !== undefined) setSelectedSplitId(s.selectedSplitId)
        if (s.splitInfo !== undefined) setSplitInfo(s.splitInfo)
        if (s.pipelineResult !== undefined) setPipelineResult(s.pipelineResult)
        if (s.pipelinePercent !== undefined) setPipelinePercent(s.pipelinePercent)
        if (s.paramValues && Object.keys(s.paramValues).length > 0) setParamValues(s.paramValues)
      }
    } catch { /* 静默忽略反序列化错误 */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 关键状态变化时写入 localStorage
  useEffect(() => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        currentStep,
        selectedDatasetId,
        targetColumn,
        selectedSplitId,
        splitInfo,
        pipelineResult,
        pipelinePercent,
        paramValues: Object.keys(paramValues).length > 0 ? paramValues : undefined,
      }))
    } catch { /* 静默忽略 */ }
  }, [currentStep, selectedDatasetId, targetColumn, selectedSplitId, splitInfo, pipelineResult, pipelinePercent, paramValues])

  // ── 数据加载 ──────────────────────────────────────────────────────────────

  useEffect(() => {
    listDatasets().then(d => setDatasets(d)).catch(() => {})
  }, [])

  // 页面返回时：若 localStorage 已恢复 selectedDatasetId 但 summary 未加载，自动补充加载
  useEffect(() => {
    if (!selectedDatasetId || summary !== null || datasets.length === 0) return
    const ds = datasets.find(d => d.id === selectedDatasetId)
    if (!ds) return
    setActiveDatasetId(selectedDatasetId)
    setActiveDatasetName(ds.name)
    setPreprocessLoading(true)
    Promise.all([
      getDatasetSummary(selectedDatasetId),
      getPreprocessSuggestions(selectedDatasetId),
    ]).then(([s, ps]) => {
      setSummary(s)
      setPreprocessSuggestions(ps.suggestions ?? [])
      if (!targetColumn) {
        const rec = s.target_column || (s.candidate_targets?.[0]?.col ?? '')
        setTargetColumn(rec)
      }
    }).catch(() => {
      message.error('恢复数据集状态失败，请重新选择数据集')
    }).finally(() => {
      setPreprocessLoading(false)
    })
  }, [selectedDatasetId, datasets.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [pipelineLogs])

  // ── Step 0: 选择数据集 ─────────────────────────────────────────────────────

  const handleSelectDataset = async (id: number) => {
    setSelectedDatasetId(id)
    const ds = datasets.find(d => d.id === id)
    setLoading(true)
    setPreprocessLoading(true)
    try {
      const [s, ps] = await Promise.all([
        getDatasetSummary(id),
        getPreprocessSuggestions(id),
      ])
      setSummary(s)
      setPreprocessSuggestions(ps.suggestions ?? [])
      const recTarget = s.target_column || (s.candidate_targets?.[0]?.col ?? '')
      setTargetColumn(recTarget)
    } catch {
      message.error('获取数据集信息失败')
    } finally {
      setLoading(false)
      setPreprocessLoading(false)
    }
    if (ds) {
      setActiveDatasetId(id)
      setActiveDatasetName(ds.name)
    }
  }

  const goToStep1 = () => {
    if (!selectedDatasetId || !summary) return
    setCurrentStep(1)
  }

  // ── Step 2: 数据划分 ───────────────────────────────────────────────────────

  const handleCreateSplit = async () => {
    if (!selectedDatasetId) return
    const targetCol = targetColumn || summary?.target_column || ''
    setSplitLoading(true)
    try {
      const res = await apiClient.post(`/api/datasets/${selectedDatasetId}/split`, {
        train_ratio: splitRatio,
        random_seed: 42,
        stratify: preprocessSuggestions.some(s => s.type === 'class_imbalance'),
        target_column: targetCol,
      })
      const data = res.data
      setSelectedSplitId(data.split_id)
      setActiveSplitId(data.split_id)
      setSplitInfo({ train_rows: data.train_rows, test_rows: data.test_rows })
      message.success(`划分完成：训练集 ${data.train_rows} 行，测试集 ${data.test_rows} 行`)
    } catch {
      message.error('数据划分失败')
    } finally {
      setSplitLoading(false)
    }
  }

  const goToStep3 = async () => {
    if (!selectedSplitId) {
      message.warning('请先完成数据划分')
      return
    }
    setActiveSplitId(selectedSplitId)
    setLoading(true)
    try {
      // 获取参数 schema
      const schemaRaw = await getParamsSchema()
      const schema = (Array.isArray(schemaRaw) ? schemaRaw : []) as ParamSchema[]
      setParamSchemas(schema)

      // 获取推荐配置
      const config: QuickConfigResult = await getQuickConfig(selectedSplitId)
      const initVals: Record<string, number | string> = {}
      schema.forEach((s: ParamSchema) => {
        initVals[s.name] = config.params[s.name] !== undefined
          ? (config.params[s.name] as number | string)
          : (s.default as number | string)
      })
      setParamValues(initVals)
      setBalancedParams({ ...initVals })
      setExplanations(config.explanations ?? {})
      setConfigNotes(config.notes ?? [])
      setCurrentStep(3)
    } catch {
      message.error('获取参数推荐失败，将使用默认参数')
      setCurrentStep(3)
    } finally {
      setLoading(false)
    }
  }

  // ── Lab 参数实验处理 ──────────────────────────────────────────────────────

  const openLab = () => {
    setLabStep('config')
    setLabCurveA([])
    setLabCurveB([])
    setLabMetricsA(null)
    setLabMetricsB(null)
    setLabProgressA(0)
    setLabProgressB(0)
    setLabOpen(true)
  }

  const handleRunLab = () => {
    if (!selectedSplitId) return
    const paramsA = { ...paramValues, [labParam]: labValueA }
    const paramsB = { ...paramValues, [labParam]: labValueB }
    setLabStep('runningA')
    setLabCurveA([])
    setLabCurveB([])
    setLabProgressA(0)
    setLabProgressB(0)

    // 先跑配置 A
    const cancelA = runLabExperiment(
      { split_id: selectedSplitId, params: paramsA as Record<string, unknown> },
      (ev) => {
        setLabCurveA(prev => [...prev, ev.val_loss])
        setLabProgressA(Math.round((ev.round / ev.total) * 100))
      },
      (doneA: LabDoneEvent) => {
        setLabMetricsA(doneA.metrics)
        setLabStep('runningB')
        // 再跑配置 B
        const cancelB = runLabExperiment(
          { split_id: selectedSplitId, params: paramsB as Record<string, unknown> },
          (ev) => {
            setLabCurveB(prev => [...prev, ev.val_loss])
            setLabProgressB(Math.round((ev.round / ev.total) * 100))
          },
          (doneB: LabDoneEvent) => {
            setLabMetricsB(doneB.metrics)
            setLabStep('done')
          },
          (err) => {
            message.error(`配置 B 训练失败：${err}`)
            setLabStep('config')
          },
        )
        cancelLabRef.current = cancelB
      },
      (err) => {
        message.error(`配置 A 训练失败：${err}`)
        setLabStep('config')
      },
    )
    cancelLabRef.current = cancelA
  }

  // ── Step 4: 一键流水线 ────────────────────────────────────────────────────


  const handleRunPipeline = (overrideParams?: Record<string, number | string>) => {
    if (!selectedSplitId) return
    const activeParams = overrideParams ?? paramValues
    setPipelineRunning(true)
    setPipelinePercent(0)
    setPipelineLogs([])
    setPipelineResult(null)
    setNlStatus('')

    const cancel = runPipeline(
      {
        split_id: selectedSplitId,
        params: activeParams as Record<string, unknown>,
        report_title: `智能向导 - ${datasets.find(d => d.id === selectedDatasetId)?.name ?? '模型'}`,
      },
      (event) => {
        if (event.type === 'progress' && event.percent !== undefined) {
          setPipelinePercent(event.percent)
        }
        if (event.type === 'log' && event.message) {
          setPipelineLogs(prev => [...prev, event.message!])
          // 训练进度类日志（含"轮"）用于状态行实时更新
          if (event.message.includes('轮') || event.message.includes('训练')) {
            setNlStatus(event.message)
          }
        }
      },
      (result) => {
        setPipelineResult(result)
        setPipelineRunning(false)
        if (result.model_id) setActiveModelId(result.model_id)
        // 写入历史记录
        if (result.model_id) {
          const now = new Date()
          const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
          const entry: WizardHistoryEntry = {
            id: now.toISOString(),
            timestamp,
            datasetName: datasets.find(d => d.id === selectedDatasetId)?.name ?? '未知数据集',
            targetColumn: targetColumn,
            model_id: result.model_id,
            report_id: result.report_id ?? null,
            metrics: result.metrics ?? {},
            natural_summary: result.natural_summary ?? '',
          }
          setWizardHistory(prev => {
            const next = [entry, ...prev].slice(0, MAX_HISTORY)
            try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* 忽略 */ }
            return next
          })
        }
        setCurrentStep(5)
      },
      (err) => {
        message.error(`训练失败：${err}`)
        setPipelineRunning(false)
      },
    )
    cancelPipelineRef.current = cancel
  }

  // ── 过拟合迭代优化 ──────────────────────────────────────────────────────────

  const handleOptimizeAndRetrain = () => {
    const adjusted = { ...paramValues }
    const changes: string[] = []

    const depth = Number(adjusted.max_depth)
    if (depth > 2) {
      const newDepth = depth - 1
      adjusted.max_depth = newDepth
      changes.push(`max_depth ${depth}→${newDepth}`)
    }

    const lambda = Number(adjusted.reg_lambda)
    const newLambda = Math.min(10, parseFloat((lambda + 0.5).toFixed(1)))
    if (newLambda !== lambda) {
      adjusted.reg_lambda = newLambda
      changes.push(`reg_lambda ${lambda}→${newLambda}`)
    }

    const alpha = Number(adjusted.reg_alpha)
    const newAlpha = Math.min(5, parseFloat((alpha + 0.1).toFixed(2)))
    if (newAlpha !== alpha) {
      adjusted.reg_alpha = newAlpha
      changes.push(`reg_alpha ${alpha}→${newAlpha}`)
    }

    const sub = Number(adjusted.subsample)
    const newSub = Math.min(0.95, parseFloat((sub + 0.05).toFixed(2)))
    if (newSub !== sub) {
      adjusted.subsample = newSub
      changes.push(`subsample ${sub}→${newSub}`)
    }

    const summary = changes.length > 0 ? changes.join('，') : '参数已达优化边界，建议检查数据或特征'
    setParamValues(adjusted)
    setLastOptimizeSummary(summary)
    setOptimizeCount(c => c + 1)
    message.open({
      type: 'info',
      icon: <ThunderboltOutlined style={{ color: '#fa8c16' }} />,
      content: `第 ${optimizeCount + 1} 次迭代优化：${summary}`,
      duration: 4,
    })
    setCurrentStep(4)
    handleRunPipeline(adjusted)
  }

  // ── 追求精度优化 ──────────────────────────────────────────────────────────

  const handleOptimizeForAccuracy = () => {
    const adjusted = { ...paramValues }
    const changes: string[] = []

    const estimators = Number(adjusted.n_estimators)
    const newEstimators = Math.min(1000, Math.round(estimators * 1.5))
    if (newEstimators !== estimators) {
      adjusted.n_estimators = newEstimators
      changes.push(`n_estimators ${estimators}→${newEstimators}`)
    }

    const lr = Number(adjusted.learning_rate)
    const newLr = Math.max(0.01, parseFloat((lr * 0.7).toFixed(4)))
    if (newLr !== lr) {
      adjusted.learning_rate = newLr
      changes.push(`learning_rate ${lr}→${newLr}`)
    }

    const depth = Number(adjusted.max_depth)
    const newDepth = Math.min(10, depth + 1)
    if (newDepth !== depth) {
      adjusted.max_depth = newDepth
      changes.push(`max_depth ${depth}→${newDepth}`)
    }

    const accuracySummary = changes.length > 0 ? changes.join('，') : '参数已达优化边界'
    setParamValues(adjusted)
    setLastOptimizeSummary(`[增强精度] ${accuracySummary}`)
    setOptimizeCount(c => c + 1)
    message.open({
      type: 'info',
      icon: <RocketOutlined style={{ color: '#7c3aed' }} />,
      content: `追求精度优化：${accuracySummary}`,
      duration: 4,
    })
    setCurrentStep(4)
    handleRunPipeline(adjusted)
  }

  // ── 参数值变更 ────────────────────────────────────────────────────────────

  const handleParamChange = (name: string, v: number | string) => {
    setParamValues(prev => ({ ...prev, [name]: v }))
  }

  const applyPreset = (preset: 'quick' | 'balanced' | 'deep') => {
    const quickPreset = {
      n_estimators: 50, max_depth: 4, learning_rate: 0.2,
      subsample: 0.8, colsample_bytree: 0.8, reg_lambda: 1, reg_alpha: 0,
      min_child_weight: 1, gamma: 0,
    }
    const deepPreset = {
      n_estimators: 500, max_depth: 6, learning_rate: 0.05,
      subsample: 0.8, colsample_bytree: 0.7, reg_lambda: 1.5, reg_alpha: 0.1,
      min_child_weight: 3, gamma: 0.1,
    }
    if (preset === 'quick') {
      setParamValues(prev => ({ ...prev, ...quickPreset }))
      setSelectedPreset('quick')
      message.success('已应用「快速验证」：50 棵树，约 30 秒出结果')
    } else if (preset === 'deep') {
      setParamValues(prev => ({ ...prev, ...deepPreset }))
      setSelectedPreset('deep')
      message.success('已应用「深度训练」：500 棵树，追求最高精度')
    } else if (balancedParams) {
      setParamValues({ ...balancedParams })
      setSelectedPreset('balanced')
      message.success('已恢复 AI 均衡推荐参数')
    }
  }

  const handleApplyAll = () => {
    setAppliedAll(true)
    setAppliedItems(new Set(preprocessSuggestions.map((_, i) => i)))
    message.success(`已应用全部 ${preprocessSuggestions.length} 项建议`)
  }

  const handleApplyOne = (i: number) => {
    setAppliedItems(prev => {
      const next = new Set(prev)
      next.add(i)
      if (next.size === preprocessSuggestions.length) setAppliedAll(true)
      return next
    })
    message.success(`已应用：${preprocessSuggestions[i].title}`)
  }

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  const coreSchemas = paramSchemas.filter(s => CORE_PARAM_NAMES.includes(s.name))
  const advancedSchemas = paramSchemas.filter(s => ADVANCED_PARAM_NAMES.includes(s.name))

  const steps = [
    { title: '选择数据集', icon: <FileTextOutlined /> },
    { title: '数据分析', icon: <BarChartOutlined /> },
    { title: '数据划分', icon: <ThunderboltOutlined /> },
    { title: '参数配置', icon: <BookOutlined /> },
    { title: '一键训练', icon: <RocketOutlined /> },
    { title: '结果总结', icon: <CheckCircleOutlined /> },
  ]

  return (
    <div style={{ padding: '24px', maxWidth: 960, margin: '0 auto' }}>
      <HelpButton pageTitle="智能工作流" items={[
        { title: '导向模式与学习模式有何区别？', content: '导向模式逐步引导完成建模全流程；学习模式额外显示参数说明卡片，适合初学者理解各参数含义。' },
        { title: '推荐流程是什么顺序？', content: '1.选择数据集 → 2.自动预处理 → 3.快速配置 → 4.训练模型 → 5.查看评估结果 → 6.导出报告。' },
        { title: '实验室模式有什么用？', content: '实验室模式支持多参数组合对比，自动运行多次训练并汇总结果，适合快速探索最优参数组合。' },
      ]} />
      {/* 模式切换 */}
      <Row justify="end" style={{ marginBottom: 16 }}>
        <Space>
          <Text type="secondary">学习模式</Text>
          <Switch
            checked={isLearning}
            onChange={v => setWorkflowMode(v ? 'learning' : 'guided')}
            checkedChildren="开"
            unCheckedChildren="关"
          />
          {isLearning && <Tag color="purple">参数学习卡已开启</Tag>}
        </Space>
      </Row>

      {/* 历史记录选择 */}
      {wizardHistory.length > 0 && (
        <Row style={{ marginBottom: 16 }} align="middle" gutter={8}>
          <Col flex="auto">
            <Select
              style={{ width: '100%' }}
              placeholder="查看历史训练记录（点击可恢复上次结果）"
              value={selectedHistoryId ?? undefined}
              allowClear
              onClear={() => setSelectedHistoryId(null)}
              onChange={(val: string) => {
                const entry = wizardHistory.find(h => h.id === val)
                if (!entry) return
                setSelectedHistoryId(val)
                setPipelineResult({
                  type: 'done',
                  model_id: entry.model_id,
                  report_id: entry.report_id,
                  metrics: entry.metrics,
                  natural_summary: entry.natural_summary,
                })
                setActiveModelId(entry.model_id)
                setCurrentStep(5)
              }}
            >
              {wizardHistory.map(h => {
                const metrics = h.metrics
                const auc = metrics.auc as number | undefined
                const r2 = metrics.r2 as number | undefined
                const key = auc ?? r2
                let badge = ''
                if (key !== undefined) {
                  const metricName = auc !== undefined ? 'AUC' : 'R²'
                  const levelLabel = key >= 0.9 ? '优秀' : key >= 0.8 ? '良好' : key >= 0.7 ? '尚可' : '待提升'
                  badge = ` | ${metricName}: ${key.toFixed(4)} (${levelLabel})`
                }
                return (
                  <Option key={h.id} value={h.id}>
                    {`${h.datasetName} → ${h.targetColumn} | ${h.timestamp}${badge}`}
                  </Option>
                )
              })}
            </Select>
          </Col>
        </Row>
      )}

      <Steps current={currentStep} items={steps} style={{ marginBottom: 32 }} />

      {/* ── Step 0: 选择数据集 ── */}
      {currentStep === 0 && (
        <Card title="选择要分析的数据集">
          <Paragraph type="secondary">
            请从已上传的数据集中选择一个，系统将自动分析数据质量并推荐最佳配置。
          </Paragraph>
          <Select
            style={{ width: '100%', marginBottom: 16 }}
            placeholder="选择数据集…"
            value={selectedDatasetId ?? undefined}
            onChange={handleSelectDataset}
            loading={loading}
          >
            {datasets.map(d => (
              <Option key={d.id} value={d.id}>
                {d.name}
                {d.rows && <Text type="secondary"> ({d.rows} 行 × {d.cols} 列)</Text>}
              </Option>
            ))}
          </Select>
          {datasets.length === 0 && (
            <Alert type="info" message="您还没有上传数据集，请先前往「数据导入」页面上传数据。" />
          )}
          {summary && (() => {
            const qa = qualityScoreAlert(summary.quality_score)
            return (
              <Alert
                type={qa.type}
                message={qa.message}
                description={
                  <span>
                    {summary.task_hint}
                    <br />
                    <Text type="secondary">{qa.description}</Text>
                  </span>
                }
                showIcon
                style={{ marginBottom: 8 }}
              />
            )
          })()}
          <Button
            type="primary"
            disabled={!summary}
            loading={loading}
            onClick={goToStep1}
            size="large"
            style={{ marginTop: 8 }}
          >
            下一步：查看数据分析
          </Button>
        </Card>
      )}

      {/* ── Step 1: 数据分析 & AI 推荐预处理 ── */}
      {currentStep === 1 && summary && (
        <Card title="Step 1：数据分析 & AI 推荐预处理">
          <Row gutter={24} style={{ marginBottom: 16 }}>
            <Col span={6}><Statistic title="样本数" value={summary.n_rows} /></Col>
            <Col span={6}><Statistic title="特征数" value={summary.n_cols} /></Col>
            <Col span={6}>
              <Statistic
                title="质量评分"
                value={`${summary.quality_score}/100`}
                valueStyle={
                  summary.quality_score < 70
                    ? { color: '#fa8c16' }
                    : summary.quality_score < 80
                      ? { color: '#d48806' }
                      : undefined
                }
              />
            </Col>
            <Col span={6}><Statistic title="缺失率" value={`${(summary.missing_rate * 100).toFixed(1)}%`} /></Col>
          </Row>

          {(() => {
            const qa = qualityScoreAlert(summary.quality_score)
            if (summary.quality_score >= 80) return null
            return (
              <Alert
                type={qa.type}
                message={qa.message}
                description={qa.description}
                showIcon
                style={{ marginBottom: 16 }}
              />
            )
          })()}

          <Alert
            type={summary.task_type.includes('classification') ? 'info' : 'success'}
            message={`检测到任务类型：${summary.task_hint}`}
            showIcon
            style={{ marginBottom: 16 }}
          />

          <Divider>✨ AI 预处理建议</Divider>

          {preprocessLoading && <Spin tip="正在分析数据问题…" style={{ display: 'block', margin: '16px 0' }} />}

          {!preprocessLoading && preprocessSuggestions.length === 0 && (
            <Alert
              type="success"
              message={summary.quality_score >= 90 ? '数据质量优秀，可跳过预处理步骤' : '未检测到明显数据问题'}
              description="数据状况良好，无需额外预处理即可直接进行数据划分。"
              showIcon
            />
          )}

          {!preprocessLoading && preprocessSuggestions.length > 0 && (
            <>
              <Alert
                type="info"
                message={`AI 检测到 ${preprocessSuggestions.length} 个可优化项`}
                description="建议处理以下问题，点击「应用全部推荐」一键处理，也可单独应用每项。"
                showIcon
                style={{ marginBottom: 12 }}
                action={
                  <Button type="primary" size="small" onClick={handleApplyAll}>
                    {appliedAll ? '✓ 已全部应用' : '应用全部推荐'}
                  </Button>
                }
              />
              {preprocessSuggestions.map((s, i) => {
                const borderColor = s.severity === 'error' ? '#ff4d4f' : s.severity === 'warning' ? '#faad14' : '#1677ff'
                const tagColor = s.severity === 'error' ? 'error' : s.severity === 'warning' ? 'warning' : 'processing'
                const tagText = s.severity === 'error' ? '严重' : s.severity === 'warning' ? '建议' : '提示'
                return (
                  <Card
                    key={i}
                    size="small"
                    style={{ marginBottom: 10, borderLeft: `4px solid ${borderColor}` }}
                    title={<Space><Tag color={tagColor}>{tagText}</Tag><span>{s.title}</span></Space>}
                    extra={
                      appliedItems.has(i)
                        ? <Tag color="success">✓ 已应用</Tag>
                        : <Button size="small" onClick={() => handleApplyOne(i)}>应用</Button>
                    }
                  >
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Typography.Text type="secondary">{s.description}</Typography.Text>
                      <Row gutter={16}>
                        <Col span={8}>
                          <Typography.Text style={{ fontSize: 12, color: '#666' }}>推荐操作：</Typography.Text>
                          <br /><Typography.Text style={{ fontSize: 12 }}>{s.action}</Typography.Text>
                        </Col>
                        <Col span={8}>
                          <Typography.Text style={{ fontSize: 12, color: '#666' }}>预期改善：</Typography.Text>
                          <br /><Typography.Text style={{ fontSize: 12, color: '#52c41a' }}>{s.expected_improvement}</Typography.Text>
                        </Col>
                        <Col span={8}>
                          <Typography.Text style={{ fontSize: 12, color: '#666' }}>潜在风险：</Typography.Text>
                          <br /><Typography.Text style={{ fontSize: 12, color: '#faad14' }}>{s.potential_risk}</Typography.Text>
                        </Col>
                      </Row>
                      {isLearning && (
                        <Collapse
                          size="small"
                          ghost
                          items={[{
                            key: 'why',
                            label: <Typography.Text style={{ color: '#722ed1', fontSize: 12 }}>📖 深入了解：为什么检测出此问题？</Typography.Text>,
                            children: <Typography.Paragraph style={{ fontSize: 13, marginBottom: 0 }}>{s.learn_why}</Typography.Paragraph>,
                          }]}
                        />
                      )}
                    </Space>
                  </Card>
                )
              })}
            </>
          )}

          <Space style={{ marginTop: 16 }}>
            <Button onClick={() => setCurrentStep(0)}>返回</Button>
            <Button type="primary" onClick={() => setCurrentStep(2)}>
              {preprocessSuggestions.length === 0 ? '下一步：确认目标列' : '继续：确认目标列'}
            </Button>
          </Space>
        </Card>
      )}

      {/* ── Step 2: 确认目标列 & 数据划分 ── */}
      {currentStep === 2 && summary && (
        <Card title="Step 2：确认目标列 & 数据划分">
          {/* 目标列选择 */}
          <div style={{ marginBottom: 24 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
              目标列（要预测的列）
              {summary.candidate_targets?.length > 0 && (
                <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                  — AI 推荐：{summary.candidate_targets[0]?.col}（{summary.candidate_targets[0]?.reason}）
                </Typography.Text>
              )}
            </Typography.Text>
            <Select
              style={{ width: 320 }}
              value={targetColumn || undefined}
              placeholder="请选择目标列…"
              onChange={v => setTargetColumn(v)}
            >
              {summary.columns.map(c => {
                const candidate = summary.candidate_targets?.find(ct => ct.col === c.name)
                return (
                  <Option key={c.name} value={c.name}>
                    <Space>
                      <span>{c.name}</span>
                      {candidate && <Tag color="blue" style={{ fontSize: 10 }}>推荐 {Math.round(candidate.confidence * 100)}%</Tag>}
                    </Space>
                  </Option>
                )
              })}
            </Select>
          </div>

          {/* 互信息重要性图 */}
          {summary.feature_mi && summary.feature_mi.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                特征重要性（与目标列的互信息得分 Top-{summary.feature_mi.length}）
              </Typography.Text>
              <ReactECharts
                option={{
                  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                  grid: { left: '3%', right: '12%', bottom: '3%', containLabel: true },
                  xAxis: { type: 'value', name: '互信息得分' },
                  yAxis: {
                    type: 'category',
                    data: [...summary.feature_mi].reverse().map(f => f.col),
                  },
                  series: [{
                    type: 'bar',
                    data: [...summary.feature_mi].reverse().map(f => f.mi),
                    itemStyle: { color: '#1677ff' },
                    label: { show: true, position: 'right', formatter: '{c}' },
                  }],
                }}
                style={{ height: Math.max(120, summary.feature_mi.length * 30) + 'px' }}
              />
            </div>
          )}

          {/* 划分比例 */}
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>训练/测试集划分比例</Typography.Text>
          <Row align="middle" gutter={16} style={{ marginBottom: 8 }}>
            <Col><Typography.Text>训练集比例：</Typography.Text></Col>
            <Col flex="auto">
              <input
                type="range"
                min={0.5}
                max={0.9}
                step={0.05}
                value={splitRatio}
                onChange={e => setSplitRatio(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </Col>
            <Col><Tag>{Math.round(splitRatio * 100)}% : {Math.round((1 - splitRatio) * 100)}%</Tag></Col>
          </Row>

          {summary.n_rows < 1000 && (
            <Alert
              type="info" showIcon
              message="样本量较少（< 1000），建议使用 90/10 划分或考虑交叉验证"
              style={{ marginBottom: 8 }}
            />
          )}
          {preprocessSuggestions.some(s => s.type === 'class_imbalance') && (
            <Alert
              type="warning" showIcon
              message="已检测到类别不平衡，将自动启用分层采样（Stratified Sampling），确保训练集与测试集各类别比例一致"
              style={{ marginBottom: 8 }}
            />
          )}

          {splitInfo && (
            <Alert
              type="success"
              message={`划分完成：训练集 ${splitInfo.train_rows} 行，测试集 ${splitInfo.test_rows} 行`}
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          <Divider />
          <Space>
            <Button onClick={() => setCurrentStep(1)}>返回</Button>
            <Button
              onClick={handleCreateSplit}
              loading={splitLoading}
              disabled={!targetColumn}
            >
              {selectedSplitId ? '重新划分' : '划分数据集 →'}
            </Button>
            <Button
              type="primary"
              disabled={!selectedSplitId}
              loading={loading}
              onClick={goToStep3}
            >
              下一步：AI 参数推荐
            </Button>
          </Space>
        </Card>
      )}

      {/* ── Step 3: 参数配置 ── */}
      {currentStep === 3 && (
        <Card title="Step 3：参数配置（AI 已为您推荐最优参数）">
          {/* ── 三预设方案按钮 ── */}
          <div style={{ marginBottom: 20 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 10 }}>选择参数方案：</Typography.Text>
            <Row gutter={12}>
              <Col>
                <Card
                  size="small" hoverable
                  style={{ width: 200, cursor: 'pointer', borderColor: selectedPreset === 'quick' ? '#1677ff' : undefined, background: selectedPreset === 'quick' ? '#1677ff18' : undefined }}
                  onClick={() => applyPreset('quick')}
                >
                  <Typography.Text strong>🚀 快速验证</Typography.Text>
                  <br />
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>约 30 秒出结果，适合验证思路</Typography.Text>
                </Card>
              </Col>
              <Col>
                <Card
                  size="small" hoverable
                  style={{ width: 280, cursor: 'pointer', borderColor: selectedPreset === 'balanced' ? '#1677ff' : undefined, background: selectedPreset === 'balanced' ? '#1677ff18' : undefined }}
                  onClick={() => applyPreset('balanced')}
                >
                  <Badge dot color="blue" offset={[4, 0]}>
                    <Typography.Text strong>⚖️ 均衡推荐</Typography.Text>
                  </Badge>
                  <br />
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', whiteSpace: 'nowrap' }}>AI 基于数据推荐，绝大多数场景首选</Typography.Text>
                </Card>
              </Col>
              <Col>
                <Card
                  size="small" hoverable
                  style={{ width: 200, cursor: 'pointer', borderColor: selectedPreset === 'deep' ? '#1677ff' : undefined, background: selectedPreset === 'deep' ? '#1677ff18' : undefined }}
                  onClick={() => applyPreset('deep')}
                >
                  <Typography.Text strong>🎯 深度训练</Typography.Text>
                  <br />
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>最高精度，训练时间较长</Typography.Text>
                </Card>
              </Col>
            </Row>
          </div>
          <Divider style={{ margin: '0 0 12px 0' }} />
          {configNotes.length > 0 && (
            <Alert
              type="success"
              message="AI 推荐说明"
              description={<ul style={{ margin: 0, paddingLeft: 20 }}>{configNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          {isLearning && (
            <Alert
              type="info"
              icon={<BookOutlined />}
              message="学习模式已开启：点击每个参数右侧的 ❓ 了解详细说明，展开「学习此参数」深入理解原理"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          <Text strong style={{ display: 'block', marginBottom: 12 }}>核心参数（推荐调整）</Text>
          {coreSchemas.length === 0 ? (
            <Spin />
          ) : (
            coreSchemas.map(schema => (
              <ParamExplainCard
                key={schema.name}
                schema={schema}
                value={paramValues[schema.name] ?? schema.default}
                onChange={v => handleParamChange(schema.name, v)}
                explanation={explanations[schema.name]}
              />
            ))
          )}

          <Divider>
            <Switch
              checked={showAdvanced}
              onChange={setShowAdvanced}
              checkedChildren="隐藏高级参数"
              unCheckedChildren="显示高级参数"
            />
          </Divider>

          {showAdvanced && advancedSchemas.map(schema => (
            <ParamExplainCard
              key={schema.name}
              schema={schema}
              value={paramValues[schema.name] ?? schema.default}
              onChange={v => handleParamChange(schema.name, v)}
              explanation={explanations[schema.name]}
            />
          ))}

          <Space style={{ marginTop: 16 }}>
            <Button onClick={() => setCurrentStep(2)}>返回</Button>
            {isLearning && (
              <Button
                icon={<ExperimentOutlined />}
                onClick={openLab}
                disabled={!selectedSplitId}
              >
                ⚗️ 参数实验
              </Button>
            )}
            <Button type="primary" size="large" icon={<RocketOutlined />} onClick={() => setCurrentStep(4)}>
              下一步：开始训练
            </Button>
          </Space>
        </Card>
      )}

      {/* ── Step 4: 一键训练 ── */}
      {currentStep === 4 && (
        <Card title="一键训练 → 评估 → 报告">
          <Paragraph type="secondary">
            点击下方按钮，系统将自动完成模型训练、性能评估和报告生成，全程无需干预。
          </Paragraph>

          {!pipelineRunning && !pipelineResult && (
            <Button
              type="primary"
              size="large"
              icon={<RocketOutlined />}
              onClick={() => handleRunPipeline()}
              style={{ marginBottom: 24 }}
            >
              一键启动
            </Button>
          )}

          {(pipelineRunning || pipelineLogs.length > 0) && (
            <>
              <Progress
                percent={pipelinePercent}
                status={pipelineRunning ? 'active' : 'success'}
                style={{ marginBottom: 4 }}
              />
              {nlStatus && (
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                  {nlStatus}
                </Text>
              )}
              <Card
                size="small"
                style={{ background: '#001529', marginBottom: 16, maxHeight: 240, overflowY: 'auto' }}
              >
                {pipelineLogs.map((log, i) => (
                  <div key={i} style={{ color: '#52c41a', fontSize: 13, fontFamily: 'monospace' }}>
                    {log}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </Card>
              {pipelineRunning && (
                <Button
                  danger
                  onClick={() => { cancelPipelineRef.current?.(); setPipelineRunning(false) }}
                >
                  取消
                </Button>
              )}
            </>
          )}

          <Space style={{ marginTop: 16 }}>
            <Button onClick={() => setCurrentStep(3)} disabled={pipelineRunning}>返回</Button>
          </Space>
        </Card>
      )}

      {/* ── Step 5: 结果总结 ── */}
      {currentStep === 5 && pipelineResult && (() => {
        const metrics = pipelineResult.metrics ?? {}
        const auc = metrics.auc as number | undefined
        const r2 = metrics.r2 as number | undefined
        const key = auc ?? r2
        let level = '', levelColor = ''
        if (key !== undefined) {
          if (key >= 0.9) { level = '优秀'; levelColor = '#52c41a' }
          else if (key >= 0.8) { level = '良好'; levelColor = '#1677ff' }
          else if (key >= 0.7) { level = '尚可'; levelColor = '#faad14' }
          else { level = '待提升'; levelColor = '#ff4d4f' }
        }
        const overfittingLevel = metrics.overfitting_level as string | undefined
        const primaryEntries = Object.entries(metrics).filter(([k]) => ['auc', 'accuracy', 'f1', 'r2'].includes(k))
        const secondaryEntries = Object.entries(metrics).filter(([k, v]) => !['auc', 'accuracy', 'f1', 'r2'].includes(k) && typeof v === 'number')
        return (
        <Card
          title={<Space><CheckCircleOutlined style={{ color: '#52c41a' }} /><span>训练完成</span></Space>}
          style={{ borderColor: '#52c41a' }}
        >
          <Alert
            type="success"
            message={
              <Space>
                <span>🎉 恭喜！模型训练成功</span>
                {level && (
                  <Tag color={levelColor} style={{ fontWeight: 600 }}>{level}</Tag>
                )}
                {auc !== undefined && (
                  <Text type="secondary" style={{ fontSize: 12 }}>参考：随机猜测 AUC = 0.50</Text>
                )}
              </Space>
            }
            description={pipelineResult.natural_summary}
            showIcon
            style={{ marginBottom: 24 }}
          />

          {(overfittingLevel === 'high' || overfittingLevel === 'medium') && (
            <Alert
              type="warning"
              showIcon
              message={overfittingLevel === 'high' ? '检测到明显过拟合' : '检测到轻度过拟合'}
              description={
                <div>
                  <p style={{ margin: '4px 0 6px' }}>
                    {overfittingLevel === 'high'
                      ? '训练集误差显著低于验证集误差，模型对训练数据记忆过度，泛化能力较差。'
                      : '训练集与验证集误差存在一定差距，模型存在轻度过拟合风险。'}
                  </p>
                  <p style={{ margin: 0 }}>
                    建议：适当<strong>降低 max_depth</strong>（减少树的复杂度）、
                    <strong>增大 reg_lambda / reg_alpha</strong>（加强正则化）、
                    <strong>提高 subsample</strong>（增加随机采样比例），然后重新训练。
                  </p>
                </div>
              }
              style={{ marginBottom: 24 }}
            />
          )}

          {Object.keys(metrics).length > 0 && (
            <>
              {primaryEntries.length > 0 && (
                <Row gutter={16} style={{ marginBottom: 12 }}>
                  {primaryEntries.map(([k, v]) => (
                    <Col key={k} span={6}>
                      <Statistic title={k.toUpperCase()} value={typeof v === 'number' ? v.toFixed(4) : v} />
                    </Col>
                  ))}
                </Row>
              )}
              {secondaryEntries.length > 0 && (
                <Row gutter={16} style={{ marginBottom: 24 }}>
                  {secondaryEntries.map(([k, v]) => (
                    <Col key={k} span={6}>
                      <Statistic title={k.toUpperCase()} value={typeof v === 'number' ? v.toFixed(4) : v}
                        valueStyle={{ fontSize: 18, color: '#666' }} />
                    </Col>
                  ))}
                </Row>
              )}
            </>
          )}

          <Space wrap style={{ marginBottom: lastOptimizeSummary ? 8 : 0 }}>
            <Button
              type="primary"
              icon={<FileTextOutlined />}
              onClick={() => {
                // 触发导航到报告页（通过自定义事件）
                window.dispatchEvent(new CustomEvent('navigate', { detail: 'report' }))
              }}
            >
              查看报告
            </Button>
            <Button
              icon={<BarChartOutlined />}
              onClick={() => {
                window.dispatchEvent(new CustomEvent('navigate', { detail: 'model-eval' }))
              }}
            >
              查看评估详情
            </Button>
            {(overfittingLevel === 'high' || overfittingLevel === 'medium') && (
              <>
                <Button
                  icon={<ThunderboltOutlined />}
                  style={{ background: '#fa8c16', borderColor: '#fa8c16', color: '#fff' }}
                  onClick={handleOptimizeAndRetrain}
                  disabled={!selectedSplitId}
                >
                  🛡️ 减少过拟合
                </Button>
                <Button
                  icon={<RocketOutlined />}
                  style={{ background: '#7c3aed', borderColor: '#7c3aed', color: '#fff' }}
                  onClick={handleOptimizeForAccuracy}
                  disabled={!selectedSplitId}
                >
                  📈 追求精度
                </Button>
              </>
            )}
            <Button
              onClick={() => {
                localStorage.removeItem('xgbs_workflow_state')
                setCurrentStep(0)
                setPipelineResult(null)
                setPipelineLogs([])
                setPipelinePercent(0)
                setSelectedDatasetId(null)
                setSummary(null)
                setOptimizeCount(0)
                setLastOptimizeSummary('')
              }}
            >
              训练新模型
            </Button>
          </Space>
          {lastOptimizeSummary && (
            <div style={{ marginTop: 6 }}>
              <Text type="secondary" style={{ fontSize: 12, color: '#fa8c16' }}>
                上次调整：{lastOptimizeSummary}
              </Text>
            </div>
          )}
        </Card>
        )
      })()}
      {/* ── Lab 参数实验 Modal ── */}
      <Modal
        title={<Space><ExperimentOutlined /><span>⚗️ 参数对比实验</span></Space>}
        open={labOpen}
        onCancel={() => { cancelLabRef.current?.(); setLabOpen(false) }}
        footer={null}
        width={760}
        destroyOnClose
      >
        {labStep === 'config' && (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Alert
              type="info"
              message="学习模式专属功能：用同一份数据，对比两组不同参数的训练效果，直观体验参数对模型的影响"
              showIcon
            />
            <Row gutter={16} align="middle">
              <Col span={8}>
                <Typography.Text strong>对比参数：</Typography.Text>
                <Select
                  style={{ width: '100%', marginTop: 4 }}
                  value={labParam}
                  onChange={setLabParam}
                >
                  {[...CORE_PARAM_NAMES, ...ADVANCED_PARAM_NAMES].map(p => (
                    <Select.Option key={p} value={p}>{p}</Select.Option>
                  ))}
                </Select>
              </Col>
              <Col span={8}>
                <Typography.Text strong>配置 A 值：</Typography.Text>
                <InputNumber
                  style={{ width: '100%', marginTop: 4 }}
                  value={labValueA}
                  min={0}
                  step={1}
                  onChange={v => setLabValueA(v ?? 1)}
                />
              </Col>
              <Col span={8}>
                <Typography.Text strong>配置 B 值：</Typography.Text>
                <InputNumber
                  style={{ width: '100%', marginTop: 4 }}
                  value={labValueB}
                  min={0}
                  step={1}
                  onChange={v => setLabValueB(v ?? 1)}
                />
              </Col>
            </Row>
            <Alert
              type="warning"
              message={`当前将对比：${labParam} = ${labValueA}（A）vs ${labValueA !== labValueB ? labValueB : '请修改 B 值使其不同'}（B），其余参数保持当前面板设置不变`}
              showIcon
            />
            <Button
              type="primary"
              icon={<RocketOutlined />}
              onClick={handleRunLab}
              disabled={labValueA === labValueB}
              block
            >
              开始对比训练
            </Button>
          </Space>
        )}

        {(labStep === 'runningA' || labStep === 'runningB') && (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Tag color={labStep === 'runningA' ? 'processing' : 'success'}>
              {labStep === 'runningA' ? `正在训练配置 A（${labParam}=${labValueA}）…` : `配置 A 完成，正在训练配置 B（${labParam}=${labValueB}）…`}
            </Tag>
            <div>
              <Typography.Text type="secondary">配置 A 进度</Typography.Text>
              <Progress percent={labProgressA} status={labStep === 'runningA' ? 'active' : 'success'} size="small" />
            </div>
            <div>
              <Typography.Text type="secondary">配置 B 进度</Typography.Text>
              <Progress percent={labProgressB} status={labStep === 'runningB' ? 'active' : 'normal'} size="small" />
            </div>
            {(labCurveA.length > 0 || labCurveB.length > 0) && (
              <ReactECharts
                option={{
                  title: { text: '验证集损失曲线（实时）', textStyle: { fontSize: 13 } },
                  tooltip: { trigger: 'axis' },
                  legend: { data: [`A: ${labParam}=${labValueA}`, `B: ${labParam}=${labValueB}`] },
                  xAxis: { type: 'category', name: '轮次', data: Array.from({ length: Math.max(labCurveA.length, labCurveB.length) }, (_, i) => i + 1) },
                  yAxis: { type: 'value', name: 'Val Loss', scale: true },
                  series: [
                    { name: `A: ${labParam}=${labValueA}`, type: 'line', data: labCurveA, smooth: true, itemStyle: { color: '#1677ff' }, symbol: 'none' },
                    { name: `B: ${labParam}=${labValueB}`, type: 'line', data: labCurveB, smooth: true, itemStyle: { color: '#ff4d4f' }, symbol: 'none' },
                  ],
                }}
                style={{ height: 240 }}
              />
            )}
            <Button danger onClick={() => { cancelLabRef.current?.(); setLabStep('config') }}>取消实验</Button>
          </Space>
        )}

        {labStep === 'done' && labMetricsA && labMetricsB && (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Alert type="success" message="对比训练完成！" showIcon />
            <ReactECharts
              option={{
                title: { text: `验证集损失曲线对比（${labParam}: A=${labValueA} vs B=${labValueB}）`, textStyle: { fontSize: 13 } },
                tooltip: { trigger: 'axis' },
                legend: { data: [`A: ${labParam}=${labValueA}`, `B: ${labParam}=${labValueB}`] },
                xAxis: { type: 'category', name: '轮次', data: Array.from({ length: Math.max(labCurveA.length, labCurveB.length) }, (_, i) => i + 1) },
                yAxis: { type: 'value', name: 'Val Loss', scale: true },
                series: [
                  { name: `A: ${labParam}=${labValueA}`, type: 'line', data: labCurveA, smooth: true, itemStyle: { color: '#1677ff' }, symbol: 'none' },
                  { name: `B: ${labParam}=${labValueB}`, type: 'line', data: labCurveB, smooth: true, itemStyle: { color: '#ff4d4f' }, symbol: 'none' },
                ],
              }}
              style={{ height: 260 }}
            />
            <Table
              size="small"
              pagination={false}
              dataSource={Object.keys({ ...labMetricsA, ...labMetricsB }).map(k => ({
                key: k,
                metric: k.toUpperCase(),
                a: typeof labMetricsA[k] === 'number' ? (labMetricsA[k] as number).toFixed(4) : '—',
                b: typeof labMetricsB[k] === 'number' ? (labMetricsB[k] as number).toFixed(4) : '—',
              }))}
              columns={[
                { title: '指标', dataIndex: 'metric', width: 120 },
                { title: `配置 A（${labParam}=${labValueA}）`, dataIndex: 'a', align: 'center' as const },
                { title: `配置 B（${labParam}=${labValueB}）`, dataIndex: 'b', align: 'center' as const },
              ]}
            />
            <Row gutter={12}>
              <Col span={12}>
                <Button block onClick={() => { setParamValues(prev => ({ ...prev, [labParam]: labValueA })); setLabOpen(false); message.success(`已应用配置 A：${labParam} = ${labValueA}`) }}>
                  应用配置 A（{labParam}={labValueA}）
                </Button>
              </Col>
              <Col span={12}>
                <Button type="primary" block onClick={() => { setParamValues(prev => ({ ...prev, [labParam]: labValueB })); setLabOpen(false); message.success(`已应用配置 B：${labParam} = ${labValueB}`) }}>
                  应用配置 B（{labParam}={labValueB}）
                </Button>
              </Col>
            </Row>
            <Button block onClick={() => setLabStep('config')}>重新配置实验</Button>
          </Space>
        )}
      </Modal>

    </div>
  )
}

export default SmartWorkflow
