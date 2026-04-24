import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4801,
    host: true,
    proxy: {
      // Proxy WebSocket through the same port as the page.
      // Safari blocks cross-port WebSocket after background kill/restore.
      '/ws': {
        target: 'http://localhost:4800',
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router'],
          'vendor-shiki': ['shiki', 'react-shiki'],
        },
      },
    },
  },
})
