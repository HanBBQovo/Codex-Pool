import * as React from "react"
import {
  Card as HeroCard,
  CardBody as HeroCardBody,
  CardFooter as HeroCardFooter,
  CardHeader as HeroCardHeader,
  type CardProps as HeroCardProps,
} from "@heroui/react"

import { cn } from "@/lib/utils"

function Card({ className, ...props }: HeroCardProps) {
  return (
    <HeroCard
      radius="lg"
      shadow="sm"
      className={cn(
        "border-small border-default-200 bg-content1 text-foreground",
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<typeof HeroCardHeader>) {
  return (
    <HeroCardHeader
      className={cn("@container/card-header flex flex-col items-start gap-2 px-4 py-4", className)}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-base font-semibold tracking-[-0.02em] text-foreground", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm leading-6 text-default-600", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("ml-auto flex items-center justify-end gap-2 self-start", className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<typeof HeroCardBody>) {
  return <HeroCardBody className={cn("px-4 py-4", className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<typeof HeroCardFooter>) {
  return <HeroCardFooter className={cn("px-4 py-4", className)} {...props} />
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
