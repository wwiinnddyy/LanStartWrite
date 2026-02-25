import { useEffect } from 'react'
import { postCommand } from './useBackend'

const DURING_TRANSITION_THROTTLE_MS = 80
const FINAL_SETTLE_DELAY_MS = 70
const TRANSITION_FALLBACK_MS = 320
const MIN_SIZE = 1
const MAX_WIDTH = 1600
const MAX_HEIGHT = 900

function clampInt(value: number, min: number, max: number): number {
  const v = Math.round(value)
  return Math.max(min, Math.min(max, v))
}

function getRelativeOffset(node: HTMLElement, root: HTMLElement): { left: number; top: number } {
  let left = 0
  let top = 0
  let current: HTMLElement | null = node

  while (current && current !== root) {
    left += current.offsetLeft
    top += current.offsetTop
    current = current.offsetParent as HTMLElement | null
  }

  return { left, top }
}

function measureVisualSize(root: HTMLElement): { width: number; height: number } {
  let width = Math.max(MIN_SIZE, root.offsetWidth)
  let height = Math.max(MIN_SIZE, root.offsetHeight)

  const layoutNode = root.querySelector<HTMLElement>('.toolbarLayout')
  if (layoutNode) {
    const layoutRect = layoutNode.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    const relativeRight = layoutRect.right - rootRect.left
    const relativeBottom = layoutRect.bottom - rootRect.top
    if (Number.isFinite(relativeRight) && relativeRight > 0) {
      width = Math.max(width, relativeRight)
    }
    if (Number.isFinite(relativeBottom) && relativeBottom > 0) {
      height = Math.max(height, relativeBottom)
    }
  }

  for (const selector of [
    '.toolbarLayout',
    '.toolbarCollapsibleSection',
    '.toolbarCollapsibleContent'
  ] as const) {
    const node = root.querySelector<HTMLElement>(selector)
    if (!node) continue
    const offset = getRelativeOffset(node, root)
    width = Math.max(width, offset.left + node.offsetWidth)
    height = Math.max(height, offset.top + node.offsetHeight)
  }

  for (const node of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    const offset = getRelativeOffset(node, root)
    const right = offset.left + node.offsetWidth
    const bottom = offset.top + node.offsetHeight
    if (Number.isFinite(right)) width = Math.max(width, right)
    if (Number.isFinite(bottom)) height = Math.max(height, bottom)
  }

  const padding = 16
  width = width + padding
  height = height + padding

  return {
    width: clampInt(width, MIN_SIZE, MAX_WIDTH),
    height: clampInt(height, MIN_SIZE, MAX_HEIGHT)
  }
}

export function useToolbarWindowAutoResize(options: { root: HTMLElement | null }) {
  useEffect(() => {
    const root = options.root
    if (!root) return
    if (typeof ResizeObserver === 'undefined') return

    let lastWidth = 0
    let lastHeight = 0
    let rafId = 0
    let transitionActive = false
    let duringTransitionTimer = 0
    let finalSettleTimer = 0
    let transitionFallbackTimer = 0

    const clearRuntimeTimers = () => {
      if (duringTransitionTimer) {
        window.clearTimeout(duringTransitionTimer)
        duringTransitionTimer = 0
      }
      if (finalSettleTimer) {
        window.clearTimeout(finalSettleTimer)
        finalSettleTimer = 0
      }
      if (transitionFallbackTimer) {
        window.clearTimeout(transitionFallbackTimer)
        transitionFallbackTimer = 0
      }
    }

    const send = () => {
      rafId = 0
      const size = measureVisualSize(root)
      const width = size.width
      const height = size.height
      if (width === lastWidth && height === lastHeight) return
      lastWidth = width
      lastHeight = height
      postCommand('set-toolbar-bounds', { width, height }).catch(() => undefined)
    }

    const scheduleFrame = () => {
      if (rafId) return
      rafId = window.requestAnimationFrame(send)
    }

    const schedule = () => {
      if (!transitionActive) {
        scheduleFrame()
        return
      }
      if (duringTransitionTimer) return
      duringTransitionTimer = window.setTimeout(() => {
        duringTransitionTimer = 0
        scheduleFrame()
      }, DURING_TRANSITION_THROTTLE_MS)
    }

    const scheduleFinalSettle = () => {
      scheduleFrame()
      if (finalSettleTimer) window.clearTimeout(finalSettleTimer)
      finalSettleTimer = window.setTimeout(() => {
        finalSettleTimer = 0
        scheduleFrame()
      }, FINAL_SETTLE_DELAY_MS)
    }

    const handleTransitionStart = () => {
      transitionActive = true
      if (transitionFallbackTimer) window.clearTimeout(transitionFallbackTimer)
      transitionFallbackTimer = window.setTimeout(() => {
        transitionFallbackTimer = 0
        handleTransitionEnd()
      }, TRANSITION_FALLBACK_MS)
    }

    const handleTransitionEnd = () => {
      transitionActive = false
      if (duringTransitionTimer) {
        window.clearTimeout(duringTransitionTimer)
        duringTransitionTimer = 0
      }
      if (transitionFallbackTimer) {
        window.clearTimeout(transitionFallbackTimer)
        transitionFallbackTimer = 0
      }
      scheduleFinalSettle()
    }

    const mo =
      typeof MutationObserver === 'undefined'
        ? undefined
        : new MutationObserver(() => {
            schedule()
          })
    mo?.observe(root, { subtree: true, childList: true })

    const ro = new ResizeObserver(schedule)
    const targets = new Set<HTMLElement>([root])
    for (const selector of [
      '.toolbarLayout',
      '.toolbarCollapsibleSection',
      '.toolbarCollapsibleContent'
    ] as const) {
      const target = root.querySelector<HTMLElement>(selector)
      if (target) targets.add(target)
    }
    for (const target of targets) {
      ro.observe(target)
    }

    window.addEventListener('lanstart-toolbar-transition-start', handleTransitionStart)
    window.addEventListener('lanstart-toolbar-transition-end', handleTransitionEnd)
    scheduleFrame()
    window.setTimeout(schedule, 70)
    window.setTimeout(schedule, 190)

    return () => {
      clearRuntimeTimers()
      ro.disconnect()
      mo?.disconnect()
      window.removeEventListener('lanstart-toolbar-transition-start', handleTransitionStart)
      window.removeEventListener('lanstart-toolbar-transition-end', handleTransitionEnd)
      if (rafId) window.cancelAnimationFrame(rafId)
    }
  }, [options.root])
}
