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
const NATIVE_MICA_KEY = 'native-mica-enabled'
const LEGACY_WINDOW_IMPL_KEY = 'legacy-window-implementation'
const WINDOW_BG_MODE_KEY = 'window-background-mode'

// 默认强调色
const DEFAULT_ACCENT_COLOR = PRESET_ACCENT_COLORS[0] // 蓝色

// 默认过渡设置
const DEFAULT_TRANSITION_PRESET = TRANSITION_PRESETS[0] // 流畅
const DEFAULT_BACKGROUND_TRANSITION = BACKGROUND_TRANSITIONS[0] // 标准
export type WindowBackgroundMode = 'opaque' | 'blur' | 'transparent'

const DEFAULT_WINDOW_BG_MODE: WindowBackgroundMode = 'blur'

export type AppearanceSettings = {
  // 强调色
  accentColor: AccentColor
  setAccentColor: (color: AccentColor) => void

  nativeMicaEnabled: boolean
  setNativeMicaEnabled: (enabled: boolean) => void

  legacyWindowImplementation: boolean
  setLegacyWindowImplementation: (enabled: boolean) => void

  windowBackgroundMode: WindowBackgroundMode
  setWindowBackgroundMode: (mode: WindowBackgroundMode) => void
  
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
  
  // 强调色状态
  const [accentColorValue, setAccentColorValue] = useState<string>(DEFAULT_ACCENT_COLOR.value)

  const [nativeMicaEnabledValue, setNativeMicaEnabledValue] = useState<boolean>(false)
  const [legacyWindowImplementationValue, setLegacyWindowImplementationValue] = useState<boolean>(false)
  const [windowBackgroundModeValue, setWindowBackgroundModeValue] = useState<WindowBackgroundMode>(DEFAULT_WINDOW_BG_MODE)
  
  // 过渡设置状态
  const [transitionPresetValue, setTransitionPresetValue] = useState<string>(DEFAULT_TRANSITION_PRESET.value)
  const [backgroundTransitionValue, setBackgroundTransitionValue] = useState<string>(DEFAULT_BACKGROUND_TRANSITION.value)
  
  // 加载保存的设置
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

      const savedNativeMica = await safeGet<unknown>(NATIVE_MICA_KEY)
      if (typeof savedNativeMica === 'boolean') setNativeMicaEnabledValue(savedNativeMica)
      else if (savedNativeMica === 'true' || savedNativeMica === 1 || savedNativeMica === '1') setNativeMicaEnabledValue(true)
      else if (savedNativeMica === 'false' || savedNativeMica === 0 || savedNativeMica === '0') setNativeMicaEnabledValue(false)

      const savedLegacyWindowImplementation = await safeGet<unknown>(LEGACY_WINDOW_IMPL_KEY)
      if (typeof savedLegacyWindowImplementation === 'boolean') setLegacyWindowImplementationValue(savedLegacyWindowImplementation)
      else if (
        savedLegacyWindowImplementation === 'true' ||
        savedLegacyWindowImplementation === 1 ||
        savedLegacyWindowImplementation === '1'
      ) {
        setLegacyWindowImplementationValue(true)
      } else if (
        savedLegacyWindowImplementation === 'false' ||
        savedLegacyWindowImplementation === 0 ||
        savedLegacyWindowImplementation === '0'
      ) {
        setLegacyWindowImplementationValue(false)
      }

      const savedWindowBgMode = await safeGet<unknown>(WINDOW_BG_MODE_KEY)
      if (savedWindowBgMode === 'opaque' || savedWindowBgMode === 'blur' || savedWindowBgMode === 'transparent') {
        setWindowBackgroundModeValue(savedWindowBgMode)
      }
      
      const savedTransitionPreset = await safeGet<string>(TRANSITION_PRESET_KEY)
      if (savedTransitionPreset) {
        setTransitionPresetValue(savedTransitionPreset)
      }
      
      const savedBackgroundTransition = await safeGet<string>(BACKGROUND_TRANSITION_KEY)
      if (savedBackgroundTransition) {
        setBackgroundTransitionValue(savedBackgroundTransition)
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

  const setNativeMicaEnabled = useCallback(async (enabled: boolean) => {
    setNativeMicaEnabledValue(enabled)
    try {
      await putKv(NATIVE_MICA_KEY, enabled)
    } catch (e) {
      console.error('[useAppearanceSettings] Failed to save native mica enabled:', e)
    }
  }, [])

  const setLegacyWindowImplementation = useCallback(async (enabled: boolean) => {
    setLegacyWindowImplementationValue(enabled)
    try {
      await putKv(LEGACY_WINDOW_IMPL_KEY, enabled)
    } catch (e) {
      console.error('[useAppearanceSettings] Failed to save legacy window implementation:', e)
    }
  }, [])

  const setWindowBackgroundMode = useCallback(async (mode: WindowBackgroundMode) => {
    setWindowBackgroundModeValue(mode)
    try {
      await putKv(WINDOW_BG_MODE_KEY, mode)
    } catch (e) {
      console.error('[useAppearanceSettings] Failed to save window background mode:', e)
    }
  }, [])

  useEffect(() => {
    if (!legacyWindowImplementationValue && nativeMicaEnabledValue) {
      setNativeMicaEnabled(false)
    }
  }, [legacyWindowImplementationValue, nativeMicaEnabledValue, setNativeMicaEnabled])
  
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
      !nativeMicaEnabledValue && accentColor.value === WALLPAPER_MIX_ACCENT_VALUE ? colors.gradient : 'none'
    )
    
    // 应用过渡CSS变量
    root.style.setProperty('--ls-transition-duration', `${transitionPreset.duration}ms`)
    root.style.setProperty('--ls-transition-easing', transitionPreset.easing)
    root.style.setProperty('--ls-bg-transition-duration', `${backgroundTransition.duration}ms`)
    root.style.setProperty('--ls-bg-blur', `${backgroundTransition.blur}px`)

    if (nativeMicaEnabledValue) root.setAttribute('data-native-mica', 'true')
    else root.removeAttribute('data-native-mica')

    if (legacyWindowImplementationValue) root.setAttribute('data-window-style', 'legacy')
    else root.setAttribute('data-window-style', 'hyperos3')

    if (legacyWindowImplementationValue) root.removeAttribute('data-window-bg')
    else root.setAttribute('data-window-bg', windowBackgroundModeValue)
  }, [
    appearance,
    accentColor,
    transitionPreset,
    backgroundTransition,
    nativeMicaEnabledValue,
    legacyWindowImplementationValue,
    windowBackgroundModeValue,
  ])
  
  // 当设置改变时自动应用
  useEffect(() => {
    applyAppearanceStyles()
  }, [applyAppearanceStyles])
  
  return {
    accentColor,
    setAccentColor,
    nativeMicaEnabled: nativeMicaEnabledValue,
    setNativeMicaEnabled,
    legacyWindowImplementation: legacyWindowImplementationValue,
    setLegacyWindowImplementation,
    windowBackgroundMode: windowBackgroundModeValue,
    setWindowBackgroundMode,
    transitionPreset,
    setTransitionPreset,
    backgroundTransition,
    setBackgroundTransition,
    applyAppearanceStyles,
  }
}
