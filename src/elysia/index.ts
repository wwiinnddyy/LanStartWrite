import { Elysia, t } from 'elysia'
import { node } from '@elysiajs/node'
import { createInterface } from 'node:readline'
import { deleteByPrefix, deleteValue, getValue, openLeavelDb, putValue } from '../LeavelDB'
import {
  ACTIVE_APP_UI_STATE_KEY,
  APP_MODE_UI_STATE_KEY,
  CLEAR_PAGE_REV_UI_STATE_KEY,
  EFFECTIVE_WRITING_BACKEND_UI_STATE_KEY,
  ERASER_THICKNESS_UI_STATE_KEY,
  ERASER_TYPE_UI_STATE_KEY,
  NOTES_PAGE_INDEX_UI_STATE_KEY,
  NOTES_PAGE_TOTAL_UI_STATE_KEY,
  PEN_COLOR_UI_STATE_KEY,
  PEN_THICKNESS_UI_STATE_KEY,
  PEN_TYPE_UI_STATE_KEY,
  PPT_FULLSCREEN_UI_STATE_KEY,
  REDO_REV_UI_STATE_KEY,
  UI_STATE_APP_WINDOW_ID,
  UNDO_REV_UI_STATE_KEY,
  WHITEBOARD_BG_COLOR_KV_KEY,
  WHITEBOARD_BG_COLOR_UI_STATE_KEY,
  WHITEBOARD_BG_IMAGE_URL_KV_KEY,
  WHITEBOARD_BG_IMAGE_URL_UI_STATE_KEY,
  WHITEBOARD_BG_IMAGE_OPACITY_KV_KEY,
  WHITEBOARD_BG_IMAGE_OPACITY_UI_STATE_KEY,
  WHITEBOARD_CANVAS_PAGES_KV_KEY,
  VIDEO_SHOW_CAPTURE_REV_UI_STATE_KEY,
  VIDEO_SHOW_PAGES_KV_KEY,
  WRITING_FRAMEWORK_KV_KEY,
  WRITING_FRAMEWORK_UI_STATE_KEY,
  isActiveApp,
  isAppMode,
  isFileOrDataUrl,
  isHexColor,
  isWritingFramework,
  type ActiveApp,
  type EffectiveWritingBackend,
  type WritingFramework
} from '../status/keys'
import { identifyActiveApp } from '../task_windows_watcher/identify'
import type { ForegroundWindowSample, ProcessSample, TaskWatcherStatus } from '../task_windows_watcher/types'

type EventItem = {
  id: number
  type: string
  payload?: unknown
  ts: number
}

const port = Number(process.env.LANSTART_BACKEND_PORT ?? 3131)
const host = String(process.env.LANSTART_BACKEND_HOST ?? '127.0.0.1')
const dbPath = process.env.LANSTART_DB_PATH ?? './leveldb'
const transport = String(process.env.LANSTART_BACKEND_TRANSPORT ?? 'stdio')
const csBaseUrl = String(process.env.LANSTART_CS_BASE_URL ?? '')

const db = openLeavelDb(dbPath)

let nextEventId = 1
const events: EventItem[] = []
const MAX_EVENTS = 200

function emitEvent(type: string, payload?: unknown): EventItem {
  const item: EventItem = { id: nextEventId++, type, payload, ts: Date.now() }
  events.push(item)
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  requestMain({ type: 'BACKEND_EVENT', event: item })
  return item
}

function requestMain(message: unknown): void {
  process.stdout.write(`__LANSTART__${JSON.stringify(message)}\n`)
}

type WhiteboardCanvasPageV1 = { bgColor: string; bgImageUrl: string; bgImageOpacity: number }
type WhiteboardCanvasBookV1 = { version: 1; pages: WhiteboardCanvasPageV1[] }

function isWhiteboardCanvasBookV1(v: unknown): v is WhiteboardCanvasBookV1 {
  if (!v || typeof v !== 'object') return false
  const b = v as any
  if (b.version !== 1) return false
  if (!Array.isArray(b.pages)) return false
  return true
}

type VideoShowPageV1 = { name: string; imageUrl: string; createdAt: number }
type VideoShowPageBookV1 = { version: 1; pages: VideoShowPageV1[] }

function isVideoShowPageBookV1(v: unknown): v is VideoShowPageBookV1 {
  if (!v || typeof v !== 'object') return false
  const b = v as any
  if (b.version !== 1) return false
  if (!Array.isArray(b.pages)) return false
  return true
}

function toCnInt(v: number): string {
  const n = Math.floor(v)
  if (!Number.isFinite(n) || n <= 0) return ''
  const d = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (n < 10) return d[n]
  if (n === 10) return '十'
  if (n < 20) return `十${d[n - 10]}`
  if (n < 100) {
    const tens = Math.floor(n / 10)
    const ones = n % 10
    return `${d[tens]}十${ones ? d[ones] : ''}`
  }
  return String(n)
}

function videoShowPhotoPageName(pageNo: number): string {
  const cn = toCnInt(pageNo)
  return cn ? `第${cn}页` : `第${Math.max(1, Math.floor(pageNo))}页`
}

async function getDefaultWhiteboardBackground(): Promise<{ bgColor: string; bgImageUrl: string; bgImageOpacity: number }> {
  let bgColor = '#ffffff'
  let bgImageUrl = ''
  let bgImageOpacity = 0.5
  try {
    const v = await getValue(db, WHITEBOARD_BG_COLOR_KV_KEY)
    if (isHexColor(v)) bgColor = v
  } catch {}
  try {
    const v = await getValue(db, WHITEBOARD_BG_IMAGE_URL_KV_KEY)
    if (isFileOrDataUrl(v)) bgImageUrl = v
  } catch {}
  try {
    const v = await getValue(db, WHITEBOARD_BG_IMAGE_OPACITY_KV_KEY)
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
    if (Number.isFinite(n)) bgImageOpacity = Math.max(0, Math.min(1, n))
  } catch {}
  return { bgColor, bgImageUrl, bgImageOpacity }
}

async function getOrInitVideoShowPageBook(args: {
  photoTotal: number
}): Promise<{ book: VideoShowPageBookV1; changed: boolean }> {
  const total = Number.isFinite(args.photoTotal) ? Math.max(0, Math.floor(args.photoTotal)) : 0
  let changed = false
  let book: VideoShowPageBookV1 = { version: 1, pages: [] }
  try {
    const loaded = await getValue(db, VIDEO_SHOW_PAGES_KV_KEY)
    if (isVideoShowPageBookV1(loaded)) book = loaded
  } catch {}

  const rawPages = Array.isArray(book.pages) ? book.pages : null
  if (!rawPages) {
    book = { version: 1, pages: [] }
    changed = true
  } else {
    book = { version: 1, pages: [...rawPages] }
  }

  if (book.pages.length < total) {
    changed = true
    while (book.pages.length < total) book.pages.push({ name: '', imageUrl: '', createdAt: 0 })
  } else if (book.pages.length > total) {
    changed = true
    book.pages.length = total
  }

  return { book, changed }
}

async function ensureVideoShowPageBookPersisted(args: { photoTotal: number }): Promise<VideoShowPageBookV1> {
  const { book, changed } = await getOrInitVideoShowPageBook(args)
  if (changed) {
    await putValue(db, VIDEO_SHOW_PAGES_KV_KEY, book)
    emitEvent('KV_PUT', { key: VIDEO_SHOW_PAGES_KV_KEY })
  }
  return book
}

async function getOrInitWhiteboardCanvasBook(args: {
  total: number
  defaultBg: { bgColor: string; bgImageUrl: string; bgImageOpacity: number }
}): Promise<{ book: WhiteboardCanvasBookV1; changed: boolean }> {
  const total = Number.isFinite(args.total) ? Math.max(1, Math.floor(args.total)) : 1
  let changed = false
  let book: WhiteboardCanvasBookV1 = { version: 1, pages: [] }
  try {
    const loaded = await getValue(db, WHITEBOARD_CANVAS_PAGES_KV_KEY)
    if (isWhiteboardCanvasBookV1(loaded)) book = loaded
  } catch {}

  if (!Array.isArray(book.pages)) {
    book = { version: 1, pages: [] }
    changed = true
  }

  if (book.pages.length < total) {
    changed = true
    while (book.pages.length < total)
      book.pages.push({
        bgColor: args.defaultBg.bgColor,
        bgImageUrl: args.defaultBg.bgImageUrl,
        bgImageOpacity: args.defaultBg.bgImageOpacity
      })
  } else if (book.pages.length > total) {
    changed = true
    book.pages.length = total
  }

  return { book, changed }
}

async function ensureWhiteboardCanvasBookPersisted(args: {
  total: number
  defaultBg: { bgColor: string; bgImageUrl: string; bgImageOpacity: number }
}): Promise<WhiteboardCanvasBookV1> {
  const { book, changed } = await getOrInitWhiteboardCanvasBook(args)
  if (changed) {
    await putValue(db, WHITEBOARD_CANVAS_PAGES_KV_KEY, book)
    emitEvent('KV_PUT', { key: WHITEBOARD_CANVAS_PAGES_KV_KEY })
  }
  return book
}

function coercePageIndexTotal(state: Record<string, any>): { index: number; total: number } {
  const totalRaw = Number(state[NOTES_PAGE_TOTAL_UI_STATE_KEY])
  const total = Number.isFinite(totalRaw) && totalRaw >= 1 ? Math.floor(totalRaw) : 1
  const indexRaw = Number(state[NOTES_PAGE_INDEX_UI_STATE_KEY])
  const index = Number.isFinite(indexRaw) ? Math.floor(indexRaw) : 0
  const bounded = Math.max(0, Math.min(total - 1, index))
  return { index: bounded, total }
}

function ensurePageTotalInState(state: Record<string, any>, total: number): void {
  const totalRaw = Number(state[NOTES_PAGE_TOTAL_UI_STATE_KEY])
  if (Number.isFinite(totalRaw) && totalRaw >= 1) return
  state[NOTES_PAGE_TOTAL_UI_STATE_KEY] = total
  emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: NOTES_PAGE_TOTAL_UI_STATE_KEY, value: total })
}

async function applyWhiteboardBackgroundForPage(args: { state: Record<string, any>; index: number; total: number }): Promise<void> {
  const modeRaw = args.state[APP_MODE_UI_STATE_KEY]
  const mode = isAppMode(modeRaw) ? modeRaw : 'toolbar'
  if (mode !== 'whiteboard') return

  const defaultBg = await getDefaultWhiteboardBackground()
  const book = await ensureWhiteboardCanvasBookPersisted({ total: args.total, defaultBg })
  const raw = (book.pages as any)?.[args.index] as Partial<WhiteboardCanvasPageV1> | undefined
  const page = {
    bgColor: typeof raw?.bgColor === 'string' ? raw.bgColor : defaultBg.bgColor,
    bgImageUrl: isFileOrDataUrl(raw?.bgImageUrl) ? String(raw?.bgImageUrl ?? '') : defaultBg.bgImageUrl,
    bgImageOpacity:
      typeof raw?.bgImageOpacity === 'number' && Number.isFinite(raw.bgImageOpacity)
        ? Math.max(0, Math.min(1, raw.bgImageOpacity))
        : defaultBg.bgImageOpacity
  }

  args.state[WHITEBOARD_BG_COLOR_UI_STATE_KEY] = page.bgColor
  args.state[WHITEBOARD_BG_IMAGE_URL_UI_STATE_KEY] = page.bgImageUrl
  args.state[WHITEBOARD_BG_IMAGE_OPACITY_UI_STATE_KEY] = page.bgImageOpacity
  emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: WHITEBOARD_BG_COLOR_UI_STATE_KEY, value: page.bgColor })
  emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: WHITEBOARD_BG_IMAGE_URL_UI_STATE_KEY, value: page.bgImageUrl })
  emitEvent('UI_STATE_PUT', {
    windowId: UI_STATE_APP_WINDOW_ID,
    key: WHITEBOARD_BG_IMAGE_OPACITY_UI_STATE_KEY,
    value: page.bgImageOpacity
  })
}

let nextMainRpcId = 1
const pendingMainRpc = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
>()

function requestMainRpc<T>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
  const id = nextMainRpcId++
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingMainRpc.delete(id)
      reject(new Error('main_rpc_timeout'))
    }, timeoutMs)
    pendingMainRpc.set(id, { resolve: resolve as any, reject, timer })
    requestMain({ type: 'MAIN_RPC_REQUEST', id, method, params })
  })
}

const uiState = new Map<string, Record<string, unknown>>()
const runtimeWindows = new Map<string, unknown>()
const runtimeProcesses = new Map<string, unknown>()

function getOrInitUiState(windowId: string): Record<string, unknown> {
  const existing = uiState.get(windowId)
  if (existing) return existing
  const created: Record<string, unknown> = {}
  uiState.set(windowId, created)
  return created
}

function cleanupMonitoringData(): void {
  uiState.clear()
  runtimeWindows.clear()
  runtimeProcesses.clear()
  events.splice(0, events.length)
  nextEventId = 1
}

async function cleanupLegacyPersistedMonitoringData(): Promise<void> {
  await deleteByPrefix(db, 'ev:')
  await deleteByPrefix(db, 'ui:state:')
  await deleteByPrefix(db, 'runtime:window:')
  await deleteByPrefix(db, 'runtime:process:')
}

type CommandResult = { ok: true } | { ok: false; error: string }

function coerceString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

type Appearance = 'light' | 'dark'

function coerceAppearance(v: unknown): Appearance | undefined {
  const s = coerceString(v)
  if (s === 'light' || s === 'dark') return s
  return undefined
}

async function getPersistedWritingFramework(): Promise<WritingFramework | undefined> {
  try {
    const value = await getValue(db, WRITING_FRAMEWORK_KV_KEY)
    return isWritingFramework(value) ? value : undefined
  } catch {
    return undefined
  }
}

function resolveEffectiveWritingBackend(input: {
  writingFramework: WritingFramework
  activeApp?: ActiveApp
  pptFullscreen?: boolean
}): EffectiveWritingBackend {
  if (input.activeApp === 'word') return 'word'
  if (input.activeApp === 'ppt' && input.pptFullscreen) return 'ppt'
  return input.writingFramework
}

async function handleCommand(command: string, payload: unknown): Promise<CommandResult> {
  emitEvent('COMMAND', { command, payload })

  const dot = command.indexOf('.')
  if (dot > 0) {
    const scope = command.slice(0, dot)
    const action = command.slice(dot + 1)

    if (scope === 'win') {
      if (action === 'createWindow') {
        requestMain({ type: 'CREATE_WINDOW' })
        return { ok: true }
      }

      if (action === 'setAppMode') {
        const modeRaw = coerceString((payload as any)?.mode)
        const mode = modeRaw === 'whiteboard' ? 'whiteboard' : modeRaw === 'video-show' ? 'video-show' : 'toolbar'
        requestMain({ type: 'SET_APP_MODE', mode })
        return { ok: true }
      }

      if (action === 'setAnnotationInput') {
        const enabled = Boolean((payload as any)?.enabled)
        requestMain({ type: 'SET_ANNOTATION_INPUT', enabled })
        return { ok: true }
      }

      if (action === 'toggleSubwindow') {
        const kind = coerceString((payload as any)?.kind)
        const placementRaw = coerceString((payload as any)?.placement)
        const placement = placementRaw === 'top' ? 'top' : placementRaw === 'bottom' ? 'bottom' : undefined
        if (!kind || !placement) return { ok: false, error: 'BAD_SUBWINDOW' }
        requestMain({ type: 'TOGGLE_SUBWINDOW', kind, placement })
        return { ok: true }
      }

      if (action === 'setSubwindowHeight') {
        const kind = coerceString((payload as any)?.kind)
        const height = Number((payload as any)?.height)
        if (!kind || !Number.isFinite(height)) return { ok: false, error: 'BAD_SUBWINDOW_HEIGHT' }
        requestMain({ type: 'SET_SUBWINDOW_HEIGHT', kind, height })
        return { ok: true }
      }

      if (action === 'setSubwindowBounds') {
        const kind = coerceString((payload as any)?.kind)
        const width = Number((payload as any)?.width)
        const height = Number((payload as any)?.height)
        if (!kind || !Number.isFinite(width) || !Number.isFinite(height)) return { ok: false, error: 'BAD_SUBWINDOW_BOUNDS' }
        requestMain({ type: 'SET_SUBWINDOW_BOUNDS', kind, width, height })
        return { ok: true }
      }

      if (action === 'setToolbarBounds') {
        const width = Number((payload as any)?.width)
        const height = Number((payload as any)?.height)
        if (!Number.isFinite(width) || !Number.isFinite(height)) return { ok: false, error: 'BAD_BOUNDS' }
        requestMain({ type: 'SET_TOOLBAR_BOUNDS', width, height })
        return { ok: true }
      }

      if (action === 'setAppWindowBounds') {
        const windowId = coerceString((payload as any)?.windowId)
        const width = Number((payload as any)?.width)
        const height = Number((payload as any)?.height)
        const x = (payload as any)?.x
        const y = (payload as any)?.y
        const hasWidth = Number.isFinite(width)
        const hasHeight = Number.isFinite(height)
        if (!windowId || (!hasWidth && !hasHeight)) return { ok: false, error: 'BAD_BOUNDS' }
        requestMain({
          type: 'SET_APP_WINDOW_BOUNDS',
          windowId,
          ...(hasWidth ? { width } : {}),
          ...(hasHeight ? { height } : {}),
          ...(Number.isFinite(Number(x)) ? { x: Number(x) } : {}),
          ...(Number.isFinite(Number(y)) ? { y: Number(y) } : {})
        })
        return { ok: true }
      }

      if (action === 'setUiZoom') {
        const zoom = Number((payload as any)?.zoom)
        if (!Number.isFinite(zoom)) return { ok: false, error: 'BAD_ZOOM' }
        requestMain({ type: 'SET_UI_ZOOM', zoom })
        return { ok: true }
      }

      if (action === 'setNoticeVisible') {
        const visible = Boolean((payload as any)?.visible)
        requestMain({ type: 'SET_NOTICE_VISIBLE', visible })
        return { ok: true }
      }

      if (action === 'quit') {
        requestMain({ type: 'QUIT_APP' })
        return { ok: true }
      }

      return { ok: false, error: 'UNKNOWN_COMMAND' }
    }

    if (scope === 'app') {
      if (action === 'setTool') {
        const toolRaw = coerceString((payload as any)?.tool)
        const tool = toolRaw === 'pen' ? 'pen' : toolRaw === 'eraser' ? 'eraser' : 'mouse'
        const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
        state.tool = tool
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: 'tool', value: tool })

        const uiFrameworkRaw = state[WRITING_FRAMEWORK_UI_STATE_KEY]
        const uiFramework = isWritingFramework(uiFrameworkRaw) ? uiFrameworkRaw : undefined
        const writingFramework = uiFramework ?? (await getPersistedWritingFramework()) ?? 'konva'

        if (!uiFramework) {
          state[WRITING_FRAMEWORK_UI_STATE_KEY] = writingFramework
          emitEvent('UI_STATE_PUT', {
            windowId: UI_STATE_APP_WINDOW_ID,
            key: WRITING_FRAMEWORK_UI_STATE_KEY,
            value: writingFramework
          })
        }

        const activeAppRaw = state[ACTIVE_APP_UI_STATE_KEY]
        const activeApp = isActiveApp(activeAppRaw) ? activeAppRaw : undefined
        const pptFullscreen = state[PPT_FULLSCREEN_UI_STATE_KEY] === true

        const effective = resolveEffectiveWritingBackend({ writingFramework, activeApp, pptFullscreen })
        state[EFFECTIVE_WRITING_BACKEND_UI_STATE_KEY] = effective
        emitEvent('UI_STATE_PUT', {
          windowId: UI_STATE_APP_WINDOW_ID,
          key: EFFECTIVE_WRITING_BACKEND_UI_STATE_KEY,
          value: effective
        })

        const modeRaw = state[APP_MODE_UI_STATE_KEY]
        const mode = isAppMode(modeRaw) ? modeRaw : 'toolbar'
        if (mode === 'toolbar') {
          requestMain({ type: 'SET_SCREEN_ANNOTATION_VISIBLE', visible: tool !== 'mouse' })
        }

        emitEvent('BACKEND_FORWARD', { target: effective, command: 'setTool', payload: { tool }, reason: { writingFramework, activeApp, pptFullscreen } })
        return { ok: true }
      }

      if (action === 'setPenSettings') {
        const typeRaw = coerceString((payload as any)?.type)
        const type = typeRaw === 'highlighter' ? 'highlighter' : typeRaw === 'laser' ? 'laser' : 'writing'
        const colorRaw = coerceString((payload as any)?.color)
        const color = colorRaw || '#333333'
        const thicknessRaw = Number((payload as any)?.thickness)
        const thickness = Number.isFinite(thicknessRaw) ? Math.max(1, Math.min(120, thicknessRaw)) : 6

        const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
        state[PEN_TYPE_UI_STATE_KEY] = type
        state[PEN_COLOR_UI_STATE_KEY] = color
        state[PEN_THICKNESS_UI_STATE_KEY] = thickness
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: PEN_TYPE_UI_STATE_KEY, value: type })
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: PEN_COLOR_UI_STATE_KEY, value: color })
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: PEN_THICKNESS_UI_STATE_KEY, value: thickness })

        const uiFrameworkRaw = state[WRITING_FRAMEWORK_UI_STATE_KEY]
        const uiFramework = isWritingFramework(uiFrameworkRaw) ? uiFrameworkRaw : undefined
        const writingFramework = uiFramework ?? (await getPersistedWritingFramework()) ?? 'konva'
        const activeAppRaw = state[ACTIVE_APP_UI_STATE_KEY]
        const activeApp = isActiveApp(activeAppRaw) ? activeAppRaw : undefined
        const pptFullscreen = state[PPT_FULLSCREEN_UI_STATE_KEY] === true
        const effective = resolveEffectiveWritingBackend({ writingFramework, activeApp, pptFullscreen })

        emitEvent('BACKEND_FORWARD', {
          target: effective,
          command: 'setPenSettings',
          payload: { type, color, thickness },
          reason: { writingFramework, activeApp, pptFullscreen }
        })
        return { ok: true }
      }

      if (action === 'setEraserSettings') {
        const typeRaw = coerceString((payload as any)?.type)
        const type = typeRaw === 'stroke' ? 'stroke' : 'pixel'
        const thicknessRaw = Number((payload as any)?.thickness)
        const thickness = Number.isFinite(thicknessRaw) ? Math.max(1, Math.min(240, thicknessRaw)) : 18
        
        const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
        state[ERASER_TYPE_UI_STATE_KEY] = type
        state[ERASER_THICKNESS_UI_STATE_KEY] = thickness
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: ERASER_TYPE_UI_STATE_KEY, value: type })
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: ERASER_THICKNESS_UI_STATE_KEY, value: thickness })
        const uiFrameworkRaw = state[WRITING_FRAMEWORK_UI_STATE_KEY]
        const uiFramework = isWritingFramework(uiFrameworkRaw) ? uiFrameworkRaw : undefined
        const writingFramework = uiFramework ?? (await getPersistedWritingFramework()) ?? 'konva'
        const activeAppRaw = state[ACTIVE_APP_UI_STATE_KEY]
        const activeApp = isActiveApp(activeAppRaw) ? activeAppRaw : undefined
        const pptFullscreen = state[PPT_FULLSCREEN_UI_STATE_KEY] === true
        const effective = resolveEffectiveWritingBackend({ writingFramework, activeApp, pptFullscreen })

        emitEvent('BACKEND_FORWARD', { target: effective, command: 'setEraserSettings', payload: { type, thickness }, reason: { writingFramework, activeApp, pptFullscreen } })
        return { ok: true }
      }

      if (action === 'clearPage') {
        const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
        const nextRev = (Number(state[CLEAR_PAGE_REV_UI_STATE_KEY]) || 0) + 1
        state[CLEAR_PAGE_REV_UI_STATE_KEY] = nextRev
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: CLEAR_PAGE_REV_UI_STATE_KEY, value: nextRev })
        const uiFrameworkRaw = state[WRITING_FRAMEWORK_UI_STATE_KEY]
        const uiFramework = isWritingFramework(uiFrameworkRaw) ? uiFrameworkRaw : undefined
        const writingFramework = uiFramework ?? (await getPersistedWritingFramework()) ?? 'konva'
        const activeAppRaw = state[ACTIVE_APP_UI_STATE_KEY]
        const activeApp = isActiveApp(activeAppRaw) ? activeAppRaw : undefined
        const pptFullscreen = state[PPT_FULLSCREEN_UI_STATE_KEY] === true
        const effective = resolveEffectiveWritingBackend({ writingFramework, activeApp, pptFullscreen })

        emitEvent('BACKEND_FORWARD', { target: effective, command: 'clearPage', payload: {}, reason: { writingFramework, activeApp, pptFullscreen } })
        return { ok: true }
      }

      if (action === 'undo') {
        const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
        const nextRev = (Number(state[UNDO_REV_UI_STATE_KEY]) || 0) + 1
        state[UNDO_REV_UI_STATE_KEY] = nextRev
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: UNDO_REV_UI_STATE_KEY, value: nextRev })
        return { ok: true }
      }

      if (action === 'redo') {
        const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
        const nextRev = (Number(state[REDO_REV_UI_STATE_KEY]) || 0) + 1
        state[REDO_REV_UI_STATE_KEY] = nextRev
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: REDO_REV_UI_STATE_KEY, value: nextRev })
        return { ok: true }
      }

      if (action === 'prevPage') {
        const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
        const { index, total } = coercePageIndexTotal(state)
        ensurePageTotalInState(state, total)
        const nextIndex = Math.max(0, Math.min(total - 1, index - 1))
        state[NOTES_PAGE_INDEX_UI_STATE_KEY] = nextIndex
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: NOTES_PAGE_INDEX_UI_STATE_KEY, value: nextIndex })
        await applyWhiteboardBackgroundForPage({ state, index: nextIndex, total })
        return { ok: true }
      }

      if (action === 'nextPage') {
        const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
        const { index, total } = coercePageIndexTotal(state)
        ensurePageTotalInState(state, total)
        const modeRaw = state[APP_MODE_UI_STATE_KEY]
        const mode = isAppMode(modeRaw) ? modeRaw : 'toolbar'

        if (mode === 'whiteboard' && index >= total - 1) {
          const nextTotal = Math.min(2000, total + 1)
          const nextIndex = nextTotal - 1
          state[NOTES_PAGE_TOTAL_UI_STATE_KEY] = nextTotal
          state[NOTES_PAGE_INDEX_UI_STATE_KEY] = nextIndex
          emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: NOTES_PAGE_TOTAL_UI_STATE_KEY, value: nextTotal })
          emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: NOTES_PAGE_INDEX_UI_STATE_KEY, value: nextIndex })
          await applyWhiteboardBackgroundForPage({ state, index: nextIndex, total: nextTotal })
          return { ok: true }
        }

        const nextIndex = Math.max(0, Math.min(total - 1, index + 1))
        state[NOTES_PAGE_INDEX_UI_STATE_KEY] = nextIndex
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: NOTES_PAGE_INDEX_UI_STATE_KEY, value: nextIndex })
        await applyWhiteboardBackgroundForPage({ state, index: nextIndex, total })
        return { ok: true }
      }

      if (action === 'newPage') {
        const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
        const { total } = coercePageIndexTotal(state)
        const modeRaw = state[APP_MODE_UI_STATE_KEY]
        const mode = isAppMode(modeRaw) ? modeRaw : 'toolbar'

        if (mode === 'video-show') {
          const rev = Date.now()
          const baseTotal = Math.max(1, total)
          const nextTotal = Math.min(2000, baseTotal + 1)
          const nextIndex = nextTotal - 1
          state[NOTES_PAGE_TOTAL_UI_STATE_KEY] = nextTotal
          state[NOTES_PAGE_INDEX_UI_STATE_KEY] = nextIndex
          emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: NOTES_PAGE_TOTAL_UI_STATE_KEY, value: nextTotal })
          emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: NOTES_PAGE_INDEX_UI_STATE_KEY, value: nextIndex })

          const photoTotal = Math.max(0, nextTotal - 1)
          const photoIndex = Math.max(0, nextIndex - 1)
          const name = videoShowPhotoPageName(nextIndex)
          const book = await ensureVideoShowPageBookPersisted({ photoTotal })
          book.pages[photoIndex] = { name, imageUrl: '', createdAt: rev }
          await putValue(db, VIDEO_SHOW_PAGES_KV_KEY, book)
          emitEvent('KV_PUT', { key: VIDEO_SHOW_PAGES_KV_KEY })

          const capture = { rev, index: nextIndex, total: nextTotal, name }
          state[VIDEO_SHOW_CAPTURE_REV_UI_STATE_KEY] = capture
          emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: VIDEO_SHOW_CAPTURE_REV_UI_STATE_KEY, value: capture })
          return { ok: true }
        }

        const nextTotal = Math.min(2000, total + 1)
        const nextIndex = nextTotal - 1
        state[NOTES_PAGE_TOTAL_UI_STATE_KEY] = nextTotal
        state[NOTES_PAGE_INDEX_UI_STATE_KEY] = nextIndex
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: NOTES_PAGE_TOTAL_UI_STATE_KEY, value: nextTotal })
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: NOTES_PAGE_INDEX_UI_STATE_KEY, value: nextIndex })
        await applyWhiteboardBackgroundForPage({ state, index: nextIndex, total: nextTotal })
        return { ok: true }
      }

      if (action === 'setPageIndex') {
        const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
        const { total } = coercePageIndexTotal(state)
        ensurePageTotalInState(state, total)
        const desiredRaw = Number((payload as any)?.index)
        const desired = Number.isFinite(desiredRaw) ? Math.floor(desiredRaw) : 0
        const nextIndex = Math.max(0, Math.min(total - 1, desired))
        state[NOTES_PAGE_INDEX_UI_STATE_KEY] = nextIndex
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: NOTES_PAGE_INDEX_UI_STATE_KEY, value: nextIndex })
        await applyWhiteboardBackgroundForPage({ state, index: nextIndex, total })
        return { ok: true }
      }

      if (action === 'togglePageThumbnailsMenu') {
        requestMain({ type: 'TOGGLE_MUT_PAGE_THUMBNAILS_MENU' })
        return { ok: true }
      }

      if (action === 'setWritingFramework') {
        const frameworkRaw = coerceString((payload as any)?.framework)
        const framework = isWritingFramework(frameworkRaw) ? frameworkRaw : undefined
        if (!framework) return { ok: false, error: 'BAD_WRITING_FRAMEWORK' }
        await putValue(db, WRITING_FRAMEWORK_KV_KEY, framework)
        emitEvent('KV_PUT', { key: WRITING_FRAMEWORK_KV_KEY })
        const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
        state[WRITING_FRAMEWORK_UI_STATE_KEY] = framework
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: WRITING_FRAMEWORK_UI_STATE_KEY, value: framework })
        return { ok: true }
      }

      if (action === 'openSettingsWindow') {
        requestMain({ type: 'OPEN_SETTINGS_WINDOW' })
        return { ok: true }
      }

      if (action === 'minimizeSettingsWindow') {
        requestMain({ type: 'MINIMIZE_SETTINGS_WINDOW' })
        return { ok: true }
      }

      if (action === 'closeSettingsWindow') {
        requestMain({ type: 'CLOSE_SETTINGS_WINDOW' })
        return { ok: true }
      }

      if (action === 'windowControl') {
        const windowId = coerceString((payload as any)?.windowId)
        const controlActionRaw = coerceString((payload as any)?.action)
        const controlAction =
          controlActionRaw === 'minimize' ? 'minimize' : controlActionRaw === 'close' ? 'close' : controlActionRaw === 'toggleMaximize' ? 'toggleMaximize' : undefined
        if (!windowId || !controlAction) return { ok: false, error: 'BAD_WINDOW_CONTROL' }
        requestMain({ type: 'CONTROL_APP_WINDOW', windowId, action: controlAction })
        return { ok: true }
      }

      return { ok: false, error: 'UNKNOWN_COMMAND' }
    }

    if (scope === 'qt') {
      requestMain({ type: 'QT_COMMAND', action, payload })
      emitEvent('QT_COMMAND', { action, payload })
      return { ok: true }
    }

    if (scope === 'watcher') {
      if (action === 'openWindow') {
        requestMain({ type: 'OPEN_WATCHER_WINDOW' })
        return { ok: true }
      }

      if (action === 'setInterval' || action === 'start') {
        const intervalMs = Number((payload as any)?.intervalMs)
        requestMain({ type: 'START_TASK_WATCHER', intervalMs: Number.isFinite(intervalMs) ? intervalMs : undefined })
        return { ok: true }
      }

      if (action === 'stop') {
        return { ok: true }
      }

      return { ok: false, error: 'UNKNOWN_COMMAND' }
    }

    if (scope === 'fs' || scope === 'img') {
      return { ok: false, error: 'NOT_IMPLEMENTED' }
    }

    return { ok: false, error: 'UNKNOWN_COMMAND' }
  }

  if (command === 'create-window') {
    requestMain({ type: 'CREATE_WINDOW' })
    return { ok: true }
  }

  if (command === 'toggle-subwindow') {
    const kind = coerceString((payload as any)?.kind)
    const placementRaw = coerceString((payload as any)?.placement)
    const placement = placementRaw === 'top' ? 'top' : placementRaw === 'bottom' ? 'bottom' : undefined
    if (!kind || !placement) return { ok: false, error: 'BAD_SUBWINDOW' }
    requestMain({ type: 'TOGGLE_SUBWINDOW', kind, placement })
    return { ok: true }
  }

  if (command === 'set-subwindow-height') {
    const kind = coerceString((payload as any)?.kind)
    const height = Number((payload as any)?.height)
    if (!kind || !Number.isFinite(height)) return { ok: false, error: 'BAD_SUBWINDOW_HEIGHT' }
    requestMain({ type: 'SET_SUBWINDOW_HEIGHT', kind, height })
    return { ok: true }
  }

  if (command === 'set-subwindow-bounds') {
    const kind = coerceString((payload as any)?.kind)
    const width = Number((payload as any)?.width)
    const height = Number((payload as any)?.height)
    if (!kind || !Number.isFinite(width) || !Number.isFinite(height)) return { ok: false, error: 'BAD_SUBWINDOW_BOUNDS' }
    requestMain({ type: 'SET_SUBWINDOW_BOUNDS', kind, width, height })
    return { ok: true }
  }

  if (command === 'set-toolbar-bounds') {
    const width = Number((payload as any)?.width)
    const height = Number((payload as any)?.height)
    if (!Number.isFinite(width) || !Number.isFinite(height)) return { ok: false, error: 'BAD_BOUNDS' }
    requestMain({ type: 'SET_TOOLBAR_BOUNDS', width, height })
    return { ok: true }
  }

  if (command === 'set-app-window-bounds') {
    const windowId = coerceString((payload as any)?.windowId)
    const width = Number((payload as any)?.width)
    const height = Number((payload as any)?.height)
    const x = (payload as any)?.x
    const y = (payload as any)?.y
    const hasWidth = Number.isFinite(width)
    const hasHeight = Number.isFinite(height)
    if (!windowId || (!hasWidth && !hasHeight)) return { ok: false, error: 'BAD_BOUNDS' }
    requestMain({
      type: 'SET_APP_WINDOW_BOUNDS',
      windowId,
      ...(hasWidth ? { width } : {}),
      ...(hasHeight ? { height } : {}),
      ...(Number.isFinite(Number(x)) ? { x: Number(x) } : {}),
      ...(Number.isFinite(Number(y)) ? { y: Number(y) } : {})
    })
    return { ok: true }
  }

  if (command === 'set-appearance') {
    const appearance = coerceAppearance((payload as any)?.appearance)
    if (!appearance) return { ok: false, error: 'BAD_APPEARANCE' }
    requestMain({ type: 'SET_APPEARANCE', appearance })
    return { ok: true }
  }

  if (command === 'quit') {
    requestMain({ type: 'QUIT_APP' })
    return { ok: true }
  }

  return { ok: false, error: 'UNKNOWN_COMMAND' }
}

const stdin = createInterface({ input: process.stdin, crlfDelay: Infinity })
stdin.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    const msg = JSON.parse(trimmed)
    const type = String((msg as any)?.type ?? '')

    if (type === 'MAIN_RPC_RESPONSE') {
      const id = Number((msg as any)?.id)
      if (!Number.isFinite(id)) return
      const pending = pendingMainRpc.get(id)
      if (!pending) return
      pendingMainRpc.delete(id)
      clearTimeout(pending.timer)
      const ok = Boolean((msg as any)?.ok)
      if (ok) {
        pending.resolve((msg as any)?.result)
      } else {
        pending.reject(new Error(String((msg as any)?.error ?? 'main_rpc_failed')))
      }
      return
    }

    if (type === 'RPC_REQUEST') {
      const id = Number((msg as any)?.id)
      const method = String((msg as any)?.method ?? '')
      const params = (msg as any)?.params as any
      if (!Number.isFinite(id) || !method) return

      void (async () => {
        try {
          if (method === 'apiRequest') {
            const requestMethod = coerceString(params?.method).toUpperCase() || 'GET'
            const path = coerceString(params?.path)
            if (!path.startsWith('/')) throw new Error('BAD_PATH')

            const headers: Record<string, string> = Object.create(null) as Record<string, string>
            let body: string | undefined
            if (params?.body !== undefined && requestMethod !== 'GET' && requestMethod !== 'HEAD') {
              headers['Content-Type'] = 'application/json'
              body = JSON.stringify(params.body)
            }

            const res = await api.handle(
              new Request(`http://local${path}`, {
                method: requestMethod,
                headers,
                body
              })
            )

            const contentType = res.headers.get('content-type') ?? ''
            let outBody: unknown
            if (contentType.includes('application/json') || contentType.includes('+json')) {
              try {
                outBody = await res.json()
              } catch {
                outBody = await res.text()
              }
            } else {
              outBody = await res.text()
            }

            requestMain({ type: 'RPC_RESPONSE', id, ok: true, result: { status: res.status, body: outBody } })
            return
          }

          if (method === 'postCommand') {
            const command = coerceString(params?.command)
            const payload = params?.payload as unknown
            if (!command) throw new Error('BAD_COMMAND')
            const res = await handleCommand(command, payload)
            if (!res.ok) throw new Error(res.error)
            requestMain({ type: 'RPC_RESPONSE', id, ok: true, result: null })
            return
          }

          if (method === 'getEvents') {
            const since = Number(params?.since ?? 0)
            const items = events.filter((e) => e.id > since)
            requestMain({ type: 'RPC_RESPONSE', id, ok: true, result: { items, latest: events.at(-1)?.id ?? since } })
            return
          }

          if (method === 'getKv') {
            const key = coerceString(params?.key)
            if (!key) throw new Error('BAD_KEY')
            try {
              const value = await getValue(db, key)
              emitEvent('KV_GET', { key })
              requestMain({ type: 'RPC_RESPONSE', id, ok: true, result: value })
              return
            } catch {
              throw new Error('kv_not_found')
            }
          }

          if (method === 'putKv') {
            const key = coerceString(params?.key)
            if (!key) throw new Error('BAD_KEY')
            await putValue(db, key, params?.value)
            emitEvent('KV_PUT', { key })
            if (key === 'native-mica-enabled') {
              const raw = (params as any)?.value
              const enabled =
                raw === true || raw === 'true' || raw === 1 || raw === '1'
                  ? true
                  : raw === false || raw === 'false' || raw === 0 || raw === '0'
                    ? false
                    : Boolean(raw)
              requestMain({ type: 'SET_NATIVE_MICA', enabled })
            }
            if (key === 'legacy-window-implementation') {
              const raw = (params as any)?.value
              const enabled =
                raw === true || raw === 'true' || raw === 1 || raw === '1'
                  ? true
                  : raw === false || raw === 'false' || raw === 0 || raw === '0'
                    ? false
                    : Boolean(raw)
              requestMain({ type: 'SET_LEGACY_WINDOW_IMPLEMENTATION', enabled })
            }
            requestMain({ type: 'RPC_RESPONSE', id, ok: true, result: null })
            return
          }

          if (method === 'getUiState') {
            const windowId = coerceString(params?.windowId)
            if (!windowId) throw new Error('BAD_WINDOW_ID')
            const state = getOrInitUiState(windowId)
            emitEvent('UI_STATE_GET', { windowId })
            requestMain({ type: 'RPC_RESPONSE', id, ok: true, result: state })
            return
          }

          if (method === 'putUiStateKey') {
            const windowId = coerceString(params?.windowId)
            const key = coerceString(params?.key)
            if (!windowId || !key) throw new Error('BAD_UI_STATE_KEY')
            const state = getOrInitUiState(windowId)
            state[key] = params?.value
            emitEvent('UI_STATE_PUT', { windowId, key, value: params?.value })
            if (
              windowId === UI_STATE_APP_WINDOW_ID &&
              (key === WHITEBOARD_BG_COLOR_UI_STATE_KEY ||
                key === WHITEBOARD_BG_IMAGE_URL_UI_STATE_KEY ||
                key === WHITEBOARD_BG_IMAGE_OPACITY_UI_STATE_KEY)
            ) {
              const modeRaw = state[APP_MODE_UI_STATE_KEY]
              const mode = isAppMode(modeRaw) ? modeRaw : 'toolbar'
              if (mode === 'whiteboard') {
                const { index, total } = coercePageIndexTotal(state)
                const defaultBg = await getDefaultWhiteboardBackground()
                const book = await ensureWhiteboardCanvasBookPersisted({ total, defaultBg })
                const rawPage = (book.pages as any)?.[index] as Partial<WhiteboardCanvasPageV1> | undefined
                const page = {
                  bgColor: typeof rawPage?.bgColor === 'string' ? rawPage.bgColor : defaultBg.bgColor,
                  bgImageUrl: isFileOrDataUrl(rawPage?.bgImageUrl) ? String(rawPage?.bgImageUrl ?? '') : defaultBg.bgImageUrl,
                  bgImageOpacity:
                    typeof rawPage?.bgImageOpacity === 'number' && Number.isFinite(rawPage.bgImageOpacity)
                      ? Math.max(0, Math.min(1, rawPage.bgImageOpacity))
                      : defaultBg.bgImageOpacity
                }

                const nextColor =
                  key === WHITEBOARD_BG_COLOR_UI_STATE_KEY && isHexColor(params?.value) ? String(params?.value) : page.bgColor

                const nextImageUrl =
                  key === WHITEBOARD_BG_IMAGE_URL_UI_STATE_KEY && isFileOrDataUrl(params?.value) ? String(params?.value) : page.bgImageUrl

                const nextOpacity = (() => {
                  if (key !== WHITEBOARD_BG_IMAGE_OPACITY_UI_STATE_KEY) return page.bgImageOpacity
                  const raw = params?.value
                  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
                  if (!Number.isFinite(n)) return page.bgImageOpacity
                  return Math.max(0, Math.min(1, n))
                })()

                if (nextColor !== page.bgColor || nextImageUrl !== page.bgImageUrl || nextOpacity !== page.bgImageOpacity) {
                  book.pages[index] = { bgColor: nextColor, bgImageUrl: nextImageUrl, bgImageOpacity: nextOpacity }
                  await putValue(db, WHITEBOARD_CANVAS_PAGES_KV_KEY, book)
                  emitEvent('KV_PUT', { key: WHITEBOARD_CANVAS_PAGES_KV_KEY })
                }

                if (key === WHITEBOARD_BG_COLOR_UI_STATE_KEY && isHexColor(params?.value)) {
                  await putValue(db, WHITEBOARD_BG_COLOR_KV_KEY, String(params?.value))
                  emitEvent('KV_PUT', { key: WHITEBOARD_BG_COLOR_KV_KEY })
                }
                if (key === WHITEBOARD_BG_IMAGE_URL_UI_STATE_KEY && isFileOrDataUrl(params?.value)) {
                  await putValue(db, WHITEBOARD_BG_IMAGE_URL_KV_KEY, String(params?.value))
                  emitEvent('KV_PUT', { key: WHITEBOARD_BG_IMAGE_URL_KV_KEY })
                }
                if (key === WHITEBOARD_BG_IMAGE_OPACITY_UI_STATE_KEY) {
                  const raw = params?.value
                  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
                  if (Number.isFinite(n)) {
                    const v = Math.max(0, Math.min(1, n))
                    await putValue(db, WHITEBOARD_BG_IMAGE_OPACITY_KV_KEY, v)
                    emitEvent('KV_PUT', { key: WHITEBOARD_BG_IMAGE_OPACITY_KV_KEY })
                  }
                }
              }
            }
            requestMain({ type: 'RPC_RESPONSE', id, ok: true, result: null })
            return
          }

          if (method === 'deleteUiStateKey') {
            const windowId = coerceString(params?.windowId)
            const key = coerceString(params?.key)
            if (!windowId || !key) throw new Error('BAD_UI_STATE_KEY')
            const state = getOrInitUiState(windowId)
            delete state[key]
            emitEvent('UI_STATE_DEL', { windowId, key })
            requestMain({ type: 'RPC_RESPONSE', id, ok: true, result: null })
            return
          }

          throw new Error('UNKNOWN_METHOD')
        } catch (e) {
          requestMain({ type: 'RPC_RESPONSE', id, ok: false, error: String(e) })
        }
      })()
      return
    }

    if (type === 'CLEANUP_RUNTIME') {
      cleanupMonitoringData()
      emitEvent('CLEANUP_RUNTIME')
      return
    }

    if (type === 'WINDOW_STATUS') {
      const windowId = String((msg as any)?.windowId ?? '')
      if (windowId) {
        runtimeWindows.set(windowId, msg as unknown)
        emitEvent('WINDOW_STATUS', msg)
        return
      }
    }

    if (type === 'PROCESS_STATUS') {
      const name = String((msg as any)?.name ?? '')
      if (name) {
        runtimeProcesses.set(name, msg as unknown)
        emitEvent('PROCESS_STATUS', msg)
        return
      }
    }

    if (type === 'TASK_WATCHER_STATUS') {
      const status = (msg as any)?.status as TaskWatcherStatus | undefined
      if (status && typeof status === 'object') {
        runtimeProcesses.set('task-watcher', status as unknown)
        emitEvent('watcherStatus', status)
        return
      }
    }

    if (type === 'TASK_WATCHER_PROCESS_SNAPSHOT') {
      const ts = Number((msg as any)?.ts)
      const processes = Array.isArray((msg as any)?.processes) ? ((msg as any).processes as ProcessSample[]) : []
      runtimeProcesses.set('system-processes', { ts: Number.isFinite(ts) ? ts : Date.now(), processes } as unknown)
      emitEvent('processChanged', { ts: Number.isFinite(ts) ? ts : Date.now(), processes })
      return
    }

    if (type === 'TASK_WATCHER_WINDOW_FOCUS') {
      const ts = Number((msg as any)?.ts)
      const window = ((msg as any)?.window ?? undefined) as ForegroundWindowSample | undefined
      runtimeWindows.set('foreground', { ts: Number.isFinite(ts) ? ts : Date.now(), window } as unknown)
      emitEvent('windowFocusChanged', { ts: Number.isFinite(ts) ? ts : Date.now(), window })

      const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
      const identified = identifyActiveApp(window)
      state[ACTIVE_APP_UI_STATE_KEY] = identified.activeApp
      state[PPT_FULLSCREEN_UI_STATE_KEY] = identified.pptFullscreen
      emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: ACTIVE_APP_UI_STATE_KEY, value: identified.activeApp })
      emitEvent('UI_STATE_PUT', {
        windowId: UI_STATE_APP_WINDOW_ID,
        key: PPT_FULLSCREEN_UI_STATE_KEY,
        value: identified.pptFullscreen
      })
      return
    }

    if (type === 'TASK_WATCHER_ERROR') {
      emitEvent('watcherError', (msg as any) ?? {})
      return
    }

    emitEvent('MAIN_MESSAGE', msg)
  } catch {
    return
  }
})

const api = new Elysia({ adapter: node() })
  .onRequest(({ request, set }) => {
    set.headers['Access-Control-Allow-Origin'] = '*'
    set.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS'
    set.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    if (request.method === 'OPTIONS') {
      set.status = 204
      return ''
    }
  })
  .get('/health', () => ({ ok: true, port }))
  .post('/dialog/select-image-file', async () => {
    const result = await requestMainRpc<{ fileUrl?: string }>('selectImageFile')
    const fileUrl = typeof (result as any)?.fileUrl === 'string' ? (result as any).fileUrl : undefined
    return { ok: true, fileUrl }
  })
  .get('/watcher/docs', () => {
    return {
      ok: true,
      endpoints: {
        docs: 'GET /watcher/docs',
        state: 'GET /watcher/state',
        events: 'GET /events',
        commands: 'POST /commands'
      },
      commands: [
        { command: 'watcher.openWindow', payload: {} },
        { command: 'watcher.setInterval', payload: { intervalMs: 'number?' } }
      ],
      subscription: {
        poll: {
          endpoint: 'GET /events',
          query: { sinceId: 'number?', limit: 'number?' },
          returns: { ok: 'boolean', events: 'EventItem[]' }
        },
        eventItem: { id: 'number', type: 'string', payload: 'unknown', ts: 'number' }
      },
      events: [
        { type: 'watcherStatus', payload: { running: 'boolean', intervalMs: 'number', ts: 'number', lastError: 'string?' } },
        { type: 'processChanged', payload: { ts: 'number', processes: 'ProcessSample[]' } },
        { type: 'windowFocusChanged', payload: { ts: 'number', window: 'ForegroundWindowSample?' } },
        { type: 'watcherError', payload: { ts: 'number', stage: 'string', error: 'string' } }
      ],
      types: {
        ProcessSample: {
          pid: 'number',
          name: 'string',
          cpuPercent: 'number?',
          cpuTimeMs: 'number?',
          memoryBytes: 'number?'
        },
        ForegroundWindowSample: {
          pid: 'number?',
          processName: 'string?',
          title: 'string',
          handle: 'string?',
          bounds: '{ x:number, y:number, width:number, height:number }?'
        }
      },
      runtime: {
        processesKey: 'system-processes',
        windowKey: 'foreground'
      },
      notes: [
        'watcherStatus 在 start/stop 时必定触发；失败时 lastError 更新',
        'processChanged 仅在采样结果发生变化时触发（含 CPU/内存变化）',
        'windowFocusChanged 仅在前台窗口 key 变化时触发（pid|handle|title）',
        'watcherError 表示采样阶段失败（例如权限不足、命令不可用、超时）'
      ]
    }
  })
  .get('/watcher/state', () => {
    const processes = runtimeProcesses.get('system-processes')
    const foreground = runtimeWindows.get('foreground')
    const watcher = runtimeProcesses.get('task-watcher')
    return { ok: true, watcher, processes, foreground }
  })
  .all('/cs/*', async ({ request, set, params }) => {
    if (!csBaseUrl) {
      set.status = 503
      return { ok: false, error: 'CS_BASE_URL_NOT_SET' }
    }

    const rest = String((params as any)['*'] ?? '')
    const incomingUrl = new URL(request.url)
    const targetUrl = new URL(`./${rest}${incomingUrl.search}`, csBaseUrl.endsWith('/') ? csBaseUrl : `${csBaseUrl}/`)

    const method = request.method.toUpperCase()

    const headers = new Headers()
    const contentType = request.headers.get('content-type')
    if (contentType) headers.set('content-type', contentType)
    const accept = request.headers.get('accept')
    if (accept) headers.set('accept', accept)

    const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer()
    const res = await fetch(targetUrl, { method, headers, body })

    set.status = res.status
    const outType = res.headers.get('content-type') ?? ''
    if (outType.includes('application/json') || outType.includes('+json')) {
      try {
        return await res.json()
      } catch {
        return await res.text()
      }
    }
    return await res.text()
  })
  .get(
    '/kv/:key',
    async ({ params, set }) => {
      try {
        const value = await getValue(db, params.key)
        emitEvent('KV_GET', { key: params.key })
        return { ok: true, key: params.key, value }
      } catch {
        set.status = 404
        return { ok: false, key: params.key, error: 'NOT_FOUND' }
      }
    },
    { params: t.Object({ key: t.String() }) }
  )
  .put(
    '/kv/:key',
    async ({ params, body }) => {
      await putValue(db, params.key, body)
      emitEvent('KV_PUT', { key: params.key })
      return { ok: true, key: params.key }
    },
    { params: t.Object({ key: t.String() }), body: t.Any() }
  )
  .delete(
    '/kv/:key',
    async ({ params }) => {
      await deleteValue(db, params.key)
      emitEvent('KV_DEL', { key: params.key })
      return { ok: true, key: params.key }
    },
    { params: t.Object({ key: t.String() }) }
  )
  .get(
    '/ui-state/:windowId',
    async ({ params }) => {
      const state = getOrInitUiState(params.windowId)
      emitEvent('UI_STATE_GET', { windowId: params.windowId })
      return { ok: true, windowId: params.windowId, state }
    },
    { params: t.Object({ windowId: t.String() }) }
  )
  .put(
    '/ui-state/:windowId/:key',
    async ({ params, body }) => {
      const state = getOrInitUiState(params.windowId)
      state[params.key] = body
      emitEvent('UI_STATE_PUT', { windowId: params.windowId, key: params.key, value: body })
      return { ok: true, windowId: params.windowId, key: params.key }
    },
    { params: t.Object({ windowId: t.String(), key: t.String() }), body: t.Any() }
  )
  .delete(
    '/ui-state/:windowId/:key',
    async ({ params }) => {
      const state = getOrInitUiState(params.windowId)
      delete state[params.key]
      emitEvent('UI_STATE_DEL', { windowId: params.windowId, key: params.key })
      return { ok: true, windowId: params.windowId, key: params.key }
    },
    { params: t.Object({ windowId: t.String(), key: t.String() }) }
  )
  .get('/runtime/windows', async () => {
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const [id, value] of runtimeWindows.entries()) out[id] = value
    emitEvent('RUNTIME_WINDOWS_GET')
    return { ok: true, windows: out }
  })
  .get('/runtime/processes', async () => {
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const [id, value] of runtimeProcesses.entries()) out[id] = value
    emitEvent('RUNTIME_PROCESSES_GET')
    return { ok: true, processes: out }
  })
  .post(
    '/commands',
    async ({ body, set }) => {
      const { command, payload } = body
      const res = await handleCommand(command, payload)
      if (!res.ok) set.status = 400
      return res
    },
    {
      body: t.Object({
        command: t.String(),
        payload: t.Optional(t.Any())
      })
    }
  )
  .get(
    '/events',
    async ({ query }) => {
      const since = Number(query.since ?? 0)
      const items = events.filter((e) => e.id > since)
      return { ok: true, items, latest: events.at(-1)?.id ?? since }
    },
    { query: t.Object({ since: t.Optional(t.String()) }) }
  )

async function bootstrap(): Promise<void> {
  try {
    await cleanupLegacyPersistedMonitoringData()
  } catch {}

  if (transport === 'http') {
    try {
      await api.listen({ hostname: host, port })
    } catch (e) {
      emitEvent('BACKEND_HTTP_LISTEN_FAILED', { host, port, error: String(e) })
    }
  }

  emitEvent('BACKEND_STARTED', { transport, host, port, dbPath, csBaseUrl: csBaseUrl || undefined })
}

bootstrap().catch((e) => {
  process.stderr.write(String(e))
})
