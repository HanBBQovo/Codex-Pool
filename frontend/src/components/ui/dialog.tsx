"use client"

import * as React from "react"
import {
  Button as HeroButton,
  Drawer,
  DrawerContent,
  type DrawerProps,
} from "@heroui/react"
import { XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { useUiPreferences } from "@/components/use-ui-preferences"
import { cn } from "@/lib/utils"

type DialogContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
}

const DialogContext = React.createContext<DialogContextValue | null>(null)

function useDialogContext() {
  const context = React.useContext(DialogContext)
  if (!context) {
    throw new Error("Dialog components must be used within <Dialog>.")
  }
  return context
}

type DialogProps = {
  children?: React.ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

function Dialog({ children, open, defaultOpen = false, onOpenChange }: DialogProps) {
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
    <DialogContext.Provider value={{ open: resolvedOpen, setOpen }}>
      {children}
    </DialogContext.Provider>
  )
}

function DialogTrigger({
  children,
  onClick,
  onPress,
  ...props
}: React.ComponentProps<typeof HeroButton>) {
  const { setOpen } = useDialogContext()

  return (
    <HeroButton
      {...props}
      onClick={(event) => {
        onClick?.(event)
        setOpen(true)
      }}
      onPress={(event) => {
        onPress?.(event)
        setOpen(true)
      }}
    >
      {children}
    </HeroButton>
  )
}

function DialogPortal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}

function DialogOverlay({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}

function DialogClose({
  children,
  onClick,
  onPress,
  ...props
}: React.ComponentProps<typeof HeroButton>) {
  const { setOpen } = useDialogContext()

  return (
    <HeroButton
      {...props}
      onClick={(event) => {
        onClick?.(event)
        setOpen(false)
      }}
      onPress={(event) => {
        onPress?.(event)
        setOpen(false)
      }}
    >
      {children}
    </HeroButton>
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: Omit<DrawerProps, "children"> & {
  children?: React.ReactNode
  className?: string
  showCloseButton?: boolean
}) {
  const { t } = useTranslation()
  const { open, setOpen } = useDialogContext()
  const { drawerPlacement } = useUiPreferences()

  return (
    <Drawer
      isOpen={open}
      onOpenChange={setOpen}
      backdrop="blur"
      placement={drawerPlacement}
      hideCloseButton
      classNames={{
        base: cn(
          "border-small border-default-200 bg-content1 shadow-large",
          className,
        ),
        wrapper: "px-0 py-0 sm:px-0 sm:py-0",
        backdrop: "bg-black/52 backdrop-blur-[2px]",
      }}
      {...props}
    >
      <DrawerContent>
        {(onClose) => (
          <div className="relative flex flex-col gap-4">
            {children}
            {showCloseButton ? (
              <HeroButton
                isIconOnly
                size="sm"
                variant="light"
                radius="full"
                className="absolute right-3 top-3 text-default-500"
                onPress={onClose}
              >
                <XIcon className="h-4 w-4" />
                <span className="sr-only">
                  {t("common.close", { defaultValue: "Close" })}
                </span>
              </HeroButton>
            ) : null}
          </div>
        )}
      </DrawerContent>
    </Drawer>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  const { t } = useTranslation()
  const { setOpen } = useDialogContext()

  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton ? (
        <HeroButton variant="bordered" onPress={() => setOpen(false)}>
          {t("common.close", { defaultValue: "Close" })}
        </HeroButton>
      ) : null}
    </div>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="dialog-title"
      className={cn("text-lg font-semibold tracking-[-0.02em] text-foreground", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="dialog-description"
      className={cn("text-sm leading-6 text-default-600", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
