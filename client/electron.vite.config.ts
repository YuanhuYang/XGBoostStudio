import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron',
      lib: {
        entry: resolve('electron/main.ts'),
      }
    },
    resolve: {
      alias: {
        '@': resolve('src')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      lib: {
        entry: resolve('electron/preload.ts'),
      }
    }
  },
  renderer: {
    plugins: [react()],
    root: resolve('.'),
    build: {
      rollupOptions: {
        input: resolve('index.html'),
      }
    },
    resolve: {
      alias: {
        '@': resolve('src')
      }
    },
    server: {
      port: 5173,
      fs: {
        allow: [resolve(__dirname, '..')],
      },
    },
  }
})
