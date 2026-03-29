import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  /** Lucide 图标或任意 ReactNode */
  icon?: ReactNode
  /** 主标题 */
  title: string
  /** 副文案，可选 */
  description?: string
  /** 操作按钮，可选 */
  action?: ReactNode
  /** 整体 className */
  className?: string
  /** 内容对齐方式，默认居中 */
  align?: 'center' | 'start'
  /** 尺寸，决定内边距和图标容器大小 */
  size?: 'sm' | 'md' | 'lg'
}

const sizeConfig = {
  sm: {
    wrapper: 'py-8 px-4',
    iconBox: 'h-10 w-10 rounded-xl',
    iconSize: 'h-5 w-5',
    title: 'text-sm font-medium',
    description: 'text-xs',
  },
  md: {
    wrapper: 'py-12 px-6',
    iconBox: 'h-12 w-12 rounded-xl',
    iconSize: 'h-6 w-6',
    title: 'text-[15px] font-medium',
    description: 'text-sm',
  },
  lg: {
    wrapper: 'py-16 px-8',
    iconBox: 'h-14 w-14 rounded-2xl',
    iconSize: 'h-7 w-7',
    title: 'text-base font-semibold',
    description: 'text-sm',
  },
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  align = 'center',
  size = 'md',
}: EmptyStateProps) {
  const cfg = sizeConfig[size]

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        cfg.wrapper,
        'flex flex-col gap-3',
        align === 'center' ? 'items-center text-center' : 'items-start text-left',
        className,
      )}
    >
      {icon ? (
        <div
          className={cn(
            cfg.iconBox,
            'flex items-center justify-center',
            'border border-default-200/70 bg-default-100/80 text-default-400',
          )}
        >
          <span className={cn(cfg.iconSize, 'flex items-center justify-center')}>
            {icon}
          </span>
        </div>
      ) : null}

      <div className={cn('space-y-1.5', align === 'center' ? 'max-w-[28ch]' : 'max-w-[36ch]')}>
        <p className={cn(cfg.title, 'text-foreground/80')}>{title}</p>
        {description ? (
          <p className={cn(cfg.description, 'leading-6 text-muted-foreground')}>{description}</p>
        ) : null}
      </div>

      {action ? <div className="mt-1">{action}</div> : null}
    </motion.div>
  )
}
