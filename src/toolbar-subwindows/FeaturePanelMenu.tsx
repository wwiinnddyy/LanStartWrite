import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../button'
import { motion, useReducedMotion } from '../Framer_Motion'
import { useHyperGlassRealtimeBlur } from '../hyper_glass'
import { TOOLBAR_STATE_KEY, usePersistedState } from '../status'
import { markQuitting, postCommand } from '../toolbar/hooks/useBackend'
import { useZoomOnWheel } from '../toolbar/hooks/useZoomOnWheel'
import { getAppButtonVisibility, type AppButtonId } from '../toolbar/utils/constants'
import './styles/subwindow.css'

type GridIconKind = 'grid' | 'plus' | 'gear' | 'doc' | 'db' | 'events' | 'watcher' | 'pin' | 'quit'

function GridIcon(props: { kind: GridIconKind }) {
  const stroke = 'currentColor'
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke, strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

  if (props.kind === 'grid') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20">
        <path fill="currentColor" d="M4.5 17a1.5 1.5 0 0 1-1.493-1.355L3 15.501v-11a1.5 1.5 0 0 1 1.356-1.493L4.5 3H9a1.5 1.5 0 0 1 1.493 1.355l.007.145v.254l2.189-2.269a1.5 1.5 0 0 1 2.007-.138l.116.101l2.757 2.725a1.5 1.5 0 0 1 .111 2.011l-.103.116l-2.311 2.2h.234a1.5 1.5 0 0 1 1.493 1.356L17 11v4.5a1.5 1.5 0 0 1-1.355 1.493L15.5 17zm5-6.5H4v5a.5.5 0 0 0 .326.47l.084.023l.09.008h5zm6 0h-5V16h5a.5.5 0 0 0 .492-.41L16 15.5V11a.5.5 0 0 0-.41-.491zm-5-2.79V9.5h1.79zM9 4H4.5a.5.5 0 0 0-.492.411L4 4.501v5h5.5v-5a.5.5 0 0 0-.326-.469L9.09 4.01zm5.122-.826a.5.5 0 0 0-.645-.053l-.068.06l-2.616 2.713a.5.5 0 0 0-.057.623l.063.078l2.616 2.615a.5.5 0 0 0 .62.07l.078-.061l2.758-2.627a.5.5 0 0 0 .054-.638l-.059-.069z"/>
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

  if (props.kind === 'db') {
    return (
      <svg {...common}>
        <path d="M12 4c4.418 0 8 1.343 8 3s-3.582 3-8 3s-8-1.343-8-3s3.582-3 8-3" />
        <path d="M4 7v10c0 1.657 3.582 3 8 3s8-1.343 8-3V7" />
        <path d="M4 12c0 1.657 3.582 3 8 3s8-1.343 8-3" />
      </svg>
    )
  }

  if (props.kind === 'events') {
    return (
      <svg {...common}>
        <path d="M8 13a4 4 0 0 1 8 0" />
        <path d="M12 21a8 8 0 1 1 8-8" />
        <path d="M20 21l-2.5-2.5" />
      </svg>
    )
  }

  if (props.kind === 'watcher') {
    return (
      <svg {...common}>
        <path d="M2 12s3.5-7 10-7s10 7 10 7s-3.5 7-10 7s-10-7-10-7" />
        <path d="M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6" />
      </svg>
    )
  }

  if (props.kind === 'pin') {
    return (
      <svg {...common}>
        <path d="M12 17v5" />
        <path d="M6 10l12 0" />
        <path d="M9 3h6l1 7H8z" />
      </svg>
    )
  }

  if (props.kind === 'gear') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20">
        <path fill="currentColor" d="M1.911 7.383a8.5 8.5 0 0 1 1.78-3.08a.5.5 0 0 1 .54-.135l1.918.686a1 1 0 0 0 1.32-.762l.366-2.006a.5.5 0 0 1 .388-.4a8.5 8.5 0 0 1 3.554 0a.5.5 0 0 1 .388.4l.366 2.006a1 1 0 0 0 1.32.762l1.919-.686a.5.5 0 0 1 .54.136a8.5 8.5 0 0 1 1.78 3.079a.5.5 0 0 1-.153.535l-1.555 1.32a1 1 0 0 0 0 1.524l1.555 1.32a.5.5 0 0 1 .152.535a8.5 8.5 0 0 1-1.78 3.08a.5.5 0 0 1-.54.135l-1.918-.686a1 1 0 0 0-1.32.762l-.366 2.007a.5.5 0 0 1-.388.399a8.5 8.5 0 0 1-3.554 0a.5.5 0 0 1-.388-.4l-.366-2.006a1 1 0 0 0-1.32-.762l-1.918.686a.5.5 0 0 1-.54-.136a8.5 8.5 0 0 1-1.78-3.079a.5.5 0 0 1 .152-.535l1.555-1.32a1 1 0 0 0 0-1.524l-1.555-1.32a.5.5 0 0 1-.152-.535m1.06-.006l1.294 1.098a2 2 0 0 1 0 3.05l-1.293 1.098c.292.782.713 1.51 1.244 2.152l1.596-.57q.155-.055.315-.085a2 2 0 0 1 2.326 1.609l.304 1.669a7.6 7.6 0 0 0 2.486 0l.304-1.67a1.998 1.998 0 0 1 2.641-1.524l1.596.571a7.5 7.5 0 0 0 1.245-2.152l-1.294-1.098a1.998 1.998 0 0 1 0-3.05l1.294-1.098a7.5 7.5 0 0 0-1.245-2.152l-1.596.57a2 2 0 0 1-2.64-1.524l-.305-1.669a7.6 7.6 0 0 0-2.486 0l-.304 1.669a2 2 0 0 1-2.64 1.525l-1.597-.571a7.5 7.5 0 0 0-1.244 2.152M7.502 10a2.5 2.5 0 1 1 5 0a2.5 2.5 0 0 1-5 0m1 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 0 0-3 0"/>
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

  if (props.kind === 'quit') {
    return (
      <svg {...common}>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="M16 17l5-5l-5-5" />
        <path d="M21 12H9" />
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

  type ToolbarState = { collapsed: boolean; alwaysOnTop: boolean }
  function isToolbarState(v: unknown): v is ToolbarState {
    if (!v || typeof v !== 'object') return false
    const x = v as any
    return typeof x.collapsed === 'boolean' && typeof x.alwaysOnTop === 'boolean'
  }

  const [toolbarState, setToolbarState] = usePersistedState<ToolbarState>(
    TOOLBAR_STATE_KEY,
    { collapsed: false, alwaysOnTop: true },
    { validate: isToolbarState }
  )

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

  const items = useMemo(() => {
    const allItems: Array<{ id: AppButtonId; title: string; icon: GridIconKind; variant?: 'default' | 'light' | 'danger'; onClick: () => void }> = [
      {
        id: 'db',
        title: '数据库',
        icon: 'db',
        onClick: () => {
          void postCommand('create-window')
        }
      },
      {
        id: 'events',
        title: '事件',
        icon: 'events',
        onClick: () => {
          void postCommand('toggle-subwindow', { kind: 'events', placement: 'bottom' })
        }
      },
      {
        id: 'watcher',
        title: '监视器',
        icon: 'watcher',
        onClick: () => {
          void postCommand('watcher.openWindow')
        }
      },
      {
        id: 'pin',
        title: '置顶',
        icon: 'pin',
        variant: toolbarState.alwaysOnTop ? 'light' : 'default',
        onClick: () => {
          const next = !toolbarState.alwaysOnTop
          setToolbarState({ ...toolbarState, alwaysOnTop: next })
          void postCommand('set-toolbar-always-on-top', { value: next })
        }
      },
      {
        id: 'settings',
        title: '设置',
        icon: 'gear',
        onClick: () => {
          void postCommand('app.openSettingsWindow')
        }
      },
      {
        id: 'quit',
        title: '退出',
        icon: 'quit',
        variant: 'danger',
        onClick: () => {
          markQuitting()
          void postCommand('quit')
        }
      }
    ]

    return allItems.filter((item) => getAppButtonVisibility(item.id).showInFeaturePanel)
  }, [setToolbarState, toolbarState.alwaysOnTop])

  const pages = useMemo(() => {
    const pageSize = 16
    const result: Array<Array<{ id: AppButtonId; title: string; icon: GridIconKind; variant?: 'default' | 'light' | 'danger'; onClick: () => void }>> = []
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
                        <Button
                          key={item.id}
                          size="sm"
                          ariaLabel={item.title}
                          title={item.title}
                          variant={item.variant}
                          showInToolbar={getAppButtonVisibility(item.id).showInToolbar}
                          showInFeaturePanel={getAppButtonVisibility(item.id).showInFeaturePanel}
                          onClick={item.onClick}
                        >
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
