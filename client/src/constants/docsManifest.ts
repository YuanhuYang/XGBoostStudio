/** 与 docs/wiki/README.md 索引对齐；guides 与根 README 来自仓库 README 文档表 */

export type DocGroupId = 'project' | 'wiki' | 'guides'

export type DocSource = 'wiki' | 'guides' | 'root'

export type DocManifestEntry = {
  /** 稳定键，用于 URL 状态与内部导航 */
  id: string
  title: string
  group: DocGroupId
  /** 不含扩展名；root 下 README 固定为 README */
  fileBase: string
  source: DocSource
}

export const DOC_GROUP_LABELS: Record<DocGroupId, string> = {
  project: '项目说明',
  wiki: '产品知识库',
  guides: '指南与规范',
}

export const DOCS_MANIFEST: DocManifestEntry[] = [
  {
    id: 'readme',
    title: 'README · 仓库说明与安装',
    group: 'project',
    fileBase: 'README',
    source: 'root',
  },
  {
    id: 'wiki-01-product-overview',
    title: '01 产品概览',
    group: 'wiki',
    fileBase: '01-product-overview',
    source: 'wiki',
  },
  {
    id: 'wiki-02-architecture',
    title: '02 技术架构',
    group: 'wiki',
    fileBase: '02-architecture',
    source: 'wiki',
  },
  {
    id: 'wiki-03-data-analysis',
    title: '03 数据分析',
    group: 'wiki',
    fileBase: '03-data-analysis',
    source: 'wiki',
  },
  {
    id: 'wiki-04-model-training',
    title: '04 模型训练',
    group: 'wiki',
    fileBase: '04-model-training',
    source: 'wiki',
  },
  {
    id: 'wiki-05-auto-tuning',
    title: '05 分层调优',
    group: 'wiki',
    fileBase: '05-auto-tuning',
    source: 'wiki',
  },
  {
    id: 'wiki-06-model-evaluation',
    title: '06 模型评估',
    group: 'wiki',
    fileBase: '06-model-evaluation',
    source: 'wiki',
  },
  {
    id: 'wiki-07-pdf-report',
    title: '07 PDF 报告',
    group: 'wiki',
    fileBase: '07-pdf-report',
    source: 'wiki',
  },
  {
    id: 'wiki-08-automl-wizard',
    title: '08 AutoML 与向导',
    group: 'wiki',
    fileBase: '08-automl-wizard',
    source: 'wiki',
  },
  {
    id: 'wiki-09-data-quality',
    title: '09 数据质量与智能清洗',
    group: 'wiki',
    fileBase: '09-data-quality-unified-and-smart-clean',
    source: 'wiki',
  },
  {
    id: 'guide-quick-start',
    title: '快速开始',
    group: 'guides',
    fileBase: 'quick-start',
    source: 'guides',
  },
  {
    id: 'guide-developers',
    title: '开发者指南',
    group: 'guides',
    fileBase: 'developers-guide',
    source: 'guides',
  },
  {
    id: 'guide-xs-cli',
    title: 'xs-studio CLI',
    group: 'guides',
    fileBase: 'xs-studio-cli',
    source: 'guides',
  },
  {
    id: 'guide-report-interpretation',
    title: '报告解读',
    group: 'guides',
    fileBase: 'report-interpretation',
    source: 'guides',
  },
  {
    id: 'guide-deploy',
    title: '部署说明',
    group: 'guides',
    fileBase: '部署说明',
    source: 'guides',
  },
  {
    id: 'guide-dev-standard',
    title: '开发规范',
    group: 'guides',
    fileBase: '开发规范',
    source: 'guides',
  },
  {
    id: 'guide-frontend-test',
    title: '前端 UI 自动化测试',
    group: 'guides',
    fileBase: 'frontend-ui-automation-testing',
    source: 'guides',
  },
]

const byId = new Map(DOCS_MANIFEST.map(d => [d.id, d]))

export function getDocById(id: string): DocManifestEntry | undefined {
  return byId.get(id)
}

/** 根据 markdown 内相对链接解析到 manifest 条目（fileBase 不含 .md） */
export function findDocByFileBase(fileBase: string): DocManifestEntry | undefined {
  for (const d of DOCS_MANIFEST) {
    if (d.fileBase === fileBase) return d
  }
  return undefined
}
