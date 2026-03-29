import * as React from "react"
import {
  Checkbox as HeroCheckbox,
  type CheckboxProps as HeroCheckboxProps,
} from "@heroui/react"

import { cn } from "@/lib/utils"

type CheckedState = boolean | "indeterminate"

export type CheckboxProps = Omit<
  HeroCheckboxProps,
  | "checked"
  | "defaultChecked"
  | "isSelected"
  | "isIndeterminate"
  | "defaultSelected"
  | "onValueChange"
> & {
  checked?: CheckedState
  defaultChecked?: boolean
  isSelected?: boolean
  isIndeterminate?: boolean
  onCheckedChange?: (checked: boolean) => void
  onValueChange?: (checked: boolean) => void
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  {
    className,
    classNames,
    checked,
    defaultChecked,
    isSelected,
    isIndeterminate,
    onCheckedChange,
    onValueChange,
    children,
    ...props
  },
  ref,
) {
  const resolvedIndeterminate = isIndeterminate ?? checked === "indeterminate"
  const resolvedSelected =
    isSelected ??
    (resolvedIndeterminate
      ? true
      : checked === undefined
        ? undefined
        : checked === true)

  return (
    <HeroCheckbox
      ref={ref}
      isSelected={resolvedSelected}
      defaultSelected={defaultChecked}
      isIndeterminate={resolvedIndeterminate}
      className={className}
      classNames={{
        base: cn("items-start gap-2", classNames?.base),
        wrapper: cn(
          "border-small border-default-200 bg-content1 shadow-small group-data-[hover=true]:border-default-300",
          "group-data-[selected=true]:border-primary group-data-[selected=true]:bg-primary",
          classNames?.wrapper,
        ),
        icon: cn("text-white", classNames?.icon),
        label: cn("text-sm text-foreground/86", classNames?.label),
      }}
      onValueChange={(value) => {
        onValueChange?.(value)
        onCheckedChange?.(value)
      }}
      {...props}
    >
      {children}
    </HeroCheckbox>
  )
})

export { Checkbox }
