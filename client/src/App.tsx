import React, { useEffect } from 'react'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useAppStore } from './store/appStore'
import LoadingScreen from './components/LoadingScreen'
import MainLayout from './components/MainLayout'

const App: React.FC = () => {
  const { serverReady, setServerReady, setServerError, setConnectingProgress } = useAppStore()

  useEffect(() => {
    // 监听 Electron 主进程推送的服务器状态事件
    const win = window as unknown as Window & {
      electron?: {
        server: {
          getConnectionState: () => Promise<{
            status: 'stopped' | 'starting' | 'running' | 'error'
            errorMessage: string | null
          }>
          onReady: (cb: () => void) => () => void
          onConnecting: (cb: (d: { attempt: number; max: number }) => void) => () => void
          onError: (cb: (msg: string) => void) => () => void
        }
      }
    }

    if (win.electron) {
      type Conn = { status: string; errorMessage: string | null }
      let pollTimer: ReturnType<typeof setInterval> | null = null
      let pollAttempts = 0
      const MAX_POLL_ATTEMPTS = 120

      const applyConnectionState = (state: Conn) => {
        if (state.status === 'running') {
          setServerReady(true)
          setServerError(null)
          setConnectingProgress(null)
          if (pollTimer !== null) {
            clearInterval(pollTimer)
            pollTimer = null
          }
        } else if (state.status === 'error') {
          setServerReady(false)
          setServerError(state.errorMessage ?? '后端服务异常')
          setConnectingProgress(null)
          if (pollTimer !== null) {
            clearInterval(pollTimer)
            pollTimer = null
          }
        }
      }

      const pullConnectionState = () => {
        void win.electron!.server.getConnectionState().then(applyConnectionState)
      }

      // 避免 server:ready / server:error 早于 React 注册监听器而丢失
      pullConnectionState()
      pollTimer = setInterval(() => {
        pollAttempts += 1
        if (pollAttempts > MAX_POLL_ATTEMPTS) {
          if (pollTimer !== null) clearInterval(pollTimer)
          pollTimer = null
          return
        }
        pullConnectionState()
      }, 600)

      // Electron 模式：监听主进程事件
      const unsubReady = win.electron.server.onReady(() => {
        setServerReady(true)
        setServerError(null)
        setConnectingProgress(null)
      })
      const unsubConnecting = win.electron.server.onConnecting((d) => {
        setConnectingProgress(d)
      })
      const unsubError = win.electron.server.onError((msg) => {
        setServerError(msg)
        setServerReady(false)
      })
      return () => {
        if (pollTimer !== null) clearInterval(pollTimer)
        unsubReady()
        unsubConnecting()
        unsubError()
      }
    } else {
      // 浏览器开发模式：直接轮询 /health
      const poll = async (): Promise<void> => {
        try {
          const res = await fetch('http://127.0.0.1:18899/health')
          if (res.ok) {
            setServerReady(true)
            return
          }
        } catch {
          // 尚未就绪
        }
        setTimeout(poll, 1000)
      }
      poll()
    }
  }, [setServerReady, setServerError, setConnectingProgress])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#3b82f6',
          borderRadius: 8,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        },
      }}
    >
      {serverReady ? <MainLayout /> : <LoadingScreen />}
    </ConfigProvider>
  )
}

export default App
