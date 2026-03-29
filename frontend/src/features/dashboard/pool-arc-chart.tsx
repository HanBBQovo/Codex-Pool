import { useCallback, useEffect, useRef, useState } from 'react'

export interface PoolArcSegment {
  label: string
  value: number
  /** OKLCH color string，例如 "oklch(55% 0.16 180)" */
  color: string
  colorDark: string
}

interface PoolArcChartProps {
  segments: PoolArcSegment[]
  /** 圆环外径，默认 96px */
  size?: number
  /** 圆环厚度，默认 18px */
  thickness?: number
}

// ── Spring solver ─────────────────────────────────────────────────────────────

function spring(current: number, target: number, velocity: number, stiffness = 110, damping = 20) {
  const force = -stiffness * (current - target) - damping * velocity
  const newVel = velocity + force / 60
  const newPos = current + newVel / 60
  return { pos: newPos, vel: newVel }
}

// ── Canvas 绘制 ───────────────────────────────────────────────────────────────

function drawArcs(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  thickness: number,
  segments: PoolArcSegment[],
  animatedAngles: number[], // 每个 segment 的当前终止角（弧度，相对 -90°）
  isDark: boolean,
  hoveredIndex: number | null,
) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  const GAP = 0.04 // segment 间隙（弧度）
  let startAngle = -Math.PI / 2 // 从 12 点方向开始

  // 背景圆环
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
  ctx.lineWidth = thickness
  ctx.stroke()

  segments.forEach((seg, i) => {
    const spanAngle = animatedAngles[i]
    if (spanAngle <= GAP * 2) return

    const endAngle = startAngle + spanAngle - GAP
    const isHovered = i === hoveredIndex
    const color = isDark ? seg.colorDark : seg.color

    ctx.beginPath()
    ctx.arc(cx, cy, r, startAngle + GAP / 2, endAngle)
    ctx.strokeStyle = color
    ctx.lineWidth = isHovered ? thickness + 4 : thickness
    ctx.lineCap = 'round'
    ctx.globalAlpha = isHovered ? 1 : 0.85
    ctx.shadowBlur = isHovered ? 10 : 0
    ctx.shadowColor = color
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.globalAlpha = 1

    startAngle += spanAngle
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PoolArcChart({ segments, size = 96, thickness = 16 }: PoolArcChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const anglesRef = useRef<number[]>(segments.map(() => 0))
  const velsRef = useRef<number[]>(segments.map(() => 0))
  const [hovered, setHovered] = useState<number | null>(null)

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - thickness / 2 - 2

  const total = segments.reduce((s, seg) => s + seg.value, 0)
  const targetAngles = segments.map((seg) =>
    total > 0 ? (seg.value / total) * Math.PI * 2 : 0,
  )

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.save()
    ctx.scale(dpr, dpr)
    drawArcs(ctx, cx, cy, r, thickness, segments, anglesRef.current, isDark, hovered)
    ctx.restore()
  }, [cx, cy, r, thickness, segments, isDark, hovered, dpr])

  // Spring animation loop
  useEffect(() => {
    let running = true

    const tick = () => {
      if (!running) return
      let settled = true
      anglesRef.current = anglesRef.current.map((angle, i) => {
        const { pos, vel } = spring(angle, targetAngles[i], velsRef.current[i])
        velsRef.current[i] = vel
        if (Math.abs(pos - targetAngles[i]) > 0.001 || Math.abs(vel) > 0.001) settled = false
        return pos
      })
      draw()
      if (!settled) animRef.current = requestAnimationFrame(tick)
    }

    animRef.current = requestAnimationFrame(tick)
    return () => {
      running = false
      cancelAnimationFrame(animRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, hovered])

  // Hover → redraw immediately
  useEffect(() => { draw() }, [draw])

  const getSegmentAt = useCallback((clientX: number, clientY: number): number | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left - cx
    const y = clientY - rect.top - cy
    const dist = Math.sqrt(x * x + y * y)
    if (dist < r - thickness / 2 - 2 || dist > r + thickness / 2 + 2) return null

    let angle = Math.atan2(y, x) + Math.PI / 2 // relative to 12 o'clock
    if (angle < 0) angle += Math.PI * 2

    let cumAngle = 0
    for (let i = 0; i < segments.length; i++) {
      cumAngle += targetAngles[i]
      if (angle < cumAngle) return i
    }
    return null
  }, [cx, cy, r, thickness, segments, targetAngles])

  return (
    <canvas
      ref={canvasRef}
      width={size * dpr}
      height={size * dpr}
      style={{ width: size, height: size }}
      aria-hidden="true"
      onMouseMove={(e) => setHovered(getSegmentAt(e.clientX, e.clientY))}
      onMouseLeave={() => setHovered(null)}
    />
  )
}
