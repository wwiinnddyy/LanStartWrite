import React, { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from '../Framer_Motion'
import { useHyperGlassRealtimeBlur } from '../hyper_glass'
import { postCommand } from '../toolbar/hooks/useBackend'
import { SettingsSidebar } from './components/SettingsSidebar'
import { SettingsContent } from './components/SettingsContent'
import type { SettingsTab } from './types'
import './SettingsWindow.css'

export function SettingsWindow() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion()

  const [activeTab, setActiveTab] = useState<SettingsTab>('toolbar')

  useHyperGlassRealtimeBlur({ root: rootRef.current })

  // 监听尺寸变化并通知主进程调整窗口大小
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
      const width = Math.max(800, Math.min(1600, Math.ceil(contentWidth) + 32))
      const height = Math.max(500, Math.min(900, Math.ceil(contentHeight) + 32))
      if (width === lastWidth && height === lastHeight) return
      lastWidth = width
      lastHeight = height
      postCommand('set-subwindow-bounds', { kind: 'settings-window', width, height }).catch(() => undefined)
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
  }, [])

  return (
    <motion.div
      ref={rootRef}
      className="settingsWindowRoot"
      initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.99 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? undefined : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div ref={cardRef} className="settingsWindowCard animate-ls-pop-in">
        <div ref={measureRef} className="settingsWindowMeasure">
          <SettingsSidebar activeTab={activeTab} onTabChange={setActiveTab} />
          <SettingsContent activeTab={activeTab} />
        </div>
      </div>
    </motion.div>
  )
}
