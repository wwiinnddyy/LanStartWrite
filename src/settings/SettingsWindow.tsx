import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from '../Framer_Motion'
import { useHyperGlassRealtimeBlur } from '../hyper_glass'
import { SettingsSidebar } from './components/SettingsSidebar'
import { SettingsContent } from './components/SettingsContent'
import { WindowControls } from './components/WindowControls'
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

  const [activeTab, setActiveTab] = useState<SettingsTab>('toolbar')

  // 监听容器大小
  const { width: containerWidth } = useContainerSize(cardRef)
  
  // 根据容器宽度确定布局大小
  const layoutSize: LayoutSize = useMemo(() => {
    if (containerWidth < 600) return 'compact'
    if (containerWidth < 900) return 'comfortable'
    return 'spacious'
  }, [containerWidth])

  useHyperGlassRealtimeBlur({ root: rootRef.current })

  return (
    <motion.div
      ref={rootRef}
      className="settingsWindowRoot"
      initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.99 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? undefined : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <WindowControls />
      <div ref={cardRef} className={`settingsWindowCard settingsWindowCard--${layoutSize} animate-ls-pop-in`}>
        <div className="settingsWindowMeasure">
          <SettingsSidebar activeTab={activeTab} onTabChange={setActiveTab} />
          <SettingsContent activeTab={activeTab} />
        </div>
      </div>
    </motion.div>
  )
}
