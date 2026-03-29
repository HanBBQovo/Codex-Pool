import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import i18n from './i18n'
import App from './App.tsx'
import { syncDocumentLanguage } from './lib/seo'

// 开发者彩蛋 — 给打开 DevTools 的好奇心点个赞
if (import.meta.env.PROD) {
  console.log(
    '%c  Codex-Pool  ',
    'background:#0d9488;color:#fff;font-size:14px;font-weight:700;padding:6px 16px;border-radius:8px;letter-spacing:0.08em',
  )
  console.log(
    '%cOpenAI/Codex 兼容代理系统 · Rust 双平面架构',
    'color:#0d9488;font-size:12px',
  )
  console.log(
    '%c如果你在这里，说明你比大多数人多走了一步。\n有兴趣深入了解？→ https://github.com/wangnov/codex-pool',
    'color:#71717a;font-size:11px;line-height:1.6',
  )
}

syncDocumentLanguage(i18n.resolvedLanguage ?? i18n.language)
i18n.off('languageChanged', syncDocumentLanguage)
i18n.on('languageChanged', syncDocumentLanguage)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
