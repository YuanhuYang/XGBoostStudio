import React from 'react'
import { Modal, Steps, Typography, Space, Tag } from 'antd'
import {
  ReadOutlined,
  BulbOutlined,
  ExperimentOutlined,
  BookOutlined,
  BarChartOutlined,
  ScissorOutlined,
  LineChartOutlined,
  RocketOutlined,
  DatabaseOutlined,
  ToolOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { useAppStore, type WorkflowMode } from '../store/appStore'

const { Title, Paragraph, Text } = Typography

const onboardingContent: Record<WorkflowMode, {
  title: string
  subtitle: string
  icon: React.ReactNode
  accentColor: string
  steps: { title: string; description: string; icon: React.ReactNode }[]
}> = {
  preprocess: {
    title: '欢迎使用数据处理模式',
    subtitle: '侧栏聚焦导入、分析与特征工程，产出可用于训练的数据集划分',
    icon: <DatabaseOutlined style={{ fontSize: 32, color: '#38bdf8' }} />,
    accentColor: '#38bdf8',
    steps: [
      { title: '数据工作台', description: '上传或选择数据集并在顶栏激活上下文', icon: <DatabaseOutlined /> },
      { title: '特征分析', description: 'IV/KS/PSI 等质量洞察，为工程与建模提供依据', icon: <BarChartOutlined /> },
      { title: '特征工程与划分', description: '完成特征处理并创建训练用 Split，供模型调优模式使用', icon: <ToolOutlined /> },
      { title: '与向导的关系', description: '六步智能向导仍在「智能向导」模式中；本模式适合分步深耕数据准备', icon: <BulbOutlined /> },
    ],
  },
  guided: {
    title: '欢迎使用智能向导模式',
    subtitle: '侧栏仅「向导工作台」：六步全程引导，零代码输出专业结论；数据准备请用「数据处理」',
    icon: <BulbOutlined style={{ fontSize: 32, color: '#3b82f6' }} />,
    accentColor: '#3b82f6',
    steps: [
      { title: '选择数据集', description: '从已导入数据中选择，系统自动分析', icon: <BarChartOutlined /> },
      { title: '自动分析', description: 'IV/KS/PSI 特征质量全自动评估', icon: <ExperimentOutlined /> },
      { title: '智能配置', description: '基于数据特性自动推荐最优参数', icon: <BulbOutlined /> },
      { title: '一键训练', description: '训练 + 交叉验证 + 过拟合诊断', icon: <BookOutlined /> },
    ],
  },
  learning: {
    title: '欢迎进入模型调优模式',
    subtitle: '侧栏首项为「调优工作台」：在已划分数据集上专注训练与超参搜索',
    icon: <ReadOutlined style={{ fontSize: 32, color: '#a78bfa' }} />,
    accentColor: '#a78bfa',
    steps: [
      { title: '从调优工作台开始', description: '查看数据集、划分与主模型状态，按推荐进入各子页', icon: <BarChartOutlined /> },
      { title: '前置条件', description: '须已激活数据集（进入本模式前会校验），并在顶栏选择训练划分；新建划分请用「数据处理 → 特征工程」', icon: <ReadOutlined /> },
      { title: '训练与超参调优', description: '参数配置、模型训练与超参数调优；参数页可使用教学卡片与参数实验室', icon: <ExperimentOutlined /> },
      { title: '确定主模型', description: '在模型管理中对比与登记，将满意模型设为主模型上下文', icon: <BookOutlined /> },
    ],
  },
  expert: {
    title: '欢迎使用专家分析模式',
    subtitle: '侧栏为模型工作台与评估/管理/报告/预测；顶栏可选对比模型。不含参数配置、训练与超参搜索（请在「模型调优」完成）',
    icon: <ExperimentOutlined style={{ fontSize: 32, color: '#22c55e' }} />,
    accentColor: '#22c55e',
    steps: [
      { title: '多模型对比', description: '工作台与模型管理支持横向对比、统计检验与主模型选定', icon: <BarChartOutlined /> },
      { title: '模型评估', description: '深入查看指标与图表，挖掘业务可落地的结论', icon: <LineChartOutlined /> },
      { title: '分析报告', description: '导出 PDF 报告，便于汇报与留档验收', icon: <ReadOutlined /> },
      { title: '交互预测', description: '单条与批量预测，核对线上可用性与字段一致性', icon: <RocketOutlined /> },
      { title: 'Ctrl+K', description: '快速跳转到本模式可用模块', icon: <SearchOutlined /> },
    ],
  },
}

interface ModeOnboardingModalProps {
  mode: WorkflowMode
  open: boolean
  onClose: () => void
}

const ModeOnboardingModal: React.FC<ModeOnboardingModalProps> = ({ mode, open, onClose }) => {
  const markModeVisited = useAppStore(s => s.markModeVisited)
  const content = onboardingContent[mode]

  const handleClose = () => {
    markModeVisited(mode)
    onClose()
  }

  return (
    <Modal
      open={open}
      onOk={handleClose}
      onCancel={handleClose}
      okText="开始使用"
      cancelButtonProps={{ style: { display: 'none' } }}
      width={540}
      title={null}
      centered
    >
      <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
        <div style={{ marginBottom: 12 }}>{content.icon}</div>
        <Title level={4} style={{ marginBottom: 4 }}>{content.title}</Title>
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>{content.subtitle}</Paragraph>
        <Tag color={content.accentColor} style={{ marginBottom: 20 }}>v0.5 · 四模式导航</Tag>
      </div>

      <Steps
        direction="vertical"
        size="small"
        current={-1}
        items={content.steps.map(s => ({
          title: <Text strong>{s.title}</Text>,
          description: <Text type="secondary" style={{ fontSize: 12 }}>{s.description}</Text>,
          icon: <span style={{ color: content.accentColor }}>{s.icon}</span>,
        }))}
      />

      <div style={{
        marginTop: 16,
        padding: '10px 14px',
        background: '#1e293b',
        borderRadius: 8,
        border: '1px solid #334155',
      }}>
        <Space>
          <Text style={{ fontSize: 12, color: '#94a3b8' }}>
            💡 提示：可随时通过顶部模式切换器在四种模式间切换，数据集、划分与模型状态始终保留。
          </Text>
        </Space>
      </div>
    </Modal>
  )
}

export default ModeOnboardingModal
