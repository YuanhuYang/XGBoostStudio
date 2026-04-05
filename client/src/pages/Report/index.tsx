import React, { useState, useEffect } from 'react'
import {
  Card, Table, Button, Space, Typography, Modal, Form, Input,
  InputNumber, message, Popconfirm, Tag, Row, Col, Empty,
  Checkbox, Spin, Select, Divider, Radio
} from 'antd'
import { FileTextOutlined, DownloadOutlined, DeleteOutlined, PlusOutlined, EyeOutlined, SaveOutlined, FolderOpenOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import apiClient from '../../api/client'
import { useAppStore } from '../../store/appStore'
import HelpButton from '../../components/HelpButton'
import PDFViewer from '../../components/PDFViewer'
import { REPORT_SECTION_OPTIONS } from '../../constants/reportSections'
import { listReportTemplates, createReportTemplate, deleteReportTemplate, type ReportTemplate } from '../../api/reports'

const { Title, Text } = Typography

const SECTION_OPTIONS = REPORT_SECTION_OPTIONS

interface ReportRecord {
  id: number; name: string; model_id: number | null; path: string; created_at: string
}

const ReportPage: React.FC = () => {
  const activeModelId = useAppStore(s => s.activeModelId)
  const [reports, setReports] = useState<ReportRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [genModal, setGenModal] = useState(false)
  const [genLoading, setGenLoading] = useState(false)
  const [selectedSections, setSelectedSections] = useState<string[]>(SECTION_OPTIONS.map(o => o.value))
  const [formatStyle, setFormatStyle] = useState<'default' | 'apa'>('default')
  const [form] = Form.useForm()

  // 模板管理相关状态
  const [templates, setTemplates] = useState<ReportTemplate[]>([])
  const [templateModal, setTemplateModal] = useState(false)
  const [templateLoading, setTemplateLoading] = useState(false)
  const [saveTemplateModal, setSaveTemplateModal] = useState(false)
  const [saveTemplateForm] = Form.useForm()
  
  // PDF 预览相关状态
  const [previewModal, setPreviewModal] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewFilename, setPreviewFilename] = useState<string>('')
  const [previewLoading, setPreviewLoading] = useState(false)

  const helpItems = [
    {
      title: '如何选择报告章节？',
      content: '默认勾选全部章节，可以根据需要取消勾选不想要的章节。精简汇报模板只包含核心章节，完整存档模板包含所有章节。你可以将当前勾选保存为自定义模板，下次一键加载。',
    },
    {
      title: 'APA 格式是什么？',
      content: 'APA 格式是学术界通用的排版格式，字体更大、行距更宽、边距更大，符合学术发表要求。生成的 PDF 可以直接插入毕业论文或技术报告。',
    },
    {
      title: '结果准确性在哪里证明？',
      content: '报告中每个指标都附带简短说明和评级。完整解答请看项目文档的 report-interpretation.md，包含结果准确性证明、建模思路解读、指标含义。',
    },
    {
      title: '报告生成失败怎么办？',
      content: '确保模型已完成训练，模型 ID 正确。如果仍失败，检查后端日志是否有错误，重启后端服务后重试。',
    },
  ]

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

  // 报告生成对话框打开时，预填当前活跃模型 ID
  useEffect(() => {
    if (genModal && activeModelId !== null) {
      form.setFieldsValue({ model_id: activeModelId })
    }
  }, [genModal, activeModelId, form])

  const handleGenerate = async () => {
    const values = await form.validateFields()
    setGenLoading(true)
    try {
      await apiClient.post('/api/reports/generate', {
        model_id: values.model_id,
        title: values.title || `模型${values.model_id}报告`,
        notes: values.notes || '',
        include_sections: selectedSections.length < SECTION_OPTIONS.length ? selectedSections : undefined,
        narrative_depth: values.narrative_depth || 'standard',
        format_style: formatStyle,
      })
      message.success('报告生成成功')
      setGenModal(false)
      form.resetFields()
      fetchReports()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '生成失败')
    } finally {
      setGenLoading(false)
    }
  }

  const loadTemplate = (template: ReportTemplate) => {
    setSelectedSections(template.sections)
    setFormatStyle(template.format_style)
    message.success(`已加载模板「${template.name}」`)
    setTemplateModal(false)
  }

  const handleSaveTemplate = async () => {
    const values = await saveTemplateForm.validateFields()
    try {
      await createReportTemplate({
        name: values.name,
        description: values.description || '',
        sections: selectedSections,
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

  const handlePreview = async (id: number, name: string) => {
    // 使用前端 PDFViewer 组件预览，而不是系统浏览器
    try {
      setPreviewLoading(true)
      const pdfUrl = `http://127.0.0.1:18899/api/reports/${id}/download`
      setPreviewUrl(pdfUrl)
      setPreviewFilename(`${name}.pdf`)
      setPreviewModal(true)
    } catch (error) {
      message.error('无法加载 PDF')
    } finally {
      setPreviewLoading(false)
    }
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
    { title: '生成时间', dataIndex: 'created_at', key: 'created_at', render: v => v?.slice(0, 19) },
    {
      title: '操作', key: 'action',
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => handlePreview(r.id, r.name)}>预览</Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(r.id, r.name)}>下载</Button>
          <Popconfirm title="确认删除此报告？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={4} style={{ color: '#60a5fa', margin: 0 }}>
          <FileTextOutlined /> 报告管理
        </Title>
        <HelpButton pageTitle="报告管理" items={helpItems} inHeader={true} />
      </div>
      <HelpButton pageTitle="报告管理" items={[
        { title: '如何生成报告？', content: '点击「生成新报告」，输入模型 ID 并选择所需章节，系统将自动生成 PDF 报告。' },
        { title: '如何选择包含章节？', content: '在生成对话框中勾选/反选对应章节，支持自定义 PDF 内容。' },
        { title: '如何预览 PDF？', content: '点击操作列的「预览」按鈕，将在弹框中内嵌展示 PDF。' },
      ]} />

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
        title="生成报告"
        open={genModal}
        onOk={handleGenerate}
        confirmLoading={genLoading}
        onCancel={() => { setGenModal(false); form.resetFields() }}
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="model_id" label="模型 ID" rules={[{ required: true, message: '请输入模型ID' }]}>
            <InputNumber min={1} style={{ width: '100%' }} placeholder="输入模型ID" />
          </Form.Item>
          <Form.Item name="title" label="报告标题">
            <Input placeholder="如：泰坦尼克生存预测模型报告" />
          </Form.Item>
          <Form.Item name="notes" label="备注说明">
            <Input.TextArea rows={2} placeholder="可输入模型说明、实验背景等" />
          </Form.Item>
          <Form.Item
            name="narrative_depth"
            label="数据关系分析深度"
            tooltip="仅影响「数据与变量关系」章节：详细档含 Spearman 热力图与更多类别/箱线图。"
            initialValue="standard"
          >
            <Select
              options={[
                { value: 'standard', label: '标准（较快）' },
                { value: 'detailed', label: '详细（Spearman、更多图表）' },
              ]}
            />
          </Form.Item>
        </Form>
        <Form.Item label="报表格式样式">
          <Radio.Group value={formatStyle} onChange={e => setFormatStyle(e.target.value)}>
            <Radio value="default">默认格式</Radio>
            <Radio value="apa">APA 学术格式</Radio>
          </Radio.Group>
          <div style={{ marginTop: 4 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              APA 格式：双倍行距、更大字体，符合学术发表要求
            </Text>
          </div>
        </Form.Item>
        <Divider style={{ margin: '12px 0', borderColor: '#334155' }} />
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500 }}>包含章节</span>
            <span>
              <Button size="small" type="link" style={{ padding: '0 4px' }}
                onClick={() => setSelectedSections(SECTION_OPTIONS.map(o => o.value))}>全选</Button>
              <Button size="small" type="link" style={{ padding: '0 4px' }}
                onClick={() => setSelectedSections([])}>清空</Button>
              <Button size="small" type="link" style={{ padding: '0 4px' }}
                onClick={() => setSaveTemplateModal(true)}>
                <SaveOutlined /> 保存当前配置为模板
              </Button>
            </span>
          </div>
          <Checkbox.Group
            options={SECTION_OPTIONS}
            value={selectedSections}
            onChange={v => setSelectedSections(v as string[])}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 0' }}
          />
        </div>
      </Modal>

      {/* PDF 预览模态框 */}
      <Modal
        title={`预览: ${previewFilename}`}
        open={previewModal}
        onCancel={() => {
          setPreviewModal(false)
          setPreviewUrl(null)
        }}
        footer={null}
        width="90%"
        style={{ top: 20 }}
        bodyStyle={{ height: 'calc(100vh - 120px)', overflow: 'hidden' }}
      >
        {previewLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
            <Spin tip="加载 PDF 中..." />
          </div>
        ) : previewUrl ? (
          <PDFViewer
            source={previewUrl}
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
              章节数：{selectedSections.length} 个，格式：{formatStyle === 'apa' ? 'APA 学术格式' : '默认格式'}
            </Text>
          </Form.Item>
        </Form>
      </Modal>

    </div>
  )
}

export default ReportPage
