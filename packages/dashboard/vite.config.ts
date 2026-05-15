import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function removeCrossorigin(): Plugin {
  return {
    name: 'remove-crossorigin',
    transformIndexHtml(html: string) {
      return html.replace(/ crossorigin(?:="[^"]*")?/g, '')
    },
  }
}

export default defineConfig({
  plugins: [react(), removeCrossorigin()],
  build: {
    outDir: '../../packages/orchestrator/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
})
