import React from 'react'
import { Segmented, Tooltip } from 'antd'
import {
  CompassOutlined,
  BookOutlined,
  CrownOutlined,
  FilterOutlined,
} from '@ant-design/icons'
import { useAppStore, type WorkflowMode } from '../store/appStore'

const modeOptions: {
  value: WorkflowMode
  icon: React.ReactNode
  label: string
  tooltip: string
}[] = [
  {
    value: 'guided',
    icon: <CompassOutlined />,
    label: '智能向导',
    tooltip:
      '智能向导：六步工作台全程引导，默认含参数教学与概念展开；分步做数据准备请使用「数据处理」模式',
  },
  {
    value: 'preprocess',
    icon: <FilterOutlined />,
    label: '数据处理',
    tooltip:
      '数据处理：数据导入、特征分析与特征工程，产出训练用划分；顶栏可选择「训练划分」与主模型',
  },
  {
    value: 'learning',
    icon: <BookOutlined />,
    label: '模型调优',
    tooltip:
      '模型调优：在已划分数据集上专注参数配置、训练、超参搜索与模型管理；输入为划分，输出为模型',
  },
  {
    value: 'expert',
    icon: <CrownOutlined />,
    label: '专家分析',
    tooltip:
      '专家分析：对比与评估已有模型、报告与预测交付；不包含训练与超参数搜索',
  },
]

interface ModeSwitcherProps {
  isTraining?: boolean
  onSwitchRequest?: (mode: WorkflowMode) => void
}

const ModeSwitcher: React.FC<ModeSwitcherProps> = ({ isTraining, onSwitchRequest }) => {
  const workflowMode = useAppStore(s => s.workflowMode)
  const setWorkflowMode = useAppStore(s => s.setWorkflowMode)

  const handleChange = (val: string | number) => {
    const mode = val as WorkflowMode
    if (onSwitchRequest) {
      onSwitchRequest(mode)
      return
    }
    if (isTraining) {
      return
    }
    setWorkflowMode(mode)
  }

  return (
    <Segmented
      className="mode-switcher-segmented"
      value={workflowMode}
      onChange={handleChange}
      size="small"
      shape="round"
      options={modeOptions.map(opt => ({
        value: opt.value,
        label: (
          <Tooltip title={opt.tooltip} placement="bottom">
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 2px' }}>
              {opt.icon}
              <span style={{ fontSize: 11 }}>{opt.label}</span>
            </span>
          </Tooltip>
        ),
      }))}
      style={{
        background: '#0f172a',
        border: '1px solid #334155',
        lineHeight: 1,
      }}
    />
  )
}

export default ModeSwitcher
