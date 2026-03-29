import type { CSSProperties } from 'react'
import { useTheme } from '@/components/use-theme'

/**
 * 图表数据系列颜色常量。
 * 在 SVG stroke/fill 属性中无法直接使用 CSS var()（Recharts 内联样式），
 * 故在此统一定义，避免散落在各页面中的硬编码颜色值。
 * 颜色来自 Tailwind 色阶，与 HeroUI 主题保持视觉协调。
 */
export const CHART_SERIES_COLORS = {
  /** 品牌主色：Teal-600，与 HeroUI primary（light）一致 */
  primary: '#0d9488',
  /** 输入 token：Indigo-500，清冷技术感 */
  input: '#6366f1',
  /** 缓存 token：Cyan-400，轻量辅助 */
  cached: '#22d3ee',
  /** 输出 token：Amber-500，与 warning 语义对应 */
  output: '#f59e0b',
  /** 推理 token：Purple-500，独特语义标识 */
  reasoning: '#a855f7',
} as const

export interface ChartTheme {
  /** recharts axis tick / label 颜色 */
  textColor: string
  /** recharts CartesianGrid stroke 颜色 */
  gridColor: string
  /** recharts Tooltip 的 contentStyle */
  tooltipStyle: CSSProperties
  /** tooltip / card 背景色（用于 Tooltip wrapperStyle 等内联场景） */
  backgroundColor: string
}

/**
 * 返回与当前主题（light/dark）一致的 recharts 颜色常量。
 * 所有颜色来源于 HeroUI 默认 zinc/neutral 色阶，与 index.css 中
 * CSS token 桥接保持一致：
 *   - zinc-400 (#a1a1aa) → dark muted text
 *   - zinc-500 (#71717a) → light muted text
 *   - zinc-200 (#e4e4e7) → light border/grid
 *   - zinc-800 (#27272a) → dark border/grid
 *   - zinc-950 (#18181b) → dark background
 */
export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === 'dark'

  const textColor = dark ? '#a1a1aa' : '#71717a'
  const gridColor = dark ? '#27272a' : '#e4e4e7'
  const backgroundColor = dark ? '#18181b' : '#ffffff'

  return {
    textColor,
    gridColor,
    backgroundColor,
    tooltipStyle: {
      backgroundColor,
      border: '1px solid',
      borderColor: gridColor,
      borderRadius: '10px',
      fontSize: '12px',
    },
  }
}
