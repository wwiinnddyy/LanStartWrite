const ROUTE_WINDOWS = [
  'floating-toolbar',
  'floating-toolbar-handle',
  'toolbar-subwindow',
  'toolbar-notice',
  'watcher',
  'settings-window',
  'child',
  'paint-board',
  'mut-page',
  'mut-page-handle',
  'mut-page-thumbnails-menu',
  'lanstart-bar'
] as const

export type RouteWindowId = (typeof ROUTE_WINDOWS)[number]

export const TOOLBAR_SUBWINDOW_KINDS = ['events', 'clock', 'feature-panel', 'notes', 'settings', 'pen', 'eraser'] as const
export type ToolbarSubwindowKind = (typeof TOOLBAR_SUBWINDOW_KINDS)[number]

export const PAINT_BOARD_KINDS = ['annotation', 'video-show', 'pdf'] as const
export type PaintBoardKind = (typeof PAINT_BOARD_KINDS)[number]

export function isRouteWindowId(value: string): value is RouteWindowId {
  return (ROUTE_WINDOWS as readonly string[]).includes(value)
}

export function normalizeRouteWindowId(input: string): string {
  const raw = String(input ?? '').trim()
  if (!raw) return 'floating-toolbar'
  if (isRouteWindowId(raw)) return raw
  return raw
}

export function buildViewsWindowPath(windowId: string, kind?: string): string {
  const routeWindowId = normalizeRouteWindowId(windowId)
  const kindSegment = typeof kind === 'string' && kind.trim() ? `/${encodeURIComponent(kind.trim())}` : ''
  return `window/${encodeURIComponent(routeWindowId)}${kindSegment}/index.html`
}

export function buildViewsWindowUrl(windowId: string, kind?: string): string {
  return `views://mainview/${buildViewsWindowPath(windowId, kind)}`
}

export function buildDevWindowUrl(baseUrl: string, windowId: string, kind?: string): string {
  const params = new URLSearchParams()
  params.set('window', normalizeRouteWindowId(windowId))
  if (typeof kind === 'string' && kind.trim()) params.set('kind', kind.trim())
  const query = params.toString()
  return `${baseUrl.replace(/\/+$/, '')}/?${query}`
}

export function parsePathWindowParams(pathname: string): { windowId?: string; kind?: string } {
  const normalized = String(pathname ?? '')
  const segments = normalized.split('/').filter(Boolean)
  const windowIndex = segments.indexOf('window')
  if (windowIndex < 0) return {}
  const windowId = decodeURIComponent(segments[windowIndex + 1] ?? '').trim()
  const rawKind = segments[windowIndex + 2] ? decodeURIComponent(segments[windowIndex + 2]).trim() : undefined
  const kind = rawKind === 'index.html' ? undefined : rawKind
  if (!windowId) return {}
  return { windowId, kind: kind || undefined }
}
