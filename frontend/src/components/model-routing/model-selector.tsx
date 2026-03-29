import { useMemo, useState } from 'react'
import { Button } from '@heroui/react'
import { ArrowDown, ArrowUp, Plus, Search, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SurfaceCard, SurfaceCardBody, SurfaceInset } from '@/components/ui/surface'
import { cn } from '@/lib/utils'

import {
  buildCatalogModelItems,
  buildSelectedModelItems,
  type ModelAvailabilityStatus,
  type ModelSelectorCatalogInput,
} from './model-selector-utils'

type ModelSelectorLabels = {
  addModel: string
  searchPlaceholder: string
  emptyCatalog: string
  emptySelection: string
  noMatches: string
  unknownModel: string
  moveUp: string
  moveDown: string
  remove: string
  available: string
  unavailable: string
  unknown: string
}

type ModelSelectorProps = {
  catalog: ModelSelectorCatalogInput[]
  value: string[]
  onChange: (next: string[]) => void
  labels: ModelSelectorLabels
  reorderable?: boolean
  disabled?: boolean
  className?: string
}

function availabilityBadgeVariant(
  status: ModelAvailabilityStatus,
): 'success' | 'secondary' | 'destructive' {
  if (status === 'available') return 'success'
  if (status === 'unavailable') return 'destructive'
  return 'secondary'
}

function availabilityLabel(status: ModelAvailabilityStatus, labels: ModelSelectorLabels) {
  if (status === 'available') return labels.available
  if (status === 'unavailable') return labels.unavailable
  return labels.unknown
}

function matchesSearch(value: string, keyword: string) {
  return value.toLowerCase().includes(keyword)
}

export function ModelSelector({
  catalog,
  value,
  onChange,
  labels,
  reorderable = false,
  disabled = false,
  className,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')

  const catalogItems = useMemo(() => buildCatalogModelItems(catalog), [catalog])
  const selectedItems = useMemo(() => buildSelectedModelItems(catalog, value), [catalog, value])

  const selectedIds = useMemo(() => new Set(value), [value])
  const normalizedKeyword = keyword.trim().toLowerCase()

  const availableItems = useMemo(() => {
    return catalogItems.filter((item) => {
      if (selectedIds.has(item.id)) {
        return false
      }
      if (!normalizedKeyword) {
        return true
      }
      return matchesSearch(item.id, normalizedKeyword)
        || matchesSearch(item.title ?? '', normalizedKeyword)
        || matchesSearch(item.description ?? '', normalizedKeyword)
    })
  }, [catalogItems, normalizedKeyword, selectedIds])

  const appendModel = (id: string) => {
    if (disabled || value.includes(id)) {
      return
    }
    onChange([...value, id])
    setKeyword('')
    setOpen(false)
  }

  const removeModel = (id: string) => {
    onChange(value.filter((item) => item !== id))
  }

  const moveModel = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= value.length) {
      return
    }
    const next = [...value]
    const current = next[index]
    next[index] = next[targetIndex]!
    next[targetIndex] = current!
    onChange(next)
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="space-y-2">
        {selectedItems.length === 0 ? (
          <SurfaceInset tone="muted" className="px-3 py-4 text-sm text-muted-foreground">
            {labels.emptySelection}
          </SurfaceInset>
        ) : (
          selectedItems.map((item, index) => (
            <SurfaceCard key={item.id} tone="muted" shadow="none">
              <SurfaceCardBody className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.id}</span>
                    <Badge variant={availabilityBadgeVariant(item.availabilityStatus)}>
                      {availabilityLabel(item.availabilityStatus, labels)}
                    </Badge>
                    {item.missingFromCatalog ? (
                      <Badge variant="outline">{labels.unknownModel}</Badge>
                    ) : null}
                  </div>
                  {item.title ? (
                    <div className="text-sm text-muted-foreground">{item.title}</div>
                  ) : null}
                  <div className="text-xs text-muted-foreground">{item.priceSummary}</div>
                  {item.contextSummary ? (
                    <div className="text-xs text-muted-foreground">{item.contextSummary}</div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {reorderable ? (
                    <>
                      <Button
                        type="button"
                        variant="light"
                        size="sm"
                        isIconOnly
                        className="h-8 w-8 min-w-8"
                        onClick={() => moveModel(index, -1)}
                        disabled={disabled || index === 0}
                        aria-label={labels.moveUp}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="light"
                        size="sm"
                        isIconOnly
                        className="h-8 w-8 min-w-8"
                        onClick={() => moveModel(index, 1)}
                        disabled={disabled || index === selectedItems.length - 1}
                        aria-label={labels.moveDown}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </>
                  ) : null}
                  <Button
                    type="button"
                    variant="light"
                    size="sm"
                    isIconOnly
                    className="h-8 w-8 min-w-8"
                    onClick={() => removeModel(item.id)}
                    disabled={disabled}
                    aria-label={labels.remove}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </SurfaceCardBody>
            </SurfaceCard>
          ))
        )}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="bordered" disabled={disabled}>
            <Plus className="mr-2 h-4 w-4" />
            {labels.addModel}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[420px] p-0">
          <div className="border-b border-default-200/70 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={labels.searchPlaceholder}
                className="pl-9"
              />
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {catalogItems.length === 0 ? (
              <SurfaceInset tone="muted" className="px-3 py-4 text-sm text-muted-foreground">
                {labels.emptyCatalog}
              </SurfaceInset>
            ) : availableItems.length === 0 ? (
              <SurfaceInset tone="muted" className="px-3 py-4 text-sm text-muted-foreground">
                {labels.noMatches}
              </SurfaceInset>
            ) : (
              <div className="space-y-2">
                {availableItems.map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    variant="light"
                    onClick={() => appendModel(item.id)}
                    className="h-auto w-full justify-start px-3 py-3 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{item.id}</span>
                      <Badge variant={availabilityBadgeVariant(item.availabilityStatus)}>
                        {availabilityLabel(item.availabilityStatus, labels)}
                      </Badge>
                    </div>
                    {item.title ? (
                      <div className="mt-1 text-sm text-muted-foreground">{item.title}</div>
                    ) : null}
                    <div className="mt-1 text-xs text-muted-foreground">{item.priceSummary}</div>
                    {item.contextSummary ? (
                      <div className="mt-1 text-xs text-muted-foreground">{item.contextSummary}</div>
                    ) : null}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
