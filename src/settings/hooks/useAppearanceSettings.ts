import { useCallback, useEffect, useState } from 'react'
import { useAppAppearance } from '../../status'
import { getKv, putKv } from '../../toolbar/hooks/useBackend'
import { useWallpaperMonetColors } from '../../hyper_glass'
import type { AccentColor } from '../components/AccentColorPicker'
import { PRESET_ACCENT_COLORS, WALLPAPER_MIX_ACCENT_VALUE, buildWallpaperMixAccentColor } from '../components/AccentColorPicker'
import type { TransitionPreset, BackgroundTransition } from '../components/TransitionSettings'
import { TRANSITION_PRESETS, BACKGROUND_TRANSITIONS } from '../components/TransitionSettings'

// 存储键名
const ACCENT_COLOR_LIGHT_KEY = 'accent-color-light'
const ACCENT_COLOR_DARK_KEY = 'accent-color-dark'
const TRANSITION_PRESET_KEY = 'transition-preset'
const BACKGROUND_TRANSITION_KEY = 'background-transition'
const TOOLBAR_BUTTON_HINTS_KEY = 'toolbar-button-hints'

// 默认强调�?
const DEFAULT_ACCENT_COLOR = PRESET_ACCENT_COLORS[0] // 蓝色

// 默认过渡设置
const DEFAULT_TRANSITION_PRESET = TRANSITION_PRESETS[0] // 流畅
const DEFAULT_BACKGROUND_TRANSITION = BACKGROUND_TRANSITIONS[0] // 标准

export type AppearanceSettings = {
  // 强调�?
  accentColor: AccentColor
  setAccentColor: (color: AccentColor) => void

  toolbarButtonHintsEnabled: boolean
  setToolbarButtonHintsEnabled: (enabled: boolean) => void
  
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
  const { monetColors } = useWallpaperMonetColors()
  
  // 根据当前主题获取对应的存储键
  const accentColorKey = appearance === 'dark' ? ACCENT_COLOR_DARK_KEY : ACCENT_COLOR_LIGHT_KEY
  
  // 强调色状�?
  const [accentColorValue, setAccentColorValue] = useState<string>(DEFAULT_ACCENT_COLOR.value)

  const [toolbarButtonHintsEnabledValue, setToolbarButtonHintsEnabledValue] = useState<boolean>(false)
  
  // 过渡设置状�?
  const [transitionPresetValue, setTransitionPresetValue] = useState<string>(DEFAULT_TRANSITION_PRESET.value)
  const [backgroundTransitionValue, setBackgroundTransitionValue] = useState<string>(DEFAULT_BACKGROUND_TRANSITION.value)
  
  // 加载保存的设�?
  useEffect(() => {
    const loadSettings = async () => {
      const safeGet = async <T,>(key: string): Promise<T | undefined> => {
        try {
          return await getKv<T>(key)
        } catch {
          return undefined
        }
      }

      const savedAccentColor = await safeGet<string>(accentColorKey)
      if (savedAccentColor) {
        setAccentColorValue(savedAccentColor === 'system-monet' ? WALLPAPER_MIX_ACCENT_VALUE : savedAccentColor)
      }

      const savedTransitionPreset = await safeGet<string>(TRANSITION_PRESET_KEY)
      if (savedTransitionPreset) {
        setTransitionPresetValue(savedTransitionPreset)
      }
      
      const savedBackgroundTransition = await safeGet<string>(BACKGROUND_TRANSITION_KEY)
      if (savedBackgroundTransition) {
        setBackgroundTransitionValue(savedBackgroundTransition)
      }

      const savedToolbarButtonHintsEnabled = await safeGet<unknown>(TOOLBAR_BUTTON_HINTS_KEY)
      if (typeof savedToolbarButtonHintsEnabled === 'boolean') setToolbarButtonHintsEnabledValue(savedToolbarButtonHintsEnabled)
      else if (
        savedToolbarButtonHintsEnabled === 'true' ||
        savedToolbarButtonHintsEnabled === 1 ||
        savedToolbarButtonHintsEnabled === '1'
      ) {
        setToolbarButtonHintsEnabledValue(true)
      } else if (
        savedToolbarButtonHintsEnabled === 'false' ||
        savedToolbarButtonHintsEnabled === 0 ||
        savedToolbarButtonHintsEnabled === '0'
      ) {
        setToolbarButtonHintsEnabledValue(false)
      }
    }
    
    loadSettings()
  }, [accentColorKey])
  
  const wallpaperMixAccentColor = buildWallpaperMixAccentColor(monetColors)

  const dynamicAccentColors: AccentColor[] = monetColors.map((m) => ({
    name: m.name,
    value: m.value,
    light: m.light,
    dark: m.dark,
  }))

  const allAccentColors: AccentColor[] = [
    ...PRESET_ACCENT_COLORS,
    ...(wallpaperMixAccentColor ? [wallpaperMixAccentColor] : []),
    ...dynamicAccentColors,
  ]

  // 获取完整的强调色对象
  const accentColor = allAccentColors.find(c => c.value === accentColorValue) || DEFAULT_ACCENT_COLOR
  
  // 获取完整的过渡预设对�?
  const transitionPreset = TRANSITION_PRESETS.find(p => p.value === transitionPresetValue) || DEFAULT_TRANSITION_PRESET
  
  // 获取完整的背景过渡对�?
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

  const setToolbarButtonHintsEnabled = useCallback(async (enabled: boolean) => {
    setToolbarButtonHintsEnabledValue(enabled)
    try {
      await putKv(TOOLBAR_BUTTON_HINTS_KEY, enabled)
    } catch (e) {
      console.error('[useAppearanceSettings] Failed to save toolbar button hints enabled:', e)
    }
  }, [])
  
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
    root.style.setProperty(
      '--ls-window-accent-gradient',
      accentColor.value === WALLPAPER_MIX_ACCENT_VALUE ? colors.gradient : 'none'
    )
    
    // 应用过渡CSS变量
    root.style.setProperty('--ls-transition-duration', `${transitionPreset.duration}ms`)
    root.style.setProperty('--ls-transition-easing', transitionPreset.easing)
    root.style.setProperty('--ls-bg-transition-duration', `${backgroundTransition.duration}ms`)
    root.style.setProperty('--ls-bg-blur', `${backgroundTransition.blur}px`)

    if (toolbarButtonHintsEnabledValue) root.setAttribute('data-toolbar-button-hints', 'true')
    else root.removeAttribute('data-toolbar-button-hints')
  }, [
    appearance,
    accentColor,
    transitionPreset,
    backgroundTransition,
    toolbarButtonHintsEnabledValue,
  ])
  
  // 当设置改变时自动应用
  useEffect(() => {
    applyAppearanceStyles()
  }, [applyAppearanceStyles])
  
  return {
    accentColor,
    setAccentColor,
    toolbarButtonHintsEnabled: toolbarButtonHintsEnabledValue,
    setToolbarButtonHintsEnabled,
    transitionPreset,
    setTransitionPreset,
    backgroundTransition,
    setBackgroundTransition,
    applyAppearanceStyles,
  }
}
