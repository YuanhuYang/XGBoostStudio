import React from 'react'
import { Modal, Alert, Space, Typography } from 'antd'
import { WarningOutlined } from '@ant-design/icons'
import { useAppStore, type WorkflowMode } from '../store/appStore'

const { Text } = Typography

const modeLabels: Record<WorkflowMode, string> = {
  guided: '智能向导',
  preprocess: '数据处理',
  learning: '模型调优',
  expert: '专家分析',
}

interface ModeTransitionModalProps {
  open: boolean
  targetMode: WorkflowMode | null
  onConfirm: (mode: WorkflowMode) => void
  onCancel: () => void
}

const ModeTransitionModal: React.FC<ModeTransitionModalProps> = ({
  open,
  targetMode,
  onConfirm,
  onCancel,
}) => {
  const { activeDatasetId, activeDatasetName, activeSplitId, activeModelId } = useAppStore()

  if (!targetMode) return null

  return (
    <Modal
      title={
        <Space>
          <WarningOutlined style={{ color: '#fa8c16' }} />
          <span>切换到{modeLabels[targetMode]}</span>
        </Space>
      }
      open={open}
      onOk={() => onConfirm(targetMode)}
      onCancel={onCancel}
      okText="确认切换"
      cancelText="继续当前任务"
      okButtonProps={{ danger: false }}
      width={480}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Alert
          type="warning"
          message="当前有训练任务正在进行"
          description="切换模式不会中断训练，训练将在后台继续运行。训练完成后结果仍可在模型训练页面查看。"
          showIcon
        />
        <div style={{ background: '#1e293b', borderRadius: 8, padding: '12px 16px' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>切换后以下状态将完整保留：</Text>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Text style={{ fontSize: 13 }}>
              ✂️ 训练划分：{activeSplitId ? `#${activeSplitId}` : '未设置'}
            </Text>
            <Text style={{ fontSize: 13 }}>
              📊 来源数据集：{activeDatasetName ?? (activeDatasetId ? `DS#${activeDatasetId}` : '未设置')}
            </Text>
            <Text style={{ fontSize: 13 }}>
              🤖 主模型：{activeModelId ? `#${activeModelId}` : '未设置'}
            </Text>
          </div>
        </div>
      </Space>
    </Modal>
  )
}

export default ModeTransitionModal
