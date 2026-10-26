/// <reference types="vitest/config" />
import { existsSync, readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/** dev เท่านั้น: เสิร์ฟ private/seed.json (ข้อมูลจากชีต) ให้โหมด preview — ไม่มีผลกับ production build */
function devSeed(): Plugin {
  return {
    name: 'ledger-dev-seed',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/seed.json', (_req, res) => {
        const file = new URL('./private/seed.json', import.meta.url)
        if (!existsSync(file)) {
          res.statusCode = 404
          return res.end()
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(readFileSync(file))
      })
    },
  }
}

// GitHub Pages เสิร์ฟใต้ /<repo>/ — ตั้ง VITE_BASE ตอน build (ดู .github/workflows/deploy.yml)
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react(),
    devSeed(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon-64.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'รวยยัง? — บันทึกรายรับรายจ่าย',
        short_name: 'รวยยัง?',
        lang: 'th',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        // ข้อมูลจาก Supabase ห้าม cache — cache เฉพาะไฟล์ OCR จาก CDN (เวอร์ชันตายตัว)
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname === 'cdn.jsdelivr.net',
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-cdn', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 90 } },
          },
        ],
      },
    }),
  ],
  server: { port: 5188, host: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
})
