import React from 'react'
import { Card, Col, Row, Typography } from 'antd'
import {
  RocketOutlined,
  BarChartOutlined,
  ExperimentOutlined,
  FileTextOutlined,
} from '@ant-design/icons'

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

const WelcomePage: React.FC = () => {
  const navigateTo = (pageKey: string) => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: pageKey }))
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <Title level={2} style={{ color: '#f8fafc', marginBottom: 8 }}>
          欢迎使用 XGBoost Studio
        </Title>
        <Paragraph style={{ color: '#94a3b8', fontSize: 15 }}>
          面向业务人员的专业机器学习建模平台，无需代码即可完成数据到决策的全流程
        </Paragraph>
      </div>

      <Row gutter={[16, 16]}>
        {steps.map((s) => (
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
          遇到问题？点击页面右下角的"帮助"按钮查看功能说明
        </Paragraph>
      </div>
    </div>
  )
}

export default WelcomePage
