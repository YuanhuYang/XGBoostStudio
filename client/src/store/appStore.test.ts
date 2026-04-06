import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './appStore'

const LS_ACTIVE_CONTEXT_KEYS = [
  'xgbs_active_dataset_id',
  'xgbs_active_dataset_name',
  'xgbs_active_split_id',
  'xgbs_active_model_id',
] as const

describe('appStore', () => {
  // Reset store before each test
  beforeEach(() => {
    for (const k of LS_ACTIVE_CONTEXT_KEYS) {
      localStorage.removeItem(k)
    }
    const base = useAppStore.getInitialState()
    useAppStore.setState(
      {
        ...base,
        activeDatasetId: null,
        activeDatasetName: null,
        activeSplitId: null,
        activeModelId: null,
      },
      true,
    )
  })

  it('has correct initial state', () => {
    const state = useAppStore.getState()
    expect(state.serverReady).toBe(false)
    expect(state.serverError).toBeNull()
    expect(state.globalError).toBeNull()
    expect(state.isOffline).toBe(false)
    expect(state.activeDatasetId).toBeNull()
    expect(state.activeSplitId).toBeNull()
    expect(state.activeModelId).toBeNull()
    expect(state.expertCompareModelIds).toEqual([])
    expect(state.sidebarCollapsed).toBe(false)
    expect(state.workflowMode).toBe('guided')
    expect(state.workflowStep).toBe(0)
  })

  it('setServerReady updates serverReady', () => {
    useAppStore.getState().setServerReady(true)
    expect(useAppStore.getState().serverReady).toBe(true)
    useAppStore.getState().setServerReady(false)
    expect(useAppStore.getState().serverReady).toBe(false)
  })

  it('setServerError updates serverError', () => {
    useAppStore.getState().setServerError('连接失败')
    expect(useAppStore.getState().serverError).toBe('连接失败')
    useAppStore.getState().setServerError(null)
    expect(useAppStore.getState().serverError).toBeNull()
  })

  it('setActiveDatasetId updates activeDatasetId and activeDatasetName', () => {
    useAppStore.getState().setActiveDatasetId(1)
    expect(useAppStore.getState().activeDatasetId).toBe(1)
    useAppStore.getState().setActiveDatasetId(null)
    expect(useAppStore.getState().activeDatasetId).toBeNull()
  })

  it('setActiveDatasetName updates activeDatasetName', () => {
    useAppStore.getState().setActiveDatasetName('titanic_train.csv')
    expect(useAppStore.getState().activeDatasetName).toBe('titanic_train.csv')
    useAppStore.getState().setActiveDatasetName(null)
    expect(useAppStore.getState().activeDatasetName).toBeNull()
  })

  it('setActiveSplitId updates activeSplitId', () => {
    useAppStore.getState().setActiveSplitId(5)
    expect(useAppStore.getState().activeSplitId).toBe(5)
    useAppStore.getState().setActiveSplitId(null)
    expect(useAppStore.getState().activeSplitId).toBeNull()
  })

  it('setActiveModelId updates activeModelId', () => {
    useAppStore.getState().setActiveModelId(10)
    expect(useAppStore.getState().activeModelId).toBe(10)
    useAppStore.getState().setActiveModelId(null)
    expect(useAppStore.getState().activeModelId).toBeNull()
  })

  it('setActiveModelId accepts functional updater and persists', () => {
    useAppStore.getState().setActiveModelId(3)
    useAppStore.getState().setActiveModelId((prev) => (prev === 3 ? 4 : null))
    expect(useAppStore.getState().activeModelId).toBe(4)
    expect(localStorage.getItem('xgbs_active_model_id')).toBe('4')
  })

  it('persists dataset / name / split / model to localStorage', () => {
    useAppStore.getState().setActiveDatasetId(7)
    useAppStore.getState().setActiveDatasetName('demo.csv')
    useAppStore.getState().setActiveSplitId(2)
    useAppStore.getState().setActiveModelId(99)
    expect(localStorage.getItem('xgbs_active_dataset_id')).toBe('7')
    expect(localStorage.getItem('xgbs_active_dataset_name')).toBe('demo.csv')
    expect(localStorage.getItem('xgbs_active_split_id')).toBe('2')
    expect(localStorage.getItem('xgbs_active_model_id')).toBe('99')
  })

  it('toggleSidebar flips sidebarCollapsed', () => {
    expect(useAppStore.getState().sidebarCollapsed).toBe(false)
    useAppStore.getState().toggleSidebar()
    expect(useAppStore.getState().sidebarCollapsed).toBe(true)
    useAppStore.getState().toggleSidebar()
    expect(useAppStore.getState().sidebarCollapsed).toBe(false)
  })

  it('setWorkflowMode updates workflowMode', () => {
    useAppStore.getState().setWorkflowMode('expert')
    expect(useAppStore.getState().workflowMode).toBe('expert')
    useAppStore.getState().setWorkflowMode('preprocess')
    expect(useAppStore.getState().workflowMode).toBe('preprocess')
    useAppStore.getState().setWorkflowMode('learning')
    expect(useAppStore.getState().workflowMode).toBe('learning')
  })

  it('markModeVisited clears preprocess in modeFirstVisit', () => {
    useAppStore.setState({
      modeFirstVisit: { guided: true, preprocess: true, learning: true, expert: true },
    })
    useAppStore.getState().markModeVisited('preprocess')
    expect(useAppStore.getState().modeFirstVisit.preprocess).toBe(false)
  })

  it('setWorkflowStep updates workflowStep', () => {
    useAppStore.getState().setWorkflowStep(3)
    expect(useAppStore.getState().workflowStep).toBe(3)
  })

  it('setIsOffline updates offline state', () => {
    useAppStore.getState().setIsOffline(true)
    expect(useAppStore.getState().isOffline).toBe(true)
    useAppStore.getState().setIsOffline(false)
    expect(useAppStore.getState().isOffline).toBe(false)
  })

  it('setGlobalError updates globalError', () => {
    useAppStore.getState().setGlobalError('全局错误')
    expect(useAppStore.getState().globalError).toBe('全局错误')
    useAppStore.getState().setGlobalError(null)
    expect(useAppStore.getState().globalError).toBeNull()
  })

  it('setConnectingProgress updates connectingProgress', () => {
    useAppStore.getState().setConnectingProgress({ attempt: 2, max: 5 })
    expect(useAppStore.getState().connectingProgress).toEqual({ attempt: 2, max: 5 })
    useAppStore.getState().setConnectingProgress(null)
    expect(useAppStore.getState().connectingProgress).toBeNull()
  })
})
