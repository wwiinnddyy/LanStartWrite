export { SettingsWindow } from './SettingsWindow'
export { SettingsSidebar } from './components/SettingsSidebar'
export { SettingsContent } from './components/SettingsContent'
export { AccentColorPicker, PRESET_ACCENT_COLORS, SYSTEM_ACCENT_COLOR } from './components/AccentColorPicker'
export { TransitionSettings, TRANSITION_PRESETS, BACKGROUND_TRANSITIONS } from './components/TransitionSettings'
export { useAppearanceSettings } from './hooks/useAppearanceSettings'
export type { SettingsTab } from './types'
export type { AccentColor } from './components/AccentColorPicker'
export type { TransitionPreset, BackgroundTransition } from './components/TransitionSettings'

// Re-export MonetColor type from hyper_glass for convenience
export type { MonetColor } from '../hyper_glass'
