import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './appStore'

describe('appStore', () => {
  // Reset store before each test
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true)
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
    useAppStore.getState().setWorkflowMode('learning')
    expect(useAppStore.getState().workflowMode).toBe('learning')
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
