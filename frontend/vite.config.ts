import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from "path"

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8090'

function normalizeModuleId(id: string) {
  return id.replace(/\\/g, '/')
}

function matchesAny(id: string, patterns: string[]) {
  return patterns.some((pattern) => id.includes(pattern))
}

function resolveVendorChunk(id: string) {
  const normalized = normalizeModuleId(id)

  if (!normalized.includes('/node_modules/')) {
    return undefined
  }

  if (matchesAny(normalized, ['/@heroui/react/'])) {
    return undefined
  }

  if (matchesAny(normalized, ['/i18next/', '/react-i18next/', '/i18next-browser-languagedetector/'])) {
    return 'i18n-vendor'
  }

  if (matchesAny(normalized, ['/framer-motion/'])) {
    return 'motion-vendor'
  }

  if (matchesAny(normalized, ['/lucide-react/'])) {
    return 'icons-vendor'
  }

  if (matchesAny(normalized, ['/recharts/', '/react-redux/', '/@reduxjs/toolkit/'])) {
    return 'charts-vendor'
  }

  if (matchesAny(normalized, ['/@tanstack/react-query/'])) {
    return 'query-vendor'
  }

  if (
    matchesAny(normalized, [
      '/@heroui/table/',
      '/@heroui/pagination/',
      '/@react-aria/table/',
      '/@react-aria/grid/',
      '/@react-stately/table/',
      '/@react-stately/grid/',
      '/@react-stately/virtualizer/',
      '/@react-types/table/',
      '/@react-types/grid/',
    ])
  ) {
    return 'heroui-data-vendor'
  }

  return undefined
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '^/api(?:/|$)': {
        target: apiProxyTarget,
        changeOrigin: true
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          return resolveVendorChunk(id)
        },
      },
    },
  }
})
