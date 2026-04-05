import React, { useState, useCallback } from 'react'
import {
  Card, Row, Col, Select, Button, Tabs, Table, Typography, Space,
  Tag, Spin, message, Statistic, Progress, Alert, Divider, Descriptions,
  Steps,
} from 'antd'
import { BarChartOutlined, ExperimentOutlined, ApartmentOutlined, DatabaseOutlined, ToolOutlined, SettingOutlined, PlayCircleOutlined } from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import apiClient from '../../api/client'
import { useAppStore } from '../../store/appStore'
import { useDatasetColumns } from '../../hooks/useDatasetColumns'
import HelpButton from '../../components/HelpButton'

const { Title, Text } = Typography

// ─── 分布拟合结果类型 ─────────────────────────────────────────────────────────
interface DistTestResult {
  column: string
  n: number
  mean: number
  std: number
  skewness: number
  kurtosis: number
  tests: { distribution: string; ks_stat: number | null; ks_p: number | null; ks_pass: boolean; ad_stat: number | null; ad_pass: boolean | null }[]
  best_fit: string | null
  is_normal: boolean
  recommendation: string
}

// ─── PCA 结果类型 ────────────────────────────────────────────────────────────
interface PcaResult {
  n_components: number
  n_features: number
  n_samples: number
  features: string[]
  explained_variance: number[]
  cumulative_variance: number[]
  loadings: Record<string, number | string>[]
  biplot_points: { x: number; y: number }[]
  recommendation: string
}


const FeatureAnalysisPage: React.FC = () => {
  const activeDatasetId = useAppStore(s => s.activeDatasetId)
  const { allColumns, numericColumns } = useDatasetColumns(activeDatasetId)
  const [loading, setLoading] = useState<string | null>(null)
  const [distributions, setDistributions] = useState<Record<string, unknown>[]>([])
  const [correlation, setCorrelation] = useState<{ matrix: number[][]; columns: string[] } | null>(null)
  const [corrMethod, setCorrMethod] = useState('pearson')
  const [vif, setVif] = useState<{ column: string; vif: number; level: string }[]>([])
  const [importance, setImportance] = useState<{ column: string; importance: number }[]>([])
  const [targetCol, setTargetCol] = useState('')
  // 分布拟合检验
  const [distTestCol, setDistTestCol] = useState('')
  const [distTestResult, setDistTestResult] = useState<DistTestResult | null>(null)
  // PCA
  const [pcaResult, setPcaResult] = useState<PcaResult | null>(null)

  const load = useCallback(async (type: string) => {
    if (!activeDatasetId) { message.warning('请先在数据导入页面选择数据集'); return }
    setLoading(type)
    try {
      if (type === 'dist') {
        const r = await apiClient.get(`/api/datasets/${activeDatasetId}/feature-analysis/distribution`)
        setDistributions((r.data as Record<string, unknown>[]) || [])
      } else if (type === 'corr') {
        const r = await apiClient.get(`/api/datasets/${activeDatasetId}/feature-analysis/correlation`, { params: { method: corrMethod } })
        setCorrelation(r.data)
      } else if (type === 'vif') {
        const r = await apiClient.get(`/api/datasets/${activeDatasetId}/feature-analysis/vif`)
        setVif((r.data as { column: string; vif: number; level: string }[]) || [])
      } else if (type === 'imp') {
        const r = await apiClient.get(`/api/datasets/${activeDatasetId}/feature-analysis/importance-preliminary`, { params: { target_column: targetCol } })
        setImportance((r.data as { column: string; importance: number }[]) || [])
      } else if (type === 'disttest') {
        if (!distTestCol) { message.warning('请输入列名'); setLoading(null); return }
        const r = await apiClient.get(`/api/datasets/${activeDatasetId}/feature-analysis/distribution-test`, { params: { column: distTestCol } })
        setDistTestResult(r.data as DistTestResult)
      } else if (type === 'pca') {
        const r = await apiClient.get(`/api/datasets/${activeDatasetId}/feature-analysis/pca`)
        setPcaResult(r.data as PcaResult)
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || `${type} 分析失败`)
    } finally {
      setLoading(null)
    }
  }, [activeDatasetId, corrMethod, targetCol, distTestCol])

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
    yAxis: { type: 'category', data: importance.slice(0, 20).map(d => d.column) },
    series: [{ type: 'bar', data: importance.slice(0, 20).map(d => d.importance), itemStyle: { color: '#3b82f6' } }]
  } : null

  const distCols = [
    { title: '特征', dataIndex: 'column', key: 'column', sorter: (a: Record<string, unknown>, b: Record<string, unknown>) => String(a.column).localeCompare(String(b.column)) },
    { title: '均値', dataIndex: 'mean', key: 'mean', render: (v: number) => v?.toFixed(4), sorter: (a: Record<string, unknown>, b: Record<string, unknown>) => ((a.mean as number) ?? 0) - ((b.mean as number) ?? 0) },
    { title: '标准差', dataIndex: 'std', key: 'std', render: (v: number) => v?.toFixed(4), sorter: (a: Record<string, unknown>, b: Record<string, unknown>) => ((a.std as number) ?? 0) - ((b.std as number) ?? 0) },
    { title: '偏度', dataIndex: 'skewness', key: 'skewness', render: (v: number) => v?.toFixed(4), sorter: (a: Record<string, unknown>, b: Record<string, unknown>) => ((a.skewness as number) ?? 0) - ((b.skewness as number) ?? 0) },
    { title: '峰度', dataIndex: 'kurtosis', key: 'kurtosis', render: (v: number) => v?.toFixed(4), sorter: (a: Record<string, unknown>, b: Record<string, unknown>) => ((a.kurtosis as number) ?? 0) - ((b.kurtosis as number) ?? 0) },
    { title: '正态检验(p)', dataIndex: 'normality_p', key: 'normality_p', render: (v: number) => {
      if (v == null) return '-'
      return <Tag color={v > 0.05 ? 'green' : 'red'}>{v?.toFixed(4)}</Tag>
    }, sorter: (a: Record<string, unknown>, b: Record<string, unknown>) => ((a.normality_p as number) ?? 0) - ((b.normality_p as number) ?? 0) },
    { title: '缺失率', dataIndex: 'missing_rate', key: 'missing_rate', render: (v: number) => v != null ? `${(v * 100).toFixed(1)}%` : '-', sorter: (a: Record<string, unknown>, b: Record<string, unknown>) => ((a.missing_rate as number) ?? 0) - ((b.missing_rate as number) ?? 0) }
  ]

  const activeSplitId = useAppStore(s => s.activeSplitId)
  const activeModelId = useAppStore(s => s.activeModelId)

  const expertSteps = [
    { title: '数据导入', icon: <DatabaseOutlined /> },
    { title: '特征分析', icon: <BarChartOutlined /> },
    { title: '特征工程', icon: <ToolOutlined /> },
    { title: '参数配置', icon: <SettingOutlined /> },
    { title: '模型训练', icon: <PlayCircleOutlined /> },
  ]

  // 计算当前进度：找到第一个未完成的步骤
  const currentStep = (() => {
    if (!activeDatasetId) return 0
    if (!activeSplitId) return 1
    if (!activeModelId) return 3
    return 4
  })()

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ color: '#60a5fa', marginBottom: 16 }}>
        <BarChartOutlined /> 特征分析
      </Title>
      <HelpButton pageTitle="特征分析" items={[
        { title: '如何分析特征分布？', content: '在「分布统计」 Tab 选择列名，查看直方图、缺失率、分位数等统计信息。' },
        { title: '相关性分析有个使用建议？', content: '相关系数 |r| > 0.7 考虑删除其中一个;相关系数 > 0.5 且与目标列相关的特征通常更重要。' },
        { title: 'SHAP 与特征重要性有何区别？', content: 'SHAP 基于模型预测计算特征贡献，相比统计相关性更准确地反映模型真实依赖。' },
      ]} />

      {/* 专家流程进度概览 */}
      <Card style={{ marginBottom: 24, background: '#1e293b', border: '1px solid #334155' }}>
        <Steps current={currentStep} size="small" items={expertSteps} />
      </Card>

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
                <Table columns={distCols} dataSource={distributions.map((d, i) => ({ ...d, key: i }))} size="small"
                  pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'], showTotal: (t) => `共 ${t} 个特征` }} />
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
                    { title: '特征', dataIndex: 'column', key: 'column' },
                    { title: 'VIF值', dataIndex: 'vif', key: 'vif', render: (v: number) => {
                      const color = v > 10 ? 'red' : v > 5 ? 'orange' : 'green'
                      return <Tag color={color}>{v?.toFixed(2)}</Tag>
                    }, sorter: (a: { vif: number }, b: { vif: number }) => a.vif - b.vif },
                    { title: '共线性风险', dataIndex: 'vif', key: 'risk', render: (v: number) => v > 10 ? '高' : v > 5 ? '中' : '低' }
                  ]}
                  size="small"
                  pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'], showTotal: (t) => `共 ${t} 项` }}
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
                  <Select
                    showSearch
                    placeholder="选择目标列"
                    value={targetCol || undefined}
                    onChange={v => setTargetCol(v)}
                    options={allColumns.map(c => ({ value: c, label: c }))}
                    style={{ width: 200 }}
                    allowClear
                  />
                  <Button type="primary" onClick={() => load('imp')} loading={loading === 'imp'}>分析重要性</Button>
                </Space>
                {impOption && <ReactECharts option={impOption} style={{ height: 400 }} />}
              </Card>
            )
          },
          {
            key: 'disttest', label: '分布拟合检验',
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Space style={{ marginBottom: 12 }} wrap>
                  <Text style={{ color: '#94a3b8' }}>列名：</Text>
                  <Select
                    showSearch
                    placeholder="选择要检验的列"
                    value={distTestCol || undefined}
                    onChange={v => setDistTestCol(v)}
                    options={numericColumns.map(c => ({ value: c, label: c }))}
                    style={{ width: 220 }}
                    allowClear
                  />
                  <Button type="primary" onClick={() => load('disttest')} loading={loading === 'disttest'}>
                    分布拟合检验
                  </Button>
                </Space>
                {distTestResult && (
                  <Space direction="vertical" style={{ width: '100%' }} size={16}>
                    <Alert
                      type={distTestResult.is_normal ? 'success' : 'warning'}
                      message={distTestResult.recommendation}
                      showIcon
                    />
                    <Row gutter={16}>
                      <Col span={6}><Statistic title="样本量" value={distTestResult.n} /></Col>
                      <Col span={6}><Statistic title="均值" value={distTestResult.mean.toFixed(4)} /></Col>
                      <Col span={6}><Statistic title="偏度" value={distTestResult.skewness.toFixed(4)} valueStyle={{ color: Math.abs(distTestResult.skewness) > 1 ? '#faad14' : '#52c41a' }} /></Col>
                      <Col span={6}><Statistic title="峰度" value={distTestResult.kurtosis.toFixed(4)} /></Col>
                    </Row>
                    <Table
                      size="small"
                      pagination={false}
                      dataSource={distTestResult.tests.map((t, i) => ({ ...t, key: i }))}
                      columns={[
                        { title: '分布类型', dataIndex: 'distribution', key: 'dist', render: (v: string) => (
                          <Space>
                            <span>{v}</span>
                            {distTestResult.best_fit === v && <Tag color="blue">最佳拟合</Tag>}
                          </Space>
                        )},
                        { title: 'KS 统计量', dataIndex: 'ks_stat', key: 'ks_stat', render: (v: number | null) => v != null ? v.toFixed(4) : '—' },
                        { title: 'KS p 值', dataIndex: 'ks_p', key: 'ks_p', render: (v: number | null, row: { ks_pass: boolean }) => {
                          if (v == null) return '—'
                          return <Tag color={row.ks_pass ? 'green' : 'red'}>{v.toFixed(4)}{row.ks_pass ? ' ✓' : ' ✗'}</Tag>
                        }},
                        { title: 'Anderson-Darling 统计量', dataIndex: 'ad_stat', key: 'ad_stat', render: (v: number | null, row: { ad_pass: boolean | null }) => {
                          if (v == null) return '—'
                          return <Tag color={row.ad_pass ? 'green' : 'red'}>{v.toFixed(4)}{row.ad_pass ? ' ✓' : ' ✗'}</Tag>
                        }},
                      ]}
                    />
                  </Space>
                )}
              </Card>
            )
          },
          {
            key: 'pca', label: 'PCA 辅助分析',
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Button type="primary" onClick={() => load('pca')} loading={loading === 'pca'} style={{ marginBottom: 16 }}>
                  运行 PCA 分析
                </Button>
                {pcaResult && (
                  <Space direction="vertical" style={{ width: '100%' }} size={16}>
                    <Alert type="info" message={pcaResult.recommendation} showIcon />
                    <Row gutter={16}>
                      <Col span={8}>
                        <Statistic title="特征数" value={pcaResult.n_features} />
                      </Col>
                      <Col span={8}>
                        <Statistic title="样本数" value={pcaResult.n_samples} />
                      </Col>
                      <Col span={8}>
                        <Statistic title="主成分数" value={pcaResult.n_components} />
                      </Col>
                    </Row>

                    {/* 碎石图（Scree Plot） */}
                    <ReactECharts
                      option={{
                        title: { text: '碎石图（Scree Plot）', textStyle: { fontSize: 13, color: '#94a3b8' } },
                        tooltip: { trigger: 'axis' },
                        legend: { data: ['各成分方差', '累计方差'], textStyle: { color: '#94a3b8' } },
                        xAxis: { type: 'category', name: '主成分', data: pcaResult.explained_variance.map((_, i) => `PC${i + 1}`),
                          axisLabel: { color: '#94a3b8' } },
                        yAxis: [
                          { type: 'value', name: '解释方差比', axisLabel: { formatter: '{value}', color: '#94a3b8' } },
                          { type: 'value', name: '累计方差比', axisLabel: { formatter: '{value}', color: '#94a3b8' } },
                        ],
                        series: [
                          { name: '各成分方差', type: 'bar', data: pcaResult.explained_variance, itemStyle: { color: '#1677ff' } },
                          { name: '累计方差', type: 'line', yAxisIndex: 1, data: pcaResult.cumulative_variance,
                            itemStyle: { color: '#52c41a' }, symbol: 'circle',
                            markLine: { data: [{ yAxis: 0.95, name: '95%', lineStyle: { color: '#faad14', type: 'dashed' } }] } },
                        ],
                        backgroundColor: 'transparent',
                      }}
                      style={{ height: 280 }}
                    />

                    {/* 双标图（Biplot） */}
                    {pcaResult.biplot_points.length > 0 && (
                      <ReactECharts
                        option={{
                          title: { text: '双标图（PC1 vs PC2 样本分布 + 特征载荷）', textStyle: { fontSize: 13, color: '#94a3b8' } },
                          tooltip: { trigger: 'item' },
                          xAxis: { type: 'value', name: 'PC1', axisLabel: { color: '#94a3b8' } },
                          yAxis: { type: 'value', name: 'PC2', axisLabel: { color: '#94a3b8' } },
                          series: [
                            {
                              type: 'scatter',
                              name: '样本',
                              data: pcaResult.biplot_points.map(p => [p.x, p.y]),
                              symbolSize: 4,
                              itemStyle: { color: '#1677ff', opacity: 0.5 },
                            },
                            {
                              type: 'scatter',
                              name: '特征载荷',
                              data: pcaResult.loadings.map(l => [
                                (l['PC1'] as number) * 3,
                                (l['PC2'] as number) * 3,
                                l['feature'] as string,
                              ]),
                              symbolSize: 8,
                              itemStyle: { color: '#ff4d4f' },
                              label: {
                                show: true,
                                formatter: (p: { value: (number | string)[] }) => p.value[2] as string,
                                color: '#faad14',
                                fontSize: 10,
                                position: 'top',
                              },
                            },
                          ],
                          backgroundColor: 'transparent',
                        }}
                        style={{ height: 320 }}
                      />
                    )}

                    {/* 载荷表 */}
                    <Table
                      size="small"
                      pagination={{ pageSize: 10 }}
                      dataSource={pcaResult.loadings.map((l, i) => ({ ...l, key: i }))}
                      columns={[
                        { title: '特征', dataIndex: 'feature', key: 'feature', fixed: 'left' as const, width: 120 },
                        ...Array.from({ length: Math.min(pcaResult.n_components, 5) }, (_, j) => ({
                          title: `PC${j + 1}`,
                          dataIndex: `PC${j + 1}`,
                          key: `pc${j + 1}`,
                          render: (v: number) => {
                            const abs = Math.abs(v)
                            const color = abs > 0.5 ? '#1677ff' : abs > 0.3 ? '#52c41a' : '#8c8c8c'
                            return <Text style={{ color }}>{v.toFixed(4)}</Text>
                          },
                        })),
                      ]}
                      scroll={{ x: 600 }}
                    />
                  </Space>
                )}
              </Card>
            )
          },
        ]}
      />
    </div>
  )
}

export default FeatureAnalysisPage
