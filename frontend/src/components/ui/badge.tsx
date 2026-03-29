/* eslint-disable react-refresh/only-export-components */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Chip, type ChipProps } from "@heroui/react"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "",
        secondary: "",
        destructive: "",
        outline: "",
        success: "",
        warning: "",
        info: "",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>

export type BadgeProps = Omit<ChipProps, "variant" | "color"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean
  }

function resolveBadgeTone(variant: BadgeVariant) {
  switch (variant) {
    case "destructive":
      return { variant: "flat" as const, color: "danger" as const }
    case "outline":
      return { variant: "bordered" as const, color: "default" as const }
    case "success":
      return { variant: "flat" as const, color: "success" as const }
    case "warning":
      return { variant: "flat" as const, color: "warning" as const }
    case "info":
      return { variant: "flat" as const, color: "secondary" as const }
    case "secondary":
      return { variant: "flat" as const, color: "default" as const }
    case "default":
    default:
      return { variant: "solid" as const, color: "primary" as const }
  }
}

function Badge({
  className,
  variant: rawVariant = "default",
  asChild,
  children,
  ...props
}: BadgeProps) {
  const variant = rawVariant ?? "default"

  if (asChild && React.isValidElement<{ className?: string }>(children)) {
    return React.cloneElement(children, {
      className: cn(badgeVariants({ variant }), className, children.props.className),
    })
  }

  const tone = resolveBadgeTone(variant)

  return (
    <Chip
      radius="sm"
      size="sm"
      color={tone.color}
      variant={tone.variant}
      className={cn(
        badgeVariants({ variant }),
        "max-w-full border border-transparent font-medium",
        className,
      )}
      {...props}
    >
      {children}
    </Chip>
  )
}

export { Badge, badgeVariants }
