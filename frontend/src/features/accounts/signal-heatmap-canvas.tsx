import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AccountSignalHeatmapBucket } from '@/api/accounts'
import { bucketSourceKind, sourceAccentFill } from './signal-heatmap-source-visual.ts'

// ── 结果分类 ──────────────────────────────────────────────────────────────────

type BucketOutcome = 'success' | 'error' | 'mixed' | 'none'

function bucketOutcome(successCount: number, errorCount: number): BucketOutcome {
  if (successCount === 0 && errorCount === 0) return 'none'
  if (errorCount === 0) return 'success'
  if (successCount === 0) return 'error'
  return 'mixed'
}

// ── 颜色 ──────────────────────────────────────────────────────────────────────

function oklabToSrgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b
  const l3 = l_ * l_ * l_, m3 = m_ * m_ * m_, s3 = s_ * s_ * s_
  const r = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
  const bl = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3
  const toSrgb = (x: number) => {
    const c = Math.max(0, Math.min(1, x))
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  }
  return [Math.round(toSrgb(r) * 255), Math.round(toSrgb(g) * 255), Math.round(toSrgb(bl) * 255)]
}

function intensityToFill(
  intensity: number,
  isDark: boolean,
  hover: boolean,
  outcome: BucketOutcome,
): string {
  if (intensity === 0) {
    return isDark
      ? (hover ? 'rgba(255,255,255,0.11)' : 'rgba(255,255,255,0.06)')
      : (hover ? 'rgba(0,0,0,0.10)' : 'rgba(0,0,0,0.05)')
  }
  const t = Math.min(0.25 + (intensity / 3) * 0.75 + (hover ? 0.12 : 0), 1)

  if (outcome === 'error') {
    // 红色：全失败
    const alpha = (0.3 + t * 0.7).toFixed(2)
    return isDark
      ? `rgba(252,165,165,${alpha})`   // red-300
      : `rgba(220,38,38,${alpha})`     // red-600
  }

  if (outcome === 'mixed') {
    // 橙/琥珀：部分失败
    const alpha = (0.3 + t * 0.7).toFixed(2)
    return isDark
      ? `rgba(252,211,77,${alpha})`    // amber-300
      : `rgba(217,119,6,${alpha})`     // amber-600
  }

  // success / unknown：teal（OKLAB 均匀插值）
  if (isDark) {
    const alpha = (0.3 + t * 0.7).toFixed(2)
    return `rgba(45,212,191,${alpha})`
  }
  const [r, g, b] = oklabToSrgb(
    0.87 + (0.55 - 0.87) * t,
    -0.14 * t,
    -0.04 * t,
  )
  return `rgb(${r},${g},${b})`
}

function shadowColor(isDark: boolean, outcome: BucketOutcome): string {
  if (outcome === 'error') return isDark ? 'rgba(252,165,165,0.5)' : 'rgba(220,38,38,0.4)'
  if (outcome === 'mixed') return isDark ? 'rgba(252,211,77,0.5)' : 'rgba(217,119,6,0.4)'
  return isDark ? 'rgba(45,212,191,0.5)' : 'rgba(13,148,136,0.4)'
}

function drawSourceAccent(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  requestCount: number,
  patrolCount: number,
  isDark: boolean,
) {
  const kind = bucketSourceKind(requestCount, patrolCount)
  if (kind === 'none') {
    return
  }

  const accentHeight = Math.max(2, Math.min(3, h * 0.28))
  const accentY = y + h - accentHeight

  ctx.save()
  roundRect(ctx, x, accentY, w, accentHeight, Math.min(2, accentHeight / 2))
  ctx.clip()

  if (kind === 'mixed') {
    const total = requestCount + patrolCount
    const requestWidth = total > 0 ? (w * requestCount) / total : w / 2
    ctx.fillStyle = sourceAccentFill('request', isDark)
    ctx.fillRect(x, accentY, requestWidth, accentHeight)
    ctx.fillStyle = sourceAccentFill('patrol', isDark)
    ctx.fillRect(x + requestWidth, accentY, w - requestWidth, accentHeight)
  } else {
    ctx.fillStyle = sourceAccentFill(kind, isDark)
    ctx.fillRect(x, accentY, w, accentHeight)
  }

  ctx.restore()
}

// ── 圆角矩形 ──────────────────────────────────────────────────────────────────

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (w < 2 * r) r = w / 2
  if (h < 2 * r) r = h / 2
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// ── 时间格式 ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string, bucketMinutes: number): string {
  const start = new Date(iso)
  const end = new Date(start.getTime() + bucketMinutes * 60_000)
  const fmt = (d: Date) =>
    `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} `
    + `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  return `${fmt(start)} – ${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`
}

// ── 详情 Tooltip ──────────────────────────────────────────────────────────────

function buildDetailTooltip(bucket: AccountSignalHeatmapBucket, bucketMinutes: number): string {
  const time = fmtTime(bucket.start_at, bucketMinutes)
  if (bucket.signal_count === 0) return `${time}\n本时段无信号`

  const lines: string[] = [time]

  if (bucket.error_count > 0) {
    lines.push(`成功 ${bucket.success_count} 次 · 失败 ${bucket.error_count} 次`)
  } else {
    lines.push(`共 ${bucket.signal_count} 次信号，全部成功`)
  }

  if (bucket.active_count > 0) lines.push(`用户请求  ${bucket.active_count} 次`)
  if (bucket.passive_count > 0) lines.push(`主动巡检  ${bucket.passive_count} 次`)

  return lines.join('\n')
}

// ── GitHub 风格热力图（Modal 详情） ───────────────────────────────────────────

interface SignalHeatmapCanvasProps {
  buckets: AccountSignalHeatmapBucket[]
  bucketMinutes: number
}

export function SignalHeatmapCanvas({ buckets, bucketMinutes }: SignalHeatmapCanvasProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null)

  const rowsPerHour = Math.max(1, Math.round(60 / bucketMinutes))
  const cols = Math.round(buckets.length / rowsPerHour)
  const rows = rowsPerHour
  const gap = 2
  const cellH = 10

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

  const draw = useCallback((hovIdx: number | null) => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const dpr = window.devicePixelRatio || 1
    const width = container.clientWidth
    const height = rows * (cellH + gap) - gap
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)
    const cellW = (width - gap * (cols - 1)) / cols

    buckets.forEach((bucket, i) => {
      const col = Math.floor(i / rows)
      const row = i % rows
      const x = col * (cellW + gap)
      const y = row * (cellH + gap)
      const hover = i === hovIdx
      const outcome = bucketOutcome(bucket.success_count, bucket.error_count)

      ctx.shadowBlur = hover && bucket.intensity > 0 ? 5 : 0
      ctx.shadowColor = shadowColor(isDark, outcome)
      ctx.fillStyle = intensityToFill(bucket.intensity, isDark, hover, outcome)
      roundRect(ctx, x, y, cellW, cellH, 2)
      ctx.fill()
      drawSourceAccent(
        ctx,
        x,
        y,
        cellW,
        cellH,
        bucket.active_count,
        bucket.passive_count,
        isDark,
      )
    })
    ctx.shadowBlur = 0
  }, [buckets, cols, rows, isDark])

  useEffect(() => { draw(hovered) }, [draw, hovered])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    setContainerWidth(container.clientWidth)
    const ro = new ResizeObserver(() => draw(hovered))
    ro.observe(container)
    const syncWidth = () => setContainerWidth(container.clientWidth)
    const widthObserver = new ResizeObserver(syncWidth)
    ro.observe(container)
    widthObserver.observe(container)
    return () => {
      ro.disconnect()
      widthObserver.disconnect()
    }
  }, [draw, hovered])

  const getIndex = useCallback((cx: number, cy: number): number | null => {
    const container = containerRef.current
    if (!container) return null
    const rect = container.getBoundingClientRect()
    const x = cx - rect.left, y = cy - rect.top
    const width = rect.width
    const height = rows * (cellH + gap) - gap
    const cellW = (width - gap * (cols - 1)) / cols
    const col = Math.floor(x / (cellW + gap))
    const row = Math.floor(y / (cellH + gap))
    if (col < 0 || col >= cols || row < 0 || row >= rows || y > height) return null
    const idx = col * rows + row
    return idx >= 0 && idx < buckets.length ? idx : null
  }, [buckets.length, cols, rows])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const idx = getIndex(e.clientX, e.clientY)
    setHovered(idx)
    if (idx !== null) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      setTooltip({ text: buildDetailTooltip(buckets[idx], bucketMinutes), x: e.clientX - rect.left, y: e.clientY - rect.top })
    } else {
      setTooltip(null)
    }
  }, [getIndex, buckets, bucketMinutes])

  const handleMouseLeave = useCallback(() => { setHovered(null); setTooltip(null) }, [])

  return (
    <div ref={containerRef} className="relative w-full select-none">
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="block w-full cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {/* 时间轴标签 */}
      <div className="mt-1.5 flex text-[10px] text-default-400" style={{ gap }}>
        {Array.from({ length: cols }, (_, i) => (
          <div key={i} className="shrink-0 text-center leading-none" style={{ width: `${100 / cols}%` }}>
            {i % 3 === 0 ? `${i}h` : ''}
          </div>
        ))}
      </div>
      {/* 图例 */}
      <div className="mt-2 flex items-center gap-3 text-[10px] text-default-400">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-[2px] bg-primary/60" />{t('accountPool.recentSignal.legend.success', { defaultValue: '成功' })}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-[2px] bg-amber-500/60" />{t('accountPool.recentSignal.legend.mixed', { defaultValue: '部分失败' })}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-[2px] bg-red-500/60" />{t('accountPool.recentSignal.legend.error', { defaultValue: '全部失败' })}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-1 w-3 rounded-full bg-sky-500/80" />{t('accountPool.recentSignal.legend.request', { defaultValue: '用户请求' })}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-1 w-3 rounded-full bg-indigo-500/80" />{t('accountPool.recentSignal.legend.patrol', { defaultValue: '主动巡检' })}</span>
      </div>
      {tooltip ? (
        <div
          className="pointer-events-none absolute z-10 max-w-[210px] rounded-lg border border-default-200/70 bg-content1/96 px-2.5 py-2 text-xs leading-5 text-foreground shadow-medium backdrop-blur-sm"
          style={{
            left: Math.max(0, Math.min(tooltip.x + 8, containerWidth - 200)),
            top: Math.max(tooltip.y - 80, 0),
            whiteSpace: 'pre-line',
          }}
        >
          {tooltip.text}
        </div>
      ) : null}
    </div>
  )
}

// ── Mini 热力图（表格行缩略图） ───────────────────────────────────────────────

interface SignalHeatmapMiniProps {
  intensityLevels: number[]
  activeCounts?: number[]
  passiveCounts?: number[]
  successCounts?: number[]
  errorCounts?: number[]
  bucketMinutes: number
  windowStart: string
  visibleCount?: number
}

function buildMiniTooltip(
  intensity: number,
  requestCount: number,
  patrolCount: number,
  successCount: number,
  errorCount: number,
  bucketStartIso: string,
  bucketMinutes: number,
): string {
  const time = fmtTime(bucketStartIso, bucketMinutes)
  if (intensity === 0) return `${time}\n本时段无信号`
  const lines = [`${time}`]

  if (errorCount > 0) {
    lines.push(`成功 ${successCount} 次 · 失败 ${errorCount} 次`)
  } else {
    const label = intensity === 1
    ? '偶有请求（1–2 次）'
    : intensity === 2
      ? '中等活跃（3–5 次）'
      : '频繁请求（6 次以上）'
    lines.push(label)
  }
  if (requestCount > 0) lines.push(`用户请求  ${requestCount} 次`)
  if (patrolCount > 0) lines.push(`主动巡检  ${patrolCount} 次`)
  return lines.join('\n')
}

export function SignalHeatmapMini({
  intensityLevels,
  activeCounts,
  passiveCounts,
  successCounts,
  errorCounts,
  bucketMinutes,
  windowStart,
  visibleCount = 12,
}: SignalHeatmapMiniProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)
  const [tooltip, setTooltip] = useState<{ text: string; x: number } | null>(null)

  const levels = (intensityLevels ?? []).slice(-visibleCount)
  const active = (activeCounts ?? []).slice(-visibleCount)
  const passive = (passiveCounts ?? []).slice(-visibleCount)
  const successes = (successCounts ?? []).slice(-visibleCount)
  const errors = (errorCounts ?? []).slice(-visibleCount)
  const n = levels.length
  const gap = 2, cellH = 10
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

  const draw = useCallback((hovIdx: number | null) => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || n === 0) return
    const dpr = window.devicePixelRatio || 1
    const width = container.clientWidth
    canvas.width = width * dpr
    canvas.height = cellH * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${cellH}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, cellH)
    const cellW = (width - gap * (n - 1)) / n

    levels.forEach((intensity, i) => {
      const x = i * (cellW + gap)
      const hover = i === hovIdx
      const outcome = bucketOutcome(successes[i] ?? 0, errors[i] ?? 0)
      ctx.shadowBlur = hover && intensity > 0 ? 5 : 0
      ctx.shadowColor = shadowColor(isDark, outcome)
      ctx.fillStyle = intensityToFill(intensity, isDark, hover, outcome)
      roundRect(ctx, x, 0, cellW, cellH, 2)
      ctx.fill()
      drawSourceAccent(
        ctx,
        x,
        0,
        cellW,
        cellH,
        active[i] ?? 0,
        passive[i] ?? 0,
        isDark,
      )
    })
    ctx.shadowBlur = 0
  }, [levels, active, passive, successes, errors, n, isDark])

  useEffect(() => { draw(hovered) }, [draw, hovered])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    setContainerWidth(container.clientWidth)
    const ro = new ResizeObserver(() => draw(hovered))
    const syncWidth = () => setContainerWidth(container.clientWidth)
    ro.observe(container)
    const widthObserver = new ResizeObserver(syncWidth)
    widthObserver.observe(container)
    return () => {
      ro.disconnect()
      widthObserver.disconnect()
    }
  }, [draw, hovered])

  const getBucketStart = useCallback((sliceIdx: number): string => {
    const totalLen = intensityLevels.length
    const actualIdx = totalLen - visibleCount + sliceIdx
    const startMs = new Date(windowStart).getTime() + actualIdx * bucketMinutes * 60_000
    return new Date(startMs).toISOString()
  }, [intensityLevels.length, visibleCount, windowStart, bucketMinutes])

  const getHoveredIndex = useCallback((clientX: number): number | null => {
    const container = containerRef.current
    if (!container) return null
    const rect = container.getBoundingClientRect()
    const x = clientX - rect.left
    const cellW = (rect.width - gap * (n - 1)) / n
    const idx = Math.floor(x / (cellW + gap))
    return idx >= 0 && idx < n ? idx : null
  }, [n])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const idx = getHoveredIndex(e.clientX)
    setHovered(idx)
    if (idx !== null) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      setTooltip({
        text: buildMiniTooltip(
          levels[idx],
          active[idx] ?? 0,
          passive[idx] ?? 0,
          successes[idx] ?? 0,
          errors[idx] ?? 0,
          getBucketStart(idx),
          bucketMinutes,
        ),
        x: e.clientX - rect.left,
      })
    } else {
      setTooltip(null)
    }
  }, [getHoveredIndex, levels, active, passive, successes, errors, getBucketStart, bucketMinutes])

  const handleMouseLeave = useCallback(() => { setHovered(null); setTooltip(null) }, [])

  return (
    <div ref={containerRef} className="relative w-full select-none">
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="block w-full cursor-default"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {tooltip ? (
        <div
          className="pointer-events-none absolute bottom-full z-10 mb-1.5 max-w-[190px] rounded-lg border border-default-200/70 bg-content1/96 px-2.5 py-1.5 text-xs leading-5 text-foreground shadow-medium backdrop-blur-sm"
          style={{
            left: Math.max(0, Math.min(tooltip.x, containerWidth - 170)),
            whiteSpace: 'pre-line',
          }}
        >
          {tooltip.text}
        </div>
      ) : null}
    </div>
  )
}
