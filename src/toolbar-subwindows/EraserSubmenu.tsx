import React, { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from '../Framer_Motion'
import { useHyperGlassRealtimeBlur } from '../hyper_glass'
import { MotionButton } from '../button'
import { postCommand } from '../toolbar/hooks/useBackend'
import { useZoomOnWheel } from '../toolbar/hooks/useZoomOnWheel'
import './styles/subwindow.css'
import './styles/EraserSubmenu.css'

type EraserType = 'pixel' | 'stroke'

// 黑板擦图标 (Pixel Eraser)
function BlackboardEraserIcon({ isActive }: { isActive: boolean }) {
  return (
    <svg viewBox="0 0 60 60" width="60" height="60">
      <rect x="10" y="15" width="40" height="30" rx="4" fill={isActive ? "#3b82f6" : "#555"} />
      <rect x="10" y="45" width="40" height="6" rx="1" fill="#888" />
      {/* 纹理 */}
      <circle cx="18" cy="25" r="2" fill="rgba(255,255,255,0.3)" />
      <circle cx="30" cy="35" r="2" fill="rgba(255,255,255,0.3)" />
      <circle cx="42" cy="25" r="2" fill="rgba(255,255,255,0.3)" />
      <circle cx="18" cy="35" r="2" fill="rgba(255,255,255,0.3)" />
      <circle cx="30" cy="25" r="2" fill="rgba(255,255,255,0.3)" />
      <circle cx="42" cy="35" r="2" fill="rgba(255,255,255,0.3)" />
    </svg>
  )
}

// 橡皮擦图标 (Stroke Eraser)
function StrokeEraserIcon({ isActive }: { isActive: boolean }) {
  return (
    <svg viewBox="0 0 60 60" width="60" height="60">
      {/* 模拟线段被擦除 */}
      <path d="M10 30 Q 30 10 50 30" stroke="#999" strokeWidth="3" fill="none" strokeDasharray="4 4" />
      
      {/* 橡皮本体 */}
      <g transform="translate(15, 10) rotate(-15)">
        <rect x="0" y="0" width="30" height="40" rx="4" fill={isActive ? "#3b82f6" : "#f0f0f0"} stroke={isActive ? "none" : "#ccc"} strokeWidth="2" />
        <rect x="0" y="25" width="30" height="15" rx="2" fill="#3b82f6" opacity={isActive ? 1 : 0.5} />
      </g>
    </svg>
  )
}

// 清空图标
function ClearAllIcon() {
  return (
    <svg viewBox="0 0 60 60" width="60" height="60">
      <path d="M15 15 L45 15 L45 50 L15 50 Z" fill="none" stroke="white" strokeWidth="3" />
      <line x1="22" y1="20" x2="22" y2="45" stroke="white" strokeWidth="2" />
      <line x1="30" y1="20" x2="30" y2="45" stroke="white" strokeWidth="2" />
      <line x1="38" y1="20" x2="38" y2="45" stroke="white" strokeWidth="2" />
      <path d="M12 15 L48 15" stroke="white" strokeWidth="3" />
      <path d="M25 15 L25 10 L35 10 L35 15" stroke="white" strokeWidth="3" fill="none" />
      <text x="30" y="58" fontSize="10" textAnchor="middle" fill="white" fontWeight="bold">清空</text>
    </svg>
  )
}

function EraserTypeButton({
  label,
  icon,
  isActive,
  onClick,
  isDanger = false,
  onLongPress
}: {
  label: string
  icon: React.ReactNode
  isActive: boolean
  onClick: () => void
  isDanger?: boolean
  onLongPress?: () => void
}) {
  const timerRef = useRef<number | undefined>(undefined)
  const [isPressing, setIsPressing] = useState(false)

  const handleDown = () => {
    if (onLongPress) {
      setIsPressing(true)
      timerRef.current = window.setTimeout(() => {
        onLongPress()
        setIsPressing(false)
      }, 3000)
    }
  }

  const handleUp = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    setIsPressing(false)
  }

  return (
    <MotionButton
      kind="custom"
      ariaLabel={label}
      className={`eraserTypeCard ${isActive ? 'eraserTypeCard--active' : ''} ${isDanger ? 'eraserTypeCard--danger' : ''}`}
      onClick={onLongPress ? undefined : onClick}
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerLeave={handleUp}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      title={label}
    >
      {isPressing && isDanger && (
        <motion.div 
          className="eraserLongPressProgress"
          initial={{ height: "0%" }}
          animate={{ height: "100%" }}
          transition={{ duration: 3, ease: "linear" }}
        />
      )}
      <div className="eraserTypeIcon">
        {icon}
      </div>
      <div className="eraserTypeLabel">{label}</div>
    </MotionButton>
  )
}

// 粗细滑块组件 (复用样式)
function ThicknessSlider({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="eraserThicknessControl">
      <span className="eraserThicknessLabel">大小:</span>
      <div className="eraserSliderContainer">
        <input
          type="range"
          min="5"
          max="100"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="eraserSlider"
          title={`大小: ${value}px`}
        />
        <div
          className="eraserSliderTrack"
          style={{ width: `${((value - 5) / 95) * 100}%` }}
        />
        <div 
          className="eraserSliderThumb"
          style={{ left: `${((value - 5) / 95) * 100}%` }}
        />
      </div>
      <span className="eraserThicknessValue">{value}</span>
    </div>
  )
}

export function EraserSubmenu(props: { kind: string }) {
  useZoomOnWheel()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion()
  
  const [selectedType, setSelectedType] = useState<EraserType>('pixel')
  const [thickness, setThickness] = useState(30)

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
      const width = Math.max(300, Math.min(600, Math.ceil(contentWidth) + 26)) // 12px padding * 2 + 1px border * 2 = 26
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

  const applySettings = (newType: EraserType, newThickness: number) => {
    void postCommand('app.setEraserSettings', {
      type: newType,
      thickness: newThickness
    })
  }

  const handleClearAll = () => {
    void postCommand('app.clearPage')
  }

  return (
    <motion.div
      ref={rootRef}
      className="subwindowRoot eraserSubmenu"
      initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.99 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? undefined : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div ref={cardRef} className="subwindowCard animate-ls-pop-in">
        <div ref={measureRef} className="subwindowMeasure">
          <div className="eraserSubmenuContent">
            
            {/* 上方：大小调整 */}
            <div className="eraserTopSection">
               <ThicknessSlider 
                  value={thickness} 
                  onChange={(value) => {
                    setThickness(value)
                    applySettings(selectedType, value)
                  }} 
                />
            </div>

            {/* 中间：三个图形按钮 */}
            <div className="eraserMiddleSection">
              <EraserTypeButton
                label="黑板擦"
                icon={<BlackboardEraserIcon isActive={selectedType === 'pixel'} />}
                isActive={selectedType === 'pixel'}
                onClick={() => {
                  setSelectedType('pixel')
                  applySettings('pixel', thickness)
                }}
              />
              <EraserTypeButton
                label="对象擦"
                icon={<StrokeEraserIcon isActive={selectedType === 'stroke'} />}
                isActive={selectedType === 'stroke'}
                onClick={() => {
                  setSelectedType('stroke')
                  applySettings('stroke', thickness)
                }}
              />
              <EraserTypeButton
                label="清空"
                icon={<ClearAllIcon />}
                isActive={false}
                onClick={() => {}} // 长按触发，点击不触发
                onLongPress={handleClearAll}
                isDanger={true}
              />
            </div>

            {/* 下方：状态栏 */}
            <div className="eraserBottomSection">
              <div className="eraserStatusBar">
                <span className="eraserStatusText">
                  橡皮 {thickness}PX
                </span>
                <span className="eraserStatusText">
                   {selectedType === 'pixel' ? '点擦除' : '对象擦除'}
                </span>
              </div>
            </div>

          </div>
        </div>
      </div>
    </motion.div>
  )
}
