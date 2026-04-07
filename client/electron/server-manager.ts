import { BrowserWindow } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { chmodSync, existsSync } from 'fs'
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
   * 生产模式：运行 PyInstaller 打入 extraResources 的内置后端。
   * 开发模式：由用户在 `server/` 下手动 `uv run python main.py`。
   */
  private getServerCommand(): { cmd: string; args: string[] } | null {
    if (is.dev) {
      return null
    }

    if (process.platform === 'win32') {
      const exePath = join(process.resourcesPath, 'xgboost-server.exe')
      if (existsSync(exePath)) {
        return { cmd: exePath, args: [] }
      }
      return null
    }

    if (process.platform === 'darwin' || process.platform === 'linux') {
      const binPath = join(process.resourcesPath, 'xgboost-server')
      if (existsSync(binPath)) {
        try {
          chmodSync(binPath, 0o755)
        } catch {
          // 若已是可执行或权限不足则仍尝试 spawn
        }
        return { cmd: binPath, args: [] }
      }
    }

    return null
  }

  /** 启动后端服务，并等待健康检查通过后显示窗口 */
  async start(win: BrowserWindow): Promise<void> {
    this.status = 'starting'

    const serverCmd = this.getServerCommand()

    if (serverCmd) {
      try {
        this.process = spawn(serverCmd.cmd, serverCmd.args, {
          detached: false,
          stdio: 'pipe',
          windowsHide: process.platform === 'win32',
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
      console.log(
        `[Server] 跳过启动内置后端 (模式: ${is.dev ? '开发' : `生产-${process.platform}`}，未找到打包资源或平台未支持)`
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
      const bundledBackend =
        process.platform === 'win32'
          ? existsSync(join(process.resourcesPath, 'xgboost-server.exe'))
          : process.platform === 'darwin' || process.platform === 'linux'
            ? existsSync(join(process.resourcesPath, 'xgboost-server'))
            : false
      const msg =
        is.dev || !bundledBackend
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

