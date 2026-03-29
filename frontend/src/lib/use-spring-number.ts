import { useEffect, useRef, useState } from 'react'

/**
 * 弹簧数字动画 hook：数字从 0 弹簧过渡到目标值（页面初始加载可见），
 * 后续每次目标值变化都会从当前位置弹簧过渡到新目标值。
 * 尊重 prefers-reduced-motion：开启后直接跳到目标值。
 */
export function useSpringNumber(
  target: number,
  options?: {
    /** 弹簧刚度，值越大越快，默认 100 */
    stiffness?: number
    /** 阻尼，默认 18 */
    damping?: number
    /** 质量，默认 1 */
    mass?: number
  },
): number {
  const { stiffness = 100, damping = 18, mass = 1 } = options ?? {}

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // 初始值从 0 开始，这样页面加载时可以看到完整的数字跳动效果
  const [display, setDisplay] = useState(prefersReducedMotion ? target : 0)

  const velocity = useRef(0)
  const current = useRef(prefersReducedMotion ? target : 0)
  const rafId = useRef<number>(0)

  useEffect(() => {
    if (prefersReducedMotion) {
      if (rafId.current) cancelAnimationFrame(rafId.current)
      current.current = target
      velocity.current = 0
      return
    }

    // 取消上一个动画帧，从当前位置重新弹向新目标
    if (rafId.current) cancelAnimationFrame(rafId.current)

    const step = () => {
      const spring = -stiffness * (current.current - target)
      const damper = -damping * velocity.current
      const acceleration = (spring + damper) / mass

      velocity.current += acceleration / 60
      current.current += velocity.current / 60

      const done =
        Math.abs(current.current - target) < 0.5 &&
        Math.abs(velocity.current) < 0.5

      if (done) {
        setDisplay(target)
        current.current = target
        velocity.current = 0
        return
      }

      setDisplay(Math.round(current.current))
      rafId.current = requestAnimationFrame(step)
    }

    rafId.current = requestAnimationFrame(step)

    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current)
    }
  }, [target, stiffness, damping, mass, prefersReducedMotion])

  return prefersReducedMotion ? target : display
}
