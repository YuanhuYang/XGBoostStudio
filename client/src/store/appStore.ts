import { create } from 'zustand'

export type WorkflowMode = 'guided' | 'preprocess' | 'learning' | 'expert'

/** 顶栏「帮助」抽屉内容（专家工作台按状态覆盖） */
export interface PageHelpPayload {
  pageTitle: string
  items: { title: string; content: string }[]
}

const LS_MODE_KEY = 'xgbs_workflow_mode'
const LS_SIDEBAR_KEY = 'xgbs_sidebar_collapsed'
const LS_MODE_FIRST_VISIT_KEY = 'xgbs_mode_first_visit'
const LS_WIZARD_STATE_KEY = 'xgbs_workflow_state'
const LS_ACTIVE_DATASET_ID_KEY = 'xgbs_active_dataset_id'
const LS_ACTIVE_DATASET_NAME_KEY = 'xgbs_active_dataset_name'
const LS_ACTIVE_SPLIT_ID_KEY = 'xgbs_active_split_id'
const LS_ACTIVE_MODEL_ID_KEY = 'xgbs_active_model_id'

function loadStoredNumber(key: string): number | null {
  try {
    const s = localStorage.getItem(key)
    if (s === null || s === '') return null
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function loadStoredString(key: string): string | null {
  try {
    const s = localStorage.getItem(key)
    if (s === null || s === '') return null
    return s
  } catch {
    return null
  }
}

function persistNumberKey(key: string, id: number | null) {
  try {
    if (id === null) localStorage.removeItem(key)
    else localStorage.setItem(key, String(id))
  } catch {
    /* 忽略（如隐私模式） */
  }
}

function persistStringKey(key: string, value: string | null) {
  try {
    if (value === null || value === '') localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* 忽略 */
  }
}

/** 从向导持久化存储中读取最近一次的步骤（0-5），无记录时返回 0 */
function loadSavedWizardStep(): number {
  try {
    const raw = localStorage.getItem(LS_WIZARD_STATE_KEY)
    if (raw) {
      const s = JSON.parse(raw) as { currentStep?: number }
      if (typeof s.currentStep === 'number') return s.currentStep
    }
  } catch { /* 忽略 */ }
  return 0
}

function loadMode(): WorkflowMode {
  const stored = localStorage.getItem(LS_MODE_KEY)
  if (
    stored === 'guided'
    || stored === 'preprocess'
    || stored === 'learning'
    || stored === 'expert'
  ) {
    return stored
  }
  return 'guided'
}

function loadSidebarCollapsed(): boolean {
  return localStorage.getItem(LS_SIDEBAR_KEY) === 'true'
}

const DEFAULT_MODE_FIRST_VISIT: Record<WorkflowMode, boolean> = {
  guided: true,
  preprocess: true,
  learning: true,
  expert: true,
}

function loadModeFirstVisit(): Record<WorkflowMode, boolean> {
  try {
    const raw = localStorage.getItem(LS_MODE_FIRST_VISIT_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<WorkflowMode, boolean>>
      return { ...DEFAULT_MODE_FIRST_VISIT, ...parsed }
    }
  } catch {}
  return { ...DEFAULT_MODE_FIRST_VISIT }
}

interface AppState {
  /** 后端服务连接状态 */
  serverReady: boolean
  serverError: string | null
  connectingProgress: { attempt: number; max: number } | null
  /** 全局错误提示（Banner） */
  globalError: string | null
  /** 网络离线状态 */
  isOffline: boolean
  /** 当前活跃的数据集 id — 跨模式共享状态，切换模式时严格不清零 */
  activeDatasetId: number | null
  /** 当前活跃的数据集名称（用于上下文显示）— 跨模式共享状态 */
  activeDatasetName: string | null
  /** 当前活跃的划分 id — 跨模式共享状态，切换模式时严格不清零 */
  activeSplitId: number | null
  /** 当前活跃的模型 id — 跨模式共享状态，切换模式时严格不清零 */
  activeModelId: number | null
  /** 专家工作台对比用的模型 ID 列表（深链 / CLI 写入；顺序即展示顺序） */
  expertCompareModelIds: number[]
  /** 侧边栏折叠状态（localStorage 持久化） */
  sidebarCollapsed: boolean
  /** 工作流模式：guided=智能向导；preprocess=数据处理；learning=模型调优；expert=专家分析 */
  workflowMode: WorkflowMode
  /** 上一次使用的模式，支持返回上一模式 */
  previousMode: WorkflowMode
  /** 向导当前步骤 (0-5)，与 SmartWorkflow currentStep 同步 */
  workflowStep: number
  /** 记录每种模式是否首次使用（用于新手引导弹窗） */
  modeFirstVisit: Record<WorkflowMode, boolean>
  /** SSE 训练是否正在进行（由 ModelTraining 页面写入） */
  isTraining: boolean
  /** 当前页自定义帮助（如专家工作台多状态）；非覆盖页应为 null */
  pageHelpOverride: PageHelpPayload | null

  setServerReady: (ready: boolean) => void
  setServerError: (msg: string | null) => void
  setConnectingProgress: (p: { attempt: number; max: number } | null) => void
  setGlobalError: (msg: string | null) => void
  setIsOffline: (offline: boolean) => void
  setActiveDatasetId: (id: number | null) => void
  setActiveDatasetName: (name: string | null) => void
  setActiveSplitId: (id: number | null) => void
  setActiveModelId: (
    id: number | null | ((prev: number | null) => number | null),
  ) => void
  setExpertCompareModelIds: (ids: number[]) => void
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setWorkflowMode: (mode: WorkflowMode) => void
  setWorkflowStep: (step: number) => void
  markModeVisited: (mode: WorkflowMode) => void
  setIsTraining: (training: boolean) => void
  setPageHelpOverride: (payload: PageHelpPayload | null) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  serverReady: false,
  serverError: null,
  connectingProgress: null,
  globalError: null,
  isOffline: false,
  activeDatasetId: loadStoredNumber(LS_ACTIVE_DATASET_ID_KEY),
  activeDatasetName: loadStoredString(LS_ACTIVE_DATASET_NAME_KEY),
  activeSplitId: loadStoredNumber(LS_ACTIVE_SPLIT_ID_KEY),
  activeModelId: loadStoredNumber(LS_ACTIVE_MODEL_ID_KEY),
  expertCompareModelIds: [],
  sidebarCollapsed: loadSidebarCollapsed(),
  workflowMode: loadMode(),
  previousMode: loadMode(),
  workflowStep: 0,
  modeFirstVisit: loadModeFirstVisit(),
  isTraining: false,
  pageHelpOverride: null,

  setServerReady: (ready) => set({ serverReady: ready }),
  setServerError: (msg) => set({ serverError: msg }),
  setConnectingProgress: (p) => set({ connectingProgress: p }),
  setGlobalError: (msg) => set({ globalError: msg }),
  setIsOffline: (offline) => set({ isOffline: offline }),
  setActiveDatasetId: (id) => {
    persistNumberKey(LS_ACTIVE_DATASET_ID_KEY, id)
    set({ activeDatasetId: id })
  },
  setActiveDatasetName: (name) => {
    persistStringKey(LS_ACTIVE_DATASET_NAME_KEY, name)
    set({ activeDatasetName: name })
  },
  setActiveSplitId: (id) => {
    persistNumberKey(LS_ACTIVE_SPLIT_ID_KEY, id)
    set({ activeSplitId: id })
  },
  setActiveModelId: (idOrUpdater) =>
    set((s) => {
      const next =
        typeof idOrUpdater === 'function' ? idOrUpdater(s.activeModelId) : idOrUpdater
      persistNumberKey(LS_ACTIVE_MODEL_ID_KEY, next)
      return { activeModelId: next }
    }),
  setExpertCompareModelIds: (ids) => set({ expertCompareModelIds: ids }),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed
    localStorage.setItem(LS_SIDEBAR_KEY, String(next))
    set({ sidebarCollapsed: next })
  },
  setSidebarCollapsed: (collapsed) => {
    localStorage.setItem(LS_SIDEBAR_KEY, String(collapsed))
    set({ sidebarCollapsed: collapsed })
  },
  setWorkflowMode: (mode) => {
    const prev = get().workflowMode
    localStorage.setItem(LS_MODE_KEY, mode)
    // 切换到向导模式时，从 localStorage 恢复最近步骤，使侧边栏提示立即同步
    const workflowStep = mode === 'guided' ? loadSavedWizardStep() : get().workflowStep
    set({ workflowMode: mode, previousMode: prev, workflowStep })
  },
  setWorkflowStep: (step) => set({ workflowStep: step }),
  markModeVisited: (mode) => {
    const updated = { ...get().modeFirstVisit, [mode]: false }
    localStorage.setItem(LS_MODE_FIRST_VISIT_KEY, JSON.stringify(updated))
    set({ modeFirstVisit: updated })
  },
  setIsTraining: (training) => set({ isTraining: training }),
  setPageHelpOverride: (payload) => set({ pageHelpOverride: payload }),
}))
