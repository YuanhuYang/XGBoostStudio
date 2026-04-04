import { FC, useState, useRef, useEffect, useCallback } from 'react'
import { Spin, Button, Space, message, Row, Col } from 'antd'
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  DownloadOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import styles from './PDFViewer.module.css'

// 配置 PDF.js worker —— 使用本地文件，避免 CDN 版本不匹配和网络依赖
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

interface PDFViewerProps {
  /** PDF 文件 URL 或 Base64 数据 */
  source: string
  /** PDF 文件名（用于下载） */
  filename?: string
  /** 初始缩放比例 (%) */
  initialScale?: number
  /** 是否显示下载按钮 */
  showDownload?: boolean
  /** 是否显示全屏按钮 */
  showFullscreen?: boolean
  /** 加载失败时的回调 */
  onError?: (error: Error) => void
  /** 加载成功时的回调 */
  onSuccess?: () => void
}

/**
 * PDF 查看器组件
 *
 * 功能：
 * - 页码导航（上一页/下一页）
 * - 缩放控制（放大/缩小）
 * - PDF 下载
 * - 全屏预览（可选）
 *
 * 使用示例：
 * ```tsx
 * <PDFViewer
 *   source="http://example.com/report.pdf"
 *   filename="report.pdf"
 *   showDownload={true}
 * />
 * ```
 */
export const PDFViewer: FC<PDFViewerProps> = ({
  source,
  filename = 'document.pdf',
  initialScale = 100,
  showDownload = true,
  showFullscreen = false,
  onError,
  onSuccess,
}) => {
  const [numPages, setNumPages] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(initialScale)
  const [loading, setLoading] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const contentRef = useRef<HTMLDivElement | null>(null)

  const handleLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages)
    setLoading(false)
    onSuccess?.()
  }

  const handleLoadError = (error: Error) => {
    setLoading(false)
    message.error('PDF 加载失败')
    onError?.(error)
    console.error('PDF 加载错误:', error)
  }

  const handleZoomIn = () => {
    setScale((s) => Math.min(s + 10, 200))
  }

  const handleZoomOut = () => {
    setScale((s) => Math.max(s - 10, 50))
  }

  const scrollToPage = useCallback((page: number) => {
    const el = pageRefs.current[page - 1]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  const handlePrevPage = () => {
    const target = Math.max(currentPage - 1, 1)
    setCurrentPage(target)
    scrollToPage(target)
  }

  const handleNextPage = () => {
    if (numPages) {
      const target = Math.min(currentPage + 1, numPages)
      setCurrentPage(target)
      scrollToPage(target)
    }
  }

  // IntersectionObserver：跟踪当前可见页码
  useEffect(() => {
    const container = contentRef.current
    if (!container || !numPages) return
    const observer = new IntersectionObserver(
      (entries) => {
        let maxRatio = 0
        let visiblePage = currentPage
        entries.forEach((entry) => {
          if (entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio
            const idx = pageRefs.current.indexOf(entry.target as HTMLDivElement)
            if (idx !== -1) visiblePage = idx + 1
          }
        })
        if (maxRatio > 0) setCurrentPage(visiblePage)
      },
      { root: container, threshold: Array.from({ length: 11 }, (_, i) => i * 0.1) },
    )
    pageRefs.current.forEach((el) => { if (el) observer.observe(el) })
    return () => observer.disconnect()
  }, [numPages]) // eslint-disable-line react-hooks/exhaustive-deps

  // 全屏时禁止背景滚动
  useEffect(() => {
    document.body.style.overflow = isFullscreen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isFullscreen])

  const handleDownload = async () => {
    try {
      const response = await fetch(source)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      message.success('PDF 已下载')
    } catch (error) {
      message.error('下载失败')
      console.error('下载错误:', error)
    }
  }

  const handleFullscreen = () => {
    setIsFullscreen((v) => !v)
  }

  return (
    <div className={isFullscreen ? styles.fullscreenContainer : styles.container}>
      {/* 工具栏 */}
      <div className={styles.toolbar}>
        <Space>
          {/* 缩放 */}
          <Button
            icon={<ZoomOutOutlined />}
            onClick={handleZoomOut}
            title="缩小"
          />
          <span className={styles.scaleText}>{scale}%</span>
          <Button
            icon={<ZoomInOutlined />}
            onClick={handleZoomIn}
            title="放大"
          />

          {/* 分隔符 */}
          <div className={styles.divider} />

          {/* 页码导航 */}
          <Button
            icon={<LeftOutlined />}
            onClick={handlePrevPage}
            disabled={currentPage <= 1}
            title="上一页"
          />
          <span className={styles.pageText}>
            {currentPage} / {numPages || '?'}
          </span>
          <Button
            icon={<RightOutlined />}
            onClick={handleNextPage}
            disabled={!numPages || currentPage >= numPages}
            title="下一页"
          />

          {/* 分隔符 */}
          <div className={styles.divider} />

          {/* 下载与全屏 */}
          {showDownload && (
            <Button
              icon={<DownloadOutlined />}
              onClick={handleDownload}
              title="下载 PDF"
            />
          )}
          {showFullscreen && (
            <Button
              icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={handleFullscreen}
              title={isFullscreen ? '退出全屏' : '全屏预览'}
            />
          )}
        </Space>
      </div>

      {/* PDF 显示区域 */}
      <div className={styles.content} ref={contentRef}>
        {loading && (
          <div className={styles.loadingContainer}>
            <Spin size="large" tip="加载 PDF 中..." />
          </div>
        )}

        <div
          className={styles.pdfWrapper}
          style={{
            transform: `scale(${scale / 100})`,
            transformOrigin: 'top center',
          }}
        >
          <Document
            file={source}
            onLoadSuccess={handleLoadSuccess}
            onLoadError={handleLoadError}
            loading={<div />}
          >
            {numPages
              ? Array.from({ length: numPages }, (_, i) => (
                  <div
                    key={i + 1}
                    ref={(el) => { pageRefs.current[i] = el }}
                    className={styles.pageWrapper}
                  >
                    <Page pageNumber={i + 1} />
                  </div>
                ))
              : <Page pageNumber={1} />}
          </Document>
        </div>
      </div>

      {/* 页码输入（可选高级功能） */}
      <div className={styles.footer}>
        <small style={{ color: '#999' }}>
          Page {currentPage} of {numPages || '?'}
        </small>
      </div>
    </div>
  )
}

export default PDFViewer
