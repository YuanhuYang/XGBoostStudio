import React, { useState, useCallback } from 'react'
import {
  Card, Row, Col, Select, Button, Tabs, Table, Typography, Space,
  Tag, Spin, message, Statistic, Progress, Alert, Divider
} from 'antd'
import { BarChartOutlined, ExperimentOutlined, ApartmentOutlined } from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import apiClient from '../../api/client'
import { useAppStore } from '../../store/appStore'

const { Title, Text } = Typography

const FeatureAnalysisPage: React.FC = () => {
  const activeDatasetId = useAppStore(s => s.activeDatasetId)
  const [loading, setLoading] = useState<string | null>(null)
  const [distributions, setDistributions] = useState<Record<string, unknown>[]>([])
  const [correlation, setCorrelation] = useState<{ matrix: number[][]; columns: string[] } | null>(null)
  const [corrMethod, setCorrMethod] = useState('pearson')
  const [vif, setVif] = useState<{ feature: string; vif: number }[]>([])
  const [importance, setImportance] = useState<{ feature: string; score: number }[]>([])
  const [targetCol, setTargetCol] = useState('')

  const load = useCallback(async (type: string) => {
    if (!activeDatasetId) { message.warning('请先在数据导入页面选择数据集'); return }
    setLoading(type)
    try {
      if (type === 'dist') {
        const r = await apiClient.get(`/api/datasets/${activeDatasetId}/feature-analysis/distribution`)
        setDistributions(r.data?.features || [])
      } else if (type === 'corr') {
        const r = await apiClient.get(`/api/datasets/${activeDatasetId}/feature-analysis/correlation`, { params: { method: corrMethod } })
        setCorrelation(r.data)
      } else if (type === 'vif') {
        const r = await apiClient.get(`/api/datasets/${activeDatasetId}/feature-analysis/vif`)
        setVif(r.data?.vif || [])
      } else if (type === 'imp') {
        const r = await apiClient.get(`/api/datasets/${activeDatasetId}/feature-analysis/importance-preliminary`, { params: { target_column: targetCol } })
        setImportance(r.data?.importance || [])
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || `${type} 分析失败`)
    } finally {
      setLoading(null)
    }
  }, [activeDatasetId, corrMethod, targetCol])

  const corrOption = correlation ? {
    tooltip: { trigger: 'item' },
    visualMap: { min: -1, max: 1, calculable: true, inRange: { color: ['#1d4ed8', '#e2e8f0', '#dc2626'] } },
    xAxis: { type: 'category', data: correlation.columns, axisLabel: { rotate: 45, fontSize: 10 } },
    yAxis: { type: 'category', data: [...correlation.columns].reverse() },
    series: [{
      type: 'heatmap',
      data: correlation.matrix.flatMap((row, i) => row.map((v, j) => [j, correlation.matrix.length - 1 - i, +v.toFixed(3)])),
      label: { show: correlation.columns.length <= 15, formatter: (p: { value: number[] }) => p.value[2].toFixed(2), fontSize: 9 }
    }]
  } : null

  const impOption = importance.length > 0 ? {
    tooltip: {},
    grid: { left: 120 },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: importance.slice(0, 20).map(d => d.feature) },
    series: [{ type: 'bar', data: importance.slice(0, 20).map(d => d.score), itemStyle: { color: '#3b82f6' } }]
  } : null

  const distCols = [
    { title: '特征', dataIndex: 'feature', key: 'feature' },
    { title: '均值', dataIndex: 'mean', key: 'mean', render: (v: number) => v?.toFixed(4) },
    { title: '标准差', dataIndex: 'std', key: 'std', render: (v: number) => v?.toFixed(4) },
    { title: '偏度', dataIndex: 'skewness', key: 'skewness', render: (v: number) => v?.toFixed(4) },
    { title: '峰度', dataIndex: 'kurtosis', key: 'kurtosis', render: (v: number) => v?.toFixed(4) },
    { title: '正态检验(p)', dataIndex: 'shapiro_p', key: 'shapiro_p', render: (v: number) => {
      if (v == null) return '-'
      return <Tag color={v > 0.05 ? 'green' : 'red'}>{v?.toFixed(4)}</Tag>
    }},
    { title: '缺失率', dataIndex: 'missing_rate', key: 'missing_rate', render: (v: number) => v != null ? `${(v * 100).toFixed(1)}%` : '-' }
  ]

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ color: '#60a5fa', marginBottom: 24 }}>
        <BarChartOutlined /> 特征分析
      </Title>
      {!activeDatasetId && <Alert message="请先在「数据导入」页面选择并设置目标列的数据集" type="warning" showIcon style={{ marginBottom: 16 }} />}

      <Tabs
        items={[
          {
            key: 'dist', label: '分布统计',
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Space style={{ marginBottom: 12 }}>
                  <Button type="primary" onClick={() => load('dist')} loading={loading === 'dist'}>分析分布</Button>
                </Space>
                <Table columns={distCols} dataSource={distributions.map((d, i) => ({ ...d, key: i }))} size="small" />
              </Card>
            )
          },
          {
            key: 'corr', label: '相关性矩阵',
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Space style={{ marginBottom: 12 }}>
                  <Select value={corrMethod} onChange={setCorrMethod}
                    options={[{ value: 'pearson', label: 'Pearson' }, { value: 'spearman', label: 'Spearman' }, { value: 'kendall', label: 'Kendall' }]}
                    style={{ width: 140 }} />
                  <Button type="primary" onClick={() => load('corr')} loading={loading === 'corr'}>计算相关性</Button>
                </Space>
                {corrOption && <ReactECharts option={corrOption} style={{ height: 500 }} />}
              </Card>
            )
          },
          {
            key: 'vif', label: 'VIF 多重共线性',
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Button type="primary" onClick={() => load('vif')} loading={loading === 'vif'} style={{ marginBottom: 12 }}>计算VIF</Button>
                <Table
                  dataSource={vif.map((d, i) => ({ ...d, key: i }))}
                  columns={[
                    { title: '特征', dataIndex: 'feature', key: 'feature' },
                    { title: 'VIF值', dataIndex: 'vif', key: 'vif', render: (v: number) => {
                      const color = v > 10 ? 'red' : v > 5 ? 'orange' : 'green'
                      return <Tag color={color}>{v?.toFixed(2)}</Tag>
                    }},
                    { title: '共线性风险', dataIndex: 'vif', key: 'risk', render: (v: number) => v > 10 ? '高' : v > 5 ? '中' : '低' }
                  ]}
                  size="small"
                />
              </Card>
            )
          },
          {
            key: 'imp', label: '特征重要性（初步）',
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Space style={{ marginBottom: 12 }}>
                  <Text style={{ color: '#94a3b8' }}>目标列：</Text>
                  <input
                    placeholder="输入目标列名"
                    value={targetCol}
                    onChange={e => setTargetCol(e.target.value)}
                    style={{ padding: '4px 8px', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 4 }}
                  />
                  <Button type="primary" onClick={() => load('imp')} loading={loading === 'imp'}>分析重要性</Button>
                </Space>
                {impOption && <ReactECharts option={impOption} style={{ height: 400 }} />}
              </Card>
            )
          }
        ]}
      />
    </div>
  )
}

export default FeatureAnalysisPage
