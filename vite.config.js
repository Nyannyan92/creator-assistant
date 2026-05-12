import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  base: './', // 使用相对路径，确保Electron可以正确加载资源
  server: {
    port: 3000,
    open: false // Electron模式下不自动打开浏览器
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true
  },
  optimizeDeps: {
    include: ['pdfjs-dist']
  }
})
