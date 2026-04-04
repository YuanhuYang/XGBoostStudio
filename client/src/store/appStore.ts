import { create } from 'zustand'

interface AppState {
  /** 后端服务连接状态 */
  serverReady: boolean
  serverError: string | null
  connectingProgress: { attempt: number; max: number } | null
  /** 全局错误提示（Banner） */
  globalError: string | null
  /** 网络离线状态 */
  isOffline: boolean
  /** 当前活跃的数据集 id */
  activeDatasetId: number | null
  /** 当前活跃的数据集名称（用于上下文显示） */
  activeDatasetName: string | null
  /** 当前活跃的划分 id */
  activeSplitId: number | null
  /** 当前活跃的模型 id */
  activeModelId: number | null
  /** 侧边栏折叠状态 */
  sidebarCollapsed: boolean
  /** 向导模式：guided=智能向导，learning=学习模式，expert=专家模式 */
  workflowMode: 'guided' | 'learning' | 'expert'
  /** 向导当前步骤 (0-5) */
  workflowStep: number

  setServerReady: (ready: boolean) => void
  setServerError: (msg: string | null) => void
  setConnectingProgress: (p: { attempt: number; max: number } | null) => void
  setGlobalError: (msg: string | null) => void
  setIsOffline: (offline: boolean) => void
  setActiveDatasetId: (id: number | null) => void
  setActiveDatasetName: (name: string | null) => void
  setActiveSplitId: (id: number | null) => void
  setActiveModelId: (id: number | null) => void
  toggleSidebar: () => void
  setWorkflowMode: (mode: 'guided' | 'learning' | 'expert') => void
  setWorkflowStep: (step: number) => void
}

export const useAppStore = create<AppState>((set) => ({
  serverReady: false,
  serverError: null,
  connectingProgress: null,
  globalError: null,
  isOffline: false,
  activeDatasetId: null,
  activeDatasetName: null,
  activeSplitId: null,
  activeModelId: null,
  sidebarCollapsed: false,
  workflowMode: 'guided',
  workflowStep: 0,

  setServerReady: (ready) => set({ serverReady: ready }),
  setServerError: (msg) => set({ serverError: msg }),
  setConnectingProgress: (p) => set({ connectingProgress: p }),
  setGlobalError: (msg) => set({ globalError: msg }),
  setIsOffline: (offline) => set({ isOffline: offline }),
  setActiveDatasetId: (id) => set({ activeDatasetId: id }),
  setActiveDatasetName: (name) => set({ activeDatasetName: name }),
  setActiveSplitId: (id) => set({ activeSplitId: id }),
  setActiveModelId: (id) => set({ activeModelId: id }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setWorkflowMode: (mode) => set({ workflowMode: mode }),
  setWorkflowStep: (step) => set({ workflowStep: step }),
}))
