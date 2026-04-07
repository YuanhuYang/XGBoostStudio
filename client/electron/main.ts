import { appendFileSync, existsSync } from 'fs'
import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { ServerManager } from './server-manager'

/** 白屏排查：环境变量 `XGBOOST_STUDIO_DISABLE_GPU=1` 或命令行 `--disable-gpu` 关闭硬件加速 */
if (
  process.env['XGBOOST_STUDIO_DISABLE_GPU'] === '1' ||
  process.argv.some((a) => a === '--disable-gpu' || a.startsWith('--disable-gpu='))
) {
  app.disableHardwareAcceleration()
}

let mainWindow: BrowserWindow | null = null
const serverManager = new ServerManager()

function appendMainDiagLine(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`
  console.error(`[MainDiag] ${message}`)
  try {
    const logPath = join(app.getPath('userData'), 'main-process-diagnostics.log')
    appendFileSync(logPath, line, 'utf-8')
  } catch {
    /* 忽略写入失败（如无 userData 权限） */
  }
}

function attachMainWindowDiagnostics(win: BrowserWindow): void {
  const wc = win.webContents
  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    appendMainDiagLine(
      `did-fail-load code=${errorCode} mainFrame=${isMainFrame} url=${validatedURL} desc=${errorDescription}`,
    )
  })
  wc.on('render-process-gone', (_event, details) => {
    appendMainDiagLine(
      `render-process-gone reason=${details.reason} exitCode=${details.exitCode}`,
    )
  })
}

/** 阻止主窗口被内嵌 PDF / blob 预览劫持为顶层导航（否则整窗变白，只剩标题栏） */
function shouldBlockMainTopNavigation(url: string): boolean {
  if (url.startsWith('blob:') || url.startsWith('data:')) return true
  try {
    const u = new URL(url)
    if (u.protocol === 'chrome-extension:' || u.protocol === 'chrome:') return true
    if (
      (u.hostname === '127.0.0.1' || u.hostname === 'localhost') &&
      u.port === '18899'
    ) {
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}

/** 开发模式下使用仓库内品牌图标；正式包由可执行文件嵌入图标负责任务栏等展示 */
function resolveDevWindowIcon(): string | undefined {
  if (!is.dev) return undefined
  if (process.platform === 'win32') {
    const p = join(__dirname, '../build/icon.ico')
    return existsSync(p) ? p : undefined
  }
  if (process.platform === 'darwin') {
    const p = join(__dirname, '../build/icon.icns')
    return existsSync(p) ? p : undefined
  }
  const png = join(__dirname, '../build/icon.png')
  return existsSync(png) ? png : undefined
}

function createWindow(): void {
  const winIcon = resolveDevWindowIcon()
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    show: false, // 等待后端就绪再显示
    autoHideMenuBar: true,
    title: 'XGBoost Studio',
    ...(winIcon ? { icon: winIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    // 窗口就绪后不立即显示，等待后端连接成功
  })

  attachMainWindowDiagnostics(mainWindow)

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (shouldBlockMainTopNavigation(navigationUrl)) {
      event.preventDefault()
      console.warn('[Main] 已阻止顶栏导航（避免 PDF 预览改写主窗口）:', navigationUrl.slice(0, 160))
    }
  })

  // 对 blob:/data: 不要用 deny：内嵌 PDF 偶发 window.open(blob) 时，deny 可能导致顶栏被回写整页空白。
  // 其它 URL 仍走系统浏览器；iframe 侧已加 sandbox 限制顶层导航。
  mainWindow.webContents.setWindowOpenHandler((details) => {
    const url = details.url
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: mainWindow!,
          width: 1200,
          height: 820,
          autoHideMenuBar: true,
          ...(winIcon ? { icon: winIcon } : {}),
          webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      }
    }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 开发模式加载 Vite dev server，生产模式加载打包后的 HTML
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.xgbooststudio')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC 事件处理
  ipcMain.handle('server:status', () => serverManager.getStatus())
  ipcMain.handle('server:getConnectionState', () => serverManager.getConnectionState())
  ipcMain.handle('server:getPort', () => 18899)
  ipcMain.handle('shell:openExternal', (_event, url: string) => shell.openExternal(url))
  ipcMain.handle('app:isFirstLaunch', () => {
    const { existsSync, writeFileSync } = require('fs')
    const { join: pathJoin } = require('path')
    const flagPath = pathJoin(app.getPath('userData'), 'launched.flag')
    if (!existsSync(flagPath)) {
      writeFileSync(flagPath, '1', 'utf-8')
      return true
    }
    return false
  })

  // 创建窗口
  createWindow()

  // 启动 Python 后端服务
  if (mainWindow) {
    await serverManager.start(mainWindow)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await serverManager.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  await serverManager.stop()
})
