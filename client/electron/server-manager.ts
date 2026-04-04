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

  /**
   * 获取后端启动命令配置
   * 
   * Windows (生产): 运行内置 xgboost-server.exe
   * Windows (开发): 用户手动 `uv run python main.py`
   * macOS/Linux (所有): 用户手动或容器运行
   */
  private getServerCommand(): { cmd: string; args: string[] } | null {
    if (is.dev) {
      // 开发模式：所有平台都由用户手动启动
      return null
    }

    // 生产模式：平台特定逻辑
    if (process.platform === 'win32') {
      // Windows: 内置 exe
      const exePath = join(process.resourcesPath, 'xgboost-server.exe')
      if (existsSync(exePath)) {
        return { cmd: exePath, args: [] }
      }
    }
    // macOS / Linux 生产模式：不自动启动（可能在容器或其他环境）
    return null
  }

  /** 启动后端服务，并等待健康检查通过后显示窗口 */
  async start(win: BrowserWindow): Promise<void> {
    this.status = 'starting'

    const serverCmd = this.getServerCommand()

    if (serverCmd) {
      // Windows 生产模式：启动内置 exe
      try {
        this.process = spawn(serverCmd.cmd, serverCmd.args, {
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
        this.process.on('error', (err) => {
          console.error('[Server] 启动失败:', err)
          this.status = 'error'
        })
        this.process.on('exit', (code) => {
          console.log(`[Server] 进程退出，退出码: ${code}`)
          this.status = 'stopped'
          this.process = null
        })
      } catch (err) {
        console.error('[Server] 无法启动服务:', err)
        this.status = 'error'
      }
    } else {
      // 开发模式或 macOS/Linux 生产模式：假设后端已启动或由外部管理
      console.log(
        `[Server] 跳过启动后端 (模式: ${is.dev ? '开发' : '生产-${process.platform}'})`
      )
    }

    // 等待健康检查通过
    const ok = await this.waitForHealth(win)
    if (ok) {
      this.status = 'running'
      win.show()
      win.focus()
    } else {
      this.status = 'error'
      const msg =
        is.dev || process.platform !== 'win32'
          ? `后端服务未就绪\n\n请确保后端已启动：\n$ cd server && uv run python main.py`
          : '后端服务启动超时，请重启应用'
      win.webContents.send('server:error', msg)
      win.show() // 仍然显示窗口，展示错误信息
    }
  }

  /** 轮询 /health 直到返回 200 或超时 */
  private async waitForHealth(win: BrowserWindow): Promise<boolean> {
    for (let i = 0; i < MAX_RETRY; i++) {
      try {
        const response = await fetch(HEALTH_URL, {
          signal: AbortSignal.timeout(2000),
        })
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
      try {
        // 尝试优雅关闭
        this.process.kill('SIGTERM')
        // 给进程 5 秒时间优雅退出
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            // 强制杀死
            if (this.process && !this.process.killed) {
              this.process.kill('SIGKILL')
            }
            resolve()
          }, 5000)
          this.process?.on('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        })
      } catch (err) {
        console.error('[Server] 停止服务出错:', err)
      }
    }
    this.process = null
    this.status = 'stopped'
  }

  getStatus(): ServerStatus {
    return this.status
  }
}

