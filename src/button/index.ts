export { Button, MotionButton, type ButtonProps, type ButtonKind, type MotionButtonProps, type ButtonSize, type ButtonVariant } from './Button'
export { ButtonGroup, type ButtonGroupProps } from './components/ButtonGroup'

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
  ALLOW_FEATURE_PANEL = 'allow-feature-panel',
  TOOLBAR_PRIMARY = 'toolbar-primary',
  TOOLBAR_SECONDARY = 'toolbar-secondary',
  TOOLBAR_DEFAULT_ALLOWED_SECONDARY = 'toolbar-default-allowed-secondary',
  TOOLBAR_DEFAULT_SECONDARY_ORDER = 'toolbar-default-secondary-order'
}

export const TOOLBAR_PRIMARY_BUTTON_IDS = ['mouse', 'pen', 'eraser', 'whiteboard', 'video-show'] as const
export type ToolbarPrimaryButtonId = (typeof TOOLBAR_PRIMARY_BUTTON_IDS)[number]

export const TOOLBAR_SECONDARY_BUTTON_IDS = ['undo', 'redo', 'clock', 'feature-panel', 'events', 'watcher'] as const
export type ToolbarSecondaryButtonId = (typeof TOOLBAR_SECONDARY_BUTTON_IDS)[number]

export const TOOLBAR_DEFAULT_ALLOWED_SECONDARY_BUTTON_IDS = ['undo', 'redo', 'feature-panel'] as const
export const TOOLBAR_DEFAULT_SECONDARY_ORDER = ['undo', 'redo', 'feature-panel'] as const

export type AppButtonDefinition = Readonly<{
  id: AppButtonId
  label: string
  tags: readonly ButtonDisplayTag[]
}>

export const APP_BUTTON_DEFINITIONS: readonly AppButtonDefinition[] = [
  { id: 'mouse', label: '鼠标', tags: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR, ButtonDisplayTag.TOOLBAR_PRIMARY] },
  { id: 'pen', label: '笔', tags: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR, ButtonDisplayTag.TOOLBAR_PRIMARY] },
  { id: 'eraser', label: '橡皮', tags: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR, ButtonDisplayTag.TOOLBAR_PRIMARY] },
  { id: 'whiteboard', label: '白板', tags: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR, ButtonDisplayTag.TOOLBAR_PRIMARY] },
  { id: 'video-show', label: '视频展台', tags: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR, ButtonDisplayTag.TOOLBAR_PRIMARY] },
  { id: 'toggle-expanded', label: '折叠/展开', tags: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR] },
  {
    id: 'undo',
    label: '撤销',
    tags: [
      ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR,
      ButtonDisplayTag.TOOLBAR_SECONDARY,
      ButtonDisplayTag.TOOLBAR_DEFAULT_ALLOWED_SECONDARY,
      ButtonDisplayTag.TOOLBAR_DEFAULT_SECONDARY_ORDER
    ]
  },
  {
    id: 'redo',
    label: '重做',
    tags: [
      ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR,
      ButtonDisplayTag.TOOLBAR_SECONDARY,
      ButtonDisplayTag.TOOLBAR_DEFAULT_ALLOWED_SECONDARY,
      ButtonDisplayTag.TOOLBAR_DEFAULT_SECONDARY_ORDER
    ]
  },
  { id: 'clock', label: '时钟', tags: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR, ButtonDisplayTag.ALLOW_FEATURE_PANEL, ButtonDisplayTag.TOOLBAR_SECONDARY] },
  {
    id: 'feature-panel',
    label: '功能面板',
    tags: [
      ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR,
      ButtonDisplayTag.TOOLBAR_SECONDARY,
      ButtonDisplayTag.TOOLBAR_DEFAULT_ALLOWED_SECONDARY,
      ButtonDisplayTag.TOOLBAR_DEFAULT_SECONDARY_ORDER
    ]
  },
  { id: 'db', label: '数据库', tags: [ButtonDisplayTag.ALLOW_FEATURE_PANEL] },
  { id: 'events', label: '事件', tags: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR, ButtonDisplayTag.ALLOW_FEATURE_PANEL, ButtonDisplayTag.TOOLBAR_SECONDARY] },
  { id: 'watcher', label: '监视器', tags: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR, ButtonDisplayTag.ALLOW_FEATURE_PANEL, ButtonDisplayTag.TOOLBAR_SECONDARY] },
  { id: 'pin', label: '置顶', tags: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR, ButtonDisplayTag.ALLOW_FEATURE_PANEL] },
  { id: 'settings', label: '设置', tags: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR, ButtonDisplayTag.ALLOW_FEATURE_PANEL] },
  { id: 'quit', label: '退出', tags: [ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR, ButtonDisplayTag.ALLOW_FEATURE_PANEL] }
]

export const APP_BUTTON_DISPLAY_TAGS: Record<AppButtonId, readonly ButtonDisplayTag[]> = Object.fromEntries(
  APP_BUTTON_DEFINITIONS.map((d) => [d.id, d.tags])
) as any

export function getAppButtonVisibility(id: AppButtonId) {
  const tags = APP_BUTTON_DISPLAY_TAGS[id] ?? []
  return {
    showInToolbar: tags.includes(ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR),
    showInFeaturePanel: tags.includes(ButtonDisplayTag.ALLOW_FEATURE_PANEL)
  }
}

export function getAppButtonLabel(id: AppButtonId): string {
  const def = APP_BUTTON_DEFINITIONS.find((d) => d.id === id)
  return def?.label ?? String(id)
}

export function isToolbarPrimaryButtonId(value: unknown): value is ToolbarPrimaryButtonId {
  return typeof value === 'string' && (TOOLBAR_PRIMARY_BUTTON_IDS as readonly string[]).includes(value)
}

export function isToolbarSecondaryButtonId(value: unknown): value is ToolbarSecondaryButtonId {
  return typeof value === 'string' && (TOOLBAR_SECONDARY_BUTTON_IDS as readonly string[]).includes(value)
}

export function getToolbarPrimaryButtonIds(): ToolbarPrimaryButtonId[] {
  const out: ToolbarPrimaryButtonId[] = []
  for (const def of APP_BUTTON_DEFINITIONS) {
    if (!def.tags.includes(ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR)) continue
    if (!def.tags.includes(ButtonDisplayTag.TOOLBAR_PRIMARY)) continue
    if (!isToolbarPrimaryButtonId(def.id)) continue
    out.push(def.id)
  }
  return out
}

export function getToolbarSecondaryButtonIds(): ToolbarSecondaryButtonId[] {
  const out: ToolbarSecondaryButtonId[] = []
  for (const def of APP_BUTTON_DEFINITIONS) {
    if (!def.tags.includes(ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR)) continue
    if (!def.tags.includes(ButtonDisplayTag.TOOLBAR_SECONDARY)) continue
    if (!isToolbarSecondaryButtonId(def.id)) continue
    out.push(def.id)
  }
  return out
}

export function getToolbarDefaultAllowedSecondaryButtonIds(): ToolbarSecondaryButtonId[] {
  const out: ToolbarSecondaryButtonId[] = []
  for (const def of APP_BUTTON_DEFINITIONS) {
    if (!def.tags.includes(ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR)) continue
    if (!def.tags.includes(ButtonDisplayTag.TOOLBAR_SECONDARY)) continue
    if (!def.tags.includes(ButtonDisplayTag.TOOLBAR_DEFAULT_ALLOWED_SECONDARY)) continue
    if (!isToolbarSecondaryButtonId(def.id)) continue
    out.push(def.id)
  }
  return out
}

export function getToolbarDefaultSecondaryOrder(): ToolbarSecondaryButtonId[] {
  const out: ToolbarSecondaryButtonId[] = []
  for (const def of APP_BUTTON_DEFINITIONS) {
    if (!def.tags.includes(ButtonDisplayTag.ALLOW_FLOATING_TOOLBAR)) continue
    if (!def.tags.includes(ButtonDisplayTag.TOOLBAR_SECONDARY)) continue
    if (!def.tags.includes(ButtonDisplayTag.TOOLBAR_DEFAULT_SECONDARY_ORDER)) continue
    if (!isToolbarSecondaryButtonId(def.id)) continue
    out.push(def.id)
  }
  return out
}

