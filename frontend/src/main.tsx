import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './eink.css'
import App from './app'
import { wsClient } from './services/ws-client'
import { applyThemeToDocument } from './services/theme'

// Apply persisted theme (code-viewer:theme) before first paint.
applyThemeToDocument()

// Auto-derive WS URL from current page host so mobile devices work over LAN.
// In dev mode, use same-origin WebSocket (proxied by Vite to :4800).
// Safari blocks cross-port WebSocket connections after background kill/restore.
const wsUrl = import.meta.env.VITE_WS_URL
  ?? (import.meta.env.DEV
    ? `ws://${window.location.hostname}:${window.location.port}/ws/frontend`
    : `ws://${window.location.hostname}:4800/ws/frontend`)
wsClient.connect(wsUrl)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failed — app still works without it
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        void registration.unregister()
      }
    }).catch(() => {
      // Ignore dev cleanup failure
    })
  }
}
