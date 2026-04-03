import React, { useState, useEffect } from 'react'
import { Layout, Menu, Typography, Tooltip, Button, Badge, Tag, Space } from 'antd'
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
  BulbOutlined,
} from '@ant-design/icons'
import { useAppStore } from '../store/appStore'

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

const { Sider, Content, Header } = Layout
const { Text } = Typography

type PageKey =
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

const menuItems: MenuProps['items'] = [
  {
    key: 'smart-workflow',
    icon: <Badge dot offset={[4, -2]}><BulbOutlined /></Badge>,
    label: '智能向导',
  },
  { type: 'divider' },
  {
    key: 'data-import',
    icon: <DatabaseOutlined />,
    label: '数据导入',
  },
  {
    key: 'feature-analysis',
    icon: <BarChartOutlined />,
    label: '特征分析',
  },
  {
    key: 'feature-engineering',
    icon: <ToolOutlined />,
    label: '特征工程',
  },
  {
    key: 'param-config',
    icon: <SettingOutlined />,
    label: '参数配置',
  },
  {
    key: 'model-training',
    icon: <PlayCircleOutlined />,
    label: '模型训练',
  },
  {
    key: 'model-eval',
    icon: <LineChartOutlined />,
    label: '模型评估',
  },
  {
    key: 'model-tuning',
    icon: <ThunderboltOutlined />,
    label: '模型调优',
  },
  {
    key: 'model-management',
    icon: <AppstoreOutlined />,
    label: '模型管理',
  },
  {
    key: 'report',
    icon: <FileTextOutlined />,
    label: '分析报告',
  },
  {
    key: 'prediction',
    icon: <RocketOutlined />,
    label: '交互预测',
  },
]

const pageMap: Record<PageKey, React.ReactNode> = {
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

const MainLayout: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<PageKey>('smart-workflow')
  const { sidebarCollapsed, toggleSidebar } = useAppStore()
  const activeDatasetName = useAppStore(s => s.activeDatasetName)
  const activeDatasetId = useAppStore(s => s.activeDatasetId)
  const activeSplitId = useAppStore(s => s.activeSplitId)
  const activeModelId = useAppStore(s => s.activeModelId)

  // 监听页面内导航事件（由 SmartWorkflow 触发）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (detail && Object.keys(pageMap).includes(detail)) {
        setCurrentPage(detail as PageKey)
      }
    }
    window.addEventListener('navigate', handler)
    return () => window.removeEventListener('navigate', handler)
  }, [])

  return (
    <Layout style={{ height: '100vh', background: '#0f172a' }}>
      {/* 侧边栏 */}
      <Sider
        collapsed={sidebarCollapsed}
        width={200}
        collapsedWidth={56}
        style={{
          background: '#1e293b',
          borderRight: '1px solid #334155',
        }}
      >
        {/* Logo 区 */}
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
            padding: sidebarCollapsed ? 0 : '0 16px',
            borderBottom: '1px solid #334155',
          }}
        >
          {sidebarCollapsed ? (
            <Text style={{ color: '#3b82f6', fontWeight: 700, fontSize: 16 }}>XG</Text>
          ) : (
            <Text style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>XGBoost Studio</Text>
          )}
        </div>

        {/* 导航菜单 */}
        <Menu
          mode="inline"
          selectedKeys={[currentPage]}
          items={menuItems}
          style={{ background: 'transparent', border: 'none', marginTop: 8 }}
          theme="dark"
          onClick={({ key }) => setCurrentPage(key as PageKey)}
        />
      </Sider>

      <Layout style={{ background: '#0f172a' }}>
        {/* 顶部 Header */}
        <Header
          style={{
            background: '#1e293b',
            borderBottom: '1px solid #334155',
            height: 48,
            lineHeight: '48px',
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Tooltip title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}>
            <Button
              type="text"
              icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={toggleSidebar}
              style={{ color: '#94a3b8' }}
            />
          </Tooltip>
          <Text style={{ color: '#94a3b8', fontSize: 13 }}>
            {menuItems?.find((m) => m?.key === currentPage)
              ? (menuItems.find((m) => m?.key === currentPage) as { label: string }).label
              : ''}
          </Text>

          {/* 右侧上下文状态栏 */}
          <div style={{ marginLeft: 'auto' }}>
            <Space size={4}>
              {(activeDatasetId || activeDatasetName) ? (
                <Tooltip title="点击跳转至数据导入">
                  <Tag
                    color="blue"
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setCurrentPage('data-import')}
                  >
                    📊 {activeDatasetName ?? `DS#${activeDatasetId}`}
                  </Tag>
                </Tooltip>
              ) : (
                <Tag color="default" style={{ color: '#475569' }}>📊 — 未设置 —</Tag>
              )}
              {activeSplitId ? (
                <Tooltip title="点击跳转至特征工程">
                  <Tag
                    color="cyan"
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setCurrentPage('feature-engineering')}
                  >
                    ✂️ 划分#{activeSplitId}
                  </Tag>
                </Tooltip>
              ) : (
                <Tag color="default" style={{ color: '#475569' }}>✂️ — 未设置 —</Tag>
              )}
              {activeModelId ? (
                <Tooltip title="点击跳转至模型评估">
                  <Tag
                    color="green"
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setCurrentPage('model-eval')}
                  >
                    🤖 模型#{activeModelId}
                  </Tag>
                </Tooltip>
              ) : (
                <Tag color="default" style={{ color: '#475569' }}>🤖 — 未设置 —</Tag>
              )}
            </Space>
          </div>
        </Header>

        {/* 主内容区 */}
        <Content
          style={{
            overflow: 'auto',
            padding: 16,
            background: '#0f172a',
          }}
        >
          {pageMap[currentPage]}
        </Content>
      </Layout>
    </Layout>
  )
}

export default MainLayout
