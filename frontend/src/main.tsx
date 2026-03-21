import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app'
import { wsClient } from './services/ws-client'

const wsUrl = import.meta.env.VITE_WS_URL ?? 'ws://localhost:3000'
wsClient.connect(wsUrl)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
