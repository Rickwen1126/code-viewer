// Minimal Service Worker for PWA install + app shell caching
// Does NOT intercept WebSocket or API calls

const CACHE_NAME = 'code-viewer-v1'
const APP_SHELL_URL = '/'

async function getAppShell() {
  const cached = await caches.match(APP_SHELL_URL)
  if (cached) return cached

  return fetch(APP_SHELL_URL)
}

function offlineResponse() {
  return new Response('Offline', {
    status: 503,
    statusText: 'Offline',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}

// Cache app shell on install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([
        APP_SHELL_URL,
        '/manifest.json',
        '/icon.svg',
      ])
    )
  )
  self.skipWaiting()
})

// Clean old caches on activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Network-first for navigation, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event

  // Skip non-GET requests and WebSocket upgrades
  if (request.method !== 'GET') return
  if (request.headers.get('upgrade') === 'websocket') return

  // Navigation requests: network-first (fall back to cached index.html)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => getAppShell())
    )
    return
  }

  // Static assets: cache-first
  if (request.url.match(/\.(js|css|svg|png|woff2?)$/)) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request).then((response) => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          return response
        })
      )
    )
    return
  }

  // Everything else: network-first
  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(request)
      return cached ?? offlineResponse()
    })
  )
})
