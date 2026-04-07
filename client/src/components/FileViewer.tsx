import { FC, ReactNode } from 'react'
import { Empty } from 'antd'
import { PDFViewer } from './PDFViewer'
import styles from './FileViewer.module.css'

export type FileType = 'pdf' | 'excel' | 'csv' | 'unknown'

interface FileViewerProps {
  /** 文件类型 */
  type: FileType
  /** 文件源（URL 或 Base64） */
  source: string
  /** 文件名 */
  filename?: string
  /** 自定义加载中渲染 */
  loadingRender?: ReactNode
  /** 自定义错误渲染 */
  errorRender?: ReactNode
  /** 错误时的回调 */
  onError?: (error: Error) => void
  /** 加载成功的回调 */
  onSuccess?: () => void
}

/**
 * 通用文件查看器容器组件
 *
 * 支持多种文件类型，自动路由到相应的查看器：
 * - PDF：iframe 内嵌系统内置阅读器（与浏览器直接打开一致）
 * - Excel：预留接口（未来实现）
 * - CSV：预留接口（未来实现）
 *
 * 使用示例：
 * ```tsx
 * <FileViewer
 *   type="pdf"
 *   source="http://example.com/report.pdf"
 *   filename="report.pdf"
 * />
 *
 * <FileViewer
 *   type="excel"
 *   source="http://example.com/data.xlsx"
 *   filename="data.xlsx"
 * />
 * ```
 */
export const FileViewer: FC<FileViewerProps> = ({
  type,
  source,
  filename = 'file',
  loadingRender,
  errorRender,
  onError,
  onSuccess,
}) => {
  const handleError = (error: Error) => {
    console.error(`[FileViewer] Error loading ${type} file:`, error)
    onError?.(error)
  }

  const handleSuccess = () => {
    onSuccess?.()
  }

  switch (type) {
    case 'pdf':
      return (
        <PDFViewer
          source={source}
          filename={filename}
          showDownload={true}
          showFullscreen={true}
          onError={handleError}
          onSuccess={handleSuccess}
        />
      )

    case 'excel':
      return (
        <div className={styles.container}>
          {errorRender || (
            <Empty
              description="Excel 预览功能即将推出"
              style={{ marginTop: 60 }}
            >
              <p style={{ color: '#999', marginTop: 16 }}>
                您可以下载文件到本地查看，或联系我们反馈需求。
              </p>
            </Empty>
          )}
        </div>
      )

    case 'csv':
      return (
        <div className={styles.container}>
          {errorRender || (
            <Empty
              description="CSV 预览功能即将推出"
              style={{ marginTop: 60 }}
            >
              <p style={{ color: '#999', marginTop: 16 }}>
                您可以下载文件到本地查看，或联系我们反馈需求。
              </p>
            </Empty>
          )}
        </div>
      )

    case 'unknown':
    default:
      return (
        <div className={styles.container}>
          {errorRender || (
            <Empty
              description="不支持的文件类型"
              style={{ marginTop: 60 }}
            />
          )}
        </div>
      )
  }
}

export default FileViewer

/**
 * 辅助函数：根据文件扩展名推断文件类型
 *
 * 使用：
 * ```tsx
 * const fileType = inferFileType('report.pdf')  // 'pdf'
 * const fileType = inferFileType('data.xlsx')   // 'excel'
 * ```
 */
export const inferFileType = (filename: string): FileType => {
  const ext = filename.toLowerCase().split('.').pop() || ''

  switch (ext) {
    case 'pdf':
      return 'pdf'
    case 'xlsx':
    case 'xls':
    case 'xlsm':
      return 'excel'
    case 'csv':
      return 'csv'
    default:
      return 'unknown'
  }
}
