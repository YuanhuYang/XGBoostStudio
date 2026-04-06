import React, { useState, useCallback } from 'react'
import {
  Card, Row, Col, Select, Button, Tabs, Table, Typography, Space,
  Tag, Spin, message, Statistic, Progress, Alert, Divider, Descriptions,
  Steps, Badge, Tooltip,
} from 'antd'
import {
  BarChartOutlined, ExperimentOutlined, ApartmentOutlined, DatabaseOutlined,
  ToolOutlined, SettingOutlined, PlayCircleOutlined, SafetyOutlined,
  LineChartOutlined, BulbOutlined, WarningOutlined, CheckCircleOutlined,
} from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import apiClient from '../../api/client'
import { useAppStore } from '../../store/appStore'
import { useDatasetColumns } from '../../hooks/useDatasetColumns'
import HelpButton from '../../components/HelpButton'

const { Title, Text } = Typography

// ─── 类型定义 ─────────────────────────────────────────────────────────────────
interface DistTestResult {
  column: string; n: number; mean: number; std: number
  skewness: number; kurtosis: number
  tests: { distribution: string; ks_stat: number | null; ks_p: number | null; ks_pass: boolean; ad_stat: number | null; ad_pass: boolean | null }[]
  best_fit: string | null; is_normal: boolean; recommendation: string
}

interface PcaResult {
  n_components: number; n_features: number; n_samples: number
  features: string[]; explained_variance: number[]; cumulative_variance: number[]
  loadings: Record<string, number | string>[]
  biplot_points: { x: number; y: number }[]; recommendation: string
}

interface IvKsRow {
  column: string; task_type: string
  iv?: number; iv_level?: string; ks?: number; single_auc?: number
  pearson_r?: number; pearson_p?: number; f_stat?: number; f_p?: number; r2?: number
}

interface PsiRow { column: string; psi: number; level: string; recommendation: string }

interface MonotonicityRow {
  column: string; spearman_rho: number; p_value: number
  direction: string; confidence: string; monotone_constraint: number
  bin_means: number[]; recommendation: string
}

interface LabelAnalysis {
  target_column: string; task_type: string; n_total: number
  n_missing_label: number; n_unique: number
  value_counts: Record<string, number>; value_counts_pct: Record<string, number>
  scale_pos_weight: number | null; class_balance_warning: string | null
  anomaly_labels: { value: number; count: number }[]
  label_stats: { mean: number | null; std: number | null; min: number | null; max: number | null }
}

interface LeakageRisk {
  feature: string; risk_level: string; root_cause: string; fix: string
  pearson_r?: number; spearman_r?: number; max_corr?: number
  leaking_rows?: number; leaking_pct?: number
}

interface LeakageResult {
  overall_risk: string
  detections: {
    label_leakage: { overall_risk: string; risks: LeakageRisk[]; summary: string; features_checked?: number; top_correlations?: { column: string; pearson_r: number; spearman_r: number }[] }
    time_leakage: { overall_risk: string; risks: LeakageRisk[]; summary: string }
    fit_leakage: { overall_risk: string; risks: LeakageRisk[]; summary: string }
  }
}

const riskColor = (risk: string) => {
  if (risk.includes('P0') || risk.includes('严重')) return 'red'
  if (risk.includes('P1') || risk.includes('警告')) return 'orange'
  if (risk.includes('通过')) return 'green'
  return 'default'
}

const FeatureAnalysisPage: React.FC = () => {
  const activeDatasetId = useAppStore(s => s.activeDatasetId)
  const { allColumns, numericColumns } = useDatasetColumns(activeDatasetId)
  const [loading, setLoading] = useState<string | null>(null)

  // 原有状态
  const [distributions, setDistributions] = useState<Record<string, unknown>[]>([])
  const [correlation, setCorrelation] = useState<{ matrix: number[][]; columns: string[] } | null>(null)
  const [corrMethod, setCorrMethod] = useState('pearson')
  const [vif, setVif] = useState<{ column: string; vif: number; level: string }[]>([])
  const [importance, setImportance] = useState<{ column: string; importance: number }[]>([])
  const [targetCol, setTargetCol] = useState('')
  const [distTestCol, setDistTestCol] = useState('')
  const [distTestResult, setDistTestResult] = useState<DistTestResult | null>(null)
  const [pcaResult, setPcaResult] = useState<PcaResult | null>(null)

  // G3-A 新增状态
  const [ivKsData, setIvKsData] = useState<IvKsRow[]>([])
  const [psiTimeCol, setPsiTimeCol] = useState('')
  const [psiData, setPsiData] = useState<PsiRow[]>([])
  const [monoData, setMonoData] = useState<MonotonicityRow[]>([])
  const [labelData, setLabelData] = useState<LabelAnalysis | null>(null)
  const [leakageData, setLeakageData] = useState<LeakageResult | null>(null)
  const [leakageTarget, setLeakageTarget] = useState('')
  const [leakageTimeCol, setLeakageTimeCol] = useState('')

  const activeSplitId = useAppStore(s => s.activeSplitId)
  const activeModelId = useAppStore(s => s.activeModelId)

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
        if (!distTestCol) { message.warning('请选择要检验的列'); setLoading(null); return }
        const r = await apiClient.get(`/api/datasets/${activeDatasetId}/feature-analysis/distribution-test`, { params: { column: distTestCol } })
        setDistTestResult(r.data as DistTestResult)
      } else if (type === 'pca') {
        const r = await apiClient.get(`/api/datasets/${activeDatasetId}/feature-analysis/pca`)
        setPcaResult(r.data as PcaResult)
      } else if (type === 'ivks') {
        if (!targetCol) { message.warning('请选择目标列'); setLoading(null); return }
        const r = await apiClient.get(`/api/datasets/${activeDatasetId}/feature-analysis/iv-ks-psi`, { params: { target_column: targetCol } })
        setIvKsData((r.data as IvKsRow[]) || [])
      } else if (type === 'psi') {
        if (!psiTimeCol) { message.warning('请选择时间/排序列'); setLoading(null); return }
        const r = await apiClient.get(`/api/datasets/${activeDatasetId}/feature-analysis/psi`, { params: { time_column: psiTimeCol, target_column: targetCol || undefined } })
        setPsiData((r.data as PsiRow[]) || [])
      } else if (type === 'mono') {
        if (!targetCol) { message.warning('请选择目标列'); setLoading(null); return }
        const r = await apiClient.get(`/api/datasets/${activeDatasetId}/feature-analysis/monotonicity`, { params: { target_column: targetCol } })
        setMonoData((r.data as MonotonicityRow[]) || [])
      } else if (type === 'label') {
        if (!targetCol) { message.warning('请选择目标列'); setLoading(null); return }
        const r = await apiClient.get(`/api/datasets/${activeDatasetId}/label-analysis`, { params: { target_column: targetCol } })
        setLabelData(r.data as LabelAnalysis)
      } else if (type === 'leakage') {
        if (!leakageTarget) { message.warning('请选择目标列'); setLoading(null); return }
        const r = await apiClient.post(`/api/datasets/${activeDatasetId}/leakage-detection`, {
          target_column: leakageTarget,
          label_time_col: leakageTimeCol || null,
          correlation_threshold: 0.9,
        })
        setLeakageData(r.data as LeakageResult)
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || `${type} 分析失败`)
    } finally {
      setLoading(null)
    }
  }, [activeDatasetId, corrMethod, targetCol, distTestCol, psiTimeCol, leakageTarget, leakageTimeCol])

  const corrOption = correlation ? {
    tooltip: { trigger: 'item' },
    visualMap: { min: -1, max: 1, calculable: true, inRange: { color: ['#1d4ed8', '#e2e8f0', '#dc2626'] } },
    xAxis: { type: 'category', data: correlation.columns, axisLabel: { rotate: 45, fontSize: 10 } },
    yAxis: { type: 'category', data: [...correlation.columns].reverse() },
    series: [{ type: 'heatmap', data: correlation.matrix.flatMap((row, i) => row.map((v, j) => [j, correlation.matrix.length - 1 - i, +v.toFixed(3)])), label: { show: correlation.columns.length <= 15, formatter: (p: { value: number[] }) => p.value[2].toFixed(2), fontSize: 9 } }]
  } : null

  const impOption = importance.length > 0 ? {
    tooltip: {}, grid: { left: 120 },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: importance.slice(0, 20).map(d => d.column) },
    series: [{ type: 'bar', data: importance.slice(0, 20).map(d => d.importance), itemStyle: { color: '#3b82f6' } }]
  } : null

  const distCols = [
    { title: '特征', dataIndex: 'column', key: 'column' },
    { title: '均值', dataIndex: 'mean', key: 'mean', render: (v: number) => v?.toFixed(4) },
    { title: '标准差', dataIndex: 'std', key: 'std', render: (v: number) => v?.toFixed(4) },
    { title: '偏度', dataIndex: 'skewness', key: 'skewness', render: (v: number) => v?.toFixed(4) },
    { title: '峰度', dataIndex: 'kurtosis', key: 'kurtosis', render: (v: number) => v?.toFixed(4) },
    { title: '正态检验(p)', dataIndex: 'normality_p', key: 'normality_p', render: (v: number) => {
      if (v == null) return '-'
      return <Tag color={v > 0.05 ? 'green' : 'red'}>{v?.toFixed(4)}</Tag>
    }},
  ]

  const expertSteps = [
    { title: '数据导入', icon: <DatabaseOutlined /> },
    { title: '特征分析', icon: <BarChartOutlined /> },
    { title: '特征工程', icon: <ToolOutlined /> },
    { title: '参数配置', icon: <SettingOutlined /> },
    { title: '模型训练', icon: <PlayCircleOutlined /> },
  ]
  const currentStep = (() => {
    if (!activeDatasetId) return 0
    if (!activeSplitId) return 1
    if (!activeModelId) return 3
    return 4
  })()

  const targetSelector = (
    <Space>
      <Text style={{ color: '#94a3b8' }}>目标列：</Text>
      <Select showSearch placeholder="选择目标列" value={targetCol || undefined} onChange={v => setTargetCol(v)}
        options={allColumns.map(c => ({ value: c, label: c }))} style={{ width: 200 }} allowClear />
    </Space>
  )

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ color: '#60a5fa', marginBottom: 16 }}>
        <BarChartOutlined /> 特征分析
      </Title>
      <HelpButton pageTitle="特征分析" items={[
        { title: '如何分析特征效力？', content: '在「IV/KS效力排名」Tab 选择目标列，分类任务输出 IV、KS、单特征AUC；回归任务输出相关系数、F值、R²。IV > 0.3 表示强预测效力。' },
        { title: 'PSI 是什么？', content: 'PSI（群体稳定性指数）衡量特征跨时间窗口的分布稳定性。PSI < 0.1 稳定可用；0.1~0.25 需关注；> 0.25 建议剔除。' },
        { title: 'monotone_constraints 如何使用？', content: '在「单调性分析」Tab 可获得每个特征的 monotone_constraints 建议值（1/-1/0），直接用于 XGBoost 参数配置，确保预测方向符合业务逻辑。' },
        { title: '如何检测数据泄露？', content: '在「泄露检测」Tab 输入目标列，系统自动检测标签泄露（特征与标签高度相关）和时间穿越泄露，输出风险等级与修复建议。' },
      ]} />

      <Card style={{ marginBottom: 24, background: '#1e293b', border: '1px solid #334155' }}>
        <Steps current={currentStep} size="small" items={expertSteps} />
      </Card>

      {!activeDatasetId && <Alert message="请先在「数据导入」页面选择并设置目标列的数据集" type="warning" showIcon style={{ marginBottom: 16 }} />}

      <Tabs
        items={[
          // ─── Tab 1：标签分析 ─────────────────────────────────────────────
          {
            key: 'label', label: <span><BulbOutlined /> 标签专项分析</span>,
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Space style={{ marginBottom: 16 }} wrap>
                  {targetSelector}
                  <Button type="primary" icon={<BulbOutlined />} onClick={() => load('label')} loading={loading === 'label'}>分析标签</Button>
                </Space>
                {labelData && (
                  <Space direction="vertical" style={{ width: '100%' }} size={16}>
                    <Row gutter={16}>
                      <Col span={6}><Statistic title="任务类型" value={labelData.task_type === 'binary_classification' ? '二分类' : labelData.task_type === 'multiclass_classification' ? '多分类' : '回归'} /></Col>
                      <Col span={6}><Statistic title="总样本量" value={labelData.n_total} /></Col>
                      <Col span={6}><Statistic title="唯一标签值" value={labelData.n_unique} /></Col>
                      <Col span={6}><Statistic title="标签缺失" value={labelData.n_missing_label} valueStyle={{ color: labelData.n_missing_label > 0 ? '#ff4d4f' : '#52c41a' }} /></Col>
                    </Row>
                    {labelData.class_balance_warning && (
                      <Alert type="warning" message={labelData.class_balance_warning} showIcon icon={<WarningOutlined />} />
                    )}
                    {labelData.scale_pos_weight != null && (
                      <Alert type="info" showIcon
                        message={<span>XGBoost 参数建议：<Text code>scale_pos_weight = {labelData.scale_pos_weight}</Text>（负样本数 / 正样本数）</span>} />
                    )}
                    <Row gutter={16}>
                      <Col span={12}>
                        <Card size="small" title="标签分布" style={{ background: '#0f172a' }}>
                          <ReactECharts
                            option={{
                              tooltip: { trigger: 'item' },
                              series: [{ type: 'pie', radius: '60%', data: Object.entries(labelData.value_counts).map(([k, v]) => ({ name: k, value: v })) }],
                              backgroundColor: 'transparent',
                            }}
                            style={{ height: 240 }}
                          />
                        </Card>
                      </Col>
                      <Col span={12}>
                        <Card size="small" title="各类别占比" style={{ background: '#0f172a' }}>
                          {Object.entries(labelData.value_counts_pct).map(([k, v]) => (
                            <div key={k} style={{ marginBottom: 8 }}>
                              <Text style={{ color: '#94a3b8' }}>{k}：</Text>
                              <Progress percent={+v} size="small" status={+v < 10 ? 'exception' : 'normal'} format={p => `${p}%`} />
                            </div>
                          ))}
                        </Card>
                      </Col>
                    </Row>
                    {labelData.anomaly_labels.length > 0 && (
                      <Alert type="error" showIcon message="检测到异常标签值"
                        description={<ul>{labelData.anomaly_labels.map((a, i) => <li key={i}>值 {a.value} 出现 {a.count} 次（IQR 3 倍外）</li>)}</ul>} />
                    )}
                  </Space>
                )}
              </Card>
            )
          },

          // ─── Tab 2：IV/KS/AUC 效力排名 ───────────────────────────────────
          {
            key: 'ivks', label: <span><LineChartOutlined /> IV/KS效力排名</span>,
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="XGBoost 适配性特征效力分析：分类任务输出 IV（信息价值）、KS（判别力）、单特征AUC；回归任务输出相关系数、F值、R²。大数据集自动采样 5 万行。" />
                <Space style={{ marginBottom: 16 }} wrap>
                  {targetSelector}
                  <Button type="primary" icon={<LineChartOutlined />} onClick={() => load('ivks')} loading={loading === 'ivks'}>计算特征效力</Button>
                </Space>
                {ivKsData.length > 0 && (
                  <>
                    <ReactECharts
                      option={{
                        title: { text: ivKsData[0]?.task_type === 'classification' ? '特征 IV 值排名（前 20）' : '特征 R² 排名（前 20）', textStyle: { color: '#94a3b8', fontSize: 13 } },
                        tooltip: {}, grid: { left: 140 },
                        xAxis: { type: 'value' },
                        yAxis: { type: 'category', data: ivKsData.slice(0, 20).map(d => d.column) },
                        series: [{ type: 'bar', data: ivKsData.slice(0, 20).map(d => ivKsData[0]?.task_type === 'classification' ? (d.iv ?? 0) : (d.r2 ?? 0)), itemStyle: { color: '#1677ff' } }],
                        backgroundColor: 'transparent',
                      }}
                      style={{ height: 320 }}
                    />
                    <Table
                      size="small"
                      dataSource={ivKsData.map((d, i) => ({ ...d, key: i }))}
                      columns={ivKsData[0]?.task_type === 'classification' ? [
                        { title: '特征', dataIndex: 'column', key: 'col', fixed: 'left' as const, width: 160 },
                        { title: 'IV值', dataIndex: 'iv', key: 'iv', render: (v: number | null) => v != null ? v.toFixed(4) : '-', sorter: (a: IvKsRow, b: IvKsRow) => (a.iv ?? 0) - (b.iv ?? 0) },
                        { title: 'IV等级', dataIndex: 'iv_level', key: 'ivl', render: (v: string) => {
                          const c = v === '强' ? 'green' : v === '中' ? 'blue' : v === '弱' ? 'orange' : 'default'
                          return <Tag color={c}>{v}</Tag>
                        }},
                        { title: 'KS值', dataIndex: 'ks', key: 'ks', render: (v: number | null) => v != null ? v.toFixed(4) : '-', sorter: (a: IvKsRow, b: IvKsRow) => (a.ks ?? 0) - (b.ks ?? 0) },
                        { title: '单特征AUC', dataIndex: 'single_auc', key: 'auc', render: (v: number | null) => {
                          if (v == null) return '-'
                          return <Tag color={v >= 0.7 ? 'green' : v >= 0.6 ? 'blue' : 'orange'}>{v.toFixed(4)}</Tag>
                        }, sorter: (a: IvKsRow, b: IvKsRow) => (a.single_auc ?? 0) - (b.single_auc ?? 0) },
                      ] : [
                        { title: '特征', dataIndex: 'column', key: 'col', fixed: 'left' as const, width: 160 },
                        { title: 'Pearson r', dataIndex: 'pearson_r', key: 'pr', render: (v: number | null) => v != null ? v.toFixed(4) : '-' },
                        { title: 'F 统计量', dataIndex: 'f_stat', key: 'fs', render: (v: number | null) => v != null ? v.toFixed(4) : '-' },
                        { title: 'R²', dataIndex: 'r2', key: 'r2', render: (v: number | null) => v != null ? v.toFixed(4) : '-', sorter: (a: IvKsRow, b: IvKsRow) => (a.r2 ?? 0) - (b.r2 ?? 0) },
                      ]}
                      pagination={{ defaultPageSize: 20, showSizeChanger: true }}
                      scroll={{ x: 600 }}
                    />
                  </>
                )}
              </Card>
            )
          },

          // ─── Tab 3：PSI 稳定性 ────────────────────────────────────────────
          {
            key: 'psi', label: <span><ApartmentOutlined /> PSI稳定性</span>,
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="群体稳定性指数（PSI）：按时间列将数据分为基准期（前60%）和对比期（后40%），PSI < 0.1 稳定；0.1~0.25 轻微变化；> 0.25 不稳定。大数据集自动采样 5 万行。" />
                <Space style={{ marginBottom: 16 }} wrap>
                  <Text style={{ color: '#94a3b8' }}>时间/排序列：</Text>
                  <Select showSearch placeholder="选择时间列" value={psiTimeCol || undefined} onChange={v => setPsiTimeCol(v)}
                    options={allColumns.map(c => ({ value: c, label: c }))} style={{ width: 200 }} allowClear />
                  {targetSelector}
                  <Button type="primary" onClick={() => load('psi')} loading={loading === 'psi'}>计算PSI</Button>
                </Space>
                {psiData.length > 0 && (
                  <>
                    <Row gutter={16} style={{ marginBottom: 12 }}>
                      <Col span={8}><Statistic title="稳定特征" value={psiData.filter(d => d.level === '稳定').length} suffix="个" valueStyle={{ color: '#52c41a' }} /></Col>
                      <Col span={8}><Statistic title="轻微变化" value={psiData.filter(d => d.level === '轻微变化').length} suffix="个" valueStyle={{ color: '#faad14' }} /></Col>
                      <Col span={8}><Statistic title="不稳定" value={psiData.filter(d => d.level === '不稳定').length} suffix="个" valueStyle={{ color: '#ff4d4f' }} /></Col>
                    </Row>
                    <ReactECharts
                      option={{
                        title: { text: 'PSI 值排名（前 30）', textStyle: { color: '#94a3b8', fontSize: 13 } },
                        tooltip: {}, grid: { left: 140 },
                        xAxis: { type: 'value', max: Math.max(...psiData.map(d => d.psi)) * 1.1 },
                        yAxis: { type: 'category', data: psiData.slice(0, 30).map(d => d.column) },
                        series: [{ type: 'bar', data: psiData.slice(0, 30).map(d => ({ value: d.psi, itemStyle: { color: d.psi > 0.25 ? '#ff4d4f' : d.psi > 0.1 ? '#faad14' : '#52c41a' } })) }],
                        markLine: { data: [{ xAxis: 0.1, name: '稳定阈值', lineStyle: { color: '#faad14', type: 'dashed' } }, { xAxis: 0.25, name: '不稳定阈值', lineStyle: { color: '#ff4d4f', type: 'dashed' } }] },
                        backgroundColor: 'transparent',
                      }}
                      style={{ height: 360 }}
                    />
                    <Table size="small"
                      dataSource={psiData.map((d, i) => ({ ...d, key: i }))}
                      columns={[
                        { title: '特征', dataIndex: 'column', key: 'col' },
                        { title: 'PSI值', dataIndex: 'psi', key: 'psi', render: (v: number) => v.toFixed(4), sorter: (a: PsiRow, b: PsiRow) => a.psi - b.psi },
                        { title: '稳定性等级', dataIndex: 'level', key: 'lvl', render: (v: string) => {
                          const c = v === '稳定' ? 'green' : v === '轻微变化' ? 'orange' : 'red'
                          return <Tag color={c}>{v}</Tag>
                        }},
                        { title: '建议', dataIndex: 'recommendation', key: 'rec', render: (v: string) => <Text style={{ color: '#94a3b8', fontSize: 12 }}>{v}</Text> },
                      ]}
                      pagination={{ defaultPageSize: 20 }} />
                  </>
                )}
              </Card>
            )
          },

          // ─── Tab 4：单调性分析 ────────────────────────────────────────────
          {
            key: 'mono', label: <span><BarChartOutlined /> 单调性分析</span>,
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="特征业务单调性分析：分析特征与目标的 Spearman 趋势相关性，输出 XGBoost monotone_constraints 建议。单调递增→1，单调递减→-1，无约束→0。" />
                <Space style={{ marginBottom: 16 }} wrap>
                  {targetSelector}
                  <Button type="primary" onClick={() => load('mono')} loading={loading === 'mono'}>分析单调性</Button>
                </Space>
                {monoData.length > 0 && (
                  <>
                    <Alert type="success" showIcon style={{ marginBottom: 12 }}
                      message={`共 ${monoData.filter(d => d.monotone_constraint !== 0).length} 个特征有强单调性约束建议，可直接用于 XGBoost 参数配置`} />
                    <Table size="small"
                      dataSource={monoData.map((d, i) => ({ ...d, key: i }))}
                      columns={[
                        { title: '特征', dataIndex: 'column', key: 'col', fixed: 'left' as const, width: 160 },
                        { title: 'Spearman ρ', dataIndex: 'spearman_rho', key: 'rho', render: (v: number) => {
                          const c = Math.abs(v) >= 0.7 ? 'blue' : Math.abs(v) >= 0.4 ? 'orange' : 'default'
                          return <Tag color={c}>{v.toFixed(4)}</Tag>
                        }, sorter: (a: MonotonicityRow, b: MonotonicityRow) => Math.abs(a.spearman_rho) - Math.abs(b.spearman_rho) },
                        { title: '方向', dataIndex: 'direction', key: 'dir', render: (v: string) => {
                          const c = v.includes('递增') ? 'green' : v.includes('递减') ? 'red' : 'default'
                          return <Tag color={c}>{v}</Tag>
                        }},
                        { title: '置信度', dataIndex: 'confidence', key: 'conf', render: (v: string) => (
                          <Tag color={v === '高' ? 'green' : v === '中' ? 'blue' : 'default'}>{v}</Tag>
                        )},
                        { title: 'monotone_constraints', dataIndex: 'monotone_constraint', key: 'mc', render: (v: number) => (
                          <Tag color={v === 1 ? 'green' : v === -1 ? 'red' : 'default'}>{v}</Tag>
                        )},
                        { title: '建议', dataIndex: 'recommendation', key: 'rec', render: (v: string) => <Text style={{ fontSize: 12, color: '#94a3b8' }}>{v}</Text> },
                      ]}
                      expandable={{ expandedRowRender: (row: MonotonicityRow) => (
                        <ReactECharts option={{
                          xAxis: { type: 'category', data: row.bin_means.map((_, i) => `分箱${i+1}`) },
                          yAxis: { type: 'value' },
                          series: [{ type: 'line', data: row.bin_means, smooth: true, itemStyle: { color: '#1677ff' } }],
                          backgroundColor: 'transparent',
                        }} style={{ height: 180 }} />
                      )}}
                      pagination={{ defaultPageSize: 20 }}
                      scroll={{ x: 700 }}
                    />
                  </>
                )}
              </Card>
            )
          },

          // ─── Tab 5：泄露检测 ──────────────────────────────────────────────
          {
            key: 'leakage', label: <span><SafetyOutlined /> 泄露检测</span>,
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Alert type="warning" showIcon style={{ marginBottom: 12 }}
                  message="全链路数据泄露检测：自动检测标签泄露（特征与标签高度相关）和时间穿越泄露（需提供时间列），输出风险等级、根因分析和修复方案。" />
                <Space style={{ marginBottom: 16 }} wrap>
                  <Text style={{ color: '#94a3b8' }}>目标列：</Text>
                  <Select showSearch placeholder="选择目标列" value={leakageTarget || undefined} onChange={v => setLeakageTarget(v)}
                    options={allColumns.map(c => ({ value: c, label: c }))} style={{ width: 200 }} allowClear />
                  <Text style={{ color: '#94a3b8' }}>时间列（可选）：</Text>
                  <Select showSearch placeholder="选择时间列（可选）" value={leakageTimeCol || undefined} onChange={v => setLeakageTimeCol(v)}
                    options={allColumns.map(c => ({ value: c, label: c }))} style={{ width: 200 }} allowClear />
                  <Button type="primary" danger icon={<SafetyOutlined />} onClick={() => load('leakage')} loading={loading === 'leakage'}>开始泄露检测</Button>
                </Space>
                {leakageData && (
                  <Space direction="vertical" style={{ width: '100%' }} size={16}>
                    <Alert type={leakageData.overall_risk.includes('P0') ? 'error' : leakageData.overall_risk.includes('P1') ? 'warning' : 'success'}
                      showIcon icon={leakageData.overall_risk.includes('通过') ? <CheckCircleOutlined /> : <WarningOutlined />}
                      message={<strong>整体风险：{leakageData.overall_risk}</strong>} />
                    {(['label_leakage', 'time_leakage', 'fit_leakage'] as const).map(key => {
                      const det = leakageData.detections[key]
                      const title = key === 'label_leakage' ? '①标签泄露检测' : key === 'time_leakage' ? '②时间穿越泄露检测' : '③拟合泄露检测'
                      return (
                        <Card key={key} size="small" title={<Space><Badge color={riskColor(det.overall_risk)} />{title}<Tag color={riskColor(det.overall_risk)}>{det.overall_risk}</Tag></Space>} style={{ background: '#0f172a' }}>
                          <Alert type="info" message={det.summary} showIcon style={{ marginBottom: 8 }} />
                          {det.risks && det.risks.length > 0 && (
                            <Table size="small" pagination={false}
                              dataSource={det.risks.map((r, i) => ({ ...r, key: i }))}
                              columns={[
                                { title: '风险特征', dataIndex: 'feature', key: 'f', width: 150 },
                                { title: '风险等级', dataIndex: 'risk_level', key: 'rl', render: (v: string) => <Tag color={riskColor(v)}>{v}</Tag> },
                                { title: '根因分析', dataIndex: 'root_cause', key: 'rc', render: (v: string) => <Text style={{ fontSize: 12, color: '#fbbf24' }}>{v}</Text> },
                                { title: '修复方案', dataIndex: 'fix', key: 'fix', render: (v: string) => <Text style={{ fontSize: 12, color: '#34d399' }}>{v}</Text> },
                              ]} />
                          )}
                          {key === 'label_leakage' && det.top_correlations && det.top_correlations.length > 0 && (
                            <details style={{ marginTop: 8 }}>
                              <summary style={{ color: '#94a3b8', cursor: 'pointer' }}>查看 TOP 10 特征相关性</summary>
                              <Table size="small" style={{ marginTop: 8 }} pagination={false}
                                dataSource={det.top_correlations.map((r, i) => ({ ...r, key: i }))}
                                columns={[
                                  { title: '特征', dataIndex: 'column', key: 'c' },
                                  { title: 'Pearson r', dataIndex: 'pearson_r', key: 'p', render: (v: number) => <Tag color={Math.abs(v) > 0.9 ? 'red' : Math.abs(v) > 0.7 ? 'orange' : 'default'}>{v.toFixed(4)}</Tag> },
                                  { title: 'Spearman r', dataIndex: 'spearman_r', key: 's', render: (v: number) => <Tag color={Math.abs(v) > 0.9 ? 'red' : Math.abs(v) > 0.7 ? 'orange' : 'default'}>{v.toFixed(4)}</Tag> },
                                ]} />
                            </details>
                          )}
                        </Card>
                      )
                    })}
                  </Space>
                )}
              </Card>
            )
          },

          // ─── Tab 6：分布统计（原有） ──────────────────────────────────────
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

          // ─── Tab 7：相关性矩阵（原有） ────────────────────────────────────
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

          // ─── Tab 8：VIF 多重共线性（原有） ───────────────────────────────
          {
            key: 'vif', label: 'VIF 共线性',
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="XGBoost 对共线性有一定鲁棒性。VIF > 10 为高共线性，但树模型中不必无脑剔除，需结合 IV/效力综合判断。" />
                <Button type="primary" onClick={() => load('vif')} loading={loading === 'vif'} style={{ marginBottom: 12 }}>计算VIF</Button>
                <Table size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true }}
                  dataSource={vif.map((d, i) => ({ ...d, key: i }))}
                  columns={[
                    { title: '特征', dataIndex: 'column', key: 'column' },
                    { title: 'VIF值', dataIndex: 'vif', key: 'vif', render: (v: number) => <Tag color={v > 10 ? 'red' : v > 5 ? 'orange' : 'green'}>{v?.toFixed(2)}</Tag>, sorter: (a: { vif: number }, b: { vif: number }) => a.vif - b.vif },
                    { title: '共线性等级', dataIndex: 'level', key: 'lvl', render: (v: string) => <Tag color={v === 'high' ? 'red' : v === 'medium' ? 'orange' : 'green'}>{v === 'high' ? '高' : v === 'medium' ? '中' : '低'}</Tag> },
                  ]} />
              </Card>
            )
          },

          // ─── Tab 9：分布拟合检验（原有） ──────────────────────────────────
          {
            key: 'disttest', label: '分布拟合检验',
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Space style={{ marginBottom: 12 }} wrap>
                  <Text style={{ color: '#94a3b8' }}>列名：</Text>
                  <Select showSearch placeholder="选择要检验的列" value={distTestCol || undefined} onChange={v => setDistTestCol(v)}
                    options={numericColumns.map(c => ({ value: c, label: c }))} style={{ width: 220 }} allowClear />
                  <Button type="primary" onClick={() => load('disttest')} loading={loading === 'disttest'}>分布拟合检验</Button>
                </Space>
                {distTestResult && (
                  <Space direction="vertical" style={{ width: '100%' }} size={16}>
                    <Alert type={distTestResult.is_normal ? 'success' : 'warning'} message={distTestResult.recommendation} showIcon />
                    <Row gutter={16}>
                      <Col span={6}><Statistic title="样本量" value={distTestResult.n} /></Col>
                      <Col span={6}><Statistic title="均值" value={distTestResult.mean.toFixed(4)} /></Col>
                      <Col span={6}><Statistic title="偏度" value={distTestResult.skewness.toFixed(4)} valueStyle={{ color: Math.abs(distTestResult.skewness) > 1 ? '#faad14' : '#52c41a' }} /></Col>
                      <Col span={6}><Statistic title="峰度" value={distTestResult.kurtosis.toFixed(4)} /></Col>
                    </Row>
                    <Table size="small" pagination={false}
                      dataSource={distTestResult.tests.map((t, i) => ({ ...t, key: i }))}
                      columns={[
                        { title: '分布类型', dataIndex: 'distribution', key: 'dist', render: (v: string) => <Space>{v}{distTestResult.best_fit === v && <Tag color="blue">最佳拟合</Tag>}</Space> },
                        { title: 'KS 统计量', dataIndex: 'ks_stat', key: 'ks', render: (v: number | null) => v != null ? v.toFixed(4) : '—' },
                        { title: 'KS p值', dataIndex: 'ks_p', key: 'ksp', render: (v: number | null, row: { ks_pass: boolean }) => v == null ? '—' : <Tag color={row.ks_pass ? 'green' : 'red'}>{v.toFixed(4)}{row.ks_pass ? ' ✓' : ' ✗'}</Tag> },
                      ]} />
                  </Space>
                )}
              </Card>
            )
          },

          // ─── Tab 10：PCA 辅助分析（原有） ────────────────────────────────
          {
            key: 'pca', label: 'PCA 降维分析',
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Button type="primary" onClick={() => load('pca')} loading={loading === 'pca'} style={{ marginBottom: 16 }}>运行 PCA 分析</Button>
                {pcaResult && (
                  <Space direction="vertical" style={{ width: '100%' }} size={16}>
                    <Alert type="info" message={pcaResult.recommendation} showIcon />
                    <Row gutter={16}>
                      <Col span={8}><Statistic title="特征数" value={pcaResult.n_features} /></Col>
                      <Col span={8}><Statistic title="样本数" value={pcaResult.n_samples} /></Col>
                      <Col span={8}><Statistic title="主成分数" value={pcaResult.n_components} /></Col>
                    </Row>
                    <ReactECharts
                      option={{
                        title: { text: '碎石图（Scree Plot）', textStyle: { fontSize: 13, color: '#94a3b8' } },
                        tooltip: { trigger: 'axis' },
                        legend: { data: ['各成分方差', '累计方差'], textStyle: { color: '#94a3b8' } },
                        xAxis: { type: 'category', name: '主成分', data: pcaResult.explained_variance.map((_, i) => `PC${i + 1}`), axisLabel: { color: '#94a3b8' } },
                        yAxis: [
                          { type: 'value', name: '解释方差比', axisLabel: { color: '#94a3b8' } },
                          { type: 'value', name: '累计方差比', axisLabel: { color: '#94a3b8' } },
                        ],
                        series: [
                          { name: '各成分方差', type: 'bar', data: pcaResult.explained_variance, itemStyle: { color: '#1677ff' } },
                          { name: '累计方差', type: 'line', yAxisIndex: 1, data: pcaResult.cumulative_variance, itemStyle: { color: '#52c41a' }, symbol: 'circle' },
                        ],
                        backgroundColor: 'transparent',
                      }}
                      style={{ height: 280 }}
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
