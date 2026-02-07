import React, { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from '../Framer_Motion'
import { useEventsPoll } from '../toolbar/hooks/useEventsPoll'
import { postCommand } from '../toolbar/hooks/useBackend'
import { useZoomOnWheel } from '../toolbar/hooks/useZoomOnWheel'
import './styles/subwindow.css'

export function EventsMenu(props: { kind: string }) {
  useZoomOnWheel()
  const events = useEventsPoll(800)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    const root = rootRef.current
    const card = cardRef.current
    const measure = measureRef.current
    if (!root) return
    if (typeof ResizeObserver === 'undefined') return

    let lastHeight = 0
    let lastWidth = 0
    let rafId = 0

    const send = () => {
      rafId = 0
      const measureRect = measure?.getBoundingClientRect()
      const contentWidth = Math.max(measure?.scrollWidth ?? 0, measureRect?.width ?? 0)
      const contentHeight = Math.max(measure?.scrollHeight ?? 0, measureRect?.height ?? 0)
      // 限制窗口宽度 280-400px，高度根据内容自适应但最大 280px
      const width = Math.max(280, Math.min(400, Math.ceil(contentWidth) + 24))
      const height = Math.max(80, Math.min(280, Math.ceil(contentHeight) + 24))
      if (width === lastWidth && height === lastHeight) return
      lastWidth = width
      lastHeight = height
      postCommand('set-subwindow-bounds', { kind: props.kind, width, height }).catch(() => undefined)
    }

    const schedule = () => {
      if (rafId) return
      rafId = window.requestAnimationFrame(send)
    }

    const ro = new ResizeObserver(schedule)
    ro.observe(root)
    if (card) ro.observe(card)
    if (measure) ro.observe(measure)
    schedule()

    return () => {
      ro.disconnect()
      if (rafId) window.cancelAnimationFrame(rafId)
    }
  }, [props.kind])

  return (
    <motion.div
      ref={rootRef}
      className="subwindowRoot"
      initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.99 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? undefined : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div ref={cardRef} className="subwindowCard animate-ls-pop-in eventsMenuCard">
        <div ref={measureRef} className="eventsMenuMeasure">
          <div className="eventsMenuTitle">
            <span>事件</span>
            <span className="eventsMenuMeta">{events.length}</span>
          </div>

          <div className="eventsMenuList">
            {events.slice(-8).map((e) => (
              <motion.div
                key={e.id}
                layout
                className="eventsMenuRow"
                initial={false}
                transition={reduceMotion ? undefined : { duration: 0.18, ease: 'easeOut' }}
              >
                <span>{e.type}</span>
                <span className="eventsMenuMeta">#{e.id}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
