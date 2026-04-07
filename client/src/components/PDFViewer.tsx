import { FC, useCallback, useEffect, useMemo, useState } from 'react'
import { Spin, Button, Space, message, Tooltip } from 'antd'
import {
  DownloadOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  ExportOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons'
import styles from './PDFViewer.module.css'

/**
 * 将「可直接访问的 PDF 文件 URL」转为内嵌预览地址。
 * 可选：设置环境变量 VITE_KKFILEVIEW_URL（如 http://127.0.0.1:8012）时使用 kkFileView，
 * 需自行部署 kkFileView，且服务能访问该 PDF 的完整 URL（内网/公网可达）。
 */
export function embedPdfSrc(fileAbsoluteUrl: string): string {
  const kk = (import.meta.env.VITE_KKFILEVIEW_URL as string | undefined)?.trim()
  if (kk) {
    const base = kk.replace(/\/$/, '')
    const base64 = btoa(unescape(encodeURIComponent(fileAbsoluteUrl)))
    return `${base}/onlinePreview?url=${encodeURIComponent(base64)}`
  }
  return fileAbsoluteUrl
}

function defaultDownloadUrl(previewSrc: string): string {
  return previewSrc.replace(/\/preview(?=\?|#|$)/, '/download')
}

function useKkFileViewMode(): boolean {
  return Boolean((import.meta.env.VITE_KKFILEVIEW_URL as string | undefined)?.trim())
}

function isElectronDesktop(): boolean {
  return typeof window !== 'undefined' && Boolean((window as Window & { electron?: unknown }).electron)
}

interface PDFViewerProps {
  /** 用于拉取 PDF 的地址（建议 API 的 /preview） */
  source: string
  /** 文件名（下载时） */
  filename?: string
  /** 下载用地址；缺省时若 source 含路径 …/preview 则自动换成 …/download */
  downloadUrl?: string
  showDownload?: boolean
  showFullscreen?: boolean
  onError?: (error: Error) => void
  onSuccess?: () => void
}

/**
 * PDF 预览组件。
 *
 * 非 kkFileView 模式：直接将 API 的 PDF URL 作为 iframe src，
 * 不设 sandbox（Chrome/Electron 的 PDF 查看器扩展在 sandbox 下无法激活）。
 * 顶层导航劫持由 Electron 主进程 will-navigate 拦截，浏览器端由 Chrome
 * PDF 查看器自身保证安全。
 *
 * kkFileView 模式：仍通过 iframe 加载 kkFileView 页面，保留 sandbox。
 */
export const PDFViewer: FC<PDFViewerProps> = ({
  source,
  filename = 'document.pdf',
  downloadUrl: downloadUrlProp,
  showDownload = true,
  showFullscreen = false,
  onError,
  onSuccess,
}) => {
  const useKk = useKkFileViewMode()
  const [loading, setLoading] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const kkIframeSrc = useMemo(
    () => (useKk ? embedPdfSrc(source) : null),
    [source, useKk],
  )
  const downloadSrc = downloadUrlProp ?? defaultDownloadUrl(source)

  const iframeSrc = useKk ? (kkIframeSrc ?? '') : source

  useEffect(() => {
    setLoading(true)
  }, [iframeSrc])

  useEffect(() => {
    document.body.style.overflow = isFullscreen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [isFullscreen])

  const handleIframeLoad = useCallback(() => {
    setLoading(false)
    onSuccess?.()
  }, [onSuccess])

  const handleDownload = async () => {
    try {
      const response = await fetch(downloadSrc)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
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

  const handleOpenExternal = () => {
    window.open(source, '_blank', 'noopener,noreferrer')
  }

  const hintText = useKk
    ? '由 kkFileView 提供预览。'
    : isElectronDesktop()
      ? '桌面端 PDF 内嵌预览。'
      : 'PDF 内嵌预览；缩放与翻页请使用下方阅读器工具栏。'

  const floatBtnProps = {
    type: 'text' as const,
    size: 'small' as const,
    className: styles.floatBtn,
  }

  return (
    <div className={isFullscreen ? styles.fullscreenContainer : styles.container}>
      <div className={styles.content}>
        {iframeSrc && (
          <iframe
            key={iframeSrc}
            className={styles.pdfIframe}
            title={filename}
            src={iframeSrc}
            {...(useKk
              ? {
                  sandbox:
                    'allow-scripts allow-same-origin allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox',
                }
              : {})}
            referrerPolicy="no-referrer"
            onLoad={handleIframeLoad}
            onError={() => {
              setLoading(false)
              const err = new Error('PDF 在 iframe 中加载失败')
              message.error('PDF 加载失败，请尝试「新窗口」打开')
              onError?.(err)
            }}
          />
        )}
        <div className={styles.floatActions} role="toolbar" aria-label="PDF 操作">
          <Space size={2} align="center">
            <Tooltip title={hintText}>
              <Button
                {...floatBtnProps}
                icon={<QuestionCircleOutlined />}
                aria-label="预览说明"
              />
            </Tooltip>
            {showDownload && (
              <Tooltip title="下载 PDF">
                <Button
                  {...floatBtnProps}
                  icon={<DownloadOutlined />}
                  onClick={handleDownload}
                  aria-label="下载 PDF"
                />
              </Tooltip>
            )}
            <Tooltip title="新窗口打开">
              <Button
                {...floatBtnProps}
                icon={<ExportOutlined />}
                onClick={handleOpenExternal}
                aria-label="新窗口打开"
              />
            </Tooltip>
            {showFullscreen && (
              <Tooltip title={isFullscreen ? '退出全屏' : '全屏预览'}>
                <Button
                  {...floatBtnProps}
                  icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                  onClick={() => setIsFullscreen((v) => !v)}
                  aria-label={isFullscreen ? '退出全屏' : '全屏预览'}
                />
              </Tooltip>
            )}
          </Space>
        </div>
        {loading && (
          <div className={styles.loadingOverlay}>
            <Spin size="large" tip="加载 PDF 中..." />
          </div>
        )}
      </div>
    </div>
  )
}

export default PDFViewer
