import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { vivicApi } from './server/api.ts'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss(), vivicApi()],
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(root, 'index.html'),
        controller: path.resolve(root, 'controller.html'),
        stage: path.resolve(root, 'stage.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
})
