import { contextBridge, ipcRenderer } from 'electron'

// 暴露给渲染进程的安全 API
contextBridge.exposeInMainWorld('electron', {
  server: {
    getStatus: () => ipcRenderer.invoke('server:status'),
    getPort: () => ipcRenderer.invoke('server:getPort'),
    onReady: (callback: () => void) => {
      ipcRenderer.on('server:ready', callback)
      return () => ipcRenderer.removeListener('server:ready', callback)
    },
    onConnecting: (callback: (data: { attempt: number; max: number }) => void) => {
      ipcRenderer.on('server:connecting', (_event, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('server:connecting')
    },
    onError: (callback: (msg: string) => void) => {
      ipcRenderer.on('server:error', (_event, msg) => callback(msg))
      return () => ipcRenderer.removeAllListeners('server:error')
    },
  },
})
