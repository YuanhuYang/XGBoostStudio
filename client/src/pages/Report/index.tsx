import React, { useState, useEffect, useMemo } from 'react'
import {
  Card, Table, Button, Space, Typography, Modal, Form, Input,
  message, Popconfirm, Tag, Row, Col, Empty,
  Checkbox, Spin, Select, Divider, Radio, ColorPicker, Tabs, Tooltip, Badge, List, Alert,
} from 'antd'
import {
  DownloadOutlined, DeleteOutlined, PlusOutlined, EyeOutlined,
  SaveOutlined, FolderOpenOutlined, CrownOutlined, CheckCircleOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import apiClient, { BASE_URL } from '../../api/client'
import { useAppStore } from '../../store/appStore'
import PDFViewer from '../../components/PDFViewer'
import {
  REPORT_SECTION_OPTIONS, CHAPTERS_12, REPORT_TEMPLATES, legacySectionKeysFromG3TemplateType,
} from '../../constants/reportSections'
import { listReportTemplates, createReportTemplate, deleteReportTemplate, type ReportTemplate } from '../../api/reports'
import { formatUtcToBeijing } from '../../utils/datetime'

const { Title, Text } = Typography

const SECTION_OPTIONS = REPORT_SECTION_OPTIONS

interface ReportRecord {
  id: number; name: string; model_id: number | null; path: string; created_at: string
}

const MAX_COMPARE_MODELS = 8

interface ModelListRow {
  id: number
  name: string
}

const ReportPage: React.FC = () => {
  const activeModelId = useAppStore(s => s.activeModelId)
  const activeSplitId = useAppStore(s => s.activeSplitId)
  const activeDatasetId = useAppStore(s => s.activeDatasetId)
  const [reports, setReports] = useState<ReportRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [genModal, setGenModal] = useState(false)
  const [genLoading, setGenLoading] = useState(false)
  const [selectedSections, setSelectedSections] = useState<string[]>(SECTION_OPTIONS.map(o => o.value))
  const [formatStyle, setFormatStyle] = useState<'default' | 'apa'>('default')
  const [form] = Form.useForm()
  const [modelOptions, setModelOptions] = useState<{ value: number; label: string }[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const primaryModelId = Form.useWatch('model_id', form)

  // G3-C 新增状态：12章模板选择
  const [selectedTemplateType, setSelectedTemplateType] = useState<string>('full_12_chapters')
  const [useG3Chapters, setUseG3Chapters] = useState(true)
  // 品牌定制
  const [watermarkText, setWatermarkText] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [primaryColor, setPrimaryColor] = useState('')

  // 模板管理相关状态
  const [templates, setTemplates] = useState<ReportTemplate[]>([])
  const [templateModal, setTemplateModal] = useState(false)
  const [templateLoading, setTemplateLoading] = useState(false)
  const [saveTemplateModal, setSaveTemplateModal] = useState(false)
  const [saveTemplateForm] = Form.useForm()
  
  // PDF 预览相关状态
  const [previewModal, setPreviewModal] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewDownloadUrl, setPreviewDownloadUrl] = useState<string | null>(null)
  const [previewFilename, setPreviewFilename] = useState<string>('')

  const fetchReports = async () => {
    setLoading(true)
    try {
      const r = await apiClient.get('/api/reports')
      setReports(r.data || [])
    } catch { message.error('获取报告列表失败') }
    finally { setLoading(false) }
  }

  const fetchTemplates = async () => {
    setTemplateLoading(true)
    try {
      const data = await listReportTemplates()
      setTemplates(data)
    } catch { message.error('获取模板列表失败') }
    finally { setTemplateLoading(false) }
  }

  useEffect(() => { 
    fetchReports()
    fetchTemplates()
  }, [])

  // 报告生成对话框打开时，预填当前活跃模型并拉取可选模型列表
  useEffect(() => {
    if (!genModal) return
    if (activeModelId !== null) {
      form.setFieldsValue({ model_id: activeModelId, compare_model_ids: [] })
    } else {
      form.setFieldsValue({ compare_model_ids: [] })
    }
    setModelsLoading(true)
    const params: Record<string, number> = {}
    if (activeSplitId != null) params.split_id = activeSplitId
    else if (activeDatasetId != null) params.dataset_id = activeDatasetId
    apiClient
      .get<ModelListRow[]>('/api/models', { params })
      .then(r => {
        const rows = r.data || []
        setModelOptions(rows.map(m => ({ value: m.id, label: `${m.name} (#${m.id})` })))
      })
      .catch(() => {
        message.error('加载模型列表失败')
        setModelOptions([])
      })
      .finally(() => setModelsLoading(false))
  }, [genModal, activeModelId, activeSplitId, activeDatasetId, form])

  const compareOptions = useMemo(
    () => modelOptions.filter(o => o.value !== primaryModelId),
    [modelOptions, primaryModelId],
  )

  const handleGenerate = async () => {
    const values = await form.validateFields()
    setGenLoading(true)
    try {
      const payload: Record<string, unknown> = {
        model_id: values.model_id,
        title: values.title || `模型${values.model_id}报告`,
        notes: values.notes || '',
        narrative_depth: values.narrative_depth || 'standard',
        format_style: formatStyle,
      }

      if (useG3Chapters) {
        // G3-C: 使用 12 章模板模式
        payload.template_type = selectedTemplateType
        payload.include_sections = null  // 不传旧版 include_sections
        // 品牌定制
        if (watermarkText || companyName || primaryColor) {
          payload.brand_config = {
            watermark_text: watermarkText || undefined,
            company_name: companyName || undefined,
            primary_color_hex: primaryColor || undefined,
          }
        }
      } else {
        // 旧版：自由选择章节
        payload.include_sections = selectedSections.length < SECTION_OPTIONS.length ? selectedSections : undefined
      }

      const cmp = (values.compare_model_ids as number[] | undefined)?.filter(Boolean) ?? []
      if (cmp.length > 0) {
        payload.compare_model_ids = cmp
      }

      // #region agent log
      fetch('http://127.0.0.1:7268/ingest/0460b7c0-4c9a-4a36-a0b4-004d253d2509', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'eedc4d' },
        body: JSON.stringify({
          sessionId: 'eedc4d',
          hypothesisId: 'H1',
          location: 'Report/index.tsx:handleGenerate',
          message: 'generate_report_payload',
          data: {
            model_id: payload.model_id,
            compare_len: Array.isArray(payload.compare_model_ids) ? payload.compare_model_ids.length : 0,
            compare_elt_types: Array.isArray(payload.compare_model_ids)
              ? payload.compare_model_ids.map((x: unknown) => typeof x)
              : [],
            template_type: payload.template_type,
            has_include_sections_key: 'include_sections' in payload,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {})
      // #endregion

      await apiClient.post('/api/reports/generate', payload)
      message.success('报告生成成功')
      setGenModal(false)
      form.resetFields()
      fetchReports()
    } catch (e: unknown) {
      // #region agent log
      const em = e instanceof Error ? e.message : String(e)
      const ax = e as { response?: { status?: number; data?: { detail?: unknown } } }
      fetch('http://127.0.0.1:7268/ingest/0460b7c0-4c9a-4a36-a0b4-004d253d2509', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'eedc4d' },
        body: JSON.stringify({
          sessionId: 'eedc4d',
          hypothesisId: 'H5',
          location: 'Report/index.tsx:handleGenerate',
          message: 'generate_report_catch',
          data: {
            errorMessage: em.slice(0, 500),
            httpStatus: ax.response?.status ?? null,
            detail: ax.response?.data?.detail ?? null,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {})
      // #endregion
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '生成失败')
    } finally {
      setGenLoading(false)
    }
  }

  const loadTemplate = (template: ReportTemplate) => {
    setFormatStyle(template.format_style)
    // 默认生成走 G3「template_type」，原先只改 selectedSections 会被忽略，需同步模式与预设
    if (template.is_builtin && template.name === '精简汇报') {
      setUseG3Chapters(true)
      setSelectedTemplateType('executive_brief')
      setSelectedSections(legacySectionKeysFromG3TemplateType('executive_brief'))
      message.success(`已加载「${template.name}」（对应 12 章 · 管理层简报版）。请打开「生成新报告」在「报告模板」页确认后生成。`)
    } else if (template.is_builtin && template.name === '完整存档') {
      setUseG3Chapters(true)
      setSelectedTemplateType('full_12_chapters')
      setSelectedSections(legacySectionKeysFromG3TemplateType('full_12_chapters'))
      message.success(`已加载「${template.name}」（对应 12 章 · 完整版）。请打开「生成新报告」在「报告模板」页确认后生成。`)
    } else {
      setUseG3Chapters(false)
      setSelectedSections(template.sections.length ? template.sections : SECTION_OPTIONS.map(o => o.value))
      message.success(`已加载「${template.name}」（旧版自由选择）。请打开「生成新报告」在「报告模板」页确认后生成。`)
    }
    setTemplateModal(false)
  }

  const sectionsForCustomTemplate = useMemo(
    () => (useG3Chapters ? legacySectionKeysFromG3TemplateType(selectedTemplateType) : selectedSections),
    [useG3Chapters, selectedTemplateType, selectedSections],
  )

  const handleSaveTemplate = async () => {
    const values = await saveTemplateForm.validateFields()
    try {
      await createReportTemplate({
        name: values.name,
        description: values.description || '',
        sections: sectionsForCustomTemplate,
        format_style: formatStyle,
      })
      message.success('模板保存成功')
      setSaveTemplateModal(false)
      saveTemplateForm.resetFields()
      fetchTemplates()
    } catch {
      message.error('保存模板失败')
    }
  }

  const handleDeleteTemplate = async (id: number) => {
    try {
      await deleteReportTemplate(id)
      message.success('模板已删除')
      fetchTemplates()
    } catch {
      message.error('删除模板失败')
    }
  }

  const handleDownload = async (id: number, name: string) => {
    try {
      const r = await apiClient.get(`/api/reports/${id}/download`, { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a'); a.href = url; a.download = `${name}.pdf`; a.click()
      URL.revokeObjectURL(url)
    } catch { message.error('下载失败') }
  }

  const handlePreview = (id: number, name: string) => {
    // iframe 内嵌 /preview（inline），效果与浏览器直接打开 PDF 一致
    setPreviewUrl(`${BASE_URL}/api/reports/${id}/preview`)
    setPreviewDownloadUrl(`${BASE_URL}/api/reports/${id}/download`)
    setPreviewFilename(`${name}.pdf`)
    setPreviewModal(true)
  }

  const handleDelete = async (id: number) => {
    try {
      await apiClient.delete(`/api/reports/${id}`)
      message.success('已删除')
      fetchReports()
    } catch { message.error('删除失败') }
  }

  const columns: ColumnsType<ReportRecord> = [
    { title: '报告名称', dataIndex: 'name', key: 'name', render: v => <Text strong style={{ color: '#60a5fa' }}>{v}</Text> },
    { title: '关联模型 ID', dataIndex: 'model_id', key: 'model_id', render: v => v ? <Tag color="blue">Model #{v}</Tag> : '-' },
    { title: '生成时间', dataIndex: 'created_at', key: 'created_at', render: v => formatUtcToBeijing(v) },
    {
      title: '操作', key: 'action',
      render: (_, r) => (
        <Space>
          <Button htmlType="button" size="small" icon={<EyeOutlined />} onClick={() => handlePreview(r.id, r.name)}>预览</Button>
          <Button htmlType="button" size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(r.id, r.name)}>下载</Button>
          <Popconfirm title="确认删除此报告？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div style={{ padding: 24 }}>
      <Row gutter={16} style={{ marginBottom: 16 }} align="middle">
        <Col>
          <Space align="center" style={{ marginRight: 16 }}>
            <Text style={{ color: '#94a3b8', fontSize: 14 }}>报告总数：</Text>
            <Text style={{ color: '#60a5fa', fontSize: 22, fontWeight: 700, lineHeight: '1' }}>{reports.length}</Text>
          </Space>
        </Col>
        <Col>
          <Space>
            <Button icon={<FolderOpenOutlined />} onClick={() => { setTemplateModal(true); fetchTemplates() }} size="large">
              模板管理
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setGenModal(true)} size="large">
              生成新报告
            </Button>
          </Space>
        </Col>
      </Row>

      <Card style={{ background: '#1e293b', border: '1px solid #334155' }}
        extra={<Button size="small" onClick={fetchReports}>刷新</Button>}>
        <Table
          columns={columns}
          dataSource={reports}
          loading={loading}
          rowKey="id"
          size="small"
          locale={{ emptyText: <Empty description="暂无报告，点击「生成新报告」创建" /> }}
        />
      </Card>

      <Modal
        title={<Space><CrownOutlined style={{ color: '#faad14' }} /><span>生成专业PDF报告</span></Space>}
        open={genModal}
        onOk={handleGenerate}
        confirmLoading={genLoading}
        onCancel={() => { setGenModal(false); form.resetFields() }}
        width={760}
      >
        <Tabs
          items={[
            {
              key: 'basic', label: '基本信息',
              children: (
                <Form form={form} layout="vertical">
                  <Form.Item name="model_id" label="主模型" rules={[{ required: true, message: '请选择主模型' }]}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      loading={modelsLoading}
                      placeholder="选择要生成报告的主模型"
                      options={modelOptions}
                      onChange={(v: number) => {
                        const cur = form.getFieldValue('compare_model_ids') as number[] | undefined
                        if (Array.isArray(cur) && cur.includes(v)) {
                          form.setFieldsValue({ compare_model_ids: cur.filter(id => id !== v) })
                        }
                      }}
                    />
                  </Form.Item>
                  <Form.Item
                    name="compare_model_ids"
                    label="对比模型（可选，多选）"
                    tooltip="将与主模型一并写入附录 D：指标表、参数对比及统计说明；最多 8 个"
                    initialValue={[]}
                    rules={[
                      {
                        validator: async (_, v: number[]) => {
                          if (v && v.length > MAX_COMPARE_MODELS) {
                            throw new Error(`对比模型最多 ${MAX_COMPARE_MODELS} 个`)
                          }
                        },
                      },
                    ]}
                  >
                    <Select
                      mode="multiple"
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      loading={modelsLoading}
                      placeholder="选择用于横向对比的模型（不含主模型）"
                      options={compareOptions}
                      maxTagCount="responsive"
                    />
                  </Form.Item>
                  <Form.Item name="title" label="报告标题">
                    <Input placeholder="如：泰坦尼克生存预测模型报告" />
                  </Form.Item>
                  <Form.Item name="notes" label="备注说明">
                    <Input.TextArea rows={2} placeholder="可输入模型说明、实验背景等" />
                  </Form.Item>
                  <Form.Item name="narrative_depth" label="数据关系分析深度" tooltip="影响「数据与变量关系」章节详略；选「详细」时，报告中调优过程会附带各阶段 Trial 抽样表。" initialValue="standard">
                    <Select options={[{ value: 'standard', label: '标准（较快）' }, { value: 'detailed', label: '详细（Spearman、更多图表）' }]} />
                  </Form.Item>
                  <Form.Item label="报表格式样式">
                    <Radio.Group value={formatStyle} onChange={e => setFormatStyle(e.target.value)}>
                      <Radio value="default">默认格式</Radio>
                      <Radio value="apa">APA 学术格式</Radio>
                    </Radio.Group>
                  </Form.Item>
                </Form>
              )
            },
            {
              key: 'template', label: <span><CrownOutlined /> 报告模板</span>,
              children: (
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <Text style={{ color: '#e2e8f0', fontWeight: 600 }}>选择报告模板（G3-C 12章规格）</Text>
                    <Space wrap>
                      <Text style={{ color: '#94a3b8', fontSize: 12 }}>使用12章规格</Text>
                      <Radio.Group value={useG3Chapters ? 'new' : 'legacy'} onChange={e => setUseG3Chapters(e.target.value === 'new')} optionType="button" size="small"
                        options={[{ value: 'new', label: '12章固定结构' }, { value: 'legacy', label: '旧版自由选择' }]} />
                      <Button size="small" icon={<SaveOutlined />} onClick={() => setSaveTemplateModal(true)}>
                        保存为我的模板
                      </Button>
                    </Space>
                  </div>

                  <Alert
                    type="info"
                    showIcon
                    message={
                      useG3Chapters
                        ? `生成时将使用：12 章结构 · ${REPORT_TEMPLATES.find(t => t.type === selectedTemplateType)?.name ?? selectedTemplateType}`
                        : `生成时将使用：旧版自由选择 · 已选 ${selectedSections.length} 个内容章节`
                    }
                    description="与「模板管理」中的加载结果一致；最终以本页当前选项为准。"
                  />

                  {useG3Chapters ? (
                    <>
                      {/* 4 种预设模板按钮 */}
                      <Row gutter={[12, 12]}>
                        {REPORT_TEMPLATES.map(tpl => (
                          <Col span={12} key={tpl.type}>
                            <Card
                              size="small"
                              hoverable
                              onClick={() => setSelectedTemplateType(tpl.type)}
                              style={{
                                background: selectedTemplateType === tpl.type ? '#1e3a5f' : '#0f172a',
                                border: `2px solid ${selectedTemplateType === tpl.type ? '#3b82f6' : '#334155'}`,
                                cursor: 'pointer',
                              }}
                            >
                              <Space>
                                {selectedTemplateType === tpl.type && <CheckCircleOutlined style={{ color: '#52c41a' }} />}
                                <Tag color={tpl.badge as string}>{tpl.name}</Tag>
                              </Space>
                              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{tpl.description}</div>
                              <div style={{ marginTop: 6 }}>
                                {tpl.chapters.map(ch => {
                                  const chapter = CHAPTERS_12.find(c => c.key === ch)
                                  return chapter ? (
                                    <Tag key={ch} style={{ marginBottom: 2, fontSize: 10 }}>{chapter.title.split('章')[1]?.trim() || chapter.title}</Tag>
                                  ) : null
                                })}
                              </div>
                            </Card>
                          </Col>
                        ))}
                      </Row>

                      {/* 当前选择的章节列表 */}
                      {selectedTemplateType && (
                        <Card size="small" title={<Text style={{ fontSize: 12 }}>包含章节预览</Text>} style={{ background: '#0f172a' }}>
                          {REPORT_TEMPLATES.find(t => t.type === selectedTemplateType)?.chapters.map(chKey => {
                            const ch = CHAPTERS_12.find(c => c.key === chKey)
                            return ch ? (
                              <div key={chKey} style={{ marginBottom: 4, padding: '4px 8px', background: '#1e293b', borderRadius: 4 }}>
                                <Text style={{ color: '#60a5fa', fontSize: 12 }}>{ch.title}</Text>
                                <Text style={{ color: '#475569', fontSize: 11, marginLeft: 8 }}>{ch.description}</Text>
                              </div>
                            ) : null
                          })}
                        </Card>
                      )}
                    </>
                  ) : (
                    /* 旧版章节选择 */
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <Text style={{ color: '#94a3b8', fontSize: 12 }}>自由选择章节（旧版模式）</Text>
                        <Space>
                          <Button size="small" type="link" onClick={() => setSelectedSections(SECTION_OPTIONS.map(o => o.value))}>全选</Button>
                          <Button size="small" type="link" onClick={() => setSelectedSections([])}>清空</Button>
                        </Space>
                      </div>
                      <Checkbox.Group options={SECTION_OPTIONS} value={selectedSections}
                        onChange={v => setSelectedSections(v as string[])}
                        style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 0' }} />
                    </div>
                  )}
                </Space>
              )
            },
            {
              key: 'brand', label: '品牌定制',
              children: (
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  <Text style={{ color: '#94a3b8', fontSize: 12 }}>
                    企业品牌定制（可选）：设置后将显示在报告的页眉页脚与封面，支持水印、主色调定制
                  </Text>
                  <Form layout="vertical">
                    <Form.Item label={<Text style={{ color: '#94a3b8' }}>企业/项目名称</Text>}>
                      <Input placeholder="如：XGBoost Studio / 某公司数据科学部"
                        value={companyName} onChange={e => setCompanyName(e.target.value)} />
                    </Form.Item>
                    <Form.Item label={<Text style={{ color: '#94a3b8' }}>水印文字（可选）</Text>}>
                      <Input placeholder="如：机密 / 内部使用 / CONFIDENTIAL"
                        value={watermarkText} onChange={e => setWatermarkText(e.target.value)} />
                    </Form.Item>
                    <Form.Item label={<Text style={{ color: '#94a3b8' }}>主色调十六进制颜色（可选）</Text>}>
                      <Input placeholder="如：#003087 / #1677ff"
                        value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
                        prefix={primaryColor ? <div style={{ width: 14, height: 14, borderRadius: 2, background: primaryColor }} /> : undefined} />
                    </Form.Item>
                  </Form>
                  <div style={{ background: '#0f172a', padding: 12, borderRadius: 6 }}>
                    <Text style={{ color: '#475569', fontSize: 12 }}>
                      预览：{companyName || 'XGBoost Studio'} 品牌报告
                      {watermarkText ? ` | 水印：${watermarkText}` : ''}
                      {primaryColor ? ` | 主色：${primaryColor}` : ''}
                    </Text>
                  </div>
                </Space>
              )
            },
          ]}
        />
      </Modal>

      {/* PDF 预览模态框 */}
      <Modal
        title={`预览: ${previewFilename}`}
        open={previewModal}
        destroyOnClose
        onCancel={() => {
          setPreviewModal(false)
          setPreviewUrl(null)
          setPreviewDownloadUrl(null)
        }}
        footer={null}
        width="90%"
        style={{ top: 20 }}
        bodyStyle={{ height: 'calc(100vh - 120px)', overflow: 'hidden', padding: 0 }}
      >
        {previewUrl ? (
          <PDFViewer
            source={previewUrl}
            downloadUrl={previewDownloadUrl ?? undefined}
            filename={previewFilename}
            showDownload={true}
            showFullscreen={true}
            onError={(error) => {
              console.error('PDF 加载错误:', error)
              message.error('PDF 加载失败')
            }}
          />
        ) : (
          <Empty description="未能加载 PDF" />
        )}
      </Modal>

      {/* 模板管理模态框 */}
      <Modal
        title="报表模板管理"
        open={templateModal}
        onCancel={() => setTemplateModal(false)}
        footer={null}
        width={700}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {['builtin', 'custom'].map(type => (
            <div key={type}>
              <Title level={5}>
                {type === 'builtin' ? '内置模板' : '我的模板'}
              </Title>
              <Card size="small" style={{ background: '#1e293b', borderColor: '#334155' }}>
                {templateLoading ? (
                  <Spin tip="加载中..." />
                ) : (
                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    {templates.filter(t => t.is_builtin === (type === 'builtin')).length === 0 ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={type === 'builtin' ? '暂无内置模板' : '暂无自定义模板'} />
                    ) : (
                      templates.filter(t => t.is_builtin === (type === 'builtin')).map(t => (
                        <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <Text strong>{t.name}</Text>
                            {t.description && <br />}
                            {t.description && <Text type="secondary" style={{ fontSize: 12 }}>{t.description}</Text>}
                            <br />
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              格式：{t.format_style === 'apa' ? 'APA 学术格式' : '默认格式'}，
                              章节：{t.sections.length} 个
                            </Text>
                          </div>
                          <Space>
                            <Button size="small" type="primary" onClick={() => loadTemplate(t)}>加载</Button>
                            {!t.is_builtin && (
                              <Popconfirm title="确认删除此模板？" onConfirm={() => handleDeleteTemplate(t.id)}>
                                <Button size="small" danger>删除</Button>
                              </Popconfirm>
                            )}
                          </Space>
                        </div>
                      ))
                    )}
                  </Space>
                )}
              </Card>
            </div>
          ))}
          <Divider style={{ margin: '8px 0' }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            将当前「生成新报告」里的模板与格式保存为自定义模板：打开生成对话框，切到「报告模板」页，点击「保存为我的模板」。
          </Text>
        </Space>
      </Modal>

      {/* 保存模板模态框 */}
      <Modal
        title="保存当前配置为模板"
        open={saveTemplateModal}
        onOk={handleSaveTemplate}
        confirmLoading={false}
        onCancel={() => setSaveTemplateModal(false)}
      >
        <Form form={saveTemplateForm} layout="vertical">
          <Form.Item
            name="name"
            label="模板名称"
            rules={[{ required: true, message: '请输入模板名称' }]}
          >
            <Input placeholder="例如：我的学术汇报模板" />
          </Form.Item>
          <Form.Item
            name="description"
            label="模板描述"
          >
            <Input.TextArea rows={2} placeholder="简要描述此模板的用途" />
          </Form.Item>
          <Form.Item label="将要保存的配置">
            <Text type="secondary">
              章节数：{sectionsForCustomTemplate.length} 个，格式：{formatStyle === 'apa' ? 'APA 学术格式' : '默认格式'}
              {useG3Chapters && '（由当前 12 章预设映射为旧版章节令牌，便于列表与复用）'}
            </Text>
          </Form.Item>
        </Form>
      </Modal>

    </div>
  )
}

export default ReportPage
