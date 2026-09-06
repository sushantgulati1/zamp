import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The SPA calls the API with same-origin paths (`/api/...`) and lets the dev
// server proxy them, so there is no base-URL configuration in the client code.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
