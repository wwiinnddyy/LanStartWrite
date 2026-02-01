export const TOOLBAR_STATE_KEY = 'toolbar-state'

export const UI_STATE_APP_WINDOW_ID = 'app'
export const APPEARANCE_UI_STATE_KEY = 'appearance'
export const APPEARANCE_KV_KEY = 'app-appearance'

export type AppMode = 'toolbar' | 'whiteboard'
export const APP_MODE_UI_STATE_KEY = 'mode'
export const APP_MODE_KV_KEY = 'app-mode'

export type Appearance = 'light' | 'dark'

export type WritingFramework = 'konva' | 'qt'
export const WRITING_FRAMEWORK_UI_STATE_KEY = 'writingFramework'
export const WRITING_FRAMEWORK_KV_KEY = 'writing-framework'

export type ActiveApp = 'unknown' | 'word' | 'ppt'
export const ACTIVE_APP_UI_STATE_KEY = 'activeApp'
export const PPT_FULLSCREEN_UI_STATE_KEY = 'pptFullscreen'

export type EffectiveWritingBackend = 'konva' | 'qt' | 'word' | 'ppt'
export const EFFECTIVE_WRITING_BACKEND_UI_STATE_KEY = 'effectiveWritingBackend'

export function isAppearance(v: unknown): v is Appearance {
  return v === 'light' || v === 'dark'
}

export function isAppMode(v: unknown): v is AppMode {
  return v === 'toolbar' || v === 'whiteboard'
}

export function isWritingFramework(v: unknown): v is WritingFramework {
  return v === 'konva' || v === 'qt'
}

export function isActiveApp(v: unknown): v is ActiveApp {
  return v === 'unknown' || v === 'word' || v === 'ppt'
}

export function isEffectiveWritingBackend(v: unknown): v is EffectiveWritingBackend {
  return v === 'konva' || v === 'qt' || v === 'word' || v === 'ppt'
}
