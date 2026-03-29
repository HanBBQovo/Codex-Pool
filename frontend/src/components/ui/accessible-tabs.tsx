import { type ReactNode } from "react"
import { Tab, Tabs } from "@heroui/react"

import { cn } from "@/lib/utils"

export type AccessibleTabDefinition<T extends string> = {
  value: T
  label: ReactNode
  disabled?: boolean
}

type AccessibleTabsItem<T extends string> = AccessibleTabDefinition<T> & {
  panel: ReactNode
}

type AccessibleTabListProps<T extends string> = {
  idBase: string
  ariaLabel: string
  value: T
  items: AccessibleTabDefinition<T>[]
  onValueChange: (value: T) => void
  tabClassName?: string
  className?: string
}

type AccessibleTabsProps<T extends string> = {
  idBase: string
  ariaLabel: string
  value: T
  items: AccessibleTabsItem<T>[]
  onValueChange: (value: T) => void
  tabClassName?: string
  className?: string
  tabListClassName?: string
  panelClassName?: string
}

function buildDisabledKeys<T extends string>(items: AccessibleTabDefinition<T>[]) {
  return items.filter((item) => item.disabled).map((item) => item.value)
}

export function AccessibleTabs<T extends string>({
  ariaLabel,
  value,
  items,
  onValueChange,
  tabClassName,
  className,
  tabListClassName,
  panelClassName,
}: AccessibleTabsProps<T>) {
  if (items.length === 0) {
    return null
  }

  return (
    <Tabs
      aria-label={ariaLabel}
      selectedKey={value}
      disabledKeys={buildDisabledKeys(items)}
      variant="underlined"
      color="primary"
      className={cn("w-full", className)}
      classNames={{
        tabList: cn(
          "w-full justify-start overflow-x-auto rounded-none border-b border-default-200/70 bg-transparent p-0",
          tabListClassName,
        ),
        tab: cn("h-10 px-3 data-[hover-unselected=true]:opacity-100", tabClassName),
        cursor: "h-[2px] rounded-full bg-primary",
        tabContent:
          "text-sm font-medium text-default-500 group-data-[selected=true]:text-foreground",
        panel: cn("px-0 pt-4", panelClassName),
      }}
      onSelectionChange={(key) => onValueChange(String(key) as T)}
    >
      {items.map((item) => (
        <Tab key={item.value} title={item.label}>
          {item.panel}
        </Tab>
      ))}
    </Tabs>
  )
}

export function AccessibleTabList<T extends string>({
  ariaLabel,
  value,
  items,
  onValueChange,
  tabClassName,
  className,
}: AccessibleTabListProps<T>) {
  if (items.length === 0) {
    return null
  }

  return (
    <Tabs
      aria-label={ariaLabel}
      selectedKey={value}
      disabledKeys={buildDisabledKeys(items)}
      variant="underlined"
      color="primary"
      className="w-full"
      classNames={{
        tabList: cn(
          "w-full justify-start overflow-x-auto rounded-none border-b border-default-200/70 bg-transparent p-0",
          className,
        ),
        tab: cn("h-10 px-3 data-[hover-unselected=true]:opacity-100", tabClassName),
        cursor: "h-[2px] rounded-full bg-primary",
        tabContent:
          "text-sm font-medium text-default-500 group-data-[selected=true]:text-foreground",
        panel: "hidden",
      }}
      onSelectionChange={(key) => onValueChange(String(key) as T)}
    >
      {items.map((item) => (
        <Tab key={item.value} title={item.label} />
      ))}
    </Tabs>
  )
}
