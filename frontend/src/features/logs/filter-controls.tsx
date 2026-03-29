import type { ComponentProps, ReactNode } from 'react'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type LogFilterOption = {
  value: string
  label: string
}

type LogsFilterGridProps = {
  children: ReactNode
  className?: string
}

type LogsFilterFieldProps = {
  label: ReactNode
  children: ReactNode
  className?: string
}

type LogsFilterSelectProps = {
  value: string
  onValueChange: (value: string) => void
  ariaLabel: string
  options: LogFilterOption[]
  className?: string
  placeholder?: string
}

type LogsFilterInputProps = Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
}

export function LogsFilterGrid({ children, className }: LogsFilterGridProps) {
  return <div className={cn('grid gap-2', className)}>{children}</div>
}

export function LogsFilterField({ label, children, className }: LogsFilterFieldProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  )
}

export function LogsFilterSelect({
  value,
  onValueChange,
  ariaLabel,
  options,
  className,
  placeholder,
}: LogsFilterSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={cn('w-full', className)} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function LogsFilterInput({
  value,
  onValueChange,
  className,
  ...props
}: LogsFilterInputProps) {
  return (
    <Input
      {...props}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      className={cn('w-full', className)}
    />
  )
}
