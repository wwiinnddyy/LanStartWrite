export const WINDOW_ID_FLOATING_TOOLBAR = '浮动工具栏'
export const WINDOW_ID_FLOATING_TOOLBAR_HANDLE = 'floating-toolbar-handle'
export const WINDOW_TITLE_FLOATING_TOOLBAR = '浮动工具栏'
export const BACKEND_URL = 'http://127.0.0.1:3131'
export { TOOLBAR_STATE_KEY, UI_STATE_APP_WINDOW_ID, APPEARANCE_UI_STATE_KEY, APPEARANCE_KV_KEY } from '../../status'

export type AppButtonId =
  | 'mouse'
  | 'pen'
  | 'eraser'
  | 'whiteboard'
  | 'video-show'
  | 'toggle-expanded'
  | 'undo'
  | 'redo'
  | 'clock'
  | 'feature-panel'
  | 'db'
  | 'events'
  | 'watcher'
  | 'pin'
  | 'settings'
  | 'quit'

export enum ButtonDisplayTag {
  ALLOW_FLOATING_TOOLBAR = 'allow-floating-toolbar',
  ALLOW_FEATURE_PANEL = 'allow-feature-panel'
}

export const APP_BUTTON_DISPLAY_TAGS: Record<AppButtonId, readonly ButtonDisplayTag[]> = {
  mouse: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR],
  pen: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR],
  eraser: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR],
  whiteboard: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR],
  'video-show': [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR],
  'toggle-expanded': [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR],
  undo: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR],
  redo: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR],
  clock: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR, ButtonDisplayTag.ALLOW_FEATURE_PANEL],
  'feature-panel': [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR],
  db: [ButtonDisplayTag.ALLOW_FEATURE_PANEL],
  events: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR, ButtonDisplayTag.ALLOW_FEATURE_PANEL],
  watcher: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR, ButtonDisplayTag.ALLOW_FEATURE_PANEL],
  pin: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR, ButtonDisplayTag.ALLOW_FEATURE_PANEL],
  settings: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR, ButtonDisplayTag.ALLOW_FEATURE_PANEL],
  quit: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR, ButtonDisplayTag.ALLOW_FEATURE_PANEL]
}

export function getAppButtonVisibility(id: AppButtonId) {
  const tags = APP_BUTTON_DISPLAY_TAGS[id]
  return {
    showInToolbar: tags.includes(ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR),
    showInFeaturePanel: tags.includes(ButtonDisplayTag.ALLOW_FEATURE_PANEL)
  }
}
