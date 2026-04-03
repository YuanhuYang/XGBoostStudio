import { BrowserWindow } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync } from 'fs'
import { is } from '@electron-toolkit/utils'

const BACKEND_PORT = 18899
const BACKEND_HOST = '127.0.0.1'
const HEALTH_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}/health`
const MAX_RETRY = 30       // 最多等待 30 秒
const RETRY_INTERVAL = 1000 // 每秒检测一次

type ServerStatus = 'stopped' | 'starting' | 'running' | 'error'

export class ServerManager {
  private process: ChildProcess | null = null
  private status: ServerStatus = 'stopped'

  /** 获取后端可执行文件路径 */
  private getServerExePath(): string | null {
    if (is.dev) {
      // 开发模式：不自动启动 exe，由开发者手动运行 uv run python main.py
      return null
    }
    // 生产模式：从 extraResources 目录加载
    const exePath = join(process.resourcesPath, 'xgboost-server.exe')
    return existsSync(exePath) ? exePath : null
  }

  /** 启动后端服务，并等待健康检查通过后显示窗口 */
  async start(win: BrowserWindow): Promise<void> {
    this.status = 'starting'

    const exePath = this.getServerExePath()

    if (exePath) {
      // 生产模式：启动打包好的 exe
      this.process = spawn(exePath, [], {
        detached: false,
        stdio: 'pipe',
        windowsHide: true,
      })

      this.process.stdout?.on('data', (data: Buffer) => {
        console.log('[Server]', data.toString().trim())
      })
      this.process.stderr?.on('data', (data: Buffer) => {
        console.error('[Server Error]', data.toString().trim())
      })
      this.process.on('exit', (code) => {
        console.log(`[Server] 进程退出，退出码: ${code}`)
        this.status = 'stopped'
        this.process = null
      })
    }
    // 开发模式下假设开发者已手动启动 Python 服务

    // 等待健康检查通过
    const ok = await this.waitForHealth(win)
    if (ok) {
      this.status = 'running'
      win.show()
      win.focus()
    } else {
      this.status = 'error'
      win.webContents.send('server:error', '后端服务启动超时，请重启应用')
      win.show() // 仍然显示窗口，展示错误信息
    }
  }

  /** 轮询 /health 直到返回 200 或超时 */
  private async waitForHealth(win: BrowserWindow): Promise<boolean> {
    for (let i = 0; i < MAX_RETRY; i++) {
      try {
        const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) })
        if (response.ok) {
          win.webContents.send('server:ready')
          return true
        }
      } catch {
        // 尚未就绪，继续等待
      }
      // 通知前端进度
      win.webContents.send('server:connecting', {
        attempt: i + 1,
        max: MAX_RETRY,
      })
      await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL))
    }
    return false
  }

  /** 停止后端服务 */
  async stop(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM')
      // 等待进程退出
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.process?.kill('SIGKILL')
          resolve()
        }, 5000)
        this.process?.on('exit', () => {
          clearTimeout(timeout)
          resolve()
        })
      })
    }
    this.process = null
    this.status = 'stopped'
  }

  getStatus(): ServerStatus {
    return this.status
  }
}
