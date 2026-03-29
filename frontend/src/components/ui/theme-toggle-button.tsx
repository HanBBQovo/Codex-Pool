import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Moon, Sun } from 'lucide-react'
import { Button, Tooltip } from '@heroui/react'
import { useTranslation } from 'react-i18next'

import { useTheme } from '@/components/use-theme'

/**
 * 亮色/暗色切换按钮。
 * 从 AppLayout 提取为独立组件，供登录页等无侧边栏场景复用。
 */
export function ThemeToggleButton() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const { t } = useTranslation()
  const prefersReducedMotion = useReducedMotion()
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark'

  const tooltipLabel = theme === 'system'
    ? t('layout.theme.quickSwitchFromSystem', {
        current: resolvedTheme === 'dark' ? t('theme.dark') : t('theme.light'),
        next: nextTheme === 'dark' ? t('theme.dark') : t('theme.light'),
      })
    : nextTheme === 'dark' ? t('theme.dark') : t('theme.light')

  return (
    <Tooltip content={tooltipLabel} placement="bottom">
      <Button
        isIconOnly
        variant="light"
        size="sm"
        onPress={() => setTheme(nextTheme)}
        aria-label={t('common.toggleTheme')}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={resolvedTheme}
            initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.6, rotate: -20 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={prefersReducedMotion ? {} : { opacity: 0, scale: 0.6, rotate: 20 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-center justify-center"
          >
            {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </motion.span>
        </AnimatePresence>
      </Button>
    </Tooltip>
  )
}
