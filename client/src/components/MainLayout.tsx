import React, { useState, useEffect } from 'react'
import { Layout, Menu, Typography, Tooltip, Button, Badge, Tag, Space, Alert } from 'antd'
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
  CheckCircleFilled,
  CloseCircleFilled,
  EditOutlined,
} from '@ant-design/icons'
import { useAppStore } from '../store/appStore'
import HelpButton, { type HelpItem } from './HelpButton'

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

const { Sider, Content, Header } = Layout
const { Text } = Typography

type PageKey =
  | 'welcome'
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

// 定义页面依赖关系：每个页面完成的条件是什么
const pageCompletion: Record<PageKey, (state: {
  activeDatasetId: number | null
  activeSplitId: number | null
  activeModelId: number | null
}) => boolean> = {
  welcome: () => true,
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

// 生成菜单项（带状态指示器）
const buildMenuItems = (state: {
  activeDatasetId: number | null
  activeSplitId: number | null
  activeModelId: number | null
}): MenuProps['items'] => [
  {
    key: 'smart-workflow',
    icon: <Badge dot offset={[4, -2]}><BulbOutlined /></Badge>,
    label: '智能向导',
  },
  { type: 'divider' },
  {
    key: 'group-data',
    label: '📊 数据准备',
    type: 'group',
    children: [
      {
        key: 'data-import',
        icon: <DatabaseOutlined />,
        label: pageCompletion['data-import'](state) ? '✓ 数据导入' : '○ 数据导入',
      },
      {
        key: 'feature-analysis',
        icon: <BarChartOutlined />,
        label: pageCompletion['feature-analysis'](state) ? '✓ 特征分析' : '○ 特征分析',
      },
      {
        key: 'feature-engineering',
        icon: <ToolOutlined />,
        label: pageCompletion['feature-engineering'](state) ? '✓ 特征工程' : '○ 特征工程',
      },
    ],
  },
  {
    key: 'group-model-build',
    label: '⚙️ 模型构建',
    type: 'group',
    children: [
      {
        key: 'param-config',
        icon: <SettingOutlined />,
        label: pageCompletion['param-config'](state) ? '✓ 参数配置' : '○ 参数配置',
      },
      {
        key: 'model-training',
        icon: <PlayCircleOutlined />,
        label: pageCompletion['model-training'](state) ? '✓ 模型训练' : '○ 模型训练',
      },
    ],
  },
  {
    key: 'group-model-optimize',
    label: '📈 模型优化',
    type: 'group',
    children: [
      {
        key: 'model-eval',
        icon: <LineChartOutlined />,
        label: pageCompletion['model-eval'](state) ? '✓ 模型评估' : '○ 模型评估',
      },
      {
        key: 'model-tuning',
        icon: <ThunderboltOutlined />,
        label: pageCompletion['model-tuning'](state) ? '✓ 模型调优' : '○ 模型调优',
      },
    ],
  },
  {
    key: 'group-model-management',
    label: '📦 模型管理',
    type: 'group',
    children: [
      {
        key: 'model-management',
        icon: <AppstoreOutlined />,
        label: pageCompletion['model-management'](state) ? '✓ 模型管理' : '○ 模型管理',
      },
    ],
  },
  {
    key: 'group-output',
    label: '📄 结果输出',
    type: 'group',
    children: [
      {
        key: 'report',
        icon: <FileTextOutlined />,
        label: pageCompletion['report'](state) ? '✓ 分析报告' : '○ 分析报告',
      },
      {
        key: 'prediction',
        icon: <RocketOutlined />,
        label: pageCompletion['prediction'](state) ? '✓ 交互预测' : '○ 交互预测',
      },
    ],
  },
]

const pageMap: Record<PageKey, React.ReactNode> = {
  welcome: <WelcomePage />,
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

const pageTitles: Record<PageKey, string> = {
  welcome: '欢迎页',
  'smart-workflow': '智能工作流',
  'data-import': '数据导入',
  'feature-analysis': '特征分析',
  'feature-engineering': '特征工程',
  'param-config': '超参数配置',
  'model-training': '模型训练',
  'model-eval': '模型评估',
  'model-tuning': '超参数调优',
  'model-management': '模型管理',
  report: '分析报告',
  prediction: '交互预测',
}

const pageHelpMap: Record<PageKey, HelpItem[]> = {
  welcome: [
    { title: '如何开始？', content: '建议先完成数据导入，再按特征工程、模型训练、模型评估、报告导出的顺序推进。' },
    { title: '内置示例（离线）', content: '欢迎页可一键导入 Titanic / Boston Housing / Iris，数据来自后端随包 CSV（server/tests/data/），无需联网。导入后会跳转数据导入并弹出目标列设置。' },
    {
      title: '最佳实践文档',
      content:
        '完整步骤、指标解读与进阶练习见项目 docs/best-practices/ 目录（README 与 01～03 篇）。'
        + ' 开发克隆仓库即可在本地打开；安装版若附带文档请以安装目录或发行说明为准。',
    },
    { title: '必须按流程吗？', content: '不强制，你可以从左侧菜单直接跳转到任意模块。' },
    { title: '看不到数据怎么办？', content: '请先在数据导入中激活数据集，顶部上下文标签会显示当前状态。' },
  ],
  'smart-workflow': [
    { title: '模式如何选择？', content: '导向模式适合快速完成流程；学习模式会显示更多参数解释。' },
    { title: '推荐流程顺序', content: '选择数据集 → 自动预处理 → 快速配置 → 训练模型 → 查看评估 → 导出报告。' },
    { title: '实验模式用途', content: '可并行对比多组参数，快速找到更优配置。' },
  ],
  'data-import': [
    { title: '支持哪些文件？', content: '支持 CSV/XLSX，建议优先使用 UTF-8 编码。' },
    {
      title: '内置示例与最佳实践',
      content:
        '「一键导入」使用后端本地 CSV（server/tests/data/），离线可用。'
        + ' 分步说明与验收指标见 docs/best-practices/（源码 docs 目录；安装版以附带文档为准）。',
    },
    { title: '导入后下一步？', content: '先在特征分析查看数据质量，再进入特征工程处理。' },
    { title: '数据过大怎么办？', content: '先抽样验证流程，再用完整数据训练。' },
  ],
  'feature-analysis': [
    { title: '先看哪几个指标？', content: '优先看缺失率、分布偏度、与目标列相关性。' },
    { title: '相关性怎么用？', content: '高度相关特征可考虑删一保一，减少冗余。' },
    { title: '统计结果用于什么？', content: '用于指导缺失值处理、编码与缩放策略。' },
  ],
  'feature-engineering': [
    { title: '标签页建议顺序', content: '缺失值处理 → 异常值处理 → 编码 → 缩放 → PCA（可选）→ 数据划分。' },
    { title: '分层采样何时使用？', content: '分类任务建议开启；回归任务会自动禁用。' },
    { title: '划分完成后做什么？', content: '记录 Split ID，并在模型训练/智能工作流中使用。' },
  ],
  'param-config': [
    { title: '预设怎么选？', content: '默认推荐均衡推荐；快速验证适合试跑；深度训练适合追求极致指标。' },
    { title: '关键参数有哪些？', content: 'n_estimators、max_depth、learning_rate 是最核心三项。' },
    { title: '如何复用参数？', content: '可复制当前 JSON 到模型训练页直接使用。' },
  ],
  'model-training': [
    { title: '训练前置条件', content: '需先有有效 Split ID。' },
    { title: '训练慢怎么调？', content: '先降低 n_estimators 和 max_depth 做快速试验。' },
    { title: '训练后去哪看结果？', content: '进入模型评估查看 AUC、混淆矩阵、SHAP 等。' },
  ],
  'model-eval': [
    { title: '先看哪项指标？', content: '分类任务优先 AUC/F1，回归任务优先 R2/RMSE。' },
    { title: '单次划分与 K 折', content: '默认指标为单次 hold-out，未估计指标方差；可用「K 折交叉验证」在训练集上得到各折与 summary（均值±标准差）。' },
    { title: '指标含义（摘要）', content: 'Accuracy=预测正确比例；AUC-ROC=正类排序区分能力（0.5≈随机）；RMSE=√(均方误差)。基线在训练集上拟合 Dummy，在测试集上对比。详见 PDF「模型评估结果」与 API evaluation_protocol。' },
    { title: '评估后下一步？', content: '可回到调参页优化，或直接生成报告。' },
  ],
  'model-tuning': [
    { title: 'Trials 设多少？', content: '建议从 30-100 开始，先快速收敛再扩大搜索。' },
    { title: '调参目标怎么选？', content: '分类建议 AUC/F1，回归建议 R2 或 RMSE。' },
    { title: '最优参数如何落地？', content: '直接应用最优参数并重新训练最终模型。' },
  ],
  'model-management': [
    { title: '主要指标色块含义', content: '优秀/良好/尚可/待提升用于快速判断模型可用性。' },
    { title: '如何添加备注？', content: '点击编辑按钮可修改模型名称和备注。' },
    { title: '对比功能怎么用？', content: '勾选多个模型后点击对比，查看指标与统计检验差异。' },
  ],
  report: [
    { title: '报告内容如何选择？', content: '可按需勾选章节，生成定制 PDF。' },
    { title: '报告失败如何排查？', content: '先确认模型评估数据完整，再重新生成。' },
    { title: '报告用于什么？', content: '可直接用于项目汇报与结果留档。' },
  ],
  prediction: [
    { title: '支持批量预测吗？', content: '支持 CSV/XLSX 批量预测并导出结果。' },
    { title: '能看概率吗？', content: '分类任务可输出每个类别的概率列。' },
    { title: '结果异常怎么办？', content: '先核对输入字段与训练时特征是否一致。' },
  ],
}

const MainLayout: React.FC = () => {
  // 首次启动展示欢迎页
  const isFirstLaunch = !localStorage.getItem('xgb_launched_before')
  const [currentPage, setCurrentPage] = useState<PageKey>(isFirstLaunch ? 'welcome' : 'smart-workflow')
  const { sidebarCollapsed, toggleSidebar } = useAppStore()
  const activeDatasetName = useAppStore(s => s.activeDatasetName)
  const activeDatasetId = useAppStore(s => s.activeDatasetId)
  const activeSplitId = useAppStore(s => s.activeSplitId)
  const activeModelId = useAppStore(s => s.activeModelId)
  const globalError = useAppStore(s => s.globalError)
  const setGlobalError = useAppStore(s => s.setGlobalError)
  const serverReady = useAppStore(s => s.serverReady)
  const isOffline = useAppStore(s => s.isOffline)

  // 根据当前状态动态生成菜单项（带状态指示器）
  const menuItems = buildMenuItems({ activeDatasetId, activeSplitId, activeModelId })

  // 找到推荐的下一步：第一个未完成的页面
  const recommendedNextStep = pageOrder.find(page => !pageCompletion[page]({ activeDatasetId, activeSplitId, activeModelId }))

  // 默认打开所有分组（用户可以手动折叠）
  const defaultOpenKeys = ['group-data', 'group-model-build', 'group-model-optimize', 'group-model-management', 'group-output']

  // 如果有推荐下一步，确保它的分组是打开的
  const getGroupKey = (pageKey: PageKey): string | null => {
    if (['data-import', 'feature-analysis', 'feature-engineering'].includes(pageKey)) return 'group-data'
    if (['param-config', 'model-training'].includes(pageKey)) return 'group-model-build'
    if (['model-eval', 'model-tuning'].includes(pageKey)) return 'group-model-optimize'
    if (['model-management'].includes(pageKey)) return 'group-model-management'
    if (['report', 'prediction'].includes(pageKey)) return 'group-output'
    return null
  }

  // 使用推荐高亮：如果有下一步，将它加入高亮
  const selectedKeys = recommendedNextStep && currentPage === 'welcome'
    ? [currentPage, recommendedNextStep]
    : [currentPage]

  // 保持所有分组打开
  const openKeys = defaultOpenKeys

  // 监听页面内导航事件（由 SmartWorkflow 触发）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (detail && Object.keys(pageMap).includes(detail)) {
        setCurrentPage(detail as PageKey)
        localStorage.setItem('xgb_launched_before', '1')
      }
    }
    window.addEventListener('navigate', handler)
    return () => window.removeEventListener('navigate', handler)
  }, [])

  return (
    <Layout style={{ height: '100vh', background: '#0f172a' }}>
      {/* 全局错误 Banner */}
      {globalError && (
        <Alert
          type="error"
          message={globalError}
          closable
          onClose={() => setGlobalError(null)}
          style={{ borderRadius: 0, zIndex: 1000 }}
        />
      )}
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
          selectedKeys={selectedKeys}
          openKeys={openKeys}
          items={menuItems}
          style={{ background: 'transparent', border: 'none', marginTop: 8 }}
          theme="dark"
          onClick={({ key }) => {
            setCurrentPage(key as PageKey)
            localStorage.setItem('xgb_launched_before', '1')
          }}
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
            {pageTitles[currentPage] || ''}
          </Text>

          {/* 右侧上下文状态栏 */}
          <div style={{ marginLeft: 'auto' }}>
            <Space size={4}>
              <HelpButton
                inHeader
                pageTitle={pageTitles[currentPage]}
                items={pageHelpMap[currentPage]}
              />
              {/* 后端连接状态 */}
              <Tooltip title={serverReady ? '后端服务已连接' : '后端服务未连接'}>
                {serverReady && !isOffline
                  ? <CheckCircleFilled style={{ color: '#52c41a', fontSize: 14 }} />
                  : <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: 14 }} />}
              </Tooltip>
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
                <Tooltip title="点击前往「数据导入」选择并激活数据集">
                  <Tag
                    color="default"
                    style={{ color: '#475569', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setCurrentPage('data-import')}
                  >📊 — 未设置 — <EditOutlined style={{ fontSize: 10 }} /></Tag>
                </Tooltip>
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
                <Tooltip title="点击前往「特征工程」完成数据划分">
                  <Tag
                    color="default"
                    style={{ color: '#475569', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setCurrentPage('feature-engineering')}
                  >✂️ — 未设置 — <EditOutlined style={{ fontSize: 10 }} /></Tag>
                </Tooltip>
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
                <Tooltip title="点击前往「模型训练」完成训练后激活模型">
                  <Tag
                    color="default"
                    style={{ color: '#475569', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setCurrentPage('model-training')}
                  >🤖 — 未设置 — <EditOutlined style={{ fontSize: 10 }} /></Tag>
                </Tooltip>
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
        {/* 底部状态栏 */}
        <div style={{
          height: 24, background: '#1e293b', borderTop: '1px solid #334155',
          padding: '0 16px', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Text style={{ color: '#475569', fontSize: 11 }}>
            XGBoost Studio v{(window as unknown as { __APP_VERSION__?: string }).__APP_VERSION__ ?? '0.1.0'}
          </Text>
          <Text style={{ color: '#334155', fontSize: 11 }}>|</Text>
          {serverReady && !isOffline
            ? <Text style={{ color: '#52c41a', fontSize: 11 }}>● 服务已连接</Text>
            : <Text style={{ color: '#ff4d4f', fontSize: 11 }}>● 服务未连接</Text>}
          {isOffline && <Text style={{ color: '#fa8c16', fontSize: 11 }}>▲ 网络离线</Text>}
        </div>
      </Layout>
    </Layout>
  )
}

export default MainLayout
