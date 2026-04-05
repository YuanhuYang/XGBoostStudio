import React, { useState } from 'react'
import { Card, Col, Row, Typography, Button, Space, Divider, message } from 'antd'
import {
  RocketOutlined,
  BarChartOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  BookOutlined,
  ImportOutlined,
} from '@ant-design/icons'
import { datasetsApi } from '../../api/datasets'
import { useAppStore } from '../../store/appStore'

const { Title, Paragraph } = Typography

const steps = [
  {
    icon: <RocketOutlined style={{ fontSize: 32, color: '#1677ff' }} />,
    title: '1. 导入数据',
    desc: '上传 CSV / Excel 数据集，配置目标列与特征列',
    pageKey: 'data-import',
  },
  {
    icon: <ExperimentOutlined style={{ fontSize: 32, color: '#52c41a' }} />,
    title: '2. 训练模型',
    desc: '一键训练 XGBoost 模型，自动超参数搜索',
    pageKey: 'model-training',
  },
  {
    icon: <BarChartOutlined style={{ fontSize: 32, color: '#fa8c16' }} />,
    title: '3. 评估模型',
    desc: '查看 ROC、混淆矩阵、SHAP 特征重要性等评估结果',
    pageKey: 'model-eval',
  },
  {
    icon: <FileTextOutlined style={{ fontSize: 32, color: '#722ed1' }} />,
    title: '4. 导出报告',
    desc: '生成专业 PDF 报告，支持章节自定义和多模型对比',
    pageKey: 'report',
  },
]

const WELCOME_SAMPLES = [
  { key: 'titanic' as const, label: 'Titanic', task: '二分类' },
  { key: 'boston' as const, label: 'Boston', task: '回归' },
  { key: 'iris' as const, label: 'Iris', task: '多分类' },
]

const WelcomePage: React.FC = () => {
  const navigateTo = (pageKey: string) => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: pageKey }))
  }
  const setActiveDatasetId = useAppStore(s => s.setActiveDatasetId)
  const setActiveDatasetName = useAppStore(s => s.setActiveDatasetName)
  const [sampleLoading, setSampleLoading] = useState<string | null>(null)

  const handleImportSample = async (key: (typeof WELCOME_SAMPLES)[number]['key']) => {
    setSampleLoading(key)
    try {
      const res = await datasetsApi.importSample(key)
      setActiveDatasetId(res.data.id)
      setActiveDatasetName(res.data.name ?? null)
      try {
        sessionStorage.setItem('xgb_open_target_for_dataset', String(res.data.id))
      } catch {
        /* ignore */
      }
      message.success('已导入内置示例，正在前往数据导入…')
      navigateTo('data-import')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '导入失败，请确认后端已启动且资源完整')
    } finally {
      setSampleLoading(null)
    }
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <Title level={2} style={{ color: '#f8fafc', marginBottom: 8 }}>
          欢迎使用 XGBoost Studio
        </Title>
        <Paragraph style={{ color: '#94a3b8', fontSize: 15 }}>
          面向业务人员的专业机器学习建模平台，无需代码即可完成数据到决策的全流程
        </Paragraph>
      </div>

      <Card
        title={
          <Space>
            <BookOutlined style={{ color: '#1677ff' }} />
            <span style={{ color: '#e2e8f0' }}>快速开始</span>
          </Space>
        }
        style={{ background: '#1e293b', border: '1px solid #334155', marginBottom: 32 }}
        styles={{ body: { padding: '12px 16px' } }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Paragraph type="secondary" style={{ margin: 0, flex: '1 1 200px' }}>
            <ImportOutlined style={{ color: '#1677ff', marginRight: 6 }} />
            内置示例离线可用，一键导入后可在数据导入页设置目标列：
          </Paragraph>
          <Space wrap size={8}>
            {WELCOME_SAMPLES.map(s => (
              <Button
                key={s.key}
                size="small"
                type="primary"
                ghost
                loading={sampleLoading === s.key}
                disabled={sampleLoading !== null && sampleLoading !== s.key}
                onClick={() => void handleImportSample(s.key)}
              >
                {s.label}（{s.task}）
              </Button>
            ))}
            <Button type="link" size="small" onClick={() => navigateTo('data-import')}>
              进入数据导入 →
            </Button>
          </Space>
        </div>
      </Card>

      <Divider style={{ borderColor: '#334155' }} />

      <Row gutter={[16, 16]}>
        {steps.map(s => (
          <Col xs={24} sm={12} key={s.title}>
            <Card
              hoverable
              onClick={() => navigateTo(s.pageKey)}
              style={{
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: 10,
                cursor: 'pointer',
              }}
              styles={{ body: { display: 'flex', gap: 16, alignItems: 'flex-start' } }}
            >
              <div style={{ flexShrink: 0 }}>{s.icon}</div>
              <div>
                <div style={{ color: '#f1f5f9', fontWeight: 600, marginBottom: 4 }}>
                  {s.title}
                </div>
                <div style={{ color: '#94a3b8', fontSize: 13 }}>{s.desc}</div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <div style={{ textAlign: 'center', marginTop: 40 }}>
        <Paragraph style={{ color: '#475569', fontSize: 12 }}>
          遇到问题？点击页面右下角的&quot;帮助&quot;按钮查看功能说明
        </Paragraph>
      </div>
    </div>
  )
}

export default WelcomePage
