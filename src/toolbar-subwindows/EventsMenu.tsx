import React, { useEffect, useRef } from 'react'
import { useEventsPoll } from '../toolbar/hooks/useEventsPoll'
import { postCommand } from '../toolbar/hooks/useBackend'
import './styles/subwindow.css'

export function EventsMenu(props: { kind: string }) {
  const events = useEventsPoll(800)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)

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
      const width = Math.max(360, Math.min(1600, Math.ceil(contentWidth) + 26))
      const height = Math.max(60, Math.min(900, Math.ceil(contentHeight) + 26))
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
    <div ref={rootRef} className="subwindowRoot">
      <div ref={cardRef} className="subwindowCard">
        <div ref={measureRef} className="subwindowMeasure">
          <div className="subwindowTitle">
            <span>事件</span>
            <span className="subwindowMeta">{events.length}</span>
          </div>

          <div className="subwindowList">
            {events.slice(-8).map((e) => (
              <div key={e.id} className="subwindowRow">
                <span>{e.type}</span>
                <span className="subwindowMeta">#{e.id}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
