import React, { useEffect, useRef } from 'react'
import { Button } from '../button'
import { motion, useReducedMotion } from '../Framer_Motion'
import { useHyperGlassRealtimeBlur } from '../hyper_glass'
import { markQuitting, postCommand } from '../toolbar/hooks/useBackend'
import { useAppAppearance } from '../status'
import './styles/subwindow.css'

export function SettingsMenu(props: { kind: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion()
  const { appearance, setAppearance } = useAppAppearance()

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
            <span>设置</span>
            <span className="subwindowMeta">{props.kind}</span>
          </div>

          <div className="subwindowList">
            <div className="subwindowRow">
              <span>应用</span>
              <span className="subwindowMeta">LanStartWrite</span>
            </div>
            <div className="subwindowRow">
              <span>外观</span>
              <span className="subwindowMeta">{appearance === 'dark' ? '深色 Mica' : '浅色 Mica'}</span>
            </div>
          </div>

          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <Button
              size="sm"
              variant={appearance === 'light' ? 'light' : 'default'}
              onClick={() => {
                setAppearance('light')
              }}
            >
              浅色
            </Button>
            <Button
              size="sm"
              variant={appearance === 'dark' ? 'light' : 'default'}
              onClick={() => {
                setAppearance('dark')
              }}
            >
              深色
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                markQuitting()
                void postCommand('quit')
              }}
            >
              退出
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
