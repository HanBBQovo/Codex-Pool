import * as React from "react"
import { Button, Divider, Popover, PopoverContent, PopoverTrigger } from "@heroui/react"

import { cn } from "@/lib/utils"

type DropdownMenuProps = {
  children?: React.ReactNode
}

type DropdownMenuTriggerProps = {
  children?: React.ReactNode
  asChild?: boolean
}

type DropdownMenuContentProps = {
  children?: React.ReactNode
  className?: string
  align?: "start" | "center" | "end"
}

type DropdownMenuItemProps = {
  children?: React.ReactNode
  className?: string
  disabled?: boolean
  inset?: boolean
  variant?: "default" | "destructive"
  onClick?: () => void
  onSelect?: () => void
}

type DropdownMenuLabelProps = {
  children?: React.ReactNode
  className?: string
  inset?: boolean
}

const DROPDOWN_TRIGGER_MARKER = Symbol("cp.dropdown.trigger")
const DROPDOWN_CONTENT_MARKER = Symbol("cp.dropdown.content")
const DROPDOWN_ITEM_MARKER = Symbol("cp.dropdown.item")
const DROPDOWN_LABEL_MARKER = Symbol("cp.dropdown.label")
const DROPDOWN_SEPARATOR_MARKER = Symbol("cp.dropdown.separator")

type MarkerComponent<P> = React.FC<P> & { __marker: symbol }

function createMarker<P>(marker: symbol) {
  const Component = ((() => null) as unknown) as MarkerComponent<P>
  Component.__marker = marker
  return Component
}

const DropdownMenuTrigger = createMarker<DropdownMenuTriggerProps>(DROPDOWN_TRIGGER_MARKER)
const DropdownMenuContent = createMarker<DropdownMenuContentProps>(DROPDOWN_CONTENT_MARKER)
const DropdownMenuItem = createMarker<DropdownMenuItemProps>(DROPDOWN_ITEM_MARKER)
const DropdownMenuLabel = createMarker<DropdownMenuLabelProps>(DROPDOWN_LABEL_MARKER)
const DropdownMenuSeparator = createMarker<Record<string, never>>(DROPDOWN_SEPARATOR_MARKER)

function isMarkerElement<P>(
  node: React.ReactNode,
  marker: symbol,
): node is React.ReactElement<P> {
  return React.isValidElement(node) && (node.type as MarkerComponent<P>).__marker === marker
}

function visitNodes(
  children: React.ReactNode,
  visitor: (node: React.ReactNode) => void,
) {
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === React.Fragment) {
      visitNodes((child.props as { children?: React.ReactNode }).children, visitor)
      return
    }
    visitor(child)
  })
}

function alignToPlacement(align: DropdownMenuContentProps["align"]) {
  if (align === "end") return "bottom-end" as const
  if (align === "center") return "bottom" as const
  return "bottom-start" as const
}

function DropdownMenu({ children }: DropdownMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false)

  let triggerChild: React.ReactNode = null
  let contentProps: DropdownMenuContentProps | undefined
  const contentNodes: React.ReactNode[] = []

  visitNodes(children, (node) => {
    if (isMarkerElement<DropdownMenuTriggerProps>(node, DROPDOWN_TRIGGER_MARKER)) {
      triggerChild = node.props.children ?? null
      return
    }

    if (isMarkerElement<DropdownMenuContentProps>(node, DROPDOWN_CONTENT_MARKER)) {
      contentProps = node.props
      visitNodes(node.props.children, (contentChild) => {
        contentNodes.push(contentChild)
      })
    }
  })

  const renderedContent = contentNodes.map((node, index) => {
    if (isMarkerElement<DropdownMenuLabelProps>(node, DROPDOWN_LABEL_MARKER)) {
      return (
        <div
          key={`label-${index}`}
          className={cn(
            "px-2.5 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-default-500",
            node.props.inset && "pl-8",
            node.props.className,
          )}
        >
          {node.props.children}
        </div>
      )
    }

    if (isMarkerElement<Record<string, never>>(node, DROPDOWN_SEPARATOR_MARKER)) {
      return <Divider key={`separator-${index}`} className="my-1 bg-divider/80" />
    }

    if (isMarkerElement<DropdownMenuItemProps>(node, DROPDOWN_ITEM_MARKER)) {
      const isDestructive = node.props.variant === "destructive"
      return (
        <Button
          key={`item-${index}`}
          fullWidth
          radius="sm"
          variant="light"
          color={isDestructive ? "danger" : "default"}
          isDisabled={node.props.disabled}
          className={cn(
            "h-auto min-h-10 justify-start px-2.5 py-2 text-left text-sm font-medium",
            isDestructive && "text-danger",
            node.props.inset && "pl-8",
            node.props.className,
          )}
          onPress={() => {
            node.props.onSelect?.()
            node.props.onClick?.()
            setIsOpen(false)
          }}
        >
          {node.props.children}
        </Button>
      )
    }

    if (React.isValidElement(node) && node.type === React.Fragment) {
      return <React.Fragment key={`fragment-${index}`}>{node}</React.Fragment>
    }

    return node === null ? null : (
      <div key={`content-${index}`} className="px-2.5 py-1.5 text-sm text-foreground/86">
        {node}
      </div>
    )
  })

  return (
    <Popover
      placement={alignToPlacement(contentProps?.align)}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      offset={8}
    >
      <PopoverTrigger>{triggerChild ?? <span />}</PopoverTrigger>
      <PopoverContent
        className={cn(
          "border-small border-default-200 bg-content1 p-1 shadow-medium",
          contentProps?.className,
        )}
      >
        <div className="flex min-w-[12rem] flex-col gap-0.5">{renderedContent}</div>
      </PopoverContent>
    </Popover>
  )
}

const DropdownMenuPortal = ({ children }: { children?: React.ReactNode }) => <>{children}</>
const DropdownMenuGroup = ({ children }: { children?: React.ReactNode }) => <>{children}</>
const DropdownMenuCheckboxItem = DropdownMenuItem
const DropdownMenuRadioGroup = ({ children }: { children?: React.ReactNode }) => <>{children}</>
const DropdownMenuRadioItem = DropdownMenuItem
const DropdownMenuShortcut = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <span className={cn("ml-auto text-xs uppercase tracking-[0.12em] text-default-400", className)}>
    {children}
  </span>
)
const DropdownMenuSub = ({ children }: { children?: React.ReactNode }) => <>{children}</>
const DropdownMenuSubTrigger = DropdownMenuItem
const DropdownMenuSubContent = ({ children }: { children?: React.ReactNode }) => <>{children}</>

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
