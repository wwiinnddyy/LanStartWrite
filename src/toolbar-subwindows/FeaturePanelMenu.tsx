import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../button'
import { motion, useReducedMotion } from '../Framer_Motion'
import { useHyperGlassRealtimeBlur } from '../hyper_glass'
import { postCommand } from '../toolbar/hooks/useBackend'
import { useZoomOnWheel } from '../toolbar/hooks/useZoomOnWheel'
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
  useZoomOnWheel()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const pagerViewportRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion()
  const [pageIndex, setPageIndex] = useState(0)
  const [pagerViewportWidth, setPagerViewportWidth] = useState(0)

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
      const contentWidth = Math.max(measureRect?.width ?? 0, 0)
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

  useEffect(() => {
    const viewport = pagerViewportRef.current
    if (!viewport) return
    if (typeof ResizeObserver === 'undefined') return

    let rafId = 0
    let lastWidth = 0

    const send = () => {
      rafId = 0
      const rect = viewport.getBoundingClientRect()
      const nextWidth = Math.max(1, Math.round(rect.width))
      if (nextWidth === lastWidth) return
      lastWidth = nextWidth
      setPagerViewportWidth(nextWidth)
    }

    const schedule = () => {
      if (rafId) return
      rafId = window.requestAnimationFrame(send)
    }

    const ro = new ResizeObserver(schedule)
    ro.observe(viewport)
    schedule()

    return () => {
      ro.disconnect()
      if (rafId) window.cancelAnimationFrame(rafId)
    }
  }, [])

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
    { id: 'f16', title: '功能 16', icon: 'grid' },
    { id: 'f17', title: '功能 17', icon: 'grid' },
    { id: 'f18', title: '功能 18', icon: 'grid' },
    { id: 'f19', title: '功能 19', icon: 'grid' },
    { id: 'f20', title: '功能 20', icon: 'grid' },
    { id: 'f21', title: '功能 21', icon: 'grid' },
    { id: 'f22', title: '功能 22', icon: 'grid' },
    { id: 'f23', title: '功能 23', icon: 'grid' },
    { id: 'f24', title: '功能 24', icon: 'grid' },
    { id: 'f25', title: '功能 25', icon: 'grid' },
    { id: 'f26', title: '功能 26', icon: 'grid' },
    { id: 'f27', title: '功能 27', icon: 'grid' },
    { id: 'f28', title: '功能 28', icon: 'grid' },
    { id: 'f29', title: '功能 29', icon: 'grid' },
    { id: 'f30', title: '功能 30', icon: 'grid' },
    { id: 'f31', title: '功能 31', icon: 'grid' },
    { id: 'f32', title: '功能 32', icon: 'grid' }
  ]

  const pages = useMemo(() => {
    const pageSize = 16
    const result: Array<Array<{ id: string; title: string; icon: string }>> = []
    for (let i = 0; i < items.length; i += pageSize) {
      result.push(items.slice(i, i + pageSize))
    }
    return result
  }, [items])

  const pageCount = pages.length
  const effectivePageIndex = Math.max(0, Math.min(pageCount - 1, pageIndex))
  const swipeThreshold = 40
  const pageWidth = pagerViewportWidth || 184
  const leftLimit = -Math.max(0, (pageCount - 1) * pageWidth)

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

          <div className="subwindowPager">
            <div ref={pagerViewportRef} className="subwindowPagerViewport">
              <motion.div
                className="subwindowPagerTrack"
                drag={pageCount > 1 ? 'x' : false}
                dragConstraints={{ left: leftLimit, right: 0 }}
                dragElastic={0.06}
                animate={{ x: -(effectivePageIndex * pageWidth) }}
                transition={reduceMotion ? undefined : { type: 'spring', stiffness: 360, damping: 38 }}
                onDragEnd={(_e, info: { offset: { x: number }; velocity: { x: number } }) => {
                  const offsetX = info.offset.x
                  const velocityX = info.velocity.x
                  const swipePower = offsetX + velocityX * 0.12
                  if (swipePower <= -swipeThreshold && effectivePageIndex < pageCount - 1) {
                    setPageIndex(effectivePageIndex + 1)
                    return
                  }
                  if (swipePower >= swipeThreshold && effectivePageIndex > 0) {
                    setPageIndex(effectivePageIndex - 1)
                  }
                }}
              >
                {pages.map((pageItems, idx) => (
                  <div key={idx} className="subwindowPagerPage">
                    <div className="subwindowIconGrid">
                      {pageItems.map((item) => (
                        <Button key={item.id} size="sm" title={item.title}>
                          <GridIcon kind={item.icon} />
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </motion.div>
            </div>

            {pageCount > 1 ? (
              <div className="subwindowPagerDots">
                {pages.map((_, idx) => (
                  <span
                    key={idx}
                    className={idx === effectivePageIndex ? 'subwindowPagerDot subwindowPagerDot--active' : 'subwindowPagerDot'}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
