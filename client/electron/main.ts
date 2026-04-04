import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { ServerManager } from './server-manager'

let mainWindow: BrowserWindow | null = null
const serverManager = new ServerManager()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    show: false, // 等待后端就绪再显示
    autoHideMenuBar: true,
    title: 'XGBoost Studio',
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

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
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
