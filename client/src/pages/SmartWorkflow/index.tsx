import React, { useState, useEffect, useRef } from 'react'
import {
  Steps, Card, Button, Select, Alert, Progress, Typography, Space, Tag, Row, Col,
  Divider, Spin, Statistic, Switch, message, Collapse, Badge, Modal, InputNumber, Table,
  Tooltip, Radio,
} from 'antd'
import {
  RocketOutlined, CheckCircleOutlined, BookOutlined,
  FileTextOutlined, ThunderboltOutlined, BarChartOutlined, ExperimentOutlined,
  EditOutlined, ToolOutlined, BulbOutlined,
} from '@ant-design/icons'
import ParamLabModal from '@/components/ParamLabModal'
import ReactECharts from 'echarts-for-react'
import { useAppStore } from '../../store/appStore'
import { listDatasets } from '../../api/datasets'
import apiClient, { BASE_URL } from '../../api/client'
import { startAutoMLJob, getAutoMLJobResult, type AutoMLJobResult } from '../../api/automl'
import { getDatasetSummary, getQuickConfig, getPreprocessSuggestions, runPipeline } from '../../api/wizard'
import { getParamsSchema } from '../../api/params'
import ParamExplainCard from '../../components/ParamExplainCard'
import type { Dataset } from '../../types'
import type { DatasetSummary, QuickConfigResult, PipelineProgress, PreprocessSuggestion } from '../../api/wizard'
import type { ParamSchema } from '../../components/ParamExplainCard'
import { showTeachingUi } from '../../utils/teachingUi'

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

/** 预处理建议类型 → 备用「深入了解」文案（接口缺省时仍可读） */
const PREPROCESS_LEARN_FALLBACK: Record<string, string> = {
  missing_values:
    '缺失表示该列部分样本无取值。树模型虽能处理稀疏，但适度填充常能减少噪声分裂、提升稳定性；高缺失列也可能掩盖「缺失本身」与标签的关系，可视情况单独建模。',
  duplicates:
    '完全重复行会让模型在相同模式上重复学习，相当于放大权重，易在训练集上虚高。若重复来自真实业务（如多次点击），则需保留并改用聚合特征等方式处理。',
  class_imbalance:
    '类别极不均衡时，模型默认损失更偏向多数类，少数类召回往往偏低。scale_pos_weight、重采样、或调整评估指标（F1、AUC）都是常见对策。',
  high_cardinality:
    '高基数类别指取值种类很多（如姓名、ID）。One-Hot 会产生海量稀疏列；对 XGBoost 常用有序或无序的标签编码，让树在「整数编码」上学习切分，兼顾效率与效果。',
}

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
  const setWorkflowStep = useAppStore(s => s.setWorkflowStep)

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
  const activeModelId = useAppStore(s => s.activeModelId)

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
  const nextButtonRef = useRef<HTMLButtonElement | null>(null)

  // ── Lab 参数实验（E4: 状态移至独立 ParamLabModal 组件）────────────────────
  const [labOpen, setLabOpen] = useState(false)

  const [automlRunning, setAutomlRunning] = useState(false)
  const [automlFast, setAutomlFast] = useState(false)
  const [automlSmartClean, setAutomlSmartClean] = useState(true)
  const [automlTrials, setAutomlTrials] = useState(12)
  const [automlLines, setAutomlLines] = useState<string[]>([])
  const [automlResult, setAutomlResult] = useState<AutoMLJobResult | null>(null)
  const automlEsRef = useRef<EventSource | null>(null)

  const showTeaching = showTeachingUi(workflowMode)

  // D1: 同步 currentStep 到全局 store
  useEffect(() => {
    setWorkflowStep(currentStep)
  }, [currentStep, setWorkflowStep])

  // ── sessionStorage 持久化：离开页面再回来时恢复训练状态 ───────────────────
  const SESSION_KEY = 'xgbs_workflow_state'

  /** 从 localStorage 恢复向导状态（供挂载时与模式切换时复用） */
  const restoreFromStorage = () => {
    try {
      const saved = localStorage.getItem(SESSION_KEY)
      if (!saved) return
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
      if (s.selectedDatasetId !== undefined) {
        setSelectedDatasetId(s.selectedDatasetId)
        if (s.selectedDatasetId) setActiveDatasetId(s.selectedDatasetId)
      }
      if (s.targetColumn) setTargetColumn(s.targetColumn)
      if (s.selectedSplitId !== undefined) {
        setSelectedSplitId(s.selectedSplitId)
        if (s.selectedSplitId) setActiveSplitId(s.selectedSplitId)
      }
      if (s.splitInfo !== undefined) setSplitInfo(s.splitInfo)
      if (s.pipelineResult !== undefined) {
        setPipelineResult(s.pipelineResult)
        if (s.pipelineResult?.model_id) setActiveModelId(s.pipelineResult.model_id)
      }
      if (s.pipelinePercent !== undefined) setPipelinePercent(s.pipelinePercent)
      if (s.paramValues && Object.keys(s.paramValues).length > 0) setParamValues(s.paramValues)
    } catch { /* 静默忽略反序列化错误 */ }
  }

  // 当 workflowMode 从其他模式切换到向导模式时（组件已挂载的场景），重新恢复状态
  const prevWorkflowModeRef = useRef(workflowMode)
  useEffect(() => {
    if (prevWorkflowModeRef.current !== 'guided' && workflowMode === 'guided') {
      restoreFromStorage()
    }
    prevWorkflowModeRef.current = workflowMode
  }, [workflowMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // 组件初次挂载时从 localStorage 恢复
  useEffect(() => {
    restoreFromStorage()
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

  // 每一步完成后自动聚焦到下一步按钮
  useEffect(() => {
    // 延时等待渲染完成后再聚焦
    setTimeout(() => {
      if (nextButtonRef.current) {
        nextButtonRef.current.focus()
      }
    }, 100)
  }, [currentStep])

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

  useEffect(() => {
    return () => {
      automlEsRef.current?.close()
      automlEsRef.current = null
    }
  }, [])

  const runFullAutoML = () => {
    if (!selectedDatasetId) {
      message.warning('请先选择数据集')
      return
    }
    automlEsRef.current?.close()
    setAutomlRunning(true)
    setAutomlLines([])
    setAutomlResult(null)
    void (async () => {
      try {
        const { job_id } = await startAutoMLJob({
          dataset_id: selectedDatasetId,
          skip_tuning: automlFast,
          max_tuning_trials: automlFast ? 0 : automlTrials,
          smart_clean: automlSmartClean,
        })
        const es = new EventSource(`${BASE_URL}/api/automl/jobs/${job_id}/progress`)
        automlEsRef.current = es
        es.onmessage = (ev: MessageEvent) => {
          try {
            const j = JSON.parse(ev.data) as { error?: string; step?: string; message?: string }
            if (j.error) {
              message.error(j.error)
              return
            }
            const line = j.message
              ? `${j.step ? `[${j.step}] ` : ''}${j.message}`
              : (j.step ? `[${j.step}]` : '')
            if (line) setAutomlLines(prev => [...prev, line])
          } catch {
            if (ev.data) setAutomlLines(prev => [...prev, ev.data])
          }
        }
        es.addEventListener('done', () => {
          es.close()
          automlEsRef.current = null
          void (async () => {
            try {
              const res = await getAutoMLJobResult(job_id)
              setAutomlResult(res)
              setTargetColumn(res.target_column)
              setSelectedSplitId(res.split_id)
              setActiveSplitId(res.split_id)
              setActiveDatasetId(res.dataset_id)
              const ds = datasets.find(d => d.id === res.dataset_id)
              if (ds) setActiveDatasetName(ds.name)
              const spList = await apiClient.get<Array<{ id: number; train_rows: number; test_rows: number }>>('/api/datasets/splits/list')
              const row = spList.data.find(x => x.id === res.split_id)
              if (row) setSplitInfo({ train_rows: row.train_rows, test_rows: row.test_rows })
              const best = res.candidates.find(c => c.model_id === res.chosen_recommendation.model_id)
              setActiveModelId(res.chosen_recommendation.model_id)
              setPipelineResult({
                type: 'done',
                model_id: res.chosen_recommendation.model_id,
                report_id: null,
                metrics: (best?.metrics ?? {}) as Record<string, unknown>,
                natural_summary:
                  `全自动建模完成。系统推荐：${res.chosen_recommendation.name}。${res.chosen_recommendation.reason}`,
              })
              try {
                const s = await getDatasetSummary(res.dataset_id)
                setSummary(s)
              } catch { /* 忽略 */ }
              message.success('全自动建模完成，可查看候选模型或前往「结果总结」')
            } catch (e) {
              message.error(e instanceof Error ? e.message : '获取建模结果失败')
            } finally {
              setAutomlRunning(false)
            }
          })()
        })
        es.onerror = () => {
          es.close()
          automlEsRef.current = null
          setAutomlRunning(false)
          message.error('全自动建模连接中断')
        }
      } catch (e) {
        setAutomlRunning(false)
        message.error(e instanceof Error ? e.message : '无法启动全自动建模')
      }
    })()
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
    setLabOpen(true)
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

  /** 业务向导：一键抑制过拟合的启发式调参（非全局最优搜索；每点一次迈一小步并重跑全流程） */
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

    // 略降行/列采样比例，增加每棵树的随机性，常见做法有利于缓解过拟合（此前误设为增大 subsample）
    const sub = Number(adjusted.subsample)
    const newSub = Math.max(0.5, parseFloat((sub - 0.05).toFixed(2)))
    if (newSub !== sub) {
      adjusted.subsample = newSub
      changes.push(`subsample ${sub}→${newSub}`)
    }

    const col = Number(adjusted.colsample_bytree)
    if (!Number.isNaN(col)) {
      const newCol = Math.max(0.5, parseFloat((col - 0.05).toFixed(2)))
      if (newCol !== col) {
        adjusted.colsample_bytree = newCol
        changes.push(`colsample_bytree ${col}→${newCol}`)
      }
    }

    const mcw = Number(adjusted.min_child_weight)
    if (!Number.isNaN(mcw)) {
      const newMcw = Math.min(20, Math.round(mcw + 1))
      if (newMcw !== mcw) {
        adjusted.min_child_weight = newMcw
        changes.push(`min_child_weight ${mcw}→${newMcw}`)
      }
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
      message.success('已恢复均衡智能推荐参数')
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
    { title: '参数配置' },
    { title: '一键训练', icon: <RocketOutlined /> },
    { title: '结果总结', icon: <CheckCircleOutlined /> },
  ]

  return (
    <div style={{ padding: '24px', maxWidth: 960, margin: '0 auto' }}>
      {/* D3: 模式说明 Banner */}
      {workflowMode === 'guided' && (
        <Alert
          type="info"
          showIcon
          message="智能向导工作台"
          description="本页即侧栏「向导工作台」：6 步全程引导，自动推荐配置。已默认开启与「调优」相同的参数教学卡片、预处理说明展开与参数实验，无需切换即可查看算法直觉与过拟合风险。划分完成后若只需侧栏训练/调优链路，可切换到「调优」；全模块与主模型深度分析请用「专家」。"
          style={{ marginBottom: 16 }}
          closable
        />
      )}
      {workflowMode === 'learning' && (
        <Alert
          type="success"
          showIcon
          icon={<BookOutlined />}
          message="模型调优模式"
          description="与向导相同，默认展示参数教学卡片与概念解释；侧栏聚焦训练、超参调优与模型管理。"
          style={{ marginBottom: 16 }}
          closable
        />
      )}

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
          {showTeaching && (
            <Collapse
              size="small"
              ghost
              style={{ marginBottom: 16 }}
              items={[{
                key: 'step0-learn',
                label: <Text style={{ color: '#93c5fd', fontSize: 13 }}>📚 学习指引：本步在做什么？</Text>,
                children: (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#94a3b8', lineHeight: 1.65 }}>
                    <li>选中的数据集会同步到<strong>顶栏</strong>，后续训练出的模型也会归在该数据集下，便于筛选「主模型」。</li>
                    <li>进入下一步后，会看到<strong>质量评分、任务类型提示、AI 预处理建议</strong>；与旧「学习/调优」模式相同，均可展开阅读原理说明。</li>
                    <li>若暂无数据，请切换到顶部<strong>「数据处理」</strong>模式，在侧栏<strong>「数据工作台」</strong>上传后再回到本向导。</li>
                  </ul>
                ),
              }]}
            />
          )}
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
            <Alert type="info" message="您还没有上传数据集，请先前往「数据工作台」页面上传数据。" />
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
                    <br />
                    <Text type="secondary" style={{ fontSize: 12, marginTop: 6, display: 'inline-block' }}>
                      缺失 {(summary.missing_rate * 100).toFixed(1)}% · 异常 {(summary.outlier_rate * 100).toFixed(1)}% ·
                      重复行 {(summary.duplicate_rate * 100).toFixed(1)}%
                    </Text>
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
            ref={nextButtonRef}
            autoFocus
          >
            下一步：查看数据分析
          </Button>

          {selectedDatasetId && summary && (
            <Card title="全自动建模（一键完成）" style={{ marginTop: 20 }} size="small">
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="在时间与试验预算内自动完成目标推荐、划分、多候选训练与排序。"
                description="结果为启发式推荐（含过拟合风险提示），不保证全局最优。完成后仍可使用上方「分步引导」微调流程。"
              />
              <Space wrap style={{ marginBottom: 12 }}>
                <Tooltip title="与命令行 AutoML 一致：按阈值自动去重、数值中位数/类别众数填缺失、异常率偏高时 IQR 截断；写入数据集的预处理审计，报告 PDF 可见">
                  <Space>
                    <Switch checked={automlSmartClean} onChange={setAutomlSmartClean} disabled={automlRunning} />
                    <Text>智能清洗（推荐）</Text>
                  </Space>
                </Tooltip>
                <Tooltip title="跳过 Optuna 轻量搜索，仅训练「规则基线」与「保守正则」两个模型">
                  <Space>
                    <Switch checked={automlFast} onChange={setAutomlFast} disabled={automlRunning} />
                    <Text>快速模式（跳过调优）</Text>
                  </Space>
                </Tooltip>
                {!automlFast && (
                  <Space align="center">
                    <Text type="secondary">调优试验次数</Text>
                    <InputNumber min={3} max={50} value={automlTrials} disabled={automlRunning}
                      onChange={v => setAutomlTrials(typeof v === 'number' ? v : 12)} />
                  </Space>
                )}
              </Space>
              <Button
                type="primary"
                icon={<RocketOutlined />}
                loading={automlRunning}
                onClick={runFullAutoML}
                size="large"
              >
                开始全自动建模
              </Button>
              {automlLines.length > 0 && (
                <div style={{
                  marginTop: 12, maxHeight: 180, overflow: 'auto', fontSize: 12, color: '#94a3b8',
                  background: '#0f172a', padding: 8, borderRadius: 4, fontFamily: 'monospace',
                }}
                >
                  {automlLines.map((l, i) => <div key={i}>{l}</div>)}
                </div>
              )}
              {automlResult && (
                <>
                  {automlResult.pipeline_plan && (
                    <Collapse
                      size="small"
                      style={{ marginBottom: 12 }}
                      items={[{
                        key: 'pipeline_plan',
                        label: '流水线策略摘要（与 CLI / 报告预处理审计同源）',
                        children: (
                          <pre style={{
                            fontSize: 11, margin: 0, whiteSpace: 'pre-wrap',
                            color: '#94a3b8', fontFamily: 'monospace',
                          }}
                          >
                            {JSON.stringify(automlResult.pipeline_plan, null, 2)}
                          </pre>
                        ),
                      }]}
                    />
                  )}
                  <Divider orientation="left">候选模型（可选主模型）</Divider>
                  {automlResult.warnings?.length ? (
                    <Alert type="warning" showIcon style={{ marginBottom: 8 }} message={automlResult.warnings.join(' ')} />
                  ) : null}
                  <Radio.Group
                    value={activeModelId ?? undefined}
                    onChange={e => {
                      const mid = e.target.value as number
                      setActiveModelId(mid)
                      const c = automlResult.candidates.find(x => x.model_id === mid)
                      if (c) {
                        setPipelineResult({
                          type: 'done',
                          model_id: mid,
                          report_id: null,
                          metrics: c.metrics as Record<string, unknown>,
                          natural_summary: `已选择模型：${c.name}。${c.rationale}`,
                        })
                      }
                    }}
                  >
                    <Space direction="vertical" style={{ width: '100%' }}>
                      {automlResult.candidates.map(c => (
                        <Radio key={c.model_id} value={c.model_id} style={{ alignItems: 'flex-start' }}>
                          <div>
                            <Text strong>{c.name}</Text>
                            <div style={{ fontSize: 12, color: '#94a3b8' }}>
                              {c.task_type === 'classification'
                                ? `AUC ${(c.metrics as { auc?: number }).auc ?? '—'} · 准确率 ${(c.metrics as { accuracy?: number }).accuracy ?? '—'} · 过拟合 ${c.overfitting_level ?? '—'}`
                                : `RMSE ${(c.metrics as { rmse?: number }).rmse ?? '—'} · R² ${(c.metrics as { r2?: number }).r2 ?? '—'} · 过拟合 ${c.overfitting_level ?? '—'}`}
                            </div>
                            <div style={{ fontSize: 11, color: '#64748b' }}>{c.rationale}</div>
                          </div>
                        </Radio>
                      ))}
                    </Space>
                  </Radio.Group>
                  <Button type="default" style={{ marginTop: 12 }} onClick={() => setCurrentStep(5)}>
                    前往结果总结
                  </Button>
                </>
              )}
            </Card>
          )}
        </Card>
      )}

      {/* ── Step 1: 数据分析 & 智能推荐预处理 ── */}
      {currentStep === 1 && summary && (
        <Card title="Step 1：数据分析 & 智能推荐预处理">
          <Row gutter={24} style={{ marginBottom: 16 }}>
            <Col span={4}><Statistic title="样本数" value={summary.n_rows} /></Col>
            <Col span={4}><Statistic title="特征数" value={summary.n_cols} /></Col>
            <Col span={4}>
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
            <Col span={4}><Statistic title="缺失率" value={`${(summary.missing_rate * 100).toFixed(1)}%`} /></Col>
            <Col span={4}><Statistic title="异常率" value={`${(summary.outlier_rate * 100).toFixed(1)}%`} /></Col>
            <Col span={4}><Statistic title="重复行" value={`${(summary.duplicate_rate * 100).toFixed(1)}%`} /></Col>
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

          {showTeaching && (
            <Collapse
              size="small"
              ghost
              style={{ marginBottom: 16 }}
              defaultActiveKey={['step1-learn']}
              items={[{
                key: 'step1-learn',
                label: <Text style={{ color: '#93c5fd', fontSize: 13 }}>📚 知识辅助：如何阅读「数据分析与预处理」</Text>,
                children: (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#94a3b8', lineHeight: 1.65 }}>
                    <li><strong>质量评分</strong>：与数据工作台一致，综合缺失率、异常率、重复行等给出的健康度；低于 70 时建议优先按下方 AI 建议处理再划分。</li>
                    <li><strong>任务类型 / 目标列</strong>：若提示「未设置目标列」，属正常——在下一步「数据划分」里选定要预测的列后，类型与互信息图会更准确。</li>
                    <li><strong>每条 AI 建议卡片</strong>：除「推荐操作 / 预期改善 / 风险」外，请展开<strong>「深入了解」</strong>阅读建模背景（与调优模式一致）。</li>
                    <li><strong>名词速查</strong>：<em>高基数</em>＝类别取值种类很多；<em>缺失</em>＝该列部分样本无值；<em>类别不平衡</em>＝正负样本数量悬殊。</li>
                  </ul>
                ),
              }]}
            />
          )}

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
                const tagContent = s.severity === 'error' ? '严重' : s.severity === 'warning' ? '建议' : <BulbOutlined />
                return (
                  <Card
                    key={i}
                    size="small"
                    style={{ marginBottom: 10, borderLeft: `4px solid ${borderColor}` }}
                    title={<Space><Tag color={tagColor}>{tagContent}</Tag><span>{s.title}</span></Space>}
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
                      {showTeaching && (
                        <Collapse
                          size="small"
                          ghost
                          items={[{
                            key: 'why',
                            label: <Typography.Text style={{ color: '#a78bfa', fontSize: 12 }}>📖 深入了解：为什么需要关注这条建议？</Typography.Text>,
                            children: (
                              <Typography.Paragraph style={{ fontSize: 13, marginBottom: 0, color: '#cbd5e1' }}>
                                {(s.learn_why && s.learn_why.trim()) || PREPROCESS_LEARN_FALLBACK[s.type]
                                  || '该提示来自对数据分布的自动检测，是否采纳请结合业务含义；不确定时可先应用再观察下一步指标变化。'}
                              </Typography.Paragraph>
                            ),
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
            <Button
              type="primary"
              onClick={() => setCurrentStep(2)}
              ref={nextButtonRef}
              autoFocus
            >
              {preprocessSuggestions.length === 0 ? '下一步：确认目标列' : '继续：确认目标列'}
            </Button>
          </Space>
        </Card>
      )}

      {/* ── Step 2: 确认目标列 & 数据划分 ── */}
      {currentStep === 2 && summary && (
        <Card title="Step 2：确认目标列 & 数据划分">
          {showTeaching && (
            <Collapse
              size="small"
              ghost
              style={{ marginBottom: 16 }}
              items={[{
                key: 'step2-learn',
                label: <Text style={{ color: '#93c5fd', fontSize: 13 }}>📚 学习指引：目标列、互信息与划分</Text>,
                children: (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#94a3b8', lineHeight: 1.65 }}>
                    <li><strong>目标列</strong>：即希望模型预测的字段（如「是否存活」「房价」）；选错会导致任务类型与指标含义全错。</li>
                    <li><strong>互信息条形图</strong>：在已选目标下，粗略表示各特征与目标的统计关联强度，便于理解「模型可能更依赖谁」（非因果）。</li>
                    <li><strong>训练/测试划分</strong>：测试集用于估计泛化能力，应尽量避免泄露；小样本时可适当增大训练占比或后续做交叉验证。</li>
                    <li>完成后顶栏可配合选择<strong>主模型</strong>；仅会列出当前数据集下训练出的模型。</li>
                  </ul>
                ),
              }]}
            />
          )}
          {/* 目标列选择 */}
          <div style={{ marginBottom: 24 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
              目标列（要预测的列）
              {summary.candidate_targets?.length > 0 && (
                <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                  — 智能推荐：{summary.candidate_targets[0]?.col}（{summary.candidate_targets[0]?.reason}）
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
              ref={nextButtonRef}
              autoFocus
            >
              下一步：智能参数推荐
            </Button>
          </Space>
        </Card>
      )}

      {/* ── Step 3: 参数配置 ── */}
      {currentStep === 3 && (
        <Card title="Step 3：参数配置（已根据数据智能推荐参数）">
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
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', whiteSpace: 'nowrap' }}>基于数据的智能推荐，绝大多数场景首选</Typography.Text>
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
              message="智能推荐说明"
              description={<ul style={{ margin: 0, paddingLeft: 20 }}>{configNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          {showTeaching && (
            <>
              <Alert
                type="info"
                icon={<BookOutlined />}
                message="参数教学：点击每个参数右侧的 ❓ 了解说明，展开「学习此参数」深入理解原理"
                showIcon
                style={{ marginBottom: 12 }}
              />
              <Collapse
                size="small"
                ghost
                style={{ marginBottom: 16 }}
                items={[{
                  key: 'step3-learn',
                  label: <Text style={{ color: '#93c5fd', fontSize: 13 }}>📚 学习路径：三个方案与参数实验</Text>,
                  children: (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#94a3b8', lineHeight: 1.65 }}>
                      <li><strong>快速 / 均衡 / 深度</strong>：由保守到更强拟合能力，训练时间通常递增；不确定时优先「均衡推荐」。</li>
                      <li>每个滑块旁的<strong>过拟合风险提示</strong>与「学习此参数」卡片，与模型调优模式共用同一套教学内容。</li>
                      <li><strong>参数实验</strong>：可固定数据划分，对比两组参数训练结果，直观感受调参对指标的影响。</li>
                    </ul>
                  ),
                }]}
              />
            </>
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
            {showTeaching && (
              <Button
                icon={<ExperimentOutlined />}
                onClick={openLab}
                disabled={!selectedSplitId}
              >
                ⚗️ 参数实验
              </Button>
            )}
            <Button
              type="primary"
              size="large"
              icon={<RocketOutlined />}
              onClick={() => setCurrentStep(4)}
              ref={nextButtonRef}
              autoFocus
            >
              下一步：开始训练
            </Button>
          </Space>
        </Card>
      )}

      {/* ── Step 4: 一键训练 ── */}
      {currentStep === 4 && (
        <Card title="一键训练 → 评估 → 报告">
          {showTeaching && (
            <Alert
              type="info"
              showIcon
              icon={<BookOutlined />}
              message="学习提示：一键链路里会发生什么？"
              description={
                <span style={{ fontSize: 13, color: '#94a3b8' }}>
                  系统将按顺序完成<strong>训练 → 在划分出的测试集上评估 → 生成报告草稿</strong>。日志中的进度条与文案可与上一步「参数教学」卡片对照理解；
                  训练结束后在结果页可查看过拟合提示；需要对比实验可返回上一步使用<strong>参数实验</strong>。
                </span>
              }
              style={{ marginBottom: 16 }}
            />
          )}
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
            description={
              <div>
                {pipelineResult.natural_summary && (
                  <Paragraph style={{ marginBottom: 8 }}>{pipelineResult.natural_summary}</Paragraph>
                )}
                {(overfittingLevel === 'high' || overfittingLevel === 'medium') && (
                  <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 13 }}>
                    <strong>与下方黄色提示同时出现并不矛盾：</strong>
                    绿色标签表示在当前验证集上主指标表现好；黄色表示模型在训练集上更「顺手」、与验证集差距偏大，
                    未来遇到<strong>全新数据</strong>时效果可能打折扣。是否接受需结合业务容忍度；若希望更稳妥，可用一键按钮自动收紧模型后再看指标。
                  </Paragraph>
                )}
              </div>
            }
            showIcon
            style={{ marginBottom: 24 }}
          />

          {showTeaching && (
            <Collapse
              size="small"
              ghost
              style={{ marginBottom: 16 }}
              items={[{
                key: 'step5-learn',
                label: <Text style={{ color: '#93c5fd', fontSize: 13 }}>📚 如何理解本页指标与过拟合提示？</Text>,
                children: (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#94a3b8', lineHeight: 1.65 }}>
                    <li><strong>主指标</strong>（如 AUC、R²）反映在当前划分测试集上的表现；绿色「优秀」不等于部署后一定同等水平。</li>
                    <li><strong>过拟合提示</strong>：比较训练与验证差距；可与上一步参数教学中的「正则 / 树深」建议对照，或使用「一键抑制过拟合」做保守重训。</li>
                    <li>需要 SHAP、稳定性等深度分析时，可使用「切换到专家模式继续分析」。</li>
                  </ul>
                ),
              }]}
            />
          )}

          {(overfittingLevel === 'high' || overfittingLevel === 'medium') && (
            <Alert
              type="warning"
              showIcon
              message={overfittingLevel === 'high' ? '泛化风险提示（训练/验证差距偏大）' : '泛化风险提示（轻度训练/验证差距）'}
              description={
                <div>
                  <p style={{ margin: '4px 0 8px' }}>
                    {overfittingLevel === 'high'
                      ? '模型在已见过的训练样本上明显更准，但在验证集上误差更大，部署到新数据时风险更高。'
                      : '训练集与验证集表现已有一定落差，属于常见现象；若业务对稳定性要求高，建议再收敛一版。'}
                  </p>
                  <p style={{ margin: '0 0 8px' }}>
                    <strong>无需自己改参数：</strong>点击下方「一键抑制过拟合并重训」，系统会按规则自动微调复杂度与正则，并<strong>完整重跑</strong>一键训练流程。
                    通常<strong>1～3 次</strong>内告警会减弱或消失，但<strong>不保证</strong>一定清零；若主指标明显下降，可在专家模式里细调或保留当前「高精度但略冒进」的模型。
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: 'rgba(0,0,0,0.65)' }}>
                    （技术说明：后台用验证集与训练集误差比值判断等级；这不是「模型坏了」，而是提醒您关注换数据后的表现。）
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
                      <Statistic title={k.toUpperCase()} value={typeof v === 'number' ? v.toFixed(4) : String(v)} />
                    </Col>
                  ))}
                </Row>
              )}
              {secondaryEntries.length > 0 && (
                <Row gutter={16} style={{ marginBottom: 24 }}>
                  {secondaryEntries.map(([k, v]) => (
                    <Col key={k} span={6}>
                      <Statistic title={k.toUpperCase()} value={typeof v === 'number' ? v.toFixed(4) : String(v)}
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
            <Button
              type="default"
              icon={<ToolOutlined />}
              onClick={() => {
                // D4: 切换到专家模式，携带全局状态跳转 model-eval
                setWorkflowMode('expert')
                window.dispatchEvent(new CustomEvent('navigate', { detail: 'model-eval' }))
              }}
              style={{ borderColor: '#22c55e', color: '#22c55e' }}
            >
              切换到专家模式继续分析
            </Button>
            {(overfittingLevel === 'high' || overfittingLevel === 'medium') && (
              <>
                <Tooltip
                  title="自动略减树深、加强正则、略降采样比例并重训整链；每次一小步，可重复点击。不替代全自动超参搜索。"
                >
                  <Button
                    icon={<ThunderboltOutlined />}
                    style={{ background: '#fa8c16', borderColor: '#fa8c16', color: '#fff' }}
                    onClick={handleOptimizeAndRetrain}
                    disabled={!selectedSplitId || pipelineRunning}
                  >
                    一键抑制过拟合并重训
                  </Button>
                </Tooltip>
                <Tooltip title="在可接受范围内加大容量与学习轮数，可能提升主指标，也可能放大训练/验证差距；仍会完整重跑流程。">
                  <Button
                    icon={<RocketOutlined />}
                    style={{ background: '#7c3aed', borderColor: '#7c3aed', color: '#fff' }}
                    onClick={handleOptimizeForAccuracy}
                    disabled={!selectedSplitId || pipelineRunning}
                  >
                    追求更高主指标并重训
                  </Button>
                </Tooltip>
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
      {/* ── Lab 参数实验 Modal（E4: 已提取为独立组件）── */}
      <ParamLabModal
        open={labOpen}
        onClose={() => setLabOpen(false)}
        splitId={selectedSplitId}
        paramValues={paramValues}
        onApplyParams={(newParams: Record<string, number | string>) => setParamValues(newParams)}
      />

    </div>
  )
}

export default SmartWorkflow
