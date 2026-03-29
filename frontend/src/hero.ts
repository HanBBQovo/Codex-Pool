import { heroui } from '@heroui/react'

/**
 * HeroUI 主题配置
 *
 * Primary 色系：Teal（Tailwind teal 色阶）
 *   DEFAULT = #0d9488（teal-600），清冷技术感，在 admin 工具中罕见且辨识度高。
 *
 * Dark 主题：primary DEFAULT 用更亮的 #2dd4bf（teal-400），
 *   在深色背景上保持足够对比度和可读性。
 */
export default heroui({
  defaultTheme: 'light',
  defaultExtendTheme: 'light',
  themes: {
    light: {
      colors: {
        primary: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
          DEFAULT: '#0d9488',
          foreground: '#ffffff',
        },
      },
    },
    dark: {
      colors: {
        primary: {
          50: '#134e4a',
          100: '#115e59',
          200: '#0f766e',
          300: '#0d9488',
          400: '#14b8a6',
          500: '#2dd4bf',
          600: '#5eead4',
          700: '#99f6e4',
          800: '#ccfbf1',
          900: '#f0fdfa',
          DEFAULT: '#2dd4bf',
          foreground: '#042f2e',
        },
      },
    },
  },
})
