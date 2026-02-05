import { useCallback, useEffect, useState } from 'react'
import { useAppAppearance } from '../../status'
import { getKv, putKv } from '../../toolbar/hooks/useBackend'
import type { AccentColor } from '../components/AccentColorPicker'
import { PRESET_ACCENT_COLORS, SYSTEM_ACCENT_COLOR } from '../components/AccentColorPicker'
import type { TransitionPreset, BackgroundTransition } from '../components/TransitionSettings'
import { TRANSITION_PRESETS, BACKGROUND_TRANSITIONS } from '../components/TransitionSettings'

// 存储键名
const ACCENT_COLOR_LIGHT_KEY = 'accent-color-light'
const ACCENT_COLOR_DARK_KEY = 'accent-color-dark'
const TRANSITION_PRESET_KEY = 'transition-preset'
const BACKGROUND_TRANSITION_KEY = 'background-transition'

// 默认强调色
const DEFAULT_ACCENT_COLOR = PRESET_ACCENT_COLORS[0] // 蓝色

// 所有可用的强调色（预设 + 系统取色）
const ALL_ACCENT_COLORS: AccentColor[] = [
  SYSTEM_ACCENT_COLOR,
  ...PRESET_ACCENT_COLORS,
]

// 默认过渡设置
const DEFAULT_TRANSITION_PRESET = TRANSITION_PRESETS[0] // 流畅
const DEFAULT_BACKGROUND_TRANSITION = BACKGROUND_TRANSITIONS[0] // 标准

export type AppearanceSettings = {
  // 强调色
  accentColor: AccentColor
  setAccentColor: (color: AccentColor) => void
  
  // 过渡设置
  transitionPreset: TransitionPreset
  setTransitionPreset: (preset: TransitionPreset) => void
  backgroundTransition: BackgroundTransition
  setBackgroundTransition: (transition: BackgroundTransition) => void
  
  // 应用CSS变量
  applyAppearanceStyles: () => void
}

export function useAppearanceSettings(): AppearanceSettings {
  const { appearance } = useAppAppearance()
  
  // 根据当前主题获取对应的存储键
  const accentColorKey = appearance === 'dark' ? ACCENT_COLOR_DARK_KEY : ACCENT_COLOR_LIGHT_KEY
  
  // 强调色状态
  const [accentColorValue, setAccentColorValue] = useState<string>(DEFAULT_ACCENT_COLOR.value)
  
  // 过渡设置状态
  const [transitionPresetValue, setTransitionPresetValue] = useState<string>(DEFAULT_TRANSITION_PRESET.value)
  const [backgroundTransitionValue, setBackgroundTransitionValue] = useState<string>(DEFAULT_BACKGROUND_TRANSITION.value)
  
  // 加载保存的设置
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // 加载强调色（根据当前主题）
        const savedAccentColor = await getKv<string>(accentColorKey)
        if (savedAccentColor) {
          setAccentColorValue(savedAccentColor)
        }
        
        // 加载过渡设置（全局共享）
        const savedTransitionPreset = await getKv<string>(TRANSITION_PRESET_KEY)
        if (savedTransitionPreset) {
          setTransitionPresetValue(savedTransitionPreset)
        }
        
        const savedBackgroundTransition = await getKv<string>(BACKGROUND_TRANSITION_KEY)
        if (savedBackgroundTransition) {
          setBackgroundTransitionValue(savedBackgroundTransition)
        }
      } catch (e) {
        console.error('[useAppearanceSettings] Failed to load settings:', e)
      }
    }
    
    loadSettings()
  }, [accentColorKey])
  
  // 获取完整的强调色对象
  const accentColor = ALL_ACCENT_COLORS.find(c => c.value === accentColorValue) || DEFAULT_ACCENT_COLOR
  
  // 获取完整的过渡预设对象
  const transitionPreset = TRANSITION_PRESETS.find(p => p.value === transitionPresetValue) || DEFAULT_TRANSITION_PRESET
  
  // 获取完整的背景过渡对象
  const backgroundTransition = BACKGROUND_TRANSITIONS.find(t => t.value === backgroundTransitionValue) || DEFAULT_BACKGROUND_TRANSITION
  
  // 设置强调色（根据当前主题保存到不同的键）
  const setAccentColor = useCallback(async (color: AccentColor) => {
    setAccentColorValue(color.value)
    try {
      await putKv(accentColorKey, color.value)
    } catch (e) {
      console.error('[useAppearanceSettings] Failed to save accent color:', e)
    }
  }, [accentColorKey])
  
  // 设置过渡预设
  const setTransitionPreset = useCallback(async (preset: TransitionPreset) => {
    setTransitionPresetValue(preset.value)
    try {
      await putKv(TRANSITION_PRESET_KEY, preset.value)
    } catch (e) {
      console.error('[useAppearanceSettings] Failed to save transition preset:', e)
    }
  }, [])
  
  // 设置背景过渡
  const setBackgroundTransition = useCallback(async (transition: BackgroundTransition) => {
    setBackgroundTransitionValue(transition.value)
    try {
      await putKv(BACKGROUND_TRANSITION_KEY, transition.value)
    } catch (e) {
      console.error('[useAppearanceSettings] Failed to save background transition:', e)
    }
  }, [])
  
  // 应用CSS变量
  const applyAppearanceStyles = useCallback(() => {
    const root = document.documentElement
    const colors = appearance === 'dark' ? accentColor.dark : accentColor.light
    
    // 应用强调色CSS变量
    root.style.setProperty('--ls-accent-primary', colors.primary)
    root.style.setProperty('--ls-accent-hover', colors.primaryHover)
    root.style.setProperty('--ls-accent-active', colors.primaryActive)
    root.style.setProperty('--ls-accent-light', colors.primaryLight)
    root.style.setProperty('--ls-accent-gradient', colors.gradient)
    
    // 应用过渡CSS变量
    root.style.setProperty('--ls-transition-duration', `${transitionPreset.duration}ms`)
    root.style.setProperty('--ls-transition-easing', transitionPreset.easing)
    root.style.setProperty('--ls-bg-transition-duration', `${backgroundTransition.duration}ms`)
    root.style.setProperty('--ls-bg-blur', `${backgroundTransition.blur}px`)
  }, [appearance, accentColor, transitionPreset, backgroundTransition])
  
  // 当设置改变时自动应用
  useEffect(() => {
    applyAppearanceStyles()
  }, [applyAppearanceStyles])
  
  return {
    accentColor,
    setAccentColor,
    transitionPreset,
    setTransitionPreset,
    backgroundTransition,
    setBackgroundTransition,
    applyAppearanceStyles,
  }
}
