import * as React from "react"
import { useTranslation } from "react-i18next"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type ConfirmDialogVariant = "default" | "destructive"

export interface ConfirmDialogOptions {
  title: React.ReactNode
  description?: React.ReactNode
  confirmText?: React.ReactNode
  cancelText?: React.ReactNode
  variant?: ConfirmDialogVariant
}

export function useConfirmDialog() {
  const { t } = useTranslation()
  const [options, setOptions] = React.useState<ConfirmDialogOptions | null>(null)
  const resolverRef = React.useRef<((confirmed: boolean) => void) | null>(null)

  const resolveAndClose = React.useCallback((confirmed: boolean) => {
    const resolver = resolverRef.current
    resolverRef.current = null
    setOptions(null)
    resolver?.(confirmed)
  }, [])

  const confirm = React.useCallback((nextOptions: ConfirmDialogOptions) => {
    if (resolverRef.current) {
      resolverRef.current(false)
      resolverRef.current = null
    }

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
      setOptions(nextOptions)
    })
  }, [])

  React.useEffect(() => {
    return () => {
      if (resolverRef.current) {
        resolverRef.current(false)
        resolverRef.current = null
      }
    }
  }, [])

  const confirmDialog = (
    <AlertDialog
      open={options !== null}
      onOpenChange={(open) => {
        if (!open) {
          resolveAndClose(false)
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options?.title}</AlertDialogTitle>
          {options?.description ? (
            <AlertDialogDescription>{options.description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            {options?.cancelText ??
              t("common.cancel", {
                defaultValue: "Cancel",
              })}
          </AlertDialogCancel>
          <AlertDialogAction
            color={options?.variant === "destructive" ? "danger" : "primary"}
            variant="solid"
            onClick={() => resolveAndClose(true)}
          >
            {options?.confirmText ??
              t("common.confirm", {
                defaultValue: "Confirm",
              })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { confirm, confirmDialog }
}
