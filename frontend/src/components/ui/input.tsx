import * as React from "react"
import { Input as HeroInput, type InputProps as HeroInputProps } from "@heroui/react"

import { cn } from "@/lib/utils"

export type InputProps = Omit<HeroInputProps, "spellCheck"> & {
  spellCheck?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    className,
    classNames,
    variant = "bordered",
    radius = "sm",
    size = "md",
    spellCheck,
    ...props
  },
  ref,
) {
  return (
    <HeroInput
      ref={ref}
      variant={variant}
      radius={radius}
      size={size}
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
        clearButton: cn("text-default-400", classNames?.clearButton),
        base: classNames?.base,
        mainWrapper: classNames?.mainWrapper,
        innerWrapper: classNames?.innerWrapper,
        helperWrapper: classNames?.helperWrapper,
      }}
      {...props}
    />
  )
})

export { Input }
