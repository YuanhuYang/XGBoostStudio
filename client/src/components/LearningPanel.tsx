import React from 'react'
import { Typography, Row, Col, Progress, Tag, Divider } from 'antd'
import { ArrowUpOutlined, ArrowDownOutlined, BulbOutlined } from '@ant-design/icons'

const { Text, Paragraph } = Typography

export interface LearningPanelProps {
  paramKey: string
  title: string
  intuition: string
  /** 过拟合风险 0-100 */
  riskLevel: number
  /** 调大参数的效果描述 */
  effectUp: string
  /** 调小参数的效果描述 */
  effectDown: string
  /** 可选：数学公式/背景补充 */
  mathNote?: string
}

function riskColor(level: number): string {
  if (level >= 70) return '#ff4d4f'
  if (level >= 40) return '#fa8c16'
  return '#52c41a'
}

function riskLabel(level: number): string {
  if (level >= 70) return '高风险'
  if (level >= 40) return '中等风险'
  return '低风险'
}

const LearningPanel: React.FC<LearningPanelProps> = ({
  title,
  intuition,
  riskLevel,
  effectUp,
  effectDown,
  mathNote,
}) => {
  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #1a1f35 0%, #1e2a45 100%)',
        border: '1px solid #3b4f7a',
        borderRadius: 8,
        padding: '12px 16px',
        marginTop: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <BulbOutlined style={{ color: '#a78bfa', fontSize: 13 }} />
        <Text style={{ color: '#a78bfa', fontSize: 12, fontWeight: 600 }}>
          📚 学习卡片 · {title}
        </Text>
      </div>

      <Paragraph style={{ color: '#cbd5e1', fontSize: 12, marginBottom: 10 }}>
        {intuition}
      </Paragraph>

      {mathNote && (
        <Paragraph style={{ color: '#64748b', fontSize: 11, fontStyle: 'italic', marginBottom: 10 }}>
          {mathNote}
        </Paragraph>
      )}

      <Row gutter={8} style={{ marginBottom: 10 }}>
        <Col span={12}>
          <div
            style={{
              background: '#0d2137',
              border: '1px solid #1d4ed8',
              borderRadius: 6,
              padding: '8px 10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <ArrowUpOutlined style={{ color: '#60a5fa', fontSize: 11 }} />
              <Text style={{ color: '#93c5fd', fontSize: 11, fontWeight: 600 }}>调大时</Text>
            </div>
            <Text style={{ color: '#bfdbfe', fontSize: 11 }}>{effectUp}</Text>
          </div>
        </Col>
        <Col span={12}>
          <div
            style={{
              background: '#130d2b',
              border: '1px solid #7c3aed',
              borderRadius: 6,
              padding: '8px 10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <ArrowDownOutlined style={{ color: '#c084fc', fontSize: 11 }} />
              <Text style={{ color: '#d8b4fe', fontSize: 11, fontWeight: 600 }}>调小时</Text>
            </div>
            <Text style={{ color: '#e9d5ff', fontSize: 11 }}>{effectDown}</Text>
          </div>
        </Col>
      </Row>

      <Divider style={{ borderColor: '#334155', margin: '8px 0' }} />

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={{ color: '#94a3b8', fontSize: 11 }}>过拟合风险</Text>
          <Tag
            color={riskColor(riskLevel)}
            style={{ fontSize: 10, lineHeight: '16px', padding: '0 6px' }}
          >
            {riskLabel(riskLevel)}
          </Tag>
        </div>
        <Progress
          percent={riskLevel}
          showInfo={false}
          size="small"
          strokeColor={riskColor(riskLevel)}
          trailColor="#1e293b"
        />
      </div>
    </div>
  )
}

export default LearningPanel
