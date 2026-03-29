"use client"

import * as React from "react"
import { Button as HeroButton, Modal, ModalContent, type ModalProps } from "@heroui/react"

import { cn } from "@/lib/utils"

type AlertDialogContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
}

const AlertDialogContext = React.createContext<AlertDialogContextValue | null>(null)

function useAlertDialogContext() {
  const context = React.useContext(AlertDialogContext)
  if (!context) {
    throw new Error("AlertDialog components must be used within <AlertDialog>.")
  }
  return context
}

type AlertDialogProps = {
  children?: React.ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

function AlertDialog({
  children,
  open,
  defaultOpen = false,
  onOpenChange,
}: AlertDialogProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen)
  const resolvedOpen = open ?? internalOpen

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (open === undefined) {
        setInternalOpen(nextOpen)
      }
      onOpenChange?.(nextOpen)
    },
    [onOpenChange, open],
  )

  return (
    <AlertDialogContext.Provider value={{ open: resolvedOpen, setOpen }}>
      {children}
    </AlertDialogContext.Provider>
  )
}

function AlertDialogTrigger({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}

function AlertDialogPortal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}

function AlertDialogOverlay({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}

function AlertDialogContent({
  className,
  children,
  ...props
}: Omit<ModalProps, "children"> & {
  className?: string
  children?: React.ReactNode
}) {
  const { open, setOpen } = useAlertDialogContext()

  return (
    <Modal
      isOpen={open}
      onOpenChange={setOpen}
      backdrop="blur"
      placement="center"
      hideCloseButton
      classNames={{
        base: cn(
          "border-small border-default-200 bg-content1 shadow-large",
          className,
        ),
        wrapper: "px-2 py-2 sm:px-6 sm:py-6",
        backdrop: "bg-black/52 backdrop-blur-[2px]",
      }}
      {...props}
    >
      <ModalContent>{() => <div className="flex flex-col gap-4">{children}</div>}</ModalContent>
    </Modal>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-2 text-left", className)}
      {...props}
    />
  )
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  )
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="alert-dialog-title"
      className={cn("text-lg font-semibold tracking-[-0.02em] text-foreground", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="alert-dialog-description"
      className={cn("text-sm leading-6 text-default-600", className)}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  children,
  onClick,
  onPress,
  ...props
}: React.ComponentProps<typeof HeroButton>) {
  const { setOpen } = useAlertDialogContext()

  return (
    <HeroButton
      className={className}
      onClick={(event) => {
        onClick?.(event)
        setOpen(false)
      }}
      onPress={(event) => {
        onPress?.(event)
        setOpen(false)
      }}
      {...props}
    >
      {children}
    </HeroButton>
  )
}

function AlertDialogCancel({
  className,
  children,
  onClick,
  onPress,
  variant = "bordered",
  ...props
}: React.ComponentProps<typeof HeroButton>) {
  const { setOpen } = useAlertDialogContext()

  return (
    <HeroButton
      variant={variant}
      className={cn("mt-2 sm:mt-0", className)}
      onClick={(event) => {
        onClick?.(event)
        setOpen(false)
      }}
      onPress={(event) => {
        onPress?.(event)
        setOpen(false)
      }}
      {...props}
    >
      {children}
    </HeroButton>
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
