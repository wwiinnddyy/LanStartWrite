import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from '../Framer_Motion'
import { AppWindowTitlebar } from '../app_windows_manerger/renderer'
import { SettingsSidebar } from './components/SettingsSidebar'
import { SettingsContent } from './components/SettingsContent'
import { postCommand } from '../status'
import type { SettingsTab } from './types'
import './SettingsWindow.css'

type LayoutSize = 'compact' | 'comfortable' | 'spacious'

// 自定义 hook：监听容器大小变化
function useContainerSize(ref: React.RefObject<HTMLElement>) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (!ref.current) return

    const element = ref.current
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setSize({ width, height })
      }
    })

    observer.observe(element)
    // 初始化尺寸
    setSize({ width: element.clientWidth, height: element.clientHeight })

    return () => observer.disconnect()
  }, [ref])

  return size
}

export function SettingsWindow() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion()

  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')
  const resizeStateRef = useRef({ rafId: 0, lastWidth: 0, lastHeight: 0 })

  // 监听容器大小
  const { width: containerWidth } = useContainerSize(cardRef)
  
  // 根据容器宽度确定布局大小
  const layoutSize: LayoutSize = useMemo(() => {
    if (containerWidth < 600) return 'compact'
    if (containerWidth < 900) return 'comfortable'
    return 'spacious'
  }, [containerWidth])

  useEffect(() => {
    const state = resizeStateRef.current
    const card = cardRef.current
    if (!card) return
    if (typeof ResizeObserver === 'undefined') return

    const send = () => {
      state.rafId = 0
      const width = Math.ceil(Math.max(card.getBoundingClientRect().width, card.scrollWidth))
      const height = Math.ceil(Math.max(card.getBoundingClientRect().height, card.scrollHeight))
      const boundedWidth = Math.max(560, Math.min(1400, width))
      const boundedHeight = Math.max(420, Math.min(1080, height))
      if (boundedWidth === state.lastWidth && boundedHeight === state.lastHeight) return
      state.lastWidth = boundedWidth
      state.lastHeight = boundedHeight
      postCommand('set-app-window-bounds', {
        windowId: 'settings-window',
        width: boundedWidth,
        height: boundedHeight
      }).catch(() => undefined)
    }

    const schedule = () => {
      if (state.rafId) return
      state.rafId = window.requestAnimationFrame(send)
    }

    const observer = new ResizeObserver(schedule)
    observer.observe(card)
    const contentInner = card.querySelector('.settingsContentInner')
    const sidebar = card.querySelector('.settingsSidebar')
    if (contentInner instanceof HTMLElement) observer.observe(contentInner)
    if (sidebar instanceof HTMLElement) observer.observe(sidebar)

    const mutationObserver =
      typeof MutationObserver === 'undefined'
        ? undefined
        : new MutationObserver(() => {
            schedule()
          })
    mutationObserver?.observe(card, { subtree: true, childList: true, attributes: true, characterData: true })
    schedule()

    return () => {
      if (state.rafId) window.cancelAnimationFrame(state.rafId)
      state.rafId = 0
      observer.disconnect()
      mutationObserver?.disconnect()
    }
  }, [activeTab, layoutSize])

  return (
    <motion.div
      ref={rootRef}
      className="settingsWindowRoot"
      initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.99 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? undefined : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div ref={cardRef} className={`settingsWindowCard settingsWindowCard--${layoutSize} animate-ls-pop-in`}>
        <AppWindowTitlebar windowId="settings-window" title="设置" />
        <div className="settingsWindowMeasure">
          <SettingsSidebar activeTab={activeTab} onTabChange={setActiveTab} />
          <SettingsContent activeTab={activeTab} />
        </div>
      </div>
    </motion.div>
  )
}
