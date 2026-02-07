import React, { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from '../Framer_Motion'
import { useHyperGlassRealtimeBlur } from '../hyper_glass'
import { MotionButton } from '../button'
import { postCommand } from '../toolbar/hooks/useBackend'
import { useZoomOnWheel } from '../toolbar/hooks/useZoomOnWheel'
import {
  PEN_COLOR_UI_STATE_KEY,
  PEN_SETTINGS_KV_KEY,
  PEN_THICKNESS_UI_STATE_KEY,
  PEN_TYPE_UI_STATE_KEY,
  UI_STATE_APP_WINDOW_ID,
  getKv,
  isPenSettings,
  putKv,
  useUiStateBus,
  type PenType
} from '../status'
import './styles/subwindow.css'
import './styles/PenSubmenu.css'

// 预设颜色 - 3x3 布局需要 9 个颜色
const PRESET_COLORS = [
  '#000000', // 黑色
  '#FF0000', // 红色
  '#0000FF', // 蓝色
  '#00FF00', // 绿色
  '#FFFF00', // 黄色
  '#FF00FF', // 紫色
  '#FFA500', // 橙色
  '#00FFFF', // 青色
  '#FFFFFF', // 白色
]

// 倾斜的彩色铅笔/钢笔图标（更符合草图效果）
function WritingPenIcon({ color = '#333' }: { color?: string }) {
  return (
    <svg viewBox="0 0 60 36" width="60" height="36">
      <g transform="rotate(-25, 30, 18)">
        {/* 铅笔尖 - 木质削尖部分 */}
        <path d="M2 18 L12 12 L12 24 Z" fill={color} />
        {/* 木质笔杆 */}
        <rect x="12" y="11" width="8" height="14" fill="#DEB887" />
        {/* 金属环 - 连接木质和笔杆 */}
        <rect x="20" y="10" width="4" height="16" fill="#C0C0C0" />
        {/* 彩色笔杆主体 */}
        <rect x="24" y="9" width="22" height="18" rx="2" fill={color} />
        {/* 笔杆高光 */}
        <rect x="26" y="11" width="18" height="5" rx="1" fill="rgba(255,255,255,0.4)" />
        {/* 笔尾橡皮 */}
        <rect x="46" y="10" width="8" height="16" rx="3" fill="#FF6B6B" />
        {/* 橡皮金属箍 */}
        <rect x="46" y="13" width="2" height="10" fill="#C0C0C0" />
      </g>
    </svg>
  )
}

function HighlighterIcon({ color = '#FFEB3B' }: { color?: string }) {
  return (
    <svg viewBox="0 0 60 36" width="60" height="36">
      <g transform="rotate(-25, 30, 18)">
        {/* 荧光笔斜切笔尖 */}
        <path d="M4 18 L14 10 L14 26 Z" fill={color} />
        {/* 笔尖深色部分 */}
        <path d="M4 18 L8 15 L8 21 Z" fill="rgba(0,0,0,0.2)" />
        {/* 粗笔杆 */}
        <rect x="14" y="8" width="30" height="20" rx="3" fill={color} />
        {/* 笔帽夹 */}
        <rect x="30" y="5" width="4" height="8" rx="1" fill="rgba(0,0,0,0.3)" />
        {/* 高光 */}
        <rect x="16" y="10" width="26" height="6" rx="2" fill="rgba(255,255,255,0.5)" />
        {/* 笔尾 */}
        <rect x="44" y="10" width="10" height="16" rx="4" fill={color} />
        <rect x="44" y="10" width="10" height="16" rx="4" fill="rgba(0,0,0,0.1)" />
      </g>
    </svg>
  )
}

function LaserPenIcon({ color = '#2196F3' }: { color?: string }) {
  return (
    <svg viewBox="0 0 60 36" width="60" height="36">
      <g transform="rotate(-25, 30, 18)">
        {/* 激光点 - 发光效果 */}
        <circle cx="6" cy="18" r="4" fill="#FF4444" />
        <circle cx="6" cy="18" r="6" fill="rgba(255,68,68,0.3)" />
        {/* 金属笔尖 */}
        <rect x="10" y="14" width="6" height="8" fill="#C0C0C0" />
        {/* 细长笔杆 */}
        <rect x="16" y="12" width="28" height="12" rx="2" fill={color} />
        {/* 红色按钮 */}
        <rect x="24" y="8" width="10" height="5" rx="2" fill="#FF4444" />
        {/* 高光 */}
        <rect x="18" y="14" width="24" height="4" rx="1" fill="rgba(255,255,255,0.4)" />
        {/* 笔尾挂绳孔 */}
        <rect x="44" y="14" width="8" height="8" rx="4" fill="#333" />
        <rect x="46" y="16" width="4" height="4" rx="2" fill={color} />
      </g>
    </svg>
  )
}

// 笔类型配置
const PEN_TYPES: { type: PenType; label: string; icon: (color: string) => React.ReactNode; defaultColor: string }[] = [
  {
    type: 'writing',
    label: '书写笔',
    icon: (color) => <WritingPenIcon color={color} />,
    defaultColor: '#333333',
  },
  {
    type: 'highlighter',
    label: '荧光笔',
    icon: (color) => <HighlighterIcon color={color} />,
    defaultColor: '#FFEB3B',
  },
  {
    type: 'laser',
    label: '激光笔',
    icon: (color) => <LaserPenIcon color={color} />,
    defaultColor: '#2196F3',
  },
]

// 颜色按钮组件
function ColorButton({
  color,
  isActive,
  onClick,
}: {
  color: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <MotionButton
      kind="custom"
      ariaLabel={`颜色 ${color}`}
      className={`penColorButton ${isActive ? 'penColorButton--active' : ''}`}
      onClick={onClick}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
      style={{ backgroundColor: color }}
      title={color}
    >
      {isActive && (
        <motion.div
          className="penColorCheck"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.15 }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </motion.div>
      )}
    </MotionButton>
  )
}

// 笔类型按钮组件（Office 风格：无文字，选中时向左移动）
function PenTypeButton({
  type,
  label,
  icon,
  iconColor,
  isActive,
  onClick,
}: {
  type: PenType
  label: string
  icon: (color: string) => React.ReactNode
  iconColor: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <MotionButton
      kind="custom"
      ariaLabel={label}
      className={`penTypeCard ${isActive ? 'penTypeCard--active' : ''}`}
      onClick={onClick}
      whileHover={{ x: isActive ? -12 : -4 }} // 悬停时稍微移动
      whileTap={{ scale: 0.98 }}
      title={label}
      animate={{ 
        x: isActive ? -12 : 0, // 选中时向左移动露出更多
        backgroundColor: isActive ? 'rgba(59, 130, 246, 0.1)' : 'transparent'
      }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      {/* 笔图标 */}
      <div className="penTypeIcon">
        {icon(iconColor)}
      </div>
    </MotionButton>
  )
}

// 粗细滑块组件
function ThicknessSlider({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="penThicknessControl">
      <span className="penThicknessLabel">粗细</span>
      <div className="penSliderContainer">
        <input
          type="range"
          min="1"
          max="50"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="penSlider"
          title={`粗细: ${value}px`}
        />
        <div
          className="penSliderTrack"
          style={{ width: `${(value / 50) * 100}%` }}
        />
      </div>
      <span className="penThicknessValue">{value}</span>
    </div>
  )
}

// 主组件
export function PenSubmenu(props: { kind: string }) {
  useZoomOnWheel()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion()
  const bus = useUiStateBus(UI_STATE_APP_WINDOW_ID)
  
  const [selectedColor, setSelectedColor] = useState('#000000')
  const [selectedPenType, setSelectedPenType] = useState<PenType>('writing')
  const [thickness, setThickness] = useState(12)

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
      const width = Math.max(360, Math.min(1600, Math.ceil(contentWidth) + 32))
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

  const sendPenSettings = (payload: { type: PenType; color: string; thickness: number }) => {
    const normalized = {
      type: payload.type,
      color: payload.color,
      thickness: Math.max(1, Math.min(120, payload.thickness))
    }
    void postCommand('app.setPenSettings', normalized)
    void putKv(PEN_SETTINGS_KV_KEY, normalized).catch(() => undefined)
  }

  const applyPenSettings = (next?: { type?: PenType; color?: string; thickness?: number }) => {
    sendPenSettings({
      type: next?.type ?? selectedPenType,
      color: next?.color ?? selectedColor,
      thickness: next?.thickness ?? thickness
    })
  }

  const busPenTypeRaw = bus.state[PEN_TYPE_UI_STATE_KEY]
  const busPenType: PenType | undefined =
    busPenTypeRaw === 'highlighter' ? 'highlighter' : busPenTypeRaw === 'laser' ? 'laser' : busPenTypeRaw === 'writing' ? 'writing' : undefined
  const busPenColorRaw = bus.state[PEN_COLOR_UI_STATE_KEY]
  const busPenColor = typeof busPenColorRaw === 'string' ? busPenColorRaw : undefined
  const busPenThicknessRaw = bus.state[PEN_THICKNESS_UI_STATE_KEY]
  const busPenThickness = typeof busPenThicknessRaw === 'number' && Number.isFinite(busPenThicknessRaw) ? busPenThicknessRaw : undefined

  useEffect(() => {
    if (busPenType) setSelectedPenType(busPenType)
    if (busPenColor) setSelectedColor(busPenColor)
    if (busPenThickness !== undefined) setThickness(busPenThickness)
  }, [busPenColor, busPenThickness, busPenType])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const loaded = await getKv<unknown>(PEN_SETTINGS_KV_KEY)
        if (cancelled) return
        if (!isPenSettings(loaded)) return
        if (busPenType || busPenColor || busPenThickness !== undefined) return
        setSelectedPenType(loaded.type)
        setSelectedColor(loaded.color)
        setThickness(loaded.thickness)
        sendPenSettings(loaded)
      } catch {}
    })()
    return () => {
      cancelled = true
    }
  }, [busPenColor, busPenThickness, busPenType])

  return (
    <motion.div
      ref={rootRef}
      className="subwindowRoot penSubmenu"
      initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.99 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? undefined : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div ref={cardRef} className="subwindowCard animate-ls-pop-in">
        <div ref={measureRef} className="subwindowMeasure">
          {/* 标题 */}
          <div className="subwindowTitle">
            <span>笔设置</span>
            <span className="subwindowMeta">{props.kind}</span>
          </div>

          {/* 主内容区：左右两列布局 */}
          <div className="penSubmenuContent">
            <div className="penUpperSection">
              {/* 左列：颜色九宫格 (3x4) */}
              <div className="penColorSection">
                <div className="penColorGrid">
                  {PRESET_COLORS.map((color) => (
                    <ColorButton
                      key={color}
                      color={color}
                      isActive={selectedColor === color}
                      onClick={() => {
                        setSelectedColor(color)
                        applyPenSettings({ color })
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* 垂直分隔线 */}
              <div className="penSubmenuVerticalDivider" />

              {/* 右列：笔类型 */}
              <div className="penTypeSection">
                {PEN_TYPES.map((pen) => (
                  <PenTypeButton
                    key={pen.type}
                    type={pen.type}
                    label={pen.label}
                    icon={pen.icon}
                    iconColor={pen.type === 'writing' ? selectedColor : pen.defaultColor}
                    isActive={selectedPenType === pen.type}
                    onClick={() => {
                      setSelectedPenType(pen.type)
                      applyPenSettings({ type: pen.type })
                    }}
                  />
                ))}
              </div>
            </div>

            {/* 粗细调节 */}
            <div className="penThicknessSection">
              <ThicknessSlider 
                value={thickness} 
                onChange={(value) => {
                  setThickness(value)
                  applyPenSettings({ thickness: value })
                }} 
              />
            </div>
          </div>

          {/* 下方：状态栏 */}
          <div className="penBottomSection">
            <div className="penStatusBar">
              <span className="penStatusText">
                {selectedPenType === 'writing' ? '书写笔' : selectedPenType === 'highlighter' ? '荧光笔' : '激光笔'} {thickness}PX
              </span>
              <div className="penStatusColorDisplay">
                <div className="penStatusColorDot" style={{ backgroundColor: selectedColor }} />
                <span className="penStatusText">
                  {selectedColor.toUpperCase()}
                </span>
              </div>
            </div>
          </div>
          
        </div>
      </div>
    </motion.div>
  )
}
