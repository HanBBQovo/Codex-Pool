import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import {
  type NotificationVariant,
  type NotifyPayload,
  subscribeNotifications,
} from '@/lib/notification'

type NotificationItem = {
  id: string
  title: string
  description?: string
  variant: NotificationVariant
  durationMs: number
}

const DEFAULT_DURATION_MS = 4200

function variantClasses(variant: NotificationVariant): string {
  switch (variant) {
    case 'success':
      return 'border-success/25 bg-content1/95 text-foreground'
    case 'warning':
      return 'border-warning/25 bg-content1/95 text-foreground'
    case 'error':
      return 'border-destructive/25 bg-content1/95 text-foreground'
    case 'info':
    default:
      return 'border-default-200/60 bg-content1/95 text-foreground'
  }
}

function progressColorClass(variant: NotificationVariant): string {
  switch (variant) {
    case 'success':
      return 'bg-success/60'
    case 'warning':
      return 'bg-warning/60'
    case 'error':
      return 'bg-destructive/50'
    case 'info':
    default:
      return 'bg-default-400/50'
  }
}

/**
 * success 图标：入场时有满足感的描边动画 + 轻微弹跳缩放。
 * warning / error 使用标准 CircleAlert，无额外动效。
 */
function VariantIcon({
  variant,
  reducedMotion,
}: {
  variant: NotificationVariant
  reducedMotion: boolean | null
}) {
  if (variant === 'success') {
    return (
      <motion.span
        initial={reducedMotion ? false : { scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1], delay: 0.06 }}
        className="relative flex shrink-0 items-center justify-center text-success"
        aria-hidden="true"
      >
        <CircleCheck className="h-4 w-4" />
      </motion.span>
    )
  }
  if (variant === 'warning') {
    return <CircleAlert className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
  }
  if (variant === 'error') {
    return <CircleAlert className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
  }
  return <Info className="h-4 w-4 shrink-0 text-default-500" aria-hidden="true" />
}

/**
 * 线性计时进度条：随通知自动倒计时，在消失前最后一刻淡出。
 * 仅在 `!reducedMotion` 时渲染，尊重无障碍偏好。
 */
function DismissTimer({
  durationMs,
  reducedMotion,
  variant,
}: {
  durationMs: number
  reducedMotion: boolean | null
  variant: NotificationVariant
}) {
  if (reducedMotion) return null

  return (
    <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden rounded-b-large">
      <motion.div
        className={cn('h-full', progressColorClass(variant))}
        initial={{ scaleX: 1, originX: 0 }}
        animate={{ scaleX: 0 }}
        transition={{
          duration: durationMs / 1000,
          ease: 'linear',
        }}
      />
    </div>
  )
}

export function NotificationCenter() {
  const { t } = useTranslation()
  const prefersReducedMotion = useReducedMotion()
  const [items, setItems] = useState<NotificationItem[]>([])
  const timers = useRef<Map<string, number>>(new Map())
  const transition = prefersReducedMotion
    ? { duration: 0.16, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }
    : { duration: 0.24, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }
  const layoutTransition = prefersReducedMotion
    ? { duration: 0.14 }
    : { duration: 0.22, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }

  const remove = (id: string) => {
    const timer = timers.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
    setItems((current) => current.filter((item) => item.id !== id))
  }

  useEffect(() => {
    const timerMap = timers.current

    const unsubscribe = subscribeNotifications((detail: NotifyPayload) => {
      if (!detail?.title) {
        return
      }

      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const item: NotificationItem = {
        id,
        title: detail.title,
        description: detail.description,
        variant: detail.variant ?? 'info',
        durationMs: detail.durationMs ?? DEFAULT_DURATION_MS,
      }

      setItems((current) => {
        const next = [item, ...current]
        return next.slice(0, 4)
      })

      const timer = window.setTimeout(() => {
        remove(id)
      }, item.durationMs)
      timerMap.set(id, timer)
    })

    return () => {
      unsubscribe()
      timerMap.forEach((timerId) => window.clearTimeout(timerId))
      timerMap.clear()
    }
  }, [])

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-[120] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2"
      aria-live="polite"
      aria-relevant="additions text"
      aria-atomic="false"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {items.map((item) => (
          <motion.div
            key={item.id}
            layout="position"
            initial={{ opacity: 0, y: -10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.985 }}
            transition={{
              ...transition,
              layout: layoutTransition,
            }}
            className={cn(
              'pointer-events-auto relative overflow-hidden rounded-large border-small px-3.5 py-3 shadow-medium backdrop-blur-md',
              variantClasses(item.variant),
            )}
            role="status"
          >
            <div className="flex items-start gap-2">
              <VariantIcon variant={item.variant} reducedMotion={prefersReducedMotion} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-5">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-xs leading-5 opacity-90">{item.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                className="rounded-md p-1 opacity-70 transition-[background-color,opacity,color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-black/5 hover:opacity-100 active:translate-y-px dark:hover:bg-white/10 motion-reduce:transform-none"
                onClick={() => remove(item.id)}
                aria-label={t('notifications.dismiss', {
                  defaultValue: 'Dismiss notification',
                })}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* 倒计时进度条 */}
            <DismissTimer
              durationMs={item.durationMs}
              reducedMotion={prefersReducedMotion}
              variant={item.variant}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
