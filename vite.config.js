// vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/core']
  },
  build: {
    rollupOptions: {
      external: ['@ffmpeg/ffmpeg', '@ffmpeg/core']
    }
  }
})