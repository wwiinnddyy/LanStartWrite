export const TOOLBAR_STATE_KEY = 'toolbar-state'
export const TOOLBAR_STATE_UI_STATE_KEY = 'toolbarStateRev'

export const UI_STATE_APP_WINDOW_ID = 'app'
export const APPEARANCE_UI_STATE_KEY = 'appearance'
export const APPEARANCE_KV_KEY = 'app-appearance'

export type AppMode = 'toolbar' | 'whiteboard' | 'video-show'
export const APP_MODE_UI_STATE_KEY = 'mode'
export const APP_MODE_KV_KEY = 'app-mode'

export type Appearance = 'light' | 'dark'

export type WritingFramework = 'konva' | 'qt' | 'leafer'
export const WRITING_FRAMEWORK_UI_STATE_KEY = 'writingFramework'
export const WRITING_FRAMEWORK_KV_KEY = 'writing-framework'

export type ActiveApp = 'unknown' | 'word' | 'ppt'
export const ACTIVE_APP_UI_STATE_KEY = 'activeApp'
export const PPT_FULLSCREEN_UI_STATE_KEY = 'pptFullscreen'

export type EffectiveWritingBackend = 'konva' | 'qt' | 'leafer' | 'word' | 'ppt'
export const EFFECTIVE_WRITING_BACKEND_UI_STATE_KEY = 'effectiveWritingBackend'

export const TOOL_UI_STATE_KEY = 'tool'

export type PenType = 'writing' | 'highlighter' | 'laser'
export const PEN_TYPE_UI_STATE_KEY = 'penType'
export const PEN_COLOR_UI_STATE_KEY = 'penColor'
export const PEN_THICKNESS_UI_STATE_KEY = 'penThickness'

export const PEN_SETTINGS_KV_KEY = 'pen-settings'
export type PenSettings = { type: PenType; color: string; thickness: number }

export type EraserType = 'pixel' | 'stroke'
export const ERASER_TYPE_UI_STATE_KEY = 'eraserType'
export const ERASER_THICKNESS_UI_STATE_KEY = 'eraserThickness'

export const ERASER_SETTINGS_KV_KEY = 'eraser-settings'
export type EraserSettings = { type: EraserType; thickness: number }

export const CLEAR_PAGE_REV_UI_STATE_KEY = 'clearPageRev'
export const UNDO_REV_UI_STATE_KEY = 'undoRev'
export const REDO_REV_UI_STATE_KEY = 'redoRev'

export const NOTES_PAGE_INDEX_UI_STATE_KEY = 'notesPageIndex'
export const NOTES_PAGE_TOTAL_UI_STATE_KEY = 'notesPageTotal'

export const NOTES_RELOAD_REV_UI_STATE_KEY = 'notesReloadRev'

export const WHITEBOARD_BG_COLOR_KV_KEY = 'whiteboard-bg-color'
export const WHITEBOARD_BG_COLOR_UI_STATE_KEY = 'whiteboardBgColor'

export const WHITEBOARD_BG_IMAGE_URL_KV_KEY = 'whiteboard-bg-image-url'
export const WHITEBOARD_BG_IMAGE_URL_UI_STATE_KEY = 'whiteboardBgImageUrl'

export const WHITEBOARD_BG_IMAGE_OPACITY_KV_KEY = 'whiteboard-bg-image-opacity'
export const WHITEBOARD_BG_IMAGE_OPACITY_UI_STATE_KEY = 'whiteboardBgImageOpacity'

export const WHITEBOARD_CANVAS_PAGES_KV_KEY = 'whiteboard-canvas-pages'

export const NOTICE_KIND_UI_STATE_KEY = 'noticeKind'

export type LeaferRendererEngine = 'canvas2d' | 'svg' | 'webgl' | 'webgpu'
export type LeaferNibMode = 'off' | 'dynamic' | 'static'
export type LeaferSettings = {
  multiTouch: boolean
  inkSmoothing: boolean
  showInkWhenPassthrough: boolean
  freezeScreen: boolean
  rendererEngine?: LeaferRendererEngine
  nibMode?: LeaferNibMode
  postBakeOptimize?: boolean
  postBakeOptimizeOnce?: boolean
}

export const LEAFER_SETTINGS_KV_KEY = 'leafer-settings'
export const LEAFER_SETTINGS_UI_STATE_KEY = 'leaferSettingsRev'

export function isAppearance(v: unknown): v is Appearance {
  return v === 'light' || v === 'dark'
}

export function isAppMode(v: unknown): v is AppMode {
  return v === 'toolbar' || v === 'whiteboard' || v === 'video-show'
}

export function isWritingFramework(v: unknown): v is WritingFramework {
  return v === 'konva' || v === 'qt' || v === 'leafer'
}

export function isActiveApp(v: unknown): v is ActiveApp {
  return v === 'unknown' || v === 'word' || v === 'ppt'
}

export function isEffectiveWritingBackend(v: unknown): v is EffectiveWritingBackend {
  return v === 'konva' || v === 'qt' || v === 'leafer' || v === 'word' || v === 'ppt'
}

export function isLeaferSettings(v: unknown): v is LeaferSettings {
  if (!v || typeof v !== 'object') return false
  const s = v as any
  if (s.rendererEngine !== undefined && s.rendererEngine !== 'canvas2d' && s.rendererEngine !== 'svg' && s.rendererEngine !== 'webgl' && s.rendererEngine !== 'webgpu') return false
  if (s.nibMode !== undefined && s.nibMode !== 'off' && s.nibMode !== 'dynamic' && s.nibMode !== 'static') return false
  if (s.postBakeOptimize !== undefined && typeof s.postBakeOptimize !== 'boolean') return false
  if (s.postBakeOptimizeOnce !== undefined && typeof s.postBakeOptimizeOnce !== 'boolean') return false
  return (
    typeof s.multiTouch === 'boolean' &&
    typeof s.inkSmoothing === 'boolean' &&
    typeof s.showInkWhenPassthrough === 'boolean' &&
    typeof s.freezeScreen === 'boolean'
  )
}

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)
}

export function isFileOrDataUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false
  if (!v) return true
  return v.startsWith('file:') || v.startsWith('data:')
}

export function isPenSettings(v: unknown): v is PenSettings {
  if (!v || typeof v !== 'object') return false
  const s = v as any
  if (s.type !== 'writing' && s.type !== 'highlighter' && s.type !== 'laser') return false
  if (typeof s.color !== 'string') return false
  if (typeof s.thickness !== 'number' || !Number.isFinite(s.thickness)) return false
  return true
}

export function isEraserSettings(v: unknown): v is EraserSettings {
  if (!v || typeof v !== 'object') return false
  const s = v as any
  if (s.type !== 'pixel' && s.type !== 'stroke') return false
  if (typeof s.thickness !== 'number' || !Number.isFinite(s.thickness)) return false
  return true
}
