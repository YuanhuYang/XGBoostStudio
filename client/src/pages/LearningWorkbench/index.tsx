import React, { useMemo } from 'react'
import {
  Alert, Button, Card, Col, Row, Space, Statistic, Typography,
} from 'antd'
import {
  AppstoreOutlined,
  PlayCircleOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useAppStore } from '../../store/appStore'
import { showTeachingUi } from '../../utils/teachingUi'

const { Title, Text } = Typography

const LEARNING_FLOW: { key: string; label: string; icon: React.ReactNode }[] = [
  { key: 'param-config', label: '参数配置', icon: <SettingOutlined /> },
  { key: 'model-training', label: '模型训练', icon: <PlayCircleOutlined /> },
  { key: 'model-tuning', label: '超参数调优', icon: <ThunderboltOutlined /> },
  { key: 'model-management', label: '模型管理', icon: <AppstoreOutlined /> },
]

function flowStepDone(
  pageKey: string,
  s: { activeDatasetId: number | null; activeSplitId: number | null; activeModelId: number | null },
): boolean {
  if (pageKey === 'param-config' || pageKey === 'model-training') {
    return s.activeSplitId !== null
  }
  if (pageKey === 'model-tuning' || pageKey === 'model-management') {
    return s.activeModelId !== null
  }
  return false
}

const LearningWorkbenchPage: React.FC = () => {
  const workflowMode = useAppStore(s => s.workflowMode)
  const activeDatasetId = useAppStore(s => s.activeDatasetId)
  const activeDatasetName = useAppStore(s => s.activeDatasetName)
  const activeSplitId = useAppStore(s => s.activeSplitId)
  const activeModelId = useAppStore(s => s.activeModelId)
  const showTeaching = showTeachingUi(workflowMode)

  const state = useMemo(
    () => ({ activeDatasetId, activeSplitId, activeModelId }),
    [activeDatasetId, activeSplitId, activeModelId],
  )

  const firstIncomplete = useMemo(() => {
    if (activeSplitId === null) return null as string | null
    for (const step of LEARNING_FLOW) {
      if (!flowStepDone(step.key, state)) return step.key
    }
    return null
  }, [activeSplitId, activeModelId, state])

  const go = (page: string) => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: page }))
  }

  const nextLabel = firstIncomplete
    ? LEARNING_FLOW.find(s => s.key === firstIncomplete)?.label ?? '下一环节'
    : null

  return (
    <div style={{ padding: 24 }}>
      {activeSplitId === null && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16, background: '#1e293b', borderColor: '#854d0e' }}
          message="尚未选择训练划分"
          description="请在顶栏选择「训练划分」，或在「数据处理 → 特征工程」创建划分后再进入本链路。上传数据请前往「数据工作台」。"
          action={
            <Space>
              <Button size="small" onClick={() => go('data-import')}>
                数据工作台
              </Button>
              <Button type="primary" size="small" onClick={() => go('feature-engineering')}>
                特征工程
              </Button>
            </Space>
          }
        />
      )}

      {showTeaching && (
        <Alert
          type="info"
          showIcon
          icon={<ThunderboltOutlined />}
          message="学习提示"
          description="模型调优模式与智能向导、数据处理相同，参数页可使用「学习此参数」与 ⚗️ 参数实验；训练完成后关注过拟合提示，再决定是否进入超参调优。"
          style={{ marginBottom: 16, background: '#1e293b', borderColor: '#334155' }}
        />
      )}

      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col span={8}>
          <Card size="small" style={{ background: '#1e293b', border: '1px solid #334155' }}>
            <Statistic
              title="来源数据集"
              value={activeDatasetName ?? (activeDatasetId ? `#${activeDatasetId}` : '未设置')}
              valueStyle={{ color: activeDatasetId ? '#60a5fa' : '#64748b', fontSize: 16 }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" style={{ background: '#1e293b', border: '1px solid #334155' }}>
            <Statistic
              title="训练划分"
              value={activeSplitId !== null ? `#${activeSplitId}` : '未设置'}
              valueStyle={{ color: activeSplitId ? '#22d3ee' : '#64748b', fontSize: 16 }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" style={{ background: '#1e293b', border: '1px solid #334155' }}>
            <Statistic
              title="主模型"
              value={activeModelId !== null ? `#${activeModelId}` : '未设置'}
              valueStyle={{ color: activeModelId ? '#34d399' : '#64748b', fontSize: 16 }}
            />
          </Card>
        </Col>
      </Row>

      {activeSplitId !== null && (
        <Alert
          type={firstIncomplete ? 'info' : 'success'}
          showIcon
          style={{ marginBottom: 16, background: '#1e293b', borderColor: '#334155' }}
          message={firstIncomplete ? `推荐下一步：${nextLabel}` : '链路上下文已就绪'}
          description={
            firstIncomplete
              ? '点击下方主按钮直达该环节，或使用下方快捷入口。'
              : '已具备划分与主模型上下文，可继续超参调优、对比模型或导出报告（侧栏进入对应页）。'
          }
          action={
            firstIncomplete ? (
              <Button type="primary" size="small" onClick={() => go(firstIncomplete)}>
                前往{nextLabel}
              </Button>
            ) : undefined
          }
        />
      )}

      <Title level={5} style={{ color: '#94a3b8', marginBottom: 12 }}>
        快捷入口
      </Title>
      <Row gutter={[12, 12]}>
        {LEARNING_FLOW.map(step => (
          <Col xs={24} sm={12} md={6} key={step.key}>
            <Card
              size="small"
              hoverable
              style={{
                background: '#1e293b',
                border: '1px solid #334155',
                cursor: 'pointer',
              }}
              onClick={() => go(step.key)}
            >
              <Space>
                {step.icon}
                <Text strong style={{ color: '#e2e8f0' }}>{step.label}</Text>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  )
}

export default LearningWorkbenchPage
