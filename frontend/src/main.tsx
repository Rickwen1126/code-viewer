import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app'
import { wsClient } from './services/ws-client'

// Auto-derive WS URL from current page host so mobile devices work over LAN
const wsUrl = import.meta.env.VITE_WS_URL
  ?? `ws://${window.location.hostname}:4800/ws/frontend`
wsClient.connect(wsUrl)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
