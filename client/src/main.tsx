import React from 'react'
import ReactDOM from 'react-dom/client'
import { message } from 'antd'
import App from './App'
import './styles/global.css'

message.config({ top: 16 })

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
