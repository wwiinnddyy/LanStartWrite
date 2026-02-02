import React, { useEffect, useRef } from 'react'
import { Button } from '../button'
import { motion, useReducedMotion } from '../Framer_Motion'
import { useHyperGlassRealtimeBlur } from '../hyper_glass'
import { postCommand } from '../toolbar/hooks/useBackend'
import './styles/subwindow.css'

function GridIcon(props: { kind: string }) {
  const stroke = 'currentColor'
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke, strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

  if (props.kind === 'grid') {
    return (
      <svg {...common}>
        <path d="M4 4h7v7H4z" />
        <path d="M13 4h7v7h-7z" />
        <path d="M4 13h7v7H4z" />
        <path d="M13 13h7v7h-7z" />
      </svg>
    )
  }

  if (props.kind === 'plus') {
    return (
      <svg {...common}>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    )
  }

  if (props.kind === 'gear') {
    return (
      <svg {...common}>
        <path d="M12 15.5a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7z" />
        <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.03.03l-1.2 2.08l-.04-.01a1.8 1.8 0 0 0-2.05.4l-.03.03l-2.2-1.27a7.7 7.7 0 0 1-1.16.67l-.02 2.55h-2.4l-.02-2.55a7.7 7.7 0 0 1-1.16-.67l-2.2 1.27l-.03-.03a1.8 1.8 0 0 0-2.05-.4l-.04.01l-1.2-2.08l.03-.03A1.8 1.8 0 0 0 4.6 15l.01-.04l-2.08-1.2l1.2-2.08l.04.01a1.8 1.8 0 0 0 1.98-.36l.03-.03l1.27-2.2a7.7 7.7 0 0 1 .67-1.16L5.17 7.9V5.5h2.4l2.55.02a7.7 7.7 0 0 1 .67-1.16L9.52 2.16l2.08-1.2l.03.03a1.8 1.8 0 0 0 1.98.36l.04-.01l1.2 2.08l-.01.04a1.8 1.8 0 0 0 .4 2.05l.03.03l1.27 2.2c.25.2.47.42.67.67l2.55-.02h2.4v2.4l-.02 2.55c.25.2.47.42.67.67l2.2 1.27l-.03.03a1.8 1.8 0 0 0-.36 1.98z" />
      </svg>
    )
  }

  if (props.kind === 'doc') {
    return (
      <svg {...common}>
        <path d="M7 3h7l3 3v15H7z" />
        <path d="M14 3v4h4" />
        <path d="M9 11h6" />
        <path d="M9 14h6" />
        <path d="M9 17h4" />
      </svg>
    )
  }

  return (
    <svg {...common}>
      <path d="M5 7h14" />
      <path d="M5 12h14" />
      <path d="M5 17h14" />
    </svg>
  )
}

export function FeaturePanelMenu(props: { kind: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion()

  useHyperGlassRealtimeBlur({ root: rootRef.current })

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
      const width = Math.max(220, Math.min(1600, Math.ceil(contentWidth) + 26))
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

  const items: Array<{ id: string; title: string; icon: string }> = [
    { id: 'app', title: '应用', icon: 'grid' },
    { id: 'create', title: '新建', icon: 'plus' },
    { id: 'settings', title: '设置', icon: 'gear' },
    { id: 'docs', title: '文档', icon: 'doc' },
    { id: 'f5', title: '功能 5', icon: 'grid' },
    { id: 'f6', title: '功能 6', icon: 'grid' },
    { id: 'f7', title: '功能 7', icon: 'grid' },
    { id: 'f8', title: '功能 8', icon: 'grid' },
    { id: 'f9', title: '功能 9', icon: 'grid' },
    { id: 'f10', title: '功能 10', icon: 'grid' },
    { id: 'f11', title: '功能 11', icon: 'grid' },
    { id: 'f12', title: '功能 12', icon: 'grid' },
    { id: 'f13', title: '功能 13', icon: 'grid' },
    { id: 'f14', title: '功能 14', icon: 'grid' },
    { id: 'f15', title: '功能 15', icon: 'grid' },
    { id: 'f16', title: '功能 16', icon: 'grid' }
  ]

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
            <span>功能面板</span>
            <span className="subwindowMeta">{items.length}</span>
          </div>

          <div className="subwindowIconGrid">
            {items.map((item) => (
              <Button
                key={item.id}
                size="sm"
                title={item.title}
              >
                <GridIcon kind={item.icon} />
              </Button>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
