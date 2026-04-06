import React, { useState } from 'react'
import {
  Card, Slider, InputNumber, Row, Col, Popover, Tag, Collapse, Typography, Space
} from 'antd'
import { QuestionCircleOutlined, BookOutlined } from '@ant-design/icons'
import { useAppStore } from '../store/appStore'
import { showTeachingUi } from '../utils/teachingUi'
import LearningPanel from './LearningPanel'

const { Text, Paragraph } = Typography

export interface ParamSchema {
  name: string
  label: string
  type: string
  default: number | string
  min?: number
  max?: number
  step?: number
  log_scale?: boolean
  options?: string[]
  tooltip?: string
  impact_up?: string
  impact_down?: string
  overfitting_risk?: string
  beginner_hide?: boolean
  learn_more?: string
  math_note?: string
  tuning_tips?: string
}

interface Props {
  schema: ParamSchema
  value: number | string
  onChange: (v: number | string) => void
  explanation?: string
}

const riskColor: Record<string, string> = {
  low: '#52c41a',
  medium: '#fa8c16',
  high: '#f5222d',
}
const riskLabel: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
}

const ParamExplainCard: React.FC<Props> = ({ schema, value, onChange, explanation }) => {
  const [learnOpen, setLearnOpen] = useState(false)
  const workflowMode = useAppStore(s => s.workflowMode)
  const showLearn = showTeachingUi(workflowMode)

  if (schema.type === 'select') {
    return (
      <Card size="small" style={{ marginBottom: 8 }}>
        <Row align="middle" gutter={8}>
          <Col flex="auto">
            <Text strong>{schema.label}</Text>
          </Col>
          <Col>
            <select
              value={value as string}
              onChange={e => onChange(e.target.value)}
              style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #d9d9d9' }}
            >
              {(schema.options || []).map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </Col>
        </Row>
        {explanation && (
          <Paragraph type="secondary" style={{ marginTop: 6, marginBottom: 0, fontSize: 12 }}>
            {explanation}
          </Paragraph>
        )}
      </Card>
    )
  }

  const numVal = typeof value === 'number' ? value : Number(value)

  // 风险着色逻辑：根据当前值在范围内的位置和参数过拟合风险动态着色滑块
  const getRiskTrackColor = (): string => {
    if (!schema.min || schema.max === undefined || schema.max === schema.min) return '#3b82f6'
    const norm = (numVal - (schema.min ?? 0)) / ((schema.max ?? 1) - (schema.min ?? 0))
    if (schema.overfitting_risk === 'high') {
      if (norm > 0.7) return '#ef4444'   // 红：高风险区
      if (norm > 0.4) return '#f59e0b'   // 橙：中风险区
      return '#22c55e'                    // 绿：安全区
    }
    if (schema.overfitting_risk === 'medium') {
      if (norm > 0.85) return '#f59e0b'
      return '#3b82f6'
    }
    return '#3b82f6'
  }
  const trackColor = getRiskTrackColor()

  const popoverContent = (
    <div style={{ maxWidth: 300 }}>
      {explanation && (
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>推荐原因</Text>
          <Paragraph style={{ marginBottom: 4, fontSize: 13 }}>{explanation}</Paragraph>
        </div>
      )}
      {schema.impact_up && schema.impact_up !== 'N/A（选择型参数）' && (
        <div style={{ marginBottom: 6 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>↑ 调大效果</Text>
          <Paragraph style={{ marginBottom: 4, fontSize: 13 }}>{schema.impact_up}</Paragraph>
        </div>
      )}
      {schema.impact_down && schema.impact_down !== 'N/A（选择型参数）' && (
        <div style={{ marginBottom: 6 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>↓ 调小效果</Text>
          <Paragraph style={{ marginBottom: 4, fontSize: 13 }}>{schema.impact_down}</Paragraph>
        </div>
      )}
      {schema.overfitting_risk && (
        <Space>
          <Text type="secondary" style={{ fontSize: 12 }}>过拟合风险（调大时）：</Text>
          <Tag color={riskColor[schema.overfitting_risk]}>
            {riskLabel[schema.overfitting_risk] || schema.overfitting_risk}
          </Tag>
        </Space>
      )}
    </div>
  )

  return (
    <Card size="small" style={{ marginBottom: 8 }}>
      <Row align="middle" gutter={8}>
        <Col flex="auto">
          <Space>
            <Text strong>{schema.label}</Text>
            <Popover
              content={popoverContent}
              title={schema.label}
              trigger="click"
              placement="right"
            >
              <QuestionCircleOutlined style={{ color: '#1890ff', cursor: 'pointer' }} />
            </Popover>
          </Space>
        </Col>
        <Col>
          <InputNumber
            size="small"
            value={numVal}
            min={schema.min}
            max={schema.max}
            step={schema.step}
            onChange={v => v !== null && onChange(v)}
            style={{ width: 90 }}
          />
        </Col>
      </Row>
      <Slider
        value={numVal}
        min={schema.min}
        max={schema.max}
        step={schema.step}
        onChange={v => onChange(v)}
        trackStyle={{ background: trackColor }}
        handleStyle={{ borderColor: trackColor }}
        style={{ marginTop: 4, marginBottom: 0 }}
      />
      {explanation && (
        <Paragraph type="secondary" style={{ marginTop: 4, marginBottom: showLearn ? 4 : 0, fontSize: 12 }}>
          {explanation}
        </Paragraph>
      )}
      {showLearn && (schema.learn_more || schema.math_note || schema.tuning_tips || schema.impact_up || schema.impact_down) && (
        <Collapse
          size="small"
          ghost
          activeKey={learnOpen ? ['1'] : []}
          onChange={() => setLearnOpen(!learnOpen)}
          items={[{
            key: '1',
            label: (
              <Space>
                <BookOutlined style={{ color: '#722ed1' }} />
                <Text style={{ color: '#722ed1', fontSize: 12 }}>学习此参数</Text>
              </Space>
            ),
            children: (
              <div>
                <LearningPanel
                  paramKey={schema.name}
                  title={schema.label}
                  intuition={schema.learn_more ?? schema.tooltip ?? ''}
                  riskLevel={
                    schema.overfitting_risk === 'high' ? 80
                    : schema.overfitting_risk === 'medium' ? 50
                    : 20
                  }
                  effectUp={schema.impact_up ?? '调大此参数的效果'}
                  effectDown={schema.impact_down ?? '调小此参数的效果'}
                  mathNote={schema.math_note}
                />
                {schema.tuning_tips && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: '#1e293b', borderRadius: 6 }}>
                    <Text style={{ color: '#94a3b8', fontSize: 11 }}>调参技巧：</Text>
                    <Text style={{ color: '#cbd5e1', fontSize: 12, display: 'block' }}>{schema.tuning_tips}</Text>
                  </div>
                )}
              </div>
            ),
          }]}
        />
      )}
    </Card>
  )
}

export default ParamExplainCard
