import * as React from "react"
import { Textarea as HeroTextarea, type TextAreaProps as HeroTextareaProps } from "@heroui/react"

import { cn } from "@/lib/utils"

export type TextareaProps = Omit<HeroTextareaProps, "spellCheck" | "minRows" | "maxRows"> & {
  spellCheck?: boolean
  rows?: number
  minRows?: number
  maxRows?: number
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    className,
    classNames,
    variant = "bordered",
    radius = "sm",
    rows,
    minRows,
    maxRows,
    spellCheck,
    ...props
  },
  ref,
) {
  return (
    <HeroTextarea
      ref={ref}
      variant={variant}
      radius={radius}
      minRows={rows ?? minRows ?? 4}
      maxRows={rows ?? maxRows}
      spellCheck={
        spellCheck === undefined
          ? undefined
          : (spellCheck ? "true" : "false")
      }
      className={className}
      classNames={{
        inputWrapper: cn(
          "border-small border-default-200 bg-content1 shadow-small transition-[border-color,background-color]",
          "group-data-[focus=true]:border-primary group-data-[focus=true]:bg-content1",
          "group-data-[hover=true]:border-default-300 group-data-[hover=true]:bg-content2",
          classNames?.inputWrapper,
        ),
        input: cn("text-sm text-foreground placeholder:text-default-400", classNames?.input),
        label: cn("text-sm font-medium text-foreground/82", classNames?.label),
        description: cn("text-xs text-default-500", classNames?.description),
        errorMessage: cn("text-xs", classNames?.errorMessage),
        base: classNames?.base,
        mainWrapper: classNames?.mainWrapper,
        innerWrapper: classNames?.innerWrapper,
        helperWrapper: classNames?.helperWrapper,
      }}
      {...props}
    />
  )
})

export { Textarea }
