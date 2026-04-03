import { create } from 'zustand'

interface AppState {
  /** 后端服务连接状态 */
  serverReady: boolean
  serverError: string | null
  connectingProgress: { attempt: number; max: number } | null
  /** 当前活跃的数据集 id */
  activeDatasetId: number | null
  /** 当前活跃的模型 id */
  activeModelId: number | null
  /** 侧边栏折叠状态 */
  sidebarCollapsed: boolean

  setServerReady: (ready: boolean) => void
  setServerError: (msg: string | null) => void
  setConnectingProgress: (p: { attempt: number; max: number } | null) => void
  setActiveDatasetId: (id: number | null) => void
  setActiveModelId: (id: number | null) => void
  toggleSidebar: () => void
}

export const useAppStore = create<AppState>((set) => ({
  serverReady: false,
  serverError: null,
  connectingProgress: null,
  activeDatasetId: null,
  activeModelId: null,
  sidebarCollapsed: false,

  setServerReady: (ready) => set({ serverReady: ready }),
  setServerError: (msg) => set({ serverError: msg }),
  setConnectingProgress: (p) => set({ connectingProgress: p }),
  setActiveDatasetId: (id) => set({ activeDatasetId: id }),
  setActiveModelId: (id) => set({ activeModelId: id }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}))
