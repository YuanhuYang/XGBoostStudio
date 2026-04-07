import React, { useState, useRef } from 'react'
import {
  Modal, Space, Alert, Row, Col, Select, InputNumber,
  Button, Progress, Table, Typography, Tag,
} from 'antd'
import { ExperimentOutlined, RocketOutlined } from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import { runLabExperiment } from '../api/wizard'
import type { LabDoneEvent } from '../api/wizard'
import { message } from 'antd'

const { Text } = Typography

const PARAM_NAMES = [
  'n_estimators', 'max_depth', 'learning_rate', 'subsample', 'colsample_bytree',
  'min_child_weight', 'reg_alpha', 'reg_lambda', 'gamma', 'scale_pos_weight',
]

interface ParamLabModalProps {
  open: boolean
  onClose: () => void
  splitId: number | null
  paramValues: Record<string, number | string>
  onApplyParams?: (values: Record<string, number | string>) => void
}

type LabStep = 'config' | 'runningA' | 'runningB' | 'done'

const ParamLabModal: React.FC<ParamLabModalProps> = ({
  open,
  onClose,
  splitId,
  paramValues,
  onApplyParams,
}) => {
  const [labParam, setLabParam] = useState<string>('max_depth')
  const [labValueA, setLabValueA] = useState<number>(3)
  const [labValueB, setLabValueB] = useState<number>(10)
  const [labStep, setLabStep] = useState<LabStep>('config')
  const [labCurveA, setLabCurveA] = useState<number[]>([])
  const [labCurveB, setLabCurveB] = useState<number[]>([])
  const [labMetricsA, setLabMetricsA] = useState<Record<string, number> | null>(null)
  const [labMetricsB, setLabMetricsB] = useState<Record<string, number> | null>(null)
  const [labProgressA, setLabProgressA] = useState(0)
  const [labProgressB, setLabProgressB] = useState(0)
  const cancelLabRef = useRef<(() => void) | null>(null)

  const handleClose = () => {
    cancelLabRef.current?.()
    setLabStep('config')
    setLabCurveA([])
    setLabCurveB([])
    setLabMetricsA(null)
    setLabMetricsB(null)
    setLabProgressA(0)
    setLabProgressB(0)
    onClose()
  }

  const handleReset = () => {
    cancelLabRef.current?.()
    setLabStep('config')
    setLabCurveA([])
    setLabCurveB([])
    setLabMetricsA(null)
    setLabMetricsB(null)
    setLabProgressA(0)
    setLabProgressB(0)
  }

  const handleRunLab = () => {
    if (!splitId) return
    const paramsA = { ...paramValues, [labParam]: labValueA }
    const paramsB = { ...paramValues, [labParam]: labValueB }
    setLabStep('runningA')
    setLabCurveA([])
    setLabCurveB([])
    setLabProgressA(0)
    setLabProgressB(0)

    const cancelA = runLabExperiment(
      { split_id: splitId, params: paramsA as Record<string, unknown> },
      (ev) => {
        setLabCurveA(prev => [...prev, ev.val_loss])
        setLabProgressA(Math.round((ev.round / ev.total) * 100))
      },
      (doneA: LabDoneEvent) => {
        setLabMetricsA(doneA.metrics)
        setLabStep('runningB')
        const cancelB = runLabExperiment(
          { split_id: splitId, params: paramsB as Record<string, unknown> },
          (ev) => {
            setLabCurveB(prev => [...prev, ev.val_loss])
            setLabProgressB(Math.round((ev.round / ev.total) * 100))
          },
          (doneB: LabDoneEvent) => {
            setLabMetricsB(doneB.metrics)
            setLabStep('done')
          },
          (err) => {
            message.error(`配置 B 训练失败：${err}`)
            setLabStep('config')
          },
        )
        cancelLabRef.current = cancelB
      },
      (err) => {
        message.error(`配置 A 训练失败：${err}`)
        setLabStep('config')
      },
    )
    cancelLabRef.current = cancelA
  }

  const curveOption = {
    title: {
      text: labStep === 'done'
        ? `验证集损失曲线对比（${labParam}: A=${labValueA} vs B=${labValueB}）`
        : '验证集损失曲线（实时）',
      textStyle: { fontSize: 13 },
    },
    tooltip: { trigger: 'axis' },
    legend: { data: [`A: ${labParam}=${labValueA}`, `B: ${labParam}=${labValueB}`] },
    xAxis: {
      type: 'category',
      name: '轮次',
      data: Array.from(
        { length: Math.max(labCurveA.length, labCurveB.length) },
        (_, i) => i + 1,
      ),
    },
    yAxis: { type: 'value', name: 'Val Loss', scale: true },
    series: [
      { name: `A: ${labParam}=${labValueA}`, type: 'line', data: labCurveA, smooth: true, itemStyle: { color: '#1677ff' }, symbol: 'none' },
      { name: `B: ${labParam}=${labValueB}`, type: 'line', data: labCurveB, smooth: true, itemStyle: { color: '#ff4d4f' }, symbol: 'none' },
    ],
  }

  return (
    <Modal
      title={<Space><ExperimentOutlined /><span>⚗️ 参数对比实验</span></Space>}
      open={open}
      onCancel={handleClose}
      footer={null}
      width={760}
      destroyOnClose
    >
      {labStep === 'config' && (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <Alert
            type="info"
            message="智能向导、数据处理与模型调优模式：用同一份数据对比两组参数的训练效果，直观体验参数对模型的影响（专家分析不展示入口）"
            showIcon
          />
          {!splitId && (
            <Alert type="warning" message="请先完成数据划分（选择有效 Split ID）后再使用参数实验" showIcon />
          )}
          <Row gutter={16} align="middle">
            <Col span={8}>
              <Text strong>对比参数：</Text>
              <Select
                style={{ width: '100%', marginTop: 4 }}
                value={labParam}
                onChange={setLabParam}
              >
                {PARAM_NAMES.map(p => (
                  <Select.Option key={p} value={p}>{p}</Select.Option>
                ))}
              </Select>
            </Col>
            <Col span={8}>
              <Text strong>配置 A 值：</Text>
              <InputNumber
                style={{ width: '100%', marginTop: 4 }}
                value={labValueA}
                min={0}
                step={1}
                onChange={v => setLabValueA(v ?? 1)}
              />
            </Col>
            <Col span={8}>
              <Text strong>配置 B 值：</Text>
              <InputNumber
                style={{ width: '100%', marginTop: 4 }}
                value={labValueB}
                min={0}
                step={1}
                onChange={v => setLabValueB(v ?? 1)}
              />
            </Col>
          </Row>
          <Alert
            type="warning"
            message={`当前将对比：${labParam} = ${labValueA}（A）vs ${labValueA !== labValueB ? labValueB : '请修改 B 值使其不同'}（B），其余参数保持当前设置不变`}
            showIcon
          />
          <Button
            type="primary"
            icon={<RocketOutlined />}
            onClick={handleRunLab}
            disabled={labValueA === labValueB || !splitId}
            block
          >
            开始对比训练
          </Button>
        </Space>
      )}

      {(labStep === 'runningA' || labStep === 'runningB') && (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Tag color={labStep === 'runningA' ? 'processing' : 'success'}>
            {labStep === 'runningA'
              ? `正在训练配置 A（${labParam}=${labValueA}）…`
              : `配置 A 完成，正在训练配置 B（${labParam}=${labValueB}）…`}
          </Tag>
          <div>
            <Text type="secondary">配置 A 进度</Text>
            <Progress percent={labProgressA} status={labStep === 'runningA' ? 'active' : 'success'} size="small" />
          </div>
          <div>
            <Text type="secondary">配置 B 进度</Text>
            <Progress percent={labProgressB} status={labStep === 'runningB' ? 'active' : 'normal'} size="small" />
          </div>
          {(labCurveA.length > 0 || labCurveB.length > 0) && (
            <ReactECharts option={curveOption} style={{ height: 240 }} />
          )}
          <Button danger onClick={() => { cancelLabRef.current?.(); handleReset() }}>取消实验</Button>
        </Space>
      )}

      {labStep === 'done' && labMetricsA && labMetricsB && (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <Alert type="success" message="对比训练完成！" showIcon />
          <ReactECharts option={curveOption} style={{ height: 260 }} />
          <Table
            size="small"
            pagination={false}
            dataSource={Object.keys({ ...labMetricsA, ...labMetricsB }).map(k => ({
              key: k,
              metric: k.toUpperCase(),
              a: typeof labMetricsA[k] === 'number' ? (labMetricsA[k] as number).toFixed(4) : '—',
              b: typeof labMetricsB[k] === 'number' ? (labMetricsB[k] as number).toFixed(4) : '—',
            }))}
            columns={[
              { title: '指标', dataIndex: 'metric', width: 120 },
              { title: `配置 A（${labParam}=${labValueA}）`, dataIndex: 'a', align: 'center' as const },
              { title: `配置 B（${labParam}=${labValueB}）`, dataIndex: 'b', align: 'center' as const },
            ]}
          />
          {onApplyParams && (
            <Row gutter={12}>
              <Col span={12}>
                <Button block onClick={() => {
                  onApplyParams({ ...paramValues, [labParam]: labValueA })
                  handleClose()
                  message.success(`已应用配置 A：${labParam} = ${labValueA}`)
                }}>
                  应用配置 A（{labParam}={labValueA}）
                </Button>
              </Col>
              <Col span={12}>
                <Button type="primary" block onClick={() => {
                  onApplyParams({ ...paramValues, [labParam]: labValueB })
                  handleClose()
                  message.success(`已应用配置 B：${labParam} = ${labValueB}`)
                }}>
                  应用配置 B（{labParam}={labValueB}）
                </Button>
              </Col>
            </Row>
          )}
          <Button block onClick={handleReset}>重新配置实验</Button>
        </Space>
      )}
    </Modal>
  )
}

export default ParamLabModal
