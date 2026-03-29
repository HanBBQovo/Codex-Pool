"use client"

import * as React from "react"
import {
  Select as HeroSelect,
  SelectItem as HeroSelectItem,
  type SelectProps as HeroSelectProps,
  type Selection,
} from "@heroui/react"

import { cn } from "@/lib/utils"

type SelectTriggerProps = {
  className?: string
  size?: "sm" | "default"
  children?: React.ReactNode
  "aria-label"?: string
}

type SelectValueProps = {
  placeholder?: string
}

type SelectContentProps = {
  className?: string
  children?: React.ReactNode
}

type SelectItemProps = {
  value?: string
  disabled?: boolean
  className?: string
  children?: React.ReactNode
}

type SelectProps = Omit<
  HeroSelectProps,
  "children" | "selectedKeys" | "defaultSelectedKeys" | "onSelectionChange"
> & {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  children?: React.ReactNode
}

type ParsedSelectItem = {
  key: string
  className?: string
  disabled?: boolean
  children?: React.ReactNode
}

const SELECT_TRIGGER_MARKER = Symbol("cp.select.trigger")
const SELECT_VALUE_MARKER = Symbol("cp.select.value")
const SELECT_CONTENT_MARKER = Symbol("cp.select.content")
const SELECT_ITEM_MARKER = Symbol("cp.select.item")

type MarkerComponent<P> = React.FC<P> & { __marker: symbol }

function createMarker<P>(marker: symbol) {
  const Component = ((() => null) as unknown) as MarkerComponent<P>
  Component.__marker = marker
  return Component
}

const SelectTrigger = createMarker<SelectTriggerProps>(SELECT_TRIGGER_MARKER)
const SelectValue = createMarker<SelectValueProps>(SELECT_VALUE_MARKER)
const SelectContent = createMarker<SelectContentProps>(SELECT_CONTENT_MARKER)
const SelectItem = createMarker<SelectItemProps>(SELECT_ITEM_MARKER)

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

function parseSelectChildren(children: React.ReactNode) {
  let triggerProps: SelectTriggerProps | undefined
  let valueProps: SelectValueProps | undefined
  let contentProps: SelectContentProps | undefined
  const items: ParsedSelectItem[] = []

  visitNodes(children, (node) => {
    if (isMarkerElement<SelectTriggerProps>(node, SELECT_TRIGGER_MARKER)) {
      triggerProps = node.props
      visitNodes(node.props.children, (triggerChild) => {
        if (isMarkerElement<SelectValueProps>(triggerChild, SELECT_VALUE_MARKER)) {
          valueProps = triggerChild.props
        }
      })
      return
    }

    if (isMarkerElement<SelectContentProps>(node, SELECT_CONTENT_MARKER)) {
      contentProps = node.props
      visitNodes(node.props.children, (contentChild) => {
        if (isMarkerElement<SelectItemProps>(contentChild, SELECT_ITEM_MARKER)) {
          const key =
            contentChild.props.value ??
            (contentChild.key === null ? undefined : String(contentChild.key))

          if (key) {
            items.push({
              key,
              disabled: contentChild.props.disabled,
              className: contentChild.props.className,
              children: contentChild.props.children,
            })
          }
        }
      })
    }
  })

  return { triggerProps, valueProps, contentProps, items }
}

function extractSingleSelection(selection: Selection) {
  if (selection === "all") {
    return ""
  }

  const [first] = Array.from(selection)
  return first === undefined ? "" : String(first)
}

function Select({
  children,
  value,
  defaultValue,
  onValueChange,
  className,
  classNames,
  ...props
}: SelectProps) {
  const { triggerProps, valueProps, contentProps, items } = React.useMemo(
    () => parseSelectChildren(children),
    [children],
  )
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? "")
  const selectedValue = value ?? internalValue

  return (
    <HeroSelect
      aria-label={triggerProps?.["aria-label"]}
      placeholder={valueProps?.placeholder}
      selectedKeys={selectedValue ? [selectedValue] : []}
      disallowEmptySelection={false}
      size={triggerProps?.size === "sm" ? "sm" : "md"}
      variant="bordered"
      radius="sm"
      className={cn(triggerProps?.className, className)}
      classNames={{
        trigger: cn(
          "border-small border-default-200 bg-content1 shadow-small",
          "data-[hover=true]:border-default-300 data-[hover=true]:bg-content2",
          "data-[open=true]:border-primary data-[open=true]:bg-content1",
          classNames?.trigger,
        ),
        value: cn("text-sm text-foreground", classNames?.value),
        selectorIcon: cn("text-default-400", classNames?.selectorIcon),
        popoverContent: cn(
          "border-small border-default-200 bg-content1 shadow-medium",
          contentProps?.className,
          classNames?.popoverContent,
        ),
        listboxWrapper: cn("p-1", classNames?.listboxWrapper),
        innerWrapper: classNames?.innerWrapper,
        base: classNames?.base,
        label: classNames?.label,
        mainWrapper: classNames?.mainWrapper,
        helperWrapper: classNames?.helperWrapper,
        description: classNames?.description,
        errorMessage: classNames?.errorMessage,
      }}
      onSelectionChange={(selection) => {
        const nextValue = extractSingleSelection(selection)
        if (value === undefined) {
          setInternalValue(nextValue)
        }
        onValueChange?.(nextValue)
      }}
      {...props}
    >
      {items.map((item) => (
        <HeroSelectItem
          key={item.key}
          className={item.className}
          isDisabled={item.disabled}
          textValue={typeof item.children === "string" ? item.children : item.key}
        >
          {item.children}
        </HeroSelectItem>
      ))}
    </HeroSelect>
  )
}

const SelectGroup = ({ children }: { children?: React.ReactNode }) => <>{children}</>
const SelectLabel = ({ children }: { children?: React.ReactNode }) => <>{children}</>
const SelectSeparator = () => null
const SelectScrollUpButton = () => null
const SelectScrollDownButton = () => null

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
