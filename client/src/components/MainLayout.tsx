import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Layout, Menu, Typography, Tooltip, Button, Tag, Space, Alert, Modal, Input, message, Select } from 'antd'
import type { MenuProps } from 'antd'
import {
  DatabaseOutlined,
  BarChartOutlined,
  ToolOutlined,
  SettingOutlined,
  PlayCircleOutlined,
  LineChartOutlined,
  ThunderboltOutlined,
  AppstoreOutlined,
  FileTextOutlined,
  RocketOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  CompassOutlined,
  ScissorOutlined,
  RobotOutlined,
  SearchOutlined,
  HomeOutlined,
  ReadOutlined,
} from '@ant-design/icons'
import { useAppStore, type WorkflowMode } from '../store/appStore'
import apiClient from '../api/client'
import ModeSwitcher from './ModeSwitcher'
import ModeTransitionModal from './ModeTransitionModal'
import ModeOnboardingModal from './ModeOnboardingModal'
import HelpButton from './HelpButton'
import { getStaticPageHelp } from '../constants/pageHelp'

// 页面懒加载
import DataImportPage from '../pages/DataImport'
import FeatureAnalysisPage from '../pages/FeatureAnalysis'
import FeatureEngineeringPage from '../pages/FeatureEngineering'
import ParamConfigPage from '../pages/ParamConfig'
import ModelTrainingPage from '../pages/ModelTraining'
import ModelEvalPage from '../pages/ModelEval'
import ModelTuningPage from '../pages/ModelTuning'
import ModelManagementPage from '../pages/ModelManagement'
import ReportPage from '../pages/Report'
import PredictionPage from '../pages/Prediction'
import SmartWorkflowPage from '../pages/SmartWorkflow'
import WelcomePage from '../pages/Welcome'
import ExpertWorkbenchPage from '../pages/ExpertWorkbench'
import LearningWorkbenchPage from '../pages/LearningWorkbench'
import DocumentationPage from '../pages/Documentation'

const { Sider, Content, Header } = Layout
const { Text } = Typography

/** 顶栏主模型下拉与 /api/models 对齐的轻量行类型 */
type ExpertModelRow = { id: number; name: string }

/** 专家顶栏对比集合：主模型 + 对比模型，总数上限与报告页「对比模型」规模一致 */
const MAX_EXPERT_COMPARE_MODEL_IDS = 8
const MAX_EXPERT_COMPARE_EXTRAS = MAX_EXPERT_COMPARE_MODEL_IDS - 1

/** 顶栏训练划分下拉（与 GET /api/datasets/splits/list 对齐） */
type HeaderSplitRow = {
  id: number
  dataset_id: number
  dataset_name: string
  train_rows: number | null
  test_rows: number | null
  created_at: string | null
}

export type PageKey =
  | 'welcome'
  | 'documentation'
  | 'expert-hub'
  | 'learning-hub'
  | 'smart-workflow'
  | 'data-import'
  | 'feature-analysis'
  | 'feature-engineering'
  | 'param-config'
  | 'model-training'
  | 'model-eval'
  | 'model-tuning'
  | 'model-management'
  | 'report'
  | 'prediction'

// 页面操作顺序（专家模式推荐流程）
const pageOrder: PageKey[] = [
  'data-import',
  'feature-analysis',
  'feature-engineering',
  'param-config',
  'model-training',
  'model-eval',
  'model-tuning',
  'model-management',
  'report',
  'prediction',
]

// 定义页面依赖关系
const pageCompletion: Record<PageKey, (state: {
  activeDatasetId: number | null
  activeSplitId: number | null
  activeModelId: number | null
}) => boolean> = {
  welcome: () => true,
  documentation: () => true,
  'expert-hub': () => true,
  'learning-hub': () => true,
  'smart-workflow': () => true,
  'data-import': s => s.activeDatasetId !== null,
  'feature-analysis': s => s.activeDatasetId !== null,
  'feature-engineering': s => s.activeSplitId !== null,
  'param-config': s => s.activeSplitId !== null,
  'model-training': s => s.activeSplitId !== null,
  'model-eval': s => s.activeModelId !== null,
  'model-tuning': s => s.activeModelId !== null,
  'model-management': s => s.activeModelId !== null,
  report: s => s.activeModelId !== null,
  prediction: s => s.activeModelId !== null,
}

const pageLabels: Partial<Record<PageKey, string>> = {
  documentation: '产品文档',
  'data-import': '数据工作台',
  'feature-analysis': '特征分析',
  'feature-engineering': '特征工程',
  'param-config': '参数配置',
  'model-training': '模型训练',
  'model-eval': '模型评估',
  'model-tuning': '超参数调优',
  'model-management': '模型管理',
  report: '分析报告',
  prediction: '交互预测',
}

/** 智能向导侧栏仅含工作台；在此页外切换侧栏目标时弹出「暂离向导」 */
const GUIDED_MODULE_PAGE_KEYS: PageKey[] = ['smart-workflow']

/** 数据处理模式侧栏页面；离开去其他模块时弹出确认 */
const PREPROCESS_MODULE_PAGE_KEYS: PageKey[] = [
  'data-import',
  'feature-analysis',
  'feature-engineering',
]

/** 从数据处理离开到其他功能页时，应同步切换的顶栏模式 */
function workflowModeForPageKey(pageKey: PageKey): WorkflowMode {
  if (
    ['learning-hub', 'param-config', 'model-training', 'model-tuning', 'model-management'].includes(
      pageKey,
    )
  ) {
    return 'learning'
  }
  if (pageKey === 'smart-workflow') return 'guided'
  if (['expert-hub', 'model-eval', 'report', 'prediction'].includes(pageKey)) return 'expert'
  if (PREPROCESS_MODULE_PAGE_KEYS.includes(pageKey)) return 'preprocess'
  return 'guided'
}

/** 专家分析模式不提供：数据处理页、向导工作台、训练与超参相关页 */
const EXPERT_NAV_EXCLUDED_PAGE_KEYS: PageKey[] = [
  ...PREPROCESS_MODULE_PAGE_KEYS,
  'smart-workflow',
  'learning-hub',
  'param-config',
  'model-training',
  'model-tuning',
]

// ── 数据处理模式菜单 ─────────────────────────────────────────────────────────
const buildPreprocessMenu = (): MenuProps['items'] => [
  { key: 'data-import', icon: <DatabaseOutlined />, label: '数据工作台' },
  { type: 'divider' },
  { key: 'feature-analysis', icon: <BarChartOutlined />, label: '特征分析' },
  { key: 'feature-engineering', icon: <ToolOutlined />, label: '特征工程' },
]

// ── 智能向导模式菜单（仅六步工作台）────────────────────────────────────────────
const buildGuidedMenu = (): MenuProps['items'] => [
  { key: 'smart-workflow', icon: <CompassOutlined />, label: '向导工作台' },
]

// ── 模型调优模式菜单（工作台与四项子模块之间含 divider，与专家/向导一致）──────────────
const buildLearningMenu = (): MenuProps['items'] => [
  { key: 'learning-hub', icon: <HomeOutlined />, label: '调优工作台' },
  { type: 'divider' },
  { key: 'param-config', icon: <SettingOutlined />, label: '参数配置' },
  { key: 'model-training', icon: <PlayCircleOutlined />, label: '模型训练' },
  { key: 'model-tuning', icon: <ThunderboltOutlined />, label: '超参数调优' },
  { key: 'model-management', icon: <AppstoreOutlined />, label: '模型管理' },
]

// ── 专家分析模式菜单（不含训练与超参调优）──────────────────────────────────────
const buildExpertMenu = (): MenuProps['items'] => [
  {
    key: 'expert-hub',
    icon: <HomeOutlined />,
    label: '模型工作台',
  },
  { type: 'divider' },
  { key: 'model-eval', icon: <LineChartOutlined />, label: '模型评估' },
  { key: 'model-management', icon: <AppstoreOutlined />, label: '模型管理' },
  { key: 'report', icon: <FileTextOutlined />, label: '分析报告' },
  { key: 'prediction', icon: <RocketOutlined />, label: '交互预测' },
]

const pageMap: Record<PageKey, React.ReactNode> = {
  welcome: <WelcomePage />,
  documentation: <DocumentationPage />,
  'expert-hub': <ExpertWorkbenchPage />,
  'learning-hub': <LearningWorkbenchPage />,
  'smart-workflow': <SmartWorkflowPage />,
  'data-import': <DataImportPage />,
  'feature-analysis': <FeatureAnalysisPage />,
  'feature-engineering': <FeatureEngineeringPage />,
  'param-config': <ParamConfigPage />,
  'model-training': <ModelTrainingPage />,
  'model-eval': <ModelEvalPage />,
  'model-tuning': <ModelTuningPage />,
  'model-management': <ModelManagementPage />,
  report: <ReportPage />,
  prediction: <PredictionPage />,
}

// 所有可搜索页面（用于 Ctrl+K 命令面板）
const searchablePages: { key: PageKey; label: string; group: string }[] = [
  { key: 'documentation', label: '产品文档', group: '帮助' },
  { key: 'expert-hub', label: '模型工作台', group: '入口' },
  { key: 'learning-hub', label: '调优工作台', group: '入口' },
  { key: 'smart-workflow', label: '向导工作台', group: '入口' },
  { key: 'data-import', label: '数据工作台', group: '数据处理' },
  { key: 'feature-analysis', label: '特征分析', group: '数据处理' },
  { key: 'feature-engineering', label: '特征工程', group: '数据处理' },
  { key: 'param-config', label: '超参数配置', group: '模型构建' },
  { key: 'model-training', label: '模型训练', group: '模型构建' },
  { key: 'model-eval', label: '模型评估', group: '模型优化' },
  { key: 'model-tuning', label: '超参数调优', group: '模型优化' },
  { key: 'model-management', label: '模型管理', group: '模型管理' },
  { key: 'report', label: '分析报告', group: '结果输出' },
  { key: 'prediction', label: '交互预测', group: '结果输出' },
]

function readInitialPageKey(): PageKey {
  try {
    if (!localStorage.getItem('xgb_launched_before')) return 'welcome'
    const m = localStorage.getItem('xgbs_workflow_mode')
    if (m === 'expert') return 'expert-hub'
    if (m === 'learning') return 'learning-hub'
    if (m === 'preprocess') return 'data-import'
    return 'smart-workflow'
  } catch {
    return 'smart-workflow'
  }
}

const MainLayout: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<PageKey>(readInitialPageKey)

  const {
    sidebarCollapsed,
    setSidebarCollapsed,
    toggleSidebar,
    activeDatasetName,
    activeDatasetId,
    activeSplitId,
    activeModelId,
    globalError,
    setGlobalError,
    serverReady,
    isOffline,
    workflowMode,
    setWorkflowMode,
    workflowStep,
    isTraining,
    modeFirstVisit,
    setActiveDatasetId,
    setActiveSplitId,
    setActiveModelId,
    setActiveDatasetName,
    expertCompareModelIds,
    setExpertCompareModelIds,
    pageHelpOverride,
  } = useAppStore()

  const pageHelpContent = useMemo(() => {
    if (currentPage === 'expert-hub' && pageHelpOverride) return pageHelpOverride
    return getStaticPageHelp(currentPage)
  }, [currentPage, pageHelpOverride])

  const goDocumentation = useCallback(() => {
    setCurrentPage('documentation')
    localStorage.setItem('xgb_launched_before', '1')
  }, [])

  // Ctrl+K 命令面板状态
  const [cmdOpen, setCmdOpen] = useState(false)
  const [cmdQuery, setCmdQuery] = useState('')
  const cmdInputRef = useRef<HTMLInputElement | null>(null)

  // 模式切换弹窗状态
  const [pendingMode, setPendingMode] = useState<WorkflowMode | null>(null)
  const [transitionOpen, setTransitionOpen] = useState(false)

  // 专家模式接管提示：用 message 浮层，避免与 Sider 并列参与 Layout 横向排版导致整页左挤
  const expertTakeoverShown = useRef(false)

  // 向导模式离开确认
  const [guidedLeaveTarget, setGuidedLeaveTarget] = useState<PageKey | null>(null)
  const [guidedLeaveOpen, setGuidedLeaveOpen] = useState(false)

  const [preprocessLeaveTarget, setPreprocessLeaveTarget] = useState<PageKey | null>(null)
  const [preprocessLeaveOpen, setPreprocessLeaveOpen] = useState(false)

  // 新手引导弹窗
  const [onboardingMode, setOnboardingMode] = useState<WorkflowMode | null>(null)

  /** 顶栏训练划分下拉 */
  const [headerSplits, setHeaderSplits] = useState<HeaderSplitRow[]>([])
  const [headerSplitsLoading, setHeaderSplitsLoading] = useState(false)

  /** 顶栏主模型下拉：按当前激活划分的 split_id 拉取 /api/models */
  const [expertModels, setExpertModels] = useState<ExpertModelRow[]>([])
  const [expertModelsLoading, setExpertModelsLoading] = useState(false)
  const [splitDropdownOpen, setSplitDropdownOpen] = useState(false)
  const [primaryModelDropdownOpen, setPrimaryModelDropdownOpen] = useState(false)
  const [compareModelDropdownOpen, setCompareModelDropdownOpen] = useState(false)

  const fetchHeaderSplits = useCallback(async () => {
    if (!serverReady) return
    setHeaderSplitsLoading(true)
    try {
      const r = await apiClient.get<HeaderSplitRow[]>('/api/datasets/splits/list')
      const list = Array.isArray(r.data) ? r.data : []
      setHeaderSplits(list)
    } catch {
      /* 顶栏静默失败；打开下拉时会再试 */
    } finally {
      setHeaderSplitsLoading(false)
    }
  }, [serverReady])

  useEffect(() => {
    if (serverReady) void fetchHeaderSplits()
  }, [serverReady, fetchHeaderSplits])

  const fetchPrimaryModelsForSplit = useCallback(async () => {
    if (!serverReady || activeSplitId === null) return
    setExpertModelsLoading(true)
    try {
      const r = await apiClient.get<ExpertModelRow[]>('/api/models', {
        params: { split_id: activeSplitId },
      })
      const list = Array.isArray(r.data) ? r.data : []
      setExpertModels(list)
      setActiveModelId(cur => (cur != null && !list.some(m => m.id === cur) ? null : cur))
    } catch {
      /* 顶栏静默失败；打开下拉时会再次请求 */
    } finally {
      setExpertModelsLoading(false)
    }
  }, [serverReady, activeSplitId, setActiveModelId])

  useEffect(() => {
    setPrimaryModelDropdownOpen(false)
    if (activeSplitId === null) {
      setExpertModels([])
      setActiveModelId(null)
      setExpertCompareModelIds([])
      return
    }
    if (!serverReady) return
    void fetchPrimaryModelsForSplit()
  }, [activeSplitId, serverReady, fetchPrimaryModelsForSplit, setActiveModelId, setExpertCompareModelIds])

  /** 当前划分下模型列表刷新后，裁剪无效的对比 ID，避免工作台请求幽灵模型 */
  useEffect(() => {
    if (workflowMode !== 'expert') return
    if (activeSplitId === null) return
    if (expertModelsLoading) return
    const cur = useAppStore.getState().expertCompareModelIds
    if (cur.length === 0) return
    const valid = new Set(expertModels.map(m => m.id))
    const filtered = cur.filter(id => valid.has(id))
    if (filtered.length === cur.length) return
    setExpertCompareModelIds(filtered.length >= 2 ? filtered : [])
  }, [expertModels, expertModelsLoading, activeSplitId, workflowMode, setExpertCompareModelIds])

  // 专家模式首次进入且有 activeModel → 顶部短时 message（不占布局）
  useEffect(() => {
    if (workflowMode === 'expert' && activeModelId && !expertTakeoverShown.current) {
      expertTakeoverShown.current = true
      const tip = `已接管向导进度：训练划分#${activeSplitId ?? '—'}${activeDatasetName ? `（${activeDatasetName}）` : ''} / 主模型#${activeModelId ?? '—'}`
      message.info({ content: tip, duration: 3 })
    }
    if (workflowMode !== 'expert') {
      expertTakeoverShown.current = false
    }
  }, [workflowMode, activeModelId, activeDatasetName, activeSplitId])

  // 新手引导：模式首次进入时弹窗
  useEffect(() => {
    if (modeFirstVisit[workflowMode]) {
      setOnboardingMode(workflowMode)
    }
  }, [workflowMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // 专家模式进入时展开侧边栏（菜单项多）；向导/模型调优模式不强制折叠，避免布局在模式间大幅跳动
  useEffect(() => {
    if (workflowMode === 'expert') {
      setSidebarCollapsed(false)
    }
  }, [workflowMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const urlBootstrapDone = useRef(false)
  const prevWorkflowMode = useRef(workflowMode)

  // 非专家 → 专家：若仍停留在向导模块页，则落到模型工作台
  useEffect(() => {
    const prev = prevWorkflowMode.current
    if (prev !== workflowMode && workflowMode === 'expert') {
      setCurrentPage(p => (EXPERT_NAV_EXCLUDED_PAGE_KEYS.includes(p) ? 'expert-hub' : p))
    }
    prevWorkflowMode.current = workflowMode
  }, [workflowMode])

  // 专家分析模式不承载数据准备与训练页：深链或 navigate 落到这些路由则回工作台
  useEffect(() => {
    if (workflowMode === 'expert' && EXPERT_NAV_EXCLUDED_PAGE_KEYS.includes(currentPage)) {
      setCurrentPage('expert-hub')
    }
  }, [workflowMode, currentPage])

  // CLI / 书签深链：datasetId、splitId、modelId(s)、primaryModelId、xsMode、xsPage（仅首次就绪时应用一次）
  useEffect(() => {
    if (!serverReady || urlBootstrapDone.current) return
    const params = new URLSearchParams(window.location.search)
    const ds = params.get('datasetId')
    const sp = params.get('splitId')
    const md = params.get('modelId')
    const pg = params.get('xsPage')
    const xsMode = params.get('xsMode')
    const midsRaw = params.get('modelIds')
    const pmdRaw = params.get('primaryModelId')
    if (!ds && !sp && !md && !pg && !xsMode && !midsRaw && !pmdRaw) return
    urlBootstrapDone.current = true

    const n = (s: string | null) => {
      if (s === null || s === '') return null
      const x = Number(s)
      return Number.isFinite(x) ? x : null
    }
    const parseIds = (s: string | null): number[] => {
      if (!s?.trim()) return []
      const seen = new Set<number>()
      const out: number[] = []
      for (const part of s.split(',')) {
        const x = Number(part.trim())
        if (Number.isFinite(x) && !seen.has(x)) {
          seen.add(x)
          out.push(x)
        }
      }
      return out
    }

    const did = n(ds)
    const sid = n(sp)
    const mid = n(md)
    const pmd = n(pmdRaw)
    let ids = parseIds(midsRaw)
    if (ids.length === 0 && mid !== null) ids = [mid]
    if (pmd !== null && !ids.includes(pmd)) ids = [pmd, ...ids]
    else if (ids.length === 0 && pmd !== null) ids = [pmd]

    const primary = pmd ?? mid ?? (ids[0] ?? null)

    const shouldSetExpertCompareIds =
      Boolean(midsRaw?.trim()) || xsMode === 'expert' || pg === 'expert-hub'

    if (did !== null) setActiveDatasetId(did)
    if (sid !== null) setActiveSplitId(sid)
    if (xsMode === 'expert') setWorkflowMode('expert')
    if (xsMode === 'preprocess') setWorkflowMode('preprocess')
    if (shouldSetExpertCompareIds && ids.length > 0) {
      setExpertCompareModelIds(ids)
      setActiveModelId(primary ?? ids[0])
    } else if (mid !== null) {
      setActiveModelId(mid)
    }

    if (pg && Object.prototype.hasOwnProperty.call(pageMap, pg)) {
      setCurrentPage(pg as PageKey)
      localStorage.setItem('xgb_launched_before', '1')
    }
    if (xsMode === 'preprocess') {
      setCurrentPage(p => (PREPROCESS_MODULE_PAGE_KEYS.includes(p) ? p : 'data-import'))
      localStorage.setItem('xgb_launched_before', '1')
    }
    if (did !== null) {
      void apiClient.get(`/api/datasets/${did}`).then(res => {
        const name = (res.data as { name?: string }).name
        if (name) setActiveDatasetName(name)
      }).catch(() => { /* 忽略 */ })
    }
    if (sid !== null && did === null) {
      void apiClient.get<HeaderSplitRow[]>('/api/datasets/splits/list').then(res => {
        const list = Array.isArray(res.data) ? res.data : []
        const row = list.find(x => x.id === sid)
        if (row) {
          setActiveDatasetId(row.dataset_id)
          setActiveDatasetName(row.dataset_name)
        }
      }).catch(() => { /* 忽略 */ })
    }
  }, [serverReady, setActiveDatasetId, setActiveSplitId, setActiveModelId, setActiveDatasetName, setExpertCompareModelIds, setWorkflowMode])

  // Ctrl+K 全局命令面板监听
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setCmdOpen(prev => !prev)
        setCmdQuery('')
      }
      if (e.key === 'Escape') setCmdOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Ctrl+K 弹窗打开后自动聚焦输入框
  useEffect(() => {
    if (cmdOpen) {
      setTimeout(() => cmdInputRef.current?.focus(), 50)
    }
  }, [cmdOpen])

  // 监听页面内导航事件（数据处理模式下跨模块导航时同步切换顶栏模式）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (!detail || !Object.prototype.hasOwnProperty.call(pageMap, detail)) return
      const pageKey = detail as PageKey
      if (pageKey === 'documentation') {
        setCurrentPage('documentation')
        localStorage.setItem('xgb_launched_before', '1')
        return
      }
      const { workflowMode, setWorkflowMode, activeSplitId } = useAppStore.getState()
      if (workflowMode === 'preprocess' && !PREPROCESS_MODULE_PAGE_KEYS.includes(pageKey)) {
        const nextMode = workflowModeForPageKey(pageKey)
        if (nextMode === 'learning' && activeSplitId === null) {
          Modal.warning({
            title: '无法进入模型调优模式',
            content: '请先在顶栏选择「训练划分」，或在「数据处理 → 特征工程」完成划分后再进入。',
          })
          return
        }
        setWorkflowMode(nextMode)
      }
      setCurrentPage(pageKey)
      localStorage.setItem('xgb_launched_before', '1')
    }
    window.addEventListener('navigate', handler)
    return () => window.removeEventListener('navigate', handler)
  }, [])

  /** 切换到向导模式时，若有保存进度则弹出 toast 提示 */
  const notifyGuidedRestore = useCallback(() => {
    try {
      const raw = localStorage.getItem('xgbs_workflow_state')
      if (raw) {
        const s = JSON.parse(raw) as { currentStep?: number }
        if (typeof s.currentStep === 'number' && s.currentStep > 0) {
          const stepNames = ['选择数据集', '数据分析', '数据划分', '参数配置', '一键训练', '结果总结']
          message.info(`已恢复向导进度：第 ${s.currentStep + 1}/6 步 · ${stepNames[s.currentStep] ?? ''}`, 3)
        }
      }
    } catch { /* 忽略 */ }
  }, [])

  const warnLearningPrereqs = useCallback(() => {
    if (activeSplitId === null) {
      Modal.warning({
        title: '无法进入模型调优模式',
        content: '请先在顶栏选择「训练划分」，或在「数据处理 → 特征工程」完成划分后再进入。',
      })
      return false
    }
    return true
  }, [activeSplitId])

  const applyModeAfterSwitch = useCallback((mode: WorkflowMode) => {
    if (mode === 'preprocess') {
      setCurrentPage('data-import')
      localStorage.setItem('xgb_launched_before', '1')
    } else if (mode === 'guided') {
      setCurrentPage('smart-workflow')
      notifyGuidedRestore()
    } else if (mode === 'expert') {
      setCurrentPage(p => (EXPERT_NAV_EXCLUDED_PAGE_KEYS.includes(p) ? 'expert-hub' : p))
    } else if (mode === 'learning') {
      setCurrentPage('learning-hub')
      localStorage.setItem('xgb_launched_before', '1')
    }
  }, [notifyGuidedRestore])

  // 模式切换（来自 ModeSwitcher；训练中先确认，进入调优前校验已选训练划分）
  const handleWorkflowModeChange = useCallback((mode: WorkflowMode) => {
    if (isTraining) {
      setPendingMode(mode)
      setTransitionOpen(true)
      return
    }
    if (mode === 'learning' && !warnLearningPrereqs()) {
      return
    }
    setWorkflowMode(mode)
    applyModeAfterSwitch(mode)
  }, [isTraining, warnLearningPrereqs, setWorkflowMode, applyModeAfterSwitch])

  const confirmModeTransition = useCallback((mode: WorkflowMode) => {
    if (mode === 'learning' && !warnLearningPrereqs()) {
      setTransitionOpen(false)
      setPendingMode(null)
      return
    }
    setWorkflowMode(mode)
    setTransitionOpen(false)
    setPendingMode(null)
    applyModeAfterSwitch(mode)
  }, [setWorkflowMode, warnLearningPrereqs, applyModeAfterSwitch])

  // 向导模式下点击侧栏外的目标页需确认（分步引导与数据准备四页互跳不确认）
  const handleMenuClick = useCallback(({ key }: { key: string }) => {
    const pageKey = key as PageKey
    if (workflowMode === 'guided' && !GUIDED_MODULE_PAGE_KEYS.includes(pageKey)) {
      setGuidedLeaveTarget(pageKey)
      setGuidedLeaveOpen(true)
      return
    }
    if (workflowMode === 'preprocess' && !PREPROCESS_MODULE_PAGE_KEYS.includes(pageKey)) {
      setPreprocessLeaveTarget(pageKey)
      setPreprocessLeaveOpen(true)
      return
    }
    setCurrentPage(pageKey)
    localStorage.setItem('xgb_launched_before', '1')
  }, [workflowMode, setWorkflowMode, notifyGuidedRestore])

  // 动态菜单：根据模式
  const menuItems = workflowMode === 'preprocess'
    ? buildPreprocessMenu()
    : workflowMode === 'guided'
      ? buildGuidedMenu()
      : workflowMode === 'learning'
        ? buildLearningMenu()
        : buildExpertMenu()

  const recommendedNextStep = pageOrder.find(
    page => !pageCompletion[page]({ activeDatasetId, activeSplitId, activeModelId })
  )

  const selectedKeys = recommendedNextStep && currentPage === 'welcome'
    ? [currentPage, recommendedNextStep]
    : [currentPage]

  const sideMenuSelectedKeys = currentPage === 'documentation' ? [] : selectedKeys

  // Ctrl+K：专家模式不列出训练类页；数据处理模式仅列出三数据页；产品文档始终可搜
  const commandPages = useMemo(() => {
    if (workflowMode === 'expert') {
      return searchablePages.filter(p => !EXPERT_NAV_EXCLUDED_PAGE_KEYS.includes(p.key))
    }
    if (workflowMode === 'preprocess') {
      return searchablePages.filter(
        p => p.key === 'documentation' || PREPROCESS_MODULE_PAGE_KEYS.includes(p.key),
      )
    }
    return searchablePages
  }, [workflowMode])

  const filteredPages = cmdQuery.trim()
    ? commandPages.filter(p =>
        p.label.includes(cmdQuery) || p.group.includes(cmdQuery) || p.key.includes(cmdQuery)
      )
    : commandPages

  const expertModelSelectOptions = useMemo(
    () =>
      expertModels.map(m => ({
        value: m.id,
        label: `${m.name} (#${m.id})`,
      })),
    [expertModels],
  )

  const splitSelectOptions = useMemo(
    () =>
      headerSplits.map(s => ({
        value: s.id,
        label: `${s.dataset_name} / 划分 #${s.id}（训练 ${s.train_rows ?? '?'} 行）`,
      })),
    [headerSplits],
  )

  const handleSplitSelectChange = useCallback(
    (id: number | null) => {
      setExpertCompareModelIds([])
      if (id === null) {
        setActiveSplitId(null)
        setActiveModelId(null)
        message.success('已清除训练划分')
        return
      }
      const row = headerSplits.find(s => s.id === id)
      const label = row
        ? `${row.dataset_name} / 划分 #${id}`
        : `划分 #${id}`
      setActiveSplitId(id)
      if (row) {
        setActiveDatasetId(row.dataset_id)
        setActiveDatasetName(row.dataset_name)
      }
      message.success(`已选择训练划分：${label}`)
    },
    [headerSplits, setActiveSplitId, setActiveDatasetId, setActiveDatasetName, setActiveModelId, setExpertCompareModelIds],
  )

  const handlePrimaryModelChange = useCallback(
    (v: number | null) => {
      const prevPrimary = useAppStore.getState().activeModelId
      const prevCompare = useAppStore.getState().expertCompareModelIds

      setActiveModelId(v)

      if (v === null) {
        setExpertCompareModelIds([])
        message.success('已清除主模型')
        return
      }

      if (prevCompare.length > 0) {
        const extras = prevCompare.filter(id => id !== prevPrimary)
        const merged = [v, ...extras.filter(e => e !== v)]
        const valid = new Set(expertModels.map(m => m.id))
        const next = merged.filter(id => valid.has(id))
        setExpertCompareModelIds(next.length >= 2 ? next : [])
      }

      const opt = expertModelSelectOptions.find(o => o.value === v)
      message.success(`已选择主模型：${opt?.label ?? `#${v}`}`)
    },
    [expertModelSelectOptions, expertModels, setActiveModelId, setExpertCompareModelIds],
  )

  const handleExpertCompareExtrasChange = useCallback(
    (extras: number[]) => {
      const primary = useAppStore.getState().activeModelId
      if (primary === null) return
      const deduped: number[] = []
      const seen = new Set<number>()
      for (const id of extras) {
        if (id === primary || seen.has(id)) continue
        seen.add(id)
        deduped.push(id)
        if (deduped.length >= MAX_EXPERT_COMPARE_EXTRAS) break
      }
      if (deduped.length === 0) setExpertCompareModelIds([])
      else setExpertCompareModelIds([primary, ...deduped])
    },
    [setExpertCompareModelIds],
  )

  const expertCompareExtraOptions = useMemo(
    () =>
      activeModelId === null
        ? []
        : expertModelSelectOptions.filter(o => o.value !== activeModelId),
    [expertModelSelectOptions, activeModelId],
  )

  const expertCompareExtrasValue = useMemo(
    () => expertCompareModelIds.filter(id => id !== activeModelId),
    [expertCompareModelIds, activeModelId],
  )

  // 侧边栏宽度：各模式统一，避免切换时主内容区横向跳动
  const siderWidth = 220

  return (
    <>
    <Layout style={{ height: '100vh', background: '#0f172a' }}>
      {/* 侧边栏 */}
      <Sider
        collapsed={sidebarCollapsed}
        width={siderWidth}
        collapsedWidth={64}
        style={{
          background: '#1e293b',
          borderRight: '1px solid #334155',
          transition: 'width 300ms ease-in-out',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
        }}
      >
        {/* Logo 区：左侧产品图标 + 与启动页一致的渐变标题 */}
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
            gap: sidebarCollapsed ? 0 : 10,
            padding: sidebarCollapsed ? 0 : '0 14px',
            borderBottom: '1px solid #334155',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 45%, #8b5cf6 100%)',
              boxShadow: '0 1px 5px rgba(59, 130, 246, 0.28)',
            }}
            aria-hidden
          >
            <LineChartOutlined style={{ color: '#fff', fontSize: 13 }} />
          </div>
          {!sidebarCollapsed && (
            <span
              style={{
                fontWeight: 700,
                fontSize: 20,
                letterSpacing: '-0.32px',
                lineHeight: '24px',
                background: 'linear-gradient(90deg, #60a5fa, #a78bfa)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              XGBoost Studio
            </span>
          )}
        </div>


        {/* 导航菜单：各模式侧栏为扁平项 */}
        <div
          style={{
            overflow: 'hidden auto',
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Menu
            mode="inline"
            selectedKeys={sideMenuSelectedKeys}
            items={menuItems}
            style={{
              background: 'transparent',
              border: 'none',
              marginTop: 8,
              flexShrink: 0,
              transition: 'all 300ms ease-in-out',
            }}
            theme="dark"
            onClick={handleMenuClick}
          />
        </div>

      </Sider>

      <Layout
        style={{
          background: '#0f172a',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* 顶部 Header */}
        <Header
          style={{
            background: '#1e293b',
            borderBottom: '1px solid #334155',
            height: 48,
            lineHeight: 'normal',
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexShrink: 0,
          }}
        >
          <Tooltip title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}>
            <Button
              type="text"
              icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={toggleSidebar}
              style={{ color: '#94a3b8', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            />
          </Tooltip>

          {/* 顶栏左侧：模式切换、上下文（连接状态仅在底部状态栏展示） */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <ModeSwitcher
                isTraining={isTraining}
                onSwitchRequest={handleWorkflowModeChange}
              />
            </div>
            <Tooltip
              title="选择用于训练/评估的数据划分；新建划分请打开「数据处理 → 特征工程」。上传原始数据请打开「数据工作台」。"
              open={splitDropdownOpen ? false : undefined}
            >
              <Select
                className="main-layout-primary-model-select"
                popupClassName="main-layout-model-select-dropdown"
                allowClear
                showSearch
                optionFilterProp="label"
                open={splitDropdownOpen}
                placeholder="训练划分 — 点击选择 —"
                loading={headerSplitsLoading}
                value={activeSplitId ?? undefined}
                options={splitSelectOptions}
                onChange={v => handleSplitSelectChange(v ?? null)}
                onOpenChange={open => {
                  setSplitDropdownOpen(open)
                  if (open) void fetchHeaderSplits()
                }}
                prefix={<ScissorOutlined style={{ color: '#94a3b8', fontSize: 14 }} />}
                notFoundContent={
                  headerSplitsLoading
                    ? '加载中…'
                    : '暂无训练划分，请前往「数据处理 → 特征工程」完成划分'
                }
              />
            </Tooltip>
            <Tooltip
              title={activeSplitId ? '仅列出当前训练划分下可用的模型（含同数据集 legacy 模型）；可搜索名称。' : '请先在顶栏选择「训练划分」，再选择主模型。'}
              open={primaryModelDropdownOpen ? false : undefined}
            >
              <Select
                className={`main-layout-primary-model-select${activeSplitId ? '' : ' main-layout-primary-model-select--no-split'}`}
                popupClassName="main-layout-model-select-dropdown"
                allowClear
                showSearch
                optionFilterProp="label"
                open={primaryModelDropdownOpen}
                placeholder={activeSplitId ? '主模型 — 点击选择 —' : '主模型 — 请先选择训练划分 —'}
                loading={expertModelsLoading}
                value={activeModelId ?? undefined}
                options={expertModelSelectOptions}
                onChange={v => handlePrimaryModelChange(v ?? null)}
                onOpenChange={open => {
                  if (open && activeSplitId === null) {
                    message.warning('请先在顶栏选择「训练划分」，再选择主模型。')
                    setPrimaryModelDropdownOpen(false)
                    return
                  }
                  setPrimaryModelDropdownOpen(open)
                  if (open) void fetchPrimaryModelsForSplit()
                }}
                prefix={<RobotOutlined style={{ color: '#94a3b8', fontSize: 14 }} />}
                notFoundContent={
                  expertModelsLoading
                    ? '加载中…'
                    : '该划分下暂无模型，请先在「模型训练」中训练并保存模型'
                }
              />
            </Tooltip>
            {workflowMode === 'expert' ? (
              <Tooltip
                title={
                  !activeSplitId
                    ? '请先在顶栏选择「训练划分」。'
                    : !activeModelId
                      ? '请先选择「主模型」，再添加同划分下的对比模型（至多 7 个，含主模型共 8 个）。'
                      : '与主模型同一训练划分下的其它模型；清空则模型工作台回到单模型视图。'
                }
                open={compareModelDropdownOpen ? false : undefined}
              >
                <Select
                  mode="multiple"
                  className={`main-layout-primary-model-select${activeModelId && activeSplitId ? '' : ' main-layout-primary-model-select--no-split'}`}
                  popupClassName="main-layout-model-select-dropdown"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  open={compareModelDropdownOpen}
                  placeholder={
                    !activeSplitId
                      ? '对比模型 — 请先选择训练划分 —'
                      : !activeModelId
                        ? '对比模型 — 请先选择主模型 —'
                        : '对比模型（可选，多选）'
                  }
                  loading={expertModelsLoading}
                  value={expertCompareExtrasValue}
                  options={expertCompareExtraOptions}
                  onChange={v => handleExpertCompareExtrasChange(v as number[])}
                  onOpenChange={open => {
                    if (open && activeSplitId === null) {
                      message.warning('请先在顶栏选择「训练划分」。')
                      setCompareModelDropdownOpen(false)
                      return
                    }
                    if (open && activeModelId === null) {
                      message.warning('请先选择主模型，再添加对比模型。')
                      setCompareModelDropdownOpen(false)
                      return
                    }
                    setCompareModelDropdownOpen(open)
                    if (open) void fetchPrimaryModelsForSplit()
                  }}
                  disabled={!activeSplitId || !activeModelId}
                  maxTagCount="responsive"
                  prefix={<BarChartOutlined style={{ color: '#94a3b8', fontSize: 14 }} />}
                  style={{ minWidth: 200, maxWidth: 360 }}
                  notFoundContent={expertModelsLoading ? '加载中…' : '该划分下暂无其它模型可选'}
                />
              </Tooltip>
            ) : null}
          </div>

          <Space size={8} align="center" style={{ flexShrink: 0 }}>
            <Tooltip title="Wiki、README 与开发指南（构建期打包）">
              <Button
                type="text"
                size="small"
                icon={<ReadOutlined />}
                onClick={goDocumentation}
                style={{
                  color: currentPage === 'documentation' ? '#38bdf8' : '#64748b',
                  fontSize: 12,
                  flexShrink: 0,
                }}
              >
                文档
              </Button>
            </Tooltip>
            <Tooltip title="命令面板（Ctrl+K）">
              <Button
                type="text"
                size="small"
                icon={<SearchOutlined />}
                onClick={() => setCmdOpen(true)}
                style={{ color: '#64748b', fontSize: 12, flexShrink: 0 }}
              >
                <span style={{ fontSize: 11 }}>Ctrl+K</span>
              </Button>
            </Tooltip>
            {pageHelpContent ? (
              <HelpButton pageTitle={pageHelpContent.pageTitle} items={pageHelpContent.items} />
            ) : null}
          </Space>
        </Header>

        {/* 主内容区：flexBasis+minHeight 避免子项撑高后出现 1px 级「幽灵纵向滚动」；横向交给各页内部（如 Table scroll.x） */}
        <Content
          className="main-layout-scroll"
          style={{
            overflowX: 'hidden',
            overflowY: 'auto',
            padding: currentPage === 'documentation' ? 12 : 16,
            background: '#0f172a',
            flex: '1 1 0%',
            minHeight: 0,
          }}
        >
          {pageMap[currentPage]}
        </Content>

        {/* 底部状态栏 */}
        <div style={{
          height: 24, background: '#1e293b', borderTop: '1px solid #334155',
          padding: '0 16px', display: 'flex', alignItems: 'center', gap: 8,
          flexShrink: 0,
        }}>
          <Text style={{ color: '#475569', fontSize: 11 }}>
            XGBoost Studio v{(window as unknown as { __APP_VERSION__?: string }).__APP_VERSION__ ?? '0.5.0'}
          </Text>
          <Text style={{ color: '#334155', fontSize: 11 }}>|</Text>
          {serverReady && !isOffline
            ? <Text style={{ color: '#52c41a', fontSize: 11 }}>● 服务已连接</Text>
            : <Text style={{ color: '#ff4d4f', fontSize: 11 }}>● 服务未连接</Text>}
          {isOffline && <Text style={{ color: '#fa8c16', fontSize: 11 }}>▲ 网络离线</Text>}
          <Text style={{ color: '#334155', fontSize: 11 }}>|</Text>
          <Text style={{ color: '#475569', fontSize: 11 }}>
            {workflowMode === 'preprocess' ? '🧩 数据处理'
              : workflowMode === 'guided' ? '🎯 智能向导'
              : workflowMode === 'learning' ? '🔧 模型调优'
              : '📊 专家分析'}
          </Text>
        </div>
      </Layout>

      {/* 模式切换确认弹窗（训练中） */}
      <ModeTransitionModal
        open={transitionOpen}
        targetMode={pendingMode}
        onConfirm={confirmModeTransition}
        onCancel={() => { setTransitionOpen(false); setPendingMode(null) }}
      />

      {/* 向导模式离开确认 */}
      <Modal
        title="暂离向导？"
        open={guidedLeaveOpen}
        onOk={() => {
          const t = guidedLeaveTarget
          if (t) {
            const nextMode = workflowModeForPageKey(t)
            if (nextMode === 'learning' && !warnLearningPrereqs()) {
              setGuidedLeaveOpen(false)
              setGuidedLeaveTarget(null)
              return
            }
            if (nextMode !== workflowMode) {
              setWorkflowMode(nextMode)
            }
            setCurrentPage(t)
            localStorage.setItem('xgb_launched_before', '1')
          }
          setGuidedLeaveOpen(false)
          setGuidedLeaveTarget(null)
        }}
        onCancel={() => { setGuidedLeaveOpen(false); setGuidedLeaveTarget(null) }}
        okText="前往"
        cancelText="继续向导"
        width={400}
      >
        <p>
          向导进度已自动保存（第 {workflowStep + 1}/6 步）。
          你可以前往「{guidedLeaveTarget ? pageLabels[guidedLeaveTarget] ?? guidedLeaveTarget : ''}」；
          返回时请从侧栏点击「向导工作台」，或使用顶部模式切换器回到「智能向导」。
        </p>
      </Modal>

      <Modal
        title="离开数据处理？"
        open={preprocessLeaveOpen}
        onOk={() => {
          const t = preprocessLeaveTarget
          if (t) {
            const nextMode = workflowModeForPageKey(t)
            if (nextMode === 'learning' && !warnLearningPrereqs()) {
              setPreprocessLeaveOpen(false)
              setPreprocessLeaveTarget(null)
              return
            }
            setWorkflowMode(nextMode)
            setCurrentPage(t)
            localStorage.setItem('xgb_launched_before', '1')
          }
          setPreprocessLeaveOpen(false)
          setPreprocessLeaveTarget(null)
        }}
        onCancel={() => { setPreprocessLeaveOpen(false); setPreprocessLeaveTarget(null) }}
        okText="前往"
        cancelText="留在数据处理"
        width={400}
      >
        <p>
          将前往「{preprocessLeaveTarget ? pageLabels[preprocessLeaveTarget] ?? preprocessLeaveTarget : ''}」。
          数据工作台与顶栏「训练划分 / 主模型」等上下文会保留；返回数据准备请切换回顶部「数据处理」模式。
        </p>
      </Modal>

      {/* 新手引导弹窗 */}
      {onboardingMode && (
        <ModeOnboardingModal
          mode={onboardingMode}
          open={!!onboardingMode}
          onClose={() => setOnboardingMode(null)}
        />
      )}

      {/* Ctrl+K 命令面板 */}
      <Modal
        title={
          <Space>
            <SearchOutlined />
            <span>命令面板</span>
            <Text type="secondary" style={{ fontSize: 12 }}>快速跳转页面</Text>
          </Space>
        }
        open={cmdOpen}
        onCancel={() => setCmdOpen(false)}
        footer={null}
        width={480}
        centered
      >
        <Input
          ref={cmdInputRef as React.RefObject<HTMLInputElement | null>}
          prefix={<SearchOutlined style={{ color: '#64748b' }} />}
          placeholder="输入页面名称搜索…"
          value={cmdQuery}
          onChange={e => setCmdQuery(e.target.value)}
          style={{ marginBottom: 12 }}
          allowClear
        />
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {filteredPages.map(p => (
            <div
              key={p.key}
              onClick={() => {
                if (p.key === 'documentation') {
                  setCurrentPage('documentation')
                  setCmdOpen(false)
                  setCmdQuery('')
                  localStorage.setItem('xgb_launched_before', '1')
                  return
                }
                const st = useAppStore.getState()
                const { workflowMode: wm, setWorkflowMode, activeSplitId: asp } = st
                const nextMode = workflowModeForPageKey(p.key)
                if (nextMode !== wm) {
                  if (nextMode === 'learning' && asp === null) {
                    Modal.warning({
                      title: '无法进入模型调优模式',
                      content: '请先在顶栏选择「训练划分」，或在「数据处理 → 特征工程」完成划分后再进入。',
                    })
                    return
                  }
                  setWorkflowMode(nextMode)
                }
                setCurrentPage(p.key)
                setCmdOpen(false)
                setCmdQuery('')
                localStorage.setItem('xgb_launched_before', '1')
              }}
              style={{
                padding: '10px 12px',
                cursor: 'pointer',
                borderRadius: 6,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 2,
                background: currentPage === p.key ? '#1d3a5c' : 'transparent',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#1e293b')}
              onMouseLeave={e => (e.currentTarget.style.background = currentPage === p.key ? '#1d3a5c' : 'transparent')}
            >
              <Text>{p.label}</Text>
              <Tag color="default" style={{ fontSize: 11 }}>{p.group}</Tag>
            </div>
          ))}
          {filteredPages.length === 0 && (
            <Text type="secondary" style={{ display: 'block', textAlign: 'center', padding: 20 }}>
              未找到匹配页面
            </Text>
          )}
        </div>
      </Modal>
    </Layout>
    {globalError && (
      <div
        style={{
          position: 'fixed',
          top: 16,
          right: 24,
          zIndex: 1010,
          maxWidth: 'min(420px, calc(100vw - 48px))',
        }}
      >
        <Alert
          type="error"
          message={globalError}
          closable
          onClose={() => setGlobalError(null)}
          style={{
            borderRadius: 8,
            boxShadow: '0 6px 16px rgba(0, 0, 0, 0.35)',
          }}
        />
      </div>
    )}
    </>
  )
}

export default MainLayout
