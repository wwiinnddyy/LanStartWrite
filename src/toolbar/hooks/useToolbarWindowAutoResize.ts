import { useEffect } from 'react'
import { postCommand } from './useBackend'

export function useToolbarWindowAutoResize(options: { root: HTMLElement | null }) {
  useEffect(() => {
    const root = options.root
    if (!root) return
    if (typeof ResizeObserver === 'undefined') return

    let lastWidth = 0
    let lastHeight = 0
    let rafId = 0

    const clampInt = (value: number, min: number, max: number) => {
      const v = Math.round(value)
      return Math.max(min, Math.min(max, v))
    }

    const send = () => {
      rafId = 0
      const rect = root.getBoundingClientRect()
      const width = clampInt(Math.max(rect.width, root.scrollWidth), 1, 1200)
      const height = clampInt(Math.max(rect.height, root.scrollHeight), 1, 600)

      if (width === lastWidth && height === lastHeight) return
      lastWidth = width
      lastHeight = height
      postCommand('set-toolbar-bounds', { width, height }).catch(() => undefined)
    }

    const schedule = () => {
      if (rafId) return
      rafId = window.requestAnimationFrame(send)
    }

    const ro = new ResizeObserver(schedule)
    ro.observe(root)
    schedule()

    return () => {
      ro.disconnect()
      if (rafId) window.cancelAnimationFrame(rafId)
    }
  }, [options.root])
}

