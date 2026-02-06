import React from 'react'
import { motion } from '../../Framer_Motion'
import { useWallpaperMonetColors, type MonetColor } from '../../hyper_glass'
import { MotionButton } from '../../button'
import './AccentColorPicker.css'

export type AccentColor = {
  name: string
  value: string
  light: {
    primary: string
    primaryHover: string
    primaryActive: string
    primaryLight: string
    gradient: string
  }
  dark: {
    primary: string
    primaryHover: string
    primaryActive: string
    primaryLight: string
    gradient: string
  }
}

export const PRESET_ACCENT_COLORS: AccentColor[] = [
  {
    name: '黑白',
    value: 'blue',
    light: {
      primary: '#1a1a1a',
      primaryHover: '#000000',
      primaryActive: '#000000',
      primaryLight: 'rgba(0, 0, 0, 0.1)',
      gradient: 'linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)',
    },
    dark: {
      primary: '#f5f5f5',
      primaryHover: '#ffffff',
      primaryActive: '#ffffff',
      primaryLight: 'rgba(255, 255, 255, 0.15)',
      gradient: 'linear-gradient(135deg, #ffffff 0%, #e5e5e5 100%)',
    },
  },
  {
    name: '紫色',
    value: 'purple',
    light: {
      primary: '#8b5cf6',
      primaryHover: '#7c3aed',
      primaryActive: '#6d28d9',
      primaryLight: 'rgba(139, 92, 246, 0.15)',
      gradient: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
    },
    dark: {
      primary: '#a78bfa',
      primaryHover: '#8b5cf6',
      primaryActive: '#7c3aed',
      primaryLight: 'rgba(167, 139, 250, 0.2)',
      gradient: 'linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%)',
    },
  },
  {
    name: '粉色',
    value: 'pink',
    light: {
      primary: '#ec4899',
      primaryHover: '#db2777',
      primaryActive: '#be185d',
      primaryLight: 'rgba(236, 72, 153, 0.15)',
      gradient: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
    },
    dark: {
      primary: '#f472b6',
      primaryHover: '#ec4899',
      primaryActive: '#db2777',
      primaryLight: 'rgba(244, 114, 182, 0.2)',
      gradient: 'linear-gradient(135deg, #f472b6 0%, #ec4899 100%)',
    },
  },
  {
    name: '红色',
    value: 'red',
    light: {
      primary: '#ef4444',
      primaryHover: '#dc2626',
      primaryActive: '#b91c1c',
      primaryLight: 'rgba(239, 68, 68, 0.15)',
      gradient: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
    },
    dark: {
      primary: '#f87171',
      primaryHover: '#ef4444',
      primaryActive: '#dc2626',
      primaryLight: 'rgba(248, 113, 113, 0.2)',
      gradient: 'linear-gradient(135deg, #f87171 0%, #ef4444 100%)',
    },
  },
  {
    name: '橙色',
    value: 'orange',
    light: {
      primary: '#f97316',
      primaryHover: '#ea580c',
      primaryActive: '#c2410c',
      primaryLight: 'rgba(249, 115, 22, 0.15)',
      gradient: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
    },
    dark: {
      primary: '#fb923c',
      primaryHover: '#f97316',
      primaryActive: '#ea580c',
      primaryLight: 'rgba(251, 146, 60, 0.2)',
      gradient: 'linear-gradient(135deg, #fb923c 0%, #f97316 100%)',
    },
  },
  {
    name: '绿色',
    value: 'green',
    light: {
      primary: '#10b981',
      primaryHover: '#059669',
      primaryActive: '#047857',
      primaryLight: 'rgba(16, 185, 129, 0.15)',
      gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    },
    dark: {
      primary: '#34d399',
      primaryHover: '#10b981',
      primaryActive: '#059669',
      primaryLight: 'rgba(52, 211, 153, 0.2)',
      gradient: 'linear-gradient(135deg, #34d399 0%, #10b981 100%)',
    },
  },
  {
    name: '青色',
    value: 'cyan',
    light: {
      primary: '#06b6d4',
      primaryHover: '#0891b2',
      primaryActive: '#0e7490',
      primaryLight: 'rgba(6, 182, 212, 0.15)',
      gradient: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
    },
    dark: {
      primary: '#22d3ee',
      primaryHover: '#06b6d4',
      primaryActive: '#0891b2',
      primaryLight: 'rgba(34, 211, 238, 0.2)',
      gradient: 'linear-gradient(135deg, #22d3ee 0%, #06b6d4 100%)',
    },
  },
  {
    name: '琥珀色',
    value: 'amber',
    light: {
      primary: '#f59e0b',
      primaryHover: '#d97706',
      primaryActive: '#b45309',
      primaryLight: 'rgba(245, 158, 11, 0.15)',
      gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    },
    dark: {
      primary: '#fbbf24',
      primaryHover: '#f59e0b',
      primaryActive: '#d97706',
      primaryLight: 'rgba(251, 191, 36, 0.2)',
      gradient: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
    },
  },
]

// 将 MonetColor 转换为 AccentColor
function monetToAccentColor(monetColor: MonetColor): AccentColor {
  return {
    name: monetColor.name,
    value: monetColor.value,
    light: monetColor.light,
    dark: monetColor.dark,
  }
}

export const WALLPAPER_MIX_ACCENT_VALUE = 'wallpaper-mix'

export function buildWallpaperMixAccentColor(monetColors: MonetColor[]): AccentColor | undefined {
  const colors = monetColors.slice(0, 5)
  if (colors.length === 0) return undefined

  const buildGradient = (mode: 'light' | 'dark') => {
    const stops = colors.map((c) => (mode === 'light' ? c.light.primary : c.dark.primary))
    if (stops.length === 1) return `linear-gradient(to bottom right, ${stops[0]} 0%, ${stops[0]} 100%)`
    const parts = stops.map((c, i) => {
      const pct = Math.round((i / (stops.length - 1)) * 100)
      return `${c} ${pct}%`
    })
    return `linear-gradient(to bottom right, ${parts.join(', ')})`
  }

  const base = colors[0]

  return {
    name: '壁纸混合',
    value: WALLPAPER_MIX_ACCENT_VALUE,
    light: {
      primary: base.light.primary,
      primaryHover: base.light.primaryHover,
      primaryActive: base.light.primaryActive,
      primaryLight: base.light.primaryLight,
      gradient: buildGradient('light'),
    },
    dark: {
      primary: base.dark.primary,
      primaryHover: base.dark.primaryHover,
      primaryActive: base.dark.primaryActive,
      primaryLight: base.dark.primaryLight,
      gradient: buildGradient('dark'),
    },
  }
}

interface AccentColorPickerProps {
  value: string
  onChange: (color: AccentColor) => void
}

// 系统取色方案（彩虹渐变色）
export const SYSTEM_ACCENT_COLOR: AccentColor = {
  name: '系统取色',
  value: 'system-monet',
  light: {
    primary: '#6366f1',
    primaryHover: '#4f46e5',
    primaryActive: '#4338ca',
    primaryLight: 'rgba(99, 102, 241, 0.15)',
    gradient: 'linear-gradient(135deg, #f472b6 0%, #a78bfa 25%, #60a5fa 50%, #34d399 75%, #fbbf24 100%)',
  },
  dark: {
    primary: '#818cf8',
    primaryHover: '#6366f1',
    primaryActive: '#4f46e5',
    primaryLight: 'rgba(129, 140, 248, 0.2)',
    gradient: 'linear-gradient(135deg, #f9a8d4 0%, #c4b5fd 25%, #93c5fd 50%, #6ee7b7 75%, #fde047 100%)',
  },
}

export function AccentColorPicker({ value, onChange }: AccentColorPickerProps) {
  const { monetColors, isLoading } = useWallpaperMonetColors()

  const topColors: AccentColor[] = [
    ...PRESET_ACCENT_COLORS,
  ]
  const wallpaperMix = buildWallpaperMixAccentColor(monetColors)
  const wallpaperColors: AccentColor[] = [
    ...(wallpaperMix ? [wallpaperMix] : []),
    ...monetColors.map(monetToAccentColor),
  ]

  return (
    <div className="accentColorPicker">
      <div className="accentColorPickerRow">
        {topColors.map((color, index) => (
          <MotionButton
            key={color.value}
            kind="custom"
            ariaLabel={color.name}
            className={`accentColorOption ${value === color.value ? 'accentColorOption--active' : ''} ${color.value === 'system-monet' ? 'accentColorOption--system' : ''}`}
            onClick={() => onChange(color)}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, delay: index * 0.03 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            title={color.name}
          >
            <div className="accentColorSwatch" style={{ background: color.light.gradient }} />
            {value === color.value && (
              <motion.div
                className="accentColorCheck"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </motion.div>
            )}
          </MotionButton>
        ))}
      </div>

      <div className="accentColorPickerWallpaperRow">
        {wallpaperColors.map((color, index) => (
          <MotionButton
            key={color.value}
            kind="custom"
            ariaLabel={color.name}
            className={`accentColorOption ${value === color.value ? 'accentColorOption--active' : ''}`}
            onClick={() => onChange(color)}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, delay: index * 0.03 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            title={color.name}
          >
            <div className="accentColorSwatch" style={{ background: color.light.gradient }} />
            {value === color.value && (
              <motion.div
                className="accentColorCheck"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </motion.div>
            )}
          </MotionButton>
        ))}
        {isLoading && (
          <motion.div className="accentColorLoading" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="accentColorLoadingSpinner" />
          </motion.div>
        )}
      </div>
    </div>
  )
}
