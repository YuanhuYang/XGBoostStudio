import React, { useCallback, useEffect, isValidElement, useMemo, useRef, useState } from 'react'
import { Menu, Typography, Anchor, Empty } from 'antd'
import type { MenuProps } from 'antd'
import type { AnchorProps } from 'antd'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'
import type { Components } from 'react-markdown'
import {
  DOCS_MANIFEST,
  DOC_GROUP_LABELS,
  type DocGroupId,
  findDocByFileBase,
  getDocById,
} from '../../constants/docsManifest'
import { getDocMarkdown } from '../../docs/docSources'
import { MermaidBlock } from './MermaidBlock'
import styles from './Documentation.module.css'

const { Text } = Typography

const DEFAULT_DOC_ID = 'wiki-01-product-overview'

const VIEWPORT_SCROLL = 'calc(100vh - 152px)'

function parseInternalDocLink(href: string): { docId: string; hash?: string } | null {
  const [pathPart, frag] = href.split('#')
  const clean = pathPart.trim()
  const file = clean.split(/[/\\]/).pop() ?? clean
  if (!file.endsWith('.md')) return null
  const base = file.slice(0, -3)
  const entry = findDocByFileBase(base)
  if (!entry) return null
  return {
    docId: entry.id,
    hash: frag ? `#${frag}` : undefined,
  }
}

const DocumentationPage: React.FC = () => {
  const [activeId, setActiveId] = useState(() => {
    return getDocById(DEFAULT_DOC_ID) ? DEFAULT_DOC_ID : DOCS_MANIFEST[0]?.id ?? DEFAULT_DOC_ID
  })
  const [toc, setToc] = useState<{ id: string; text: string; depth: 2 | 3 }[]>([])
  const articleRef = useRef<HTMLDivElement>(null)
  const pendingHash = useRef<string | null>(null)

  const activeEntry = useMemo(() => getDocById(activeId), [activeId])
  const markdown = useMemo(() => {
    if (!activeEntry) return null
    return getDocMarkdown(activeEntry)
  }, [activeEntry])

  const openDoc = useCallback((docId: string, headingId?: string) => {
    setActiveId(docId)
    if (headingId) pendingHash.current = headingId
    else pendingHash.current = null
  }, [])

  const menuItems: MenuProps['items'] = useMemo(() => {
    const order: DocGroupId[] = ['project', 'wiki', 'guides']
    return order.map(g => ({
      type: 'group' as const,
      label: <span style={{ color: '#94a3b8', fontSize: 12 }}>{DOC_GROUP_LABELS[g]}</span>,
      children: DOCS_MANIFEST.filter(d => d.group === g).map(d => ({
        key: d.id,
        label: <span style={{ fontSize: 13 }}>{d.title}</span>,
      })),
    }))
  }, [])

  const anchorItems: AnchorProps['items'] = useMemo(
    () =>
      toc.map(t => ({
        key: t.id,
        href: `#${t.id}`,
        title: (
          <span style={{ fontSize: t.depth === 3 ? 12 : 13, paddingLeft: t.depth === 3 ? 8 : 0 }}>
            {t.text}
          </span>
        ),
      })),
    [toc],
  )

  const markdownComponents: Components = useMemo(
    () => ({
      pre({ children }) {
        const first = Array.isArray(children) ? children[0] : children
        if (
          isValidElement(first) &&
          typeof first.props === 'object' &&
          first.props !== null &&
          'className' in first.props &&
          typeof (first.props as { className?: string }).className === 'string' &&
          (first.props as { className: string }).className.includes('language-mermaid')
        ) {
          const ch = (first.props as { children?: React.ReactNode }).children
          const chart = String(ch).replace(/\n$/, '')
          return <MermaidBlock chart={chart} />
        }
        return <pre>{children}</pre>
      },
      code(props) {
        const { inline, className, children, ...rest } = props
        if (inline) {
          return (
            <code className={className} {...rest}>
              {children}
            </code>
          )
        }
        return (
          <code className={className} {...rest}>
            {children}
          </code>
        )
      },
      a: ({ href, children, ...rest }) => {
        if (!href) {
          return <a {...rest}>{children}</a>
        }
        if (href.startsWith('#')) {
          return (
            <a
              {...rest}
              href={href}
              onClick={e => {
                e.preventDefault()
                const id = href.slice(1)
                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              {children}
            </a>
          )
        }
        const internal = parseInternalDocLink(href)
        if (internal) {
          const hid = internal.hash?.startsWith('#') ? internal.hash.slice(1) : internal.hash
          return (
            <a
              {...rest}
              href="#"
              onClick={e => {
                e.preventDefault()
                openDoc(internal.docId, hid || undefined)
              }}
            >
              {children}
            </a>
          )
        }
        if (/^https?:\/\//i.test(href) || href.startsWith('mailto:')) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
              {children}
            </a>
          )
        }
        return (
          <a href={href} {...rest}>
            {children}
          </a>
        )
      },
    }),
    [openDoc],
  )

  useEffect(() => {
    const root = articleRef.current
    if (!root || !markdown) {
      setToc([])
      return
    }
    const headings = root.querySelectorAll('h2[id], h3[id]')
    const next: { id: string; text: string; depth: 2 | 3 }[] = []
    headings.forEach(h => {
      const id = h.id
      if (!id) return
      const depth = h.tagName === 'H2' ? 2 : 3
      const text = h.textContent?.trim() ?? id
      next.push({ id, text, depth })
    })
    setToc(next)
  }, [markdown, activeId])

  useEffect(() => {
    const hash = pendingHash.current
    if (!hash || !articleRef.current) return
    pendingHash.current = null
    const id = hash.startsWith('#') ? hash.slice(1) : hash
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [markdown, activeId])

  const onMenuClick: MenuProps['onClick'] = e => {
    setActiveId(e.key)
    pendingHash.current = null
    articleRef.current?.scrollTo({ top: 0 })
  }

  const getAnchorContainer = useCallback(() => articleRef.current ?? window, [])

  return (
    <div className={styles.root} style={{ maxHeight: VIEWPORT_SCROLL }}>
      <aside className={styles.sider}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid #334155' }}>
          <Text strong style={{ color: '#f1f5f9', fontSize: 14 }}>
            文档中心
          </Text>
          <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>
            Wiki · README · 指南
          </div>
        </div>
        <div className={styles.siderScroll}>
          <Menu
            mode="inline"
            selectedKeys={[activeId]}
            items={menuItems}
            onClick={onMenuClick}
            style={{ background: 'transparent', border: 'none' }}
            theme="dark"
          />
        </div>
      </aside>

      <div
        ref={articleRef}
        className={styles.articleWrap}
        style={{ maxHeight: VIEWPORT_SCROLL }}
      >
        {!activeEntry ? (
          <Empty className={styles.empty} description="未找到文档条目" />
        ) : markdown === null ? (
          <Empty
            className={styles.empty}
            description={
              <span>
                无法加载「{activeEntry.title}」正文。
                <br />
                请确认开发环境下 Vite 已允许读取仓库根目录下的 docs/。
              </span>
            }
          />
        ) : (
          <article className={styles.prose}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSlug]}
              components={markdownComponents}
            >
              {markdown}
            </ReactMarkdown>
          </article>
        )}
      </div>

      <nav className={styles.tocWrap} style={{ maxHeight: VIEWPORT_SCROLL }}>
        {toc.length > 0 ? (
          <Anchor
            affix={false}
            offsetTop={12}
            getContainer={getAnchorContainer}
            items={anchorItems}
            style={{ background: 'transparent' }}
          />
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            本文暂无 h2/h3 目录
          </Text>
        )}
      </nav>
    </div>
  )
}

export default DocumentationPage
