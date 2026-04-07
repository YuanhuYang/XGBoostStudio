/**
 * 构建期将仓库 docs/wiki、docs/guides 与根 README 以 raw 字符串打入前端包。
 * 依赖 Vite server.fs.allow / 构建时解析路径包含仓库根目录。
 */
import type { DocManifestEntry, DocSource } from '../constants/docsManifest'

const wikiModules = import.meta.glob('../../../docs/wiki/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const guidesModules = import.meta.glob('../../../docs/guides/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const readmeModules = import.meta.glob('../../../README.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function pathFileBase(vitePath: string): string {
  const seg = vitePath.split(/[/\\]/).pop() ?? vitePath
  return seg.replace(/\.md$/i, '')
}

function buildLookup(
  modules: Record<string, string>,
  source: DocSource,
): Map<string, string> {
  const m = new Map<string, string>()
  for (const [p, raw] of Object.entries(modules)) {
    m.set(`${source}:${pathFileBase(p)}`, raw)
  }
  return m
}

const wikiLookup = buildLookup(wikiModules, 'wiki')
const guidesLookup = buildLookup(guidesModules, 'guides')
const readmeRaw = Object.values(readmeModules)[0] ?? null

const combined = new Map<string, string>([...wikiLookup, ...guidesLookup])
if (readmeRaw !== null) {
  combined.set('root:README', readmeRaw)
}

export function getDocMarkdown(entry: DocManifestEntry): string | null {
  const key = `${entry.source}:${entry.fileBase}`
  const v = combined.get(key)
  return v ?? null
}

export function hasDocSource(entry: DocManifestEntry): boolean {
  return getDocMarkdown(entry) !== null
}
