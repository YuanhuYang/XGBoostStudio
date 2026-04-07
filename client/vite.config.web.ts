import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

/**
 * Web-only Vite 配置（无 Electron）
 *
 * 用于 Linux / 无显示器环境的纯浏览器访问模式。
 * Windows / macOS 开发模式仍推荐使用 electron-vite（npm run dev）。
 *
 * 运行方式:
 *   cd client && npm run dev:web
 * 访问地址:
 *   http://localhost:5173
 */
export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, '.'),
  build: {
    outDir: resolve(__dirname, 'dist-renderer'),
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    open: false,
    fs: {
      allow: [resolve(__dirname, '..')],
    },
  },
  // 告知 Vite 这是一个浏览器应用，不处理 Node.js 相关 API
  define: {
    'process.env.IS_WEB': JSON.stringify('true'),
  },
})
