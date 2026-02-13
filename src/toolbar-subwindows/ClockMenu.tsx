import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from '../Framer_Motion'
import { postCommand } from '../toolbar/hooks/useBackend'
import { useZoomOnWheel } from '../toolbar/hooks/useZoomOnWheel'
import './styles/subwindow.css'

function pad2(v: number): string {
  return String(v).padStart(2, '0')
}

function formatTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export function ClockMenu(props: { kind: string }) {
  useZoomOnWheel()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion()
  const [now, setNow] = useState(() => new Date())

  const timeText = useMemo(() => formatTime(now), [now])

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 250)
    return () => window.clearInterval(id)
  }, [])

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
      const width = Math.max(220, Math.min(420, Math.ceil(contentWidth) + 24))
      const height = Math.max(90, Math.min(260, Math.ceil(contentHeight) + 24))
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
  }, [props.kind, timeText])

  return (
    <motion.div
      ref={rootRef}
      className="subwindowRoot"
      initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.99 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? undefined : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div ref={cardRef} className="subwindowCard animate-ls-pop-in">
        <div ref={measureRef} className="subwindowMeasure">
          <div className="subwindowTitle">
            <span>时钟</span>
          </div>

          <div style={{ fontSize: 32, fontWeight: 650, letterSpacing: 0.6, padding: '12px 2px 2px' }}>
            {timeText}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

