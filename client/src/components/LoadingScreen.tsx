import React from 'react'
import { Spin } from 'antd'
import { useAppStore } from '../store/appStore'

const LoadingScreen: React.FC = () => {
  const { connectingProgress, serverError } = useAppStore()

  return (
    <div className="loading-screen">
      <div className="logo">XGBoost Studio</div>
      <div className="subtitle">专业可视化 XGBoost 建模平台</div>
      {serverError ? (
        <div style={{ color: '#f87171', fontSize: 13, marginTop: 12 }}>{serverError}</div>
      ) : (
        <>
          <Spin size="large" />
          <div className="status-text">
            {connectingProgress
              ? `正在连接后端服务... (${connectingProgress.attempt}/${connectingProgress.max})`
              : '正在启动后端服务，请稍候...'}
          </div>
        </>
      )}
    </div>
  )
}

export default LoadingScreen
