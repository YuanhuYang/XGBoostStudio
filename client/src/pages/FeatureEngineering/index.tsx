import React, { useState, useEffect } from 'react'
import {
  Card, Select, Button, Tabs, Typography,
  Checkbox, Slider, InputNumber, message, Alert, Form, Tooltip
} from 'antd'
import { ToolOutlined } from '@ant-design/icons'
import apiClient from '../../api/client'
import { useAppStore } from '../../store/appStore'
import { useDatasetColumns } from '../../hooks/useDatasetColumns'
import HelpButton from '../../components/HelpButton'

const { Title, Text } = Typography

const FeatureEngineeringPage: React.FC = () => {
  const activeDatasetId = useAppStore(s => s.activeDatasetId)
  const activeDatasetName = useAppStore(s => s.activeDatasetName)
  const setActiveSplitId = useAppStore(s => s.setActiveSplitId)
  const { allColumns, numericColumns, refresh: refreshColumns } = useDatasetColumns(activeDatasetId)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  // 缺失值处理
  const [missingStrategy, setMissingStrategy] = useState('mean')
  const [missingCols, setMissingCols] = useState<string[]>([])

  // 异常值处理
  const [outlierStrategy, setOutlierStrategy] = useState('clip')

  // 编码
  const [encodeMethod, setEncodeMethod] = useState('label')
  const [encodeCols, setEncodeCols] = useState<string[]>([])

  // 缩放
  const [scaleMethod, setScaleMethod] = useState('standard')
  const [scaleCols, setScaleCols] = useState<string[]>([])

  // PCA
  const [pcaComponents, setPcaComponents] = useState(5)

  // 数据集划分
  const [trainRatio, setTrainRatio] = useState(0.8)
  const [randomSeed, setRandomSeed] = useState(42)
  const [stratify, setStratify] = useState(true)
  const [targetCol, setTargetCol] = useState('')
  // 目标列为数值型（回归）时，分层采样不适用，自动取消勾选
  const isNumericTarget = targetCol !== '' && numericColumns.includes(targetCol)
  useEffect(() => {
    if (isNumericTarget) setStratify(false)
  }, [isNumericTarget])
  useEffect(() => {
    // 处理后列结构可能变化（如 PCA），及时清空已失效的目标列
    if (targetCol && !allColumns.includes(targetCol)) {
      setTargetCol('')
    }
  }, [allColumns, targetCol])
  const [splitResult, setSplitResult] = useState<{ split_id: number; train_rows: number; test_rows: number } | null>(null)
  const [splitStrategy, setSplitStrategy] = useState<'random' | 'time_series'>('random')
  const [timeColumn, setTimeColumn] = useState('')

  const exec = async (type: string, payload: unknown) => {
    if (!activeDatasetId) { message.warning('请先选择数据集'); return }
    setLoading(true)
    setResult(null)
    try {
      let url = ''
      if (type === 'missing') url = `/api/datasets/${activeDatasetId}/handle-missing`
      else if (type === 'outlier') url = `/api/datasets/${activeDatasetId}/handle-outliers`
      else if (type === 'encode') url = `/api/datasets/${activeDatasetId}/feature-engineering/encode`
      else if (type === 'scale') url = `/api/datasets/${activeDatasetId}/feature-engineering/scale`
      else if (type === 'pca') url = `/api/datasets/${activeDatasetId}/feature-engineering/pca`
      else if (type === 'dedup') url = `/api/datasets/${activeDatasetId}/drop-duplicates`
      const r = await apiClient.post(url, payload, { timeout: 120000 })
      setResult(JSON.stringify(r.data, null, 2))
      refreshColumns()
      message.success('操作成功')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string }
      message.error(err.response?.data?.detail || err.message || '操作失败')
    } finally {
      setLoading(false)
    }
  }

  const execSplit = async () => {
    if (!activeDatasetId) { message.warning('请先选择数据集'); return }
    if (!targetCol) { message.warning('请输入目标列名'); return }
    if (splitStrategy === 'time_series' && !timeColumn) {
      message.warning('时间序列划分请选择时间列')
      return
    }
    setLoading(true)
    try {
      const r = await apiClient.post(`/api/datasets/${activeDatasetId}/split`, {
        train_ratio: trainRatio,
        random_seed: randomSeed,
        stratify: splitStrategy === 'time_series' ? false : stratify,
        target_column: targetCol,
        split_strategy: splitStrategy,
        ...(splitStrategy === 'time_series' ? { time_column: timeColumn } : {}),
      })
      setSplitResult(r.data)
      setActiveSplitId(r.data.split_id)
      message.success(`划分成功！训练集: ${r.data.train_rows} 行，测试集: ${r.data.test_rows} 行`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string }
      message.error(err.response?.data?.detail || err.message || '划分失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ color: '#60a5fa', marginBottom: 24 }}>
        <ToolOutlined /> 特征工程
      </Title>
      <HelpButton pageTitle="特征工程" items={[
        { title: '标签页应该按什么顺序使用？', content: '建议顺序：缺失值处理 → 异常值处理 → 编码 → 特征缩放 →（可选）PCA降维 → 数据集划分。' },
        { title: '什么时候用分层采样？', content: '分类任务建议勾选分层采样；当目标列是连续数值（回归）时系统会自动禁用分层采样。' },
        { title: '划分成功后下一步做什么？', content: '完成数据划分后会生成 Split ID，后续在「模型训练」和「智能工作流」中直接使用该 ID。' },
        { title: '时间序列划分是什么？', content: '按选定列升序排序后，前段训练、后段测试，避免用未来信息预测过去（与 sklearn TimeSeriesSplit 的单次前向切分思想一致）。' },
      ]} />
      {!activeDatasetId && <Alert message="请先在「数据导入」页面选择数据集" type="warning" showIcon style={{ marginBottom: 16 }} />}

      <Tabs
        items={[
          {
            key: 'missing', label: '缺失值处理',
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Form layout="vertical">
                  <Form.Item label={<Text style={{ color: '#94a3b8' }}>处理策略</Text>}>
                    <Select value={missingStrategy} onChange={setMissingStrategy} style={{ width: '100%', minWidth: 240 }}
                      options={[
                        { value: 'mean', label: '均值填充（数值列推荐）' },
                        { value: 'median', label: '中位数填充' },
                        { value: 'mode', label: '众数填充（分类列推荐）' },
                        { value: 'knn', label: 'KNN邻近填充（推荐，较慢）' },
                        { value: 'constant', label: '固定值填充(0)' },
                        { value: 'drop', label: '删除含缺失的行' }
                      ]} />
                  </Form.Item>
                  <Form.Item label={<Text style={{ color: '#94a3b8' }}>指定列（留空 = 全部列）</Text>}>
                    <Select
                      mode="multiple"
                      allowClear
                      showSearch
                      placeholder="留空表示全部列"
                      value={missingCols}
                      onChange={setMissingCols}
                      options={allColumns.map(c => ({ value: c, label: c }))}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                  <Button type="primary" loading={loading}
                    onClick={() => exec('missing', {
                      strategy: missingStrategy,
                      columns: missingCols.length > 0 ? missingCols : null
                    })}>
                    执行缺失值处理
                  </Button>
                </Form>
              </Card>
            )
          },
          {
            key: 'outlier', label: '异常值处理',
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Form layout="vertical">
                  <Form.Item label={<Text style={{ color: '#94a3b8' }}>处理方式</Text>}>
                    <Select value={outlierStrategy} onChange={setOutlierStrategy} style={{ width: '100%', minWidth: 240 }}
                      options={[
                        { value: 'clip', label: 'IQR 截断（替换为上下限，推荐）' },
                        { value: 'drop', label: '删除异常行' },
                        { value: 'mean', label: '均值替换' }
                      ]} />
                  </Form.Item>
                  <Button type="primary" loading={loading}
                    onClick={() => exec('outlier', { strategy: outlierStrategy })}>
                    执行异常值处理
                  </Button>
                </Form>
              </Card>
            )
          },
          {
            key: 'encode', label: '编码',
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Form layout="vertical">
                  <Form.Item label={<Text style={{ color: '#94a3b8' }}>编码方式</Text>}>
                    <Select value={encodeMethod} onChange={setEncodeMethod} style={{ width: '100%', minWidth: 240 }}
                      options={[
                        { value: 'label', label: 'Label Encoding（序数/二分类）' },
                        { value: 'onehot', label: 'One-Hot Encoding（多分类推荐）' },
                        { value: 'ordinal', label: 'Ordinal Encoding' }
                      ]} />
                  </Form.Item>
                  <Form.Item label={<Text style={{ color: '#94a3b8' }}>目标列（支持多选）</Text>}>
                    <Select
                      mode="multiple"
                      allowClear
                      showSearch
                      placeholder="选择要编码的列"
                      value={encodeCols}
                      onChange={setEncodeCols}
                      options={allColumns.map(c => ({ value: c, label: c }))}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                  <Button type="primary" loading={loading}
                    onClick={() => exec('encode', { method: encodeMethod, columns: encodeCols })}>
                    执行编码
                  </Button>
                </Form>
              </Card>
            )
          },
          {
            key: 'scale', label: '特征缩放',
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Form layout="vertical">
                  <Form.Item label={<Text style={{ color: '#94a3b8' }}>缩放方式</Text>}>
                    <Select value={scaleMethod} onChange={setScaleMethod} style={{ width: '100%', minWidth: 240 }}
                      options={[
                        { value: 'standard', label: 'StandardScaler (Z-score，推荐)' },
                        { value: 'minmax', label: 'MinMaxScaler [0,1]' },
                        { value: 'robust', label: 'RobustScaler (IQR，抗异常值)' }
                      ]} />
                  </Form.Item>
                  <Form.Item label={<Text style={{ color: '#94a3b8' }}>目标列（留空 = 全部数值列）</Text>}>
                    <Select
                      mode="multiple"
                      allowClear
                      showSearch
                      placeholder="留空表示全部数值列"
                      value={scaleCols}
                      onChange={setScaleCols}
                      options={numericColumns.map(c => ({ value: c, label: c }))}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                  <Button type="primary" loading={loading}
                    onClick={() => exec('scale', { method: scaleMethod, columns: scaleCols.length > 0 ? scaleCols : null })}>
                    执行缩放
                  </Button>
                </Form>
              </Card>
            )
          },
          {
            key: 'pca', label: 'PCA降维',
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Form layout="vertical">
                  <Form.Item label={<Text style={{ color: '#94a3b8' }}>保留主成分数量</Text>}>
                    <InputNumber min={1} max={50} value={pcaComponents} onChange={v => setPcaComponents(v || 5)} />
                  </Form.Item>
                  <Button type="primary" loading={loading}
                    onClick={() => exec('pca', { n_components: pcaComponents })}>
                    执行PCA
                  </Button>
                </Form>
              </Card>
            )
          },
          {
            key: 'split', label: '训练/测试集划分',
            children: (
              <Card style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <Form layout="vertical">
                  <Form.Item label={<Text style={{ color: '#94a3b8' }}>目标列</Text>}>
                    <Select
                      showSearch
                      allowClear
                      placeholder="选择目标列（标签列）"
                      value={targetCol || undefined}
                      onChange={v => setTargetCol(v || '')}
                      options={allColumns.map(c => ({ value: c, label: c }))}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                  <Form.Item label={<Text style={{ color: '#94a3b8' }}>划分策略</Text>}>
                    <Select
                      value={splitStrategy}
                      onChange={v => setSplitStrategy(v)}
                      style={{ width: '100%' }}
                      options={[
                        { value: 'random', label: '随机划分（train_test_split）' },
                        { value: 'time_series', label: '时间序列顺序（早训练 / 晚测试）' },
                      ]}
                    />
                  </Form.Item>
                  {splitStrategy === 'time_series' && (
                    <Form.Item label={<Text style={{ color: '#94a3b8' }}>时间列（用于排序）</Text>}>
                      <Select
                        showSearch
                        allowClear
                        placeholder="选择日期或可排序的时间列"
                        value={timeColumn || undefined}
                        onChange={v => setTimeColumn(v || '')}
                        options={allColumns.map(c => ({ value: c, label: c }))}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                  )}
                  <Form.Item label={<Text style={{ color: '#94a3b8' }}>训练集比例: {(trainRatio * 100).toFixed(0)}%</Text>}>
                    <Slider min={0.5} max={0.95} step={0.05} value={trainRatio} onChange={setTrainRatio} />
                  </Form.Item>
                  <Form.Item label={<Text style={{ color: '#94a3b8' }}>随机种子</Text>}>
                    <InputNumber value={randomSeed} onChange={v => setRandomSeed(v || 42)} />
                  </Form.Item>
                  <Form.Item>
                    <Tooltip title={isNumericTarget ? '目标列为数值型（回归任务），不支持分层采样' : splitStrategy === 'time_series' ? '时间序列划分不使用分层' : ''}>
                      <Checkbox
                        checked={stratify}
                        disabled={isNumericTarget || splitStrategy === 'time_series'}
                        onChange={e => setStratify(e.target.checked)}
                      >
                        <Text style={{ color: isNumericTarget || splitStrategy === 'time_series' ? '#475569' : '#94a3b8' }}>分层采样（分类任务推荐）</Text>
                      </Checkbox>
                    </Tooltip>
                  </Form.Item>
                  <Button type="primary" loading={loading} onClick={execSplit}>划分数据集</Button>
                  {splitResult && (
                    <Alert
                      style={{ marginTop: 16 }}
                      type="success"
                      message={`划分成功 | Split #${splitResult.split_id} | ${activeDatasetName || '数据集'} | 训练 ${splitResult.train_rows} 行 / 测试 ${splitResult.test_rows} 行`}
                    />
                  )}
                </Form>
              </Card>
            )
          }
        ]}
      />
      {result && (
        <Card style={{ background: '#0f172a', border: '1px solid #334155', marginTop: 16 }}>
          <Text style={{ color: '#34d399', fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: 12 }}>{result}</Text>
        </Card>
      )}
    </div>
  )
}

export default FeatureEngineeringPage
