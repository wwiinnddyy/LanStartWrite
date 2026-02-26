import { Elysia, t } from 'elysia'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import { deleteByPrefix, deleteValue, getValue, openLeavelDb, putValue } from '../LeavelDB'
import { exportDbToCunoxDir, exportDbToCunoxFile, importCunoxDirToDb, importCunoxFileToDb } from '../CUNOX'
import {
  APPEARANCE_KV_KEY,
  APPEARANCE_UI_STATE_KEY,
  APP_MODE_KV_KEY,
  APP_MODE_UI_STATE_KEY,
  CLEAR_PAGE_REV_UI_STATE_KEY,
  EFFECTIVE_WRITING_BACKEND_UI_STATE_KEY,
  ERASER_THICKNESS_UI_STATE_KEY,
  ERASER_TYPE_UI_STATE_KEY,
  NOTES_PAGE_INDEX_UI_STATE_KEY,
  NOTES_PAGE_TOTAL_UI_STATE_KEY,
  NOTICE_KIND_UI_STATE_KEY,
  PEN_COLOR_UI_STATE_KEY,
  PEN_THICKNESS_UI_STATE_KEY,
  PEN_TYPE_UI_STATE_KEY,
  REDO_REV_UI_STATE_KEY,
  UI_STATE_APP_WINDOW_ID,
  UNDO_REV_UI_STATE_KEY,
  VIDEO_SHOW_MERGE_LAYERS_KV_KEY,
  VIDEO_SHOW_MERGE_LAYERS_UI_STATE_KEY,
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
  isAppMode,
  isAppearance,
  isFileOrDataUrl,
  isHexColor,
  isWritingFramework,
  type WritingFramework
} from '../status/keys'

type EventItem = {
  id: number
  type: string
  payload?: unknown
  ts: number
}

const WEB_ACTIVE_SUBWINDOW_UI_STATE_KEY = 'webActiveSubwindowKind'
const WEB_SUBWINDOW_PLACEMENT_UI_STATE_KEY = 'webSubwindowPlacement'
const WEB_PAGE_THUMBNAILS_VISIBLE_UI_STATE_KEY = 'webPageThumbnailsVisible'
const WEB_SETTINGS_VISIBLE_UI_STATE_KEY = 'webSettingsVisible'

const port = Number(process.env.LANSTART_BACKEND_PORT ?? 3131)
const host = String(process.env.LANSTART_BACKEND_HOST ?? '127.0.0.1')
const dbPath = process.env.LANSTART_DB_PATH ?? './lanstart.sqlite'
const transport = String(process.env.LANSTART_BACKEND_TRANSPORT ?? 'http')
const csBaseUrl = String(process.env.LANSTART_CS_BASE_URL ?? '')
const castPort = Number(process.env.LANSTART_CAST_PORT ?? 3132)
const castHost = String(process.env.LANSTART_CAST_HOST ?? '0.0.0.0')
const useStdioRpc = transport !== 'http'

const db = openLeavelDb(dbPath)

type WebRtcSdp = { type: string; sdp: string }
type WebRtcSession = {
  id: string
  createdAt: number
  updatedAt: number
  offer?: WebRtcSdp
  answer?: WebRtcSdp
}

const webrtcSessions = new Map<string, WebRtcSession>()
const WEBRTC_SESSION_TTL_MS = 10 * 60 * 1000

function nowMs(): number {
  return Date.now()
}

function cleanupWebrtcSessions(): void {
  const now = nowMs()
  for (const [id, s] of webrtcSessions.entries()) {
    if (now - s.updatedAt > WEBRTC_SESSION_TTL_MS) webrtcSessions.delete(id)
  }
}

setInterval(() => cleanupWebrtcSessions(), 60 * 1000).unref?.()

function createWebrtcSession(): WebRtcSession {
  cleanupWebrtcSessions()
  const id = randomUUID?.() ?? `${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`
  const ts = nowMs()
  const session: WebRtcSession = { id, createdAt: ts, updatedAt: ts }
  webrtcSessions.set(id, session)
  return session
}

function getLocalIpv4Addrs(): string[] {
  const ifaces = networkInterfaces()
  const out: string[] = []
  for (const infos of Object.values(ifaces)) {
    for (const info of infos ?? []) {
      if (!info) continue
      if ((info as any).family !== 'IPv4') continue
      if ((info as any).internal) continue
      const addr = String((info as any).address ?? '')
      if (addr) out.push(addr)
    }
  }
  return Array.from(new Set(out)).sort()
}

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
  if (!useStdioRpc) return
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

type PersistedAnnotationNodeV1 = {
  role: 'stroke' | 'eraserPixel'
  strokeWidth: number
  points: number[]
  color?: string
  opacity?: number
  pfh?: boolean
  groupId?: number
}

type PersistedAnnotationDocV1 = { version: 1; nodes: PersistedAnnotationNodeV1[] }
type PersistedAnnotationBookV2 = { version: 2; currentPage: number; pages: PersistedAnnotationDocV1[] }

function createEmptyAnnotationBookV2(): PersistedAnnotationBookV2 {
  return { version: 2, currentPage: 0, pages: [{ version: 1, nodes: [] }] }
}

function isEmptyAnnotationNotesValue(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false
  const o = v as any
  if (o.version === 1) return Array.isArray(o.nodes) && o.nodes.length === 0
  if (o.version !== 2) return false
  const currentPage = Number(o.currentPage)
  if (!Number.isFinite(currentPage) || currentPage !== 0) return false
  if (!Array.isArray(o.pages) || o.pages.length !== 1) return false
  const p0 = o.pages[0] as any
  if (!p0 || typeof p0 !== 'object') return false
  if (p0.version !== 1) return false
  return Array.isArray(p0.nodes) && p0.nodes.length === 0
}

function coerceAnnotationNotesHistoryValue(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v
  const o = v as any
  if (o.version === 2 && Array.isArray(o.pages)) return v
  if (o.version === 1 && Array.isArray(o.nodes)) return { version: 2, currentPage: 0, pages: [v as any] } satisfies PersistedAnnotationBookV2
  return v
}

async function rotateNotesKeyOnStartup(key: string): Promise<void> {
  let loaded: unknown | undefined
  try {
    loaded = await getValue(db, key)
  } catch {
    loaded = undefined
  }

  if (loaded !== undefined && !isEmptyAnnotationNotesValue(loaded)) {
    try {
      await putValue(db, `${key}-prev`, coerceAnnotationNotesHistoryValue(loaded))
    } catch {}
  }

  try {
    await putValue(db, key, createEmptyAnnotationBookV2())
  } catch {}
}

async function initNotesSessionOnStartup(): Promise<void> {
  await Promise.allSettled([
    rotateNotesKeyOnStartup('annotation-notes-toolbar'),
    rotateNotesKeyOnStartup('annotation-notes-whiteboard'),
    rotateNotesKeyOnStartup('annotation-notes-video-show')
  ])
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
  if (bgImageUrl && bgImageUrl.startsWith('file:')) {
    let normalized = ''
    try {
      const filePath = fileURLToPath(bgImageUrl)
      const ext = extname(filePath).toLowerCase()
      const mime =
        ext === '.png'
          ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.webp'
              ? 'image/webp'
              : ext === '.bmp'
                ? 'image/bmp'
                : ext === '.gif'
                  ? 'image/gif'
                  : ''
      if (mime) {
        const st = await stat(filePath)
        const size = Number(st.size)
        if (Number.isFinite(size) && size > 0 && size <= 15 * 1024 * 1024) {
          const buf = await readFile(filePath)
          normalized = `data:${mime};base64,${buf.toString('base64')}`
        }
      }
    } catch {}

    bgImageUrl = normalized
    try {
      await putValue(db, WHITEBOARD_BG_IMAGE_URL_KV_KEY, bgImageUrl)
      emitEvent('KV_PUT', { key: WHITEBOARD_BG_IMAGE_URL_KV_KEY })
    } catch {}
  }
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
  if (!useStdioRpc) return Promise.reject(new Error('main_rpc_unavailable'))
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

function getOrInitUiState(windowId: string): Record<string, unknown> {
  const existing = uiState.get(windowId)
  if (existing) return existing
  const created: Record<string, unknown> = {}
  uiState.set(windowId, created)
  return created
}

function cleanupMonitoringData(): void {
  uiState.clear()
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


async function handleCommand(command: string, payload: unknown): Promise<CommandResult> {
  emitEvent('COMMAND', { command, payload })

  const dot = command.indexOf('.')
  if (dot > 0) {
    const scope = command.slice(0, dot)
    const action = command.slice(dot + 1)

    if (scope === 'win') {
      if (action === 'createWindow') {
        if (useStdioRpc) requestMain({ type: 'CREATE_WINDOW' })
        return { ok: true }
      }

      if (action === 'setAppMode') {
        return await handleCommand('settings.setAppMode', payload)
      }

      if (action === 'setAnnotationInput') {
        const enabled = Boolean((payload as any)?.enabled)
        if (useStdioRpc) requestMain({ type: 'SET_ANNOTATION_INPUT', enabled })
        return { ok: true }
      }

      if (action === 'toggleSubwindow') {
        const kind = coerceString((payload as any)?.kind)
        const placementRaw = coerceString((payload as any)?.placement)
        const placement = placementRaw === 'top' ? 'top' : placementRaw === 'bottom' ? 'bottom' : undefined
        if (!kind || !placement) return { ok: false, error: 'BAD_SUBWINDOW' }
        if (useStdioRpc) {
          requestMain({ type: 'TOGGLE_SUBWINDOW', kind, placement })
        } else {
          const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
          const currentKind = coerceString(state[WEB_ACTIVE_SUBWINDOW_UI_STATE_KEY])
          if (currentKind === kind) {
            delete state[WEB_ACTIVE_SUBWINDOW_UI_STATE_KEY]
            delete state[WEB_SUBWINDOW_PLACEMENT_UI_STATE_KEY]
            emitEvent('UI_STATE_DEL', { windowId: UI_STATE_APP_WINDOW_ID, key: WEB_ACTIVE_SUBWINDOW_UI_STATE_KEY })
            emitEvent('UI_STATE_DEL', { windowId: UI_STATE_APP_WINDOW_ID, key: WEB_SUBWINDOW_PLACEMENT_UI_STATE_KEY })
          } else {
            state[WEB_ACTIVE_SUBWINDOW_UI_STATE_KEY] = kind
            state[WEB_SUBWINDOW_PLACEMENT_UI_STATE_KEY] = placement
            emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: WEB_ACTIVE_SUBWINDOW_UI_STATE_KEY, value: kind })
            emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: WEB_SUBWINDOW_PLACEMENT_UI_STATE_KEY, value: placement })
          }
        }
        return { ok: true }
      }

      if (action === 'setSubwindowHeight') {
        const kind = coerceString((payload as any)?.kind)
        const height = Number((payload as any)?.height)
        if (!kind || !Number.isFinite(height)) return { ok: false, error: 'BAD_SUBWINDOW_HEIGHT' }
        if (useStdioRpc) requestMain({ type: 'SET_SUBWINDOW_HEIGHT', kind, height })
        return { ok: true }
      }

      if (action === 'setSubwindowBounds') {
        const kind = coerceString((payload as any)?.kind)
        const width = Number((payload as any)?.width)
        const height = Number((payload as any)?.height)
        if (!kind || !Number.isFinite(width) || !Number.isFinite(height)) return { ok: false, error: 'BAD_SUBWINDOW_BOUNDS' }
        if (useStdioRpc) requestMain({ type: 'SET_SUBWINDOW_BOUNDS', kind, width, height })
        return { ok: true }
      }

      if (action === 'setToolbarBounds') {
        const width = Number((payload as any)?.width)
        const height = Number((payload as any)?.height)
        if (!Number.isFinite(width) || !Number.isFinite(height)) return { ok: false, error: 'BAD_BOUNDS' }
        if (useStdioRpc) requestMain({ type: 'SET_TOOLBAR_BOUNDS', width, height })
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
        if (useStdioRpc) {
          requestMain({
            type: 'SET_APP_WINDOW_BOUNDS',
            windowId,
            ...(hasWidth ? { width } : {}),
            ...(hasHeight ? { height } : {}),
            ...(Number.isFinite(Number(x)) ? { x: Number(x) } : {}),
            ...(Number.isFinite(Number(y)) ? { y: Number(y) } : {})
          })
        }
        return { ok: true }
      }

      if (action === 'setUiZoom') {
        const zoom = Number((payload as any)?.zoom)
        if (!Number.isFinite(zoom)) return { ok: false, error: 'BAD_ZOOM' }
        if (useStdioRpc) requestMain({ type: 'SET_UI_ZOOM', zoom })
        return { ok: true }
      }

      if (action === 'setNoticeVisible') {
        const visible = Boolean((payload as any)?.visible)
        if (useStdioRpc) {
          requestMain({ type: 'SET_NOTICE_VISIBLE', visible })
        } else {
          const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
          state[NOTICE_KIND_UI_STATE_KEY] = visible ? (coerceString((payload as any)?.kind) || 'notice') : ''
          emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: NOTICE_KIND_UI_STATE_KEY, value: state[NOTICE_KIND_UI_STATE_KEY] })
        }
        return { ok: true }
      }

      if (action === 'quit') {
        if (useStdioRpc) requestMain({ type: 'QUIT_APP' })
        return { ok: true }
      }

      return { ok: false, error: 'UNKNOWN_COMMAND' }
    }

    if (scope === 'settings') {
      if (action === 'setAppearance') {
        const appearanceRaw = coerceString((payload as any)?.appearance)
        const appearance = isAppearance(appearanceRaw) ? appearanceRaw : undefined
        if (!appearance) return { ok: false, error: 'BAD_APPEARANCE' }
        await putValue(db, APPEARANCE_KV_KEY, appearance)
        emitEvent('KV_PUT', { key: APPEARANCE_KV_KEY })
        const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
        state[APPEARANCE_UI_STATE_KEY] = appearance
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: APPEARANCE_UI_STATE_KEY, value: appearance })
        requestMain({ type: 'SET_APPEARANCE', appearance })
        return { ok: true }
      }

      if (action === 'setAppMode') {
        const modeRaw = coerceString((payload as any)?.mode)
        const mode = isAppMode(modeRaw) ? modeRaw : undefined
        if (!mode) return { ok: false, error: 'BAD_MODE' }
        const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
        const prevModeRaw = state[APP_MODE_UI_STATE_KEY]
        const prevMode = isAppMode(prevModeRaw) ? prevModeRaw : undefined
        if (prevMode && prevMode !== mode) {
          const { index, total } = coercePageIndexTotal(state)
          await Promise.allSettled([
            putValue(db, `notes-page-index:${prevMode}`, index),
            putValue(db, `notes-page-total:${prevMode}`, total)
          ])
        }
        await putValue(db, APP_MODE_KV_KEY, mode)
        emitEvent('KV_PUT', { key: APP_MODE_KV_KEY })
        state[APP_MODE_UI_STATE_KEY] = mode
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: APP_MODE_UI_STATE_KEY, value: mode })
        requestMain({ type: 'SET_APP_MODE', mode })

        const [idxRes, totalRes] = await Promise.allSettled([
          getValue(db, `notes-page-index:${mode}`),
          getValue(db, `notes-page-total:${mode}`)
        ])
        const totalRaw = totalRes.status === 'fulfilled' ? Number(totalRes.value) : NaN
        const total = Number.isFinite(totalRaw) ? Math.max(1, Math.min(2000, Math.floor(totalRaw))) : 1
        const idxRaw = idxRes.status === 'fulfilled' ? Number(idxRes.value) : NaN
        const index = Number.isFinite(idxRaw) ? Math.max(0, Math.min(total - 1, Math.floor(idxRaw))) : 0
        state[NOTES_PAGE_TOTAL_UI_STATE_KEY] = total
        state[NOTES_PAGE_INDEX_UI_STATE_KEY] = index
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: NOTES_PAGE_TOTAL_UI_STATE_KEY, value: total })
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: NOTES_PAGE_INDEX_UI_STATE_KEY, value: index })
        await applyWhiteboardBackgroundForPage({ state, index, total })
        return { ok: true }
      }

      if (action === 'setVideoShowMergeLayers') {
        const enabled = Boolean((payload as any)?.enabled)
        await putValue(db, VIDEO_SHOW_MERGE_LAYERS_KV_KEY, enabled)
        emitEvent('KV_PUT', { key: VIDEO_SHOW_MERGE_LAYERS_KV_KEY })
        const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
        state[VIDEO_SHOW_MERGE_LAYERS_UI_STATE_KEY] = enabled
        emitEvent('UI_STATE_PUT', {
          windowId: UI_STATE_APP_WINDOW_ID,
          key: VIDEO_SHOW_MERGE_LAYERS_UI_STATE_KEY,
          value: enabled
        })
        return { ok: true }
      }

      if (action === 'setWhiteboardBackground') {
        const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
        const nextColor = isHexColor((payload as any)?.bgColor) ? String((payload as any)?.bgColor) : undefined
        const nextImageUrl = isFileOrDataUrl((payload as any)?.bgImageUrl) ? String((payload as any)?.bgImageUrl ?? '') : undefined
        const nextOpacity = (() => {
          const raw = (payload as any)?.bgImageOpacity
          const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
          if (!Number.isFinite(n)) return undefined
          return Math.max(0, Math.min(1, n))
        })()

        if (nextColor !== undefined) {
          state[WHITEBOARD_BG_COLOR_UI_STATE_KEY] = nextColor
          emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: WHITEBOARD_BG_COLOR_UI_STATE_KEY, value: nextColor })
        }
        if (nextImageUrl !== undefined) {
          state[WHITEBOARD_BG_IMAGE_URL_UI_STATE_KEY] = nextImageUrl
          emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: WHITEBOARD_BG_IMAGE_URL_UI_STATE_KEY, value: nextImageUrl })
        }
        if (nextOpacity !== undefined) {
          state[WHITEBOARD_BG_IMAGE_OPACITY_UI_STATE_KEY] = nextOpacity
          emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: WHITEBOARD_BG_IMAGE_OPACITY_UI_STATE_KEY, value: nextOpacity })
        }

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

          const appliedColor = nextColor ?? page.bgColor
          const appliedImageUrl = nextImageUrl ?? page.bgImageUrl
          const appliedOpacity = nextOpacity ?? page.bgImageOpacity

          if (appliedColor !== page.bgColor || appliedImageUrl !== page.bgImageUrl || appliedOpacity !== page.bgImageOpacity) {
            book.pages[index] = { bgColor: appliedColor, bgImageUrl: appliedImageUrl, bgImageOpacity: appliedOpacity }
            await putValue(db, WHITEBOARD_CANVAS_PAGES_KV_KEY, book)
            emitEvent('KV_PUT', { key: WHITEBOARD_CANVAS_PAGES_KV_KEY })
          }
        }

        if (nextColor !== undefined) {
          await putValue(db, WHITEBOARD_BG_COLOR_KV_KEY, nextColor)
          emitEvent('KV_PUT', { key: WHITEBOARD_BG_COLOR_KV_KEY })
        }
        if (nextImageUrl !== undefined) {
          await putValue(db, WHITEBOARD_BG_IMAGE_URL_KV_KEY, nextImageUrl)
          emitEvent('KV_PUT', { key: WHITEBOARD_BG_IMAGE_URL_KV_KEY })
        }
        if (nextOpacity !== undefined) {
          await putValue(db, WHITEBOARD_BG_IMAGE_OPACITY_KV_KEY, nextOpacity)
          emitEvent('KV_PUT', { key: WHITEBOARD_BG_IMAGE_OPACITY_KV_KEY })
        }

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

        const effective = writingFramework
        state[EFFECTIVE_WRITING_BACKEND_UI_STATE_KEY] = effective
        emitEvent('UI_STATE_PUT', {
          windowId: UI_STATE_APP_WINDOW_ID,
          key: EFFECTIVE_WRITING_BACKEND_UI_STATE_KEY,
          value: effective
        })

        emitEvent('BACKEND_FORWARD', { target: effective, command: 'setTool', payload: { tool }, reason: { writingFramework } })
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
        const effective = writingFramework

        emitEvent('BACKEND_FORWARD', {
          target: effective,
          command: 'setPenSettings',
          payload: { type, color, thickness },
          reason: { writingFramework }
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
        const effective = writingFramework

        emitEvent('BACKEND_FORWARD', { target: effective, command: 'setEraserSettings', payload: { type, thickness }, reason: { writingFramework } })
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
        const effective = writingFramework

        emitEvent('BACKEND_FORWARD', { target: effective, command: 'clearPage', payload: {}, reason: { writingFramework } })
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
        if (useStdioRpc) {
          requestMain({ type: 'TOGGLE_MUT_PAGE_THUMBNAILS_MENU' })
        } else {
          const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
          const next = !Boolean(state[WEB_PAGE_THUMBNAILS_VISIBLE_UI_STATE_KEY])
          state[WEB_PAGE_THUMBNAILS_VISIBLE_UI_STATE_KEY] = next
          emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: WEB_PAGE_THUMBNAILS_VISIBLE_UI_STATE_KEY, value: next })
        }
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
        if (useStdioRpc) {
          requestMain({ type: 'OPEN_SETTINGS_WINDOW' })
        } else {
          const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
          state[WEB_SETTINGS_VISIBLE_UI_STATE_KEY] = true
          emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: WEB_SETTINGS_VISIBLE_UI_STATE_KEY, value: true })
        }
        return { ok: true }
      }

      if (action === 'minimizeSettingsWindow') {
        if (useStdioRpc) requestMain({ type: 'MINIMIZE_SETTINGS_WINDOW' })
        return { ok: true }
      }

      if (action === 'closeSettingsWindow') {
        if (useStdioRpc) {
          requestMain({ type: 'CLOSE_SETTINGS_WINDOW' })
        } else {
          const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
          state[WEB_SETTINGS_VISIBLE_UI_STATE_KEY] = false
          emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: WEB_SETTINGS_VISIBLE_UI_STATE_KEY, value: false })
        }
        return { ok: true }
      }

      if (action === 'windowControl') {
        const windowId = coerceString((payload as any)?.windowId)
        const controlActionRaw = coerceString((payload as any)?.action)
        const controlAction =
          controlActionRaw === 'minimize' ? 'minimize' : controlActionRaw === 'close' ? 'close' : controlActionRaw === 'toggleMaximize' ? 'toggleMaximize' : undefined
        if (!windowId || !controlAction) return { ok: false, error: 'BAD_WINDOW_CONTROL' }
        if (useStdioRpc) requestMain({ type: 'CONTROL_APP_WINDOW', windowId, action: controlAction })
        return { ok: true }
      }

      return { ok: false, error: 'UNKNOWN_COMMAND' }
    }

    if (scope === 'qt') {
      requestMain({ type: 'QT_COMMAND', action, payload })
      emitEvent('QT_COMMAND', { action, payload })
      return { ok: true }
    }

    if (scope === 'fs' || scope === 'img') {
      return { ok: false, error: 'NOT_IMPLEMENTED' }
    }

    return { ok: false, error: 'UNKNOWN_COMMAND' }
  }

  if (command === 'create-window') {
    if (useStdioRpc) requestMain({ type: 'CREATE_WINDOW' })
    return { ok: true }
  }

  if (command === 'toggle-subwindow') {
    const kind = coerceString((payload as any)?.kind)
    const placementRaw = coerceString((payload as any)?.placement)
    const placement = placementRaw === 'top' ? 'top' : placementRaw === 'bottom' ? 'bottom' : undefined
    if (!kind || !placement) return { ok: false, error: 'BAD_SUBWINDOW' }
    if (useStdioRpc) {
      requestMain({ type: 'TOGGLE_SUBWINDOW', kind, placement })
    } else {
      const state = getOrInitUiState(UI_STATE_APP_WINDOW_ID)
      const currentKind = coerceString(state[WEB_ACTIVE_SUBWINDOW_UI_STATE_KEY])
      if (currentKind === kind) {
        delete state[WEB_ACTIVE_SUBWINDOW_UI_STATE_KEY]
        delete state[WEB_SUBWINDOW_PLACEMENT_UI_STATE_KEY]
        emitEvent('UI_STATE_DEL', { windowId: UI_STATE_APP_WINDOW_ID, key: WEB_ACTIVE_SUBWINDOW_UI_STATE_KEY })
        emitEvent('UI_STATE_DEL', { windowId: UI_STATE_APP_WINDOW_ID, key: WEB_SUBWINDOW_PLACEMENT_UI_STATE_KEY })
      } else {
        state[WEB_ACTIVE_SUBWINDOW_UI_STATE_KEY] = kind
        state[WEB_SUBWINDOW_PLACEMENT_UI_STATE_KEY] = placement
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: WEB_ACTIVE_SUBWINDOW_UI_STATE_KEY, value: kind })
        emitEvent('UI_STATE_PUT', { windowId: UI_STATE_APP_WINDOW_ID, key: WEB_SUBWINDOW_PLACEMENT_UI_STATE_KEY, value: placement })
      }
    }
    return { ok: true }
  }

  if (command === 'set-subwindow-height') {
    const kind = coerceString((payload as any)?.kind)
    const height = Number((payload as any)?.height)
    if (!kind || !Number.isFinite(height)) return { ok: false, error: 'BAD_SUBWINDOW_HEIGHT' }
    if (useStdioRpc) requestMain({ type: 'SET_SUBWINDOW_HEIGHT', kind, height })
    return { ok: true }
  }

  if (command === 'set-subwindow-bounds') {
    const kind = coerceString((payload as any)?.kind)
    const width = Number((payload as any)?.width)
    const height = Number((payload as any)?.height)
    if (!kind || !Number.isFinite(width) || !Number.isFinite(height)) return { ok: false, error: 'BAD_SUBWINDOW_BOUNDS' }
    if (useStdioRpc) requestMain({ type: 'SET_SUBWINDOW_BOUNDS', kind, width, height })
    return { ok: true }
  }

  if (command === 'set-toolbar-bounds') {
    const width = Number((payload as any)?.width)
    const height = Number((payload as any)?.height)
    if (!Number.isFinite(width) || !Number.isFinite(height)) return { ok: false, error: 'BAD_BOUNDS' }
    if (useStdioRpc) requestMain({ type: 'SET_TOOLBAR_BOUNDS', width, height })
    return { ok: true }
  }

  if (command === 'set-mut-page-bounds') {
    const width = Number((payload as any)?.width)
    const height = Number((payload as any)?.height)
    if (!Number.isFinite(width) || !Number.isFinite(height)) return { ok: false, error: 'BAD_BOUNDS' }
    if (useStdioRpc) requestMain({ type: 'SET_MUT_PAGE_BOUNDS', width, height })
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
    if (useStdioRpc) {
      requestMain({
        type: 'SET_APP_WINDOW_BOUNDS',
        windowId,
        ...(hasWidth ? { width } : {}),
        ...(hasHeight ? { height } : {}),
        ...(Number.isFinite(Number(x)) ? { x: Number(x) } : {}),
        ...(Number.isFinite(Number(y)) ? { y: Number(y) } : {})
      })
    }
    return { ok: true }
  }

  if (command === 'set-appearance') {
    const appearance = coerceAppearance((payload as any)?.appearance)
    if (!appearance) return { ok: false, error: 'BAD_APPEARANCE' }
    if (useStdioRpc) requestMain({ type: 'SET_APPEARANCE', appearance })
    return { ok: true }
  }

  if (command === 'quit') {
    if (useStdioRpc) requestMain({ type: 'QUIT_APP' })
    return { ok: true }
  }

  return { ok: false, error: 'UNKNOWN_COMMAND' }
}

if (useStdioRpc) {
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
            } catch (e) {
              const err = e as any
              if (err?.notFound === true || String(err?.code ?? '') === 'LEVEL_NOT_FOUND') throw new Error('kv_not_found')
              throw e
            }
          }

          if (method === 'putKv') {
            const key = coerceString(params?.key)
            if (!key) throw new Error('BAD_KEY')
            await putValue(db, key, params?.value)
            emitEvent('KV_PUT', { key })
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

          if (method === 'shutdown') {
            requestMain({ type: 'RPC_RESPONSE', id, ok: true, result: null })
            try {
              await db.close()
            } catch {}
            setTimeout(() => {
              process.exit(0)
            }, 10)
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

    emitEvent('MAIN_MESSAGE', msg)
  } catch {
    return
  }
})
}

const api = new Elysia()
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
  .get('/events', ({ query }) => {
    const sinceRaw = Number((query as any)?.since ?? 0)
    const since = Number.isFinite(sinceRaw) ? Math.max(0, Math.floor(sinceRaw)) : 0
    const items = events.filter((e) => e.id > since)
    return { ok: true, items, latest: events.at(-1)?.id ?? since }
  })
  .post('/rpc/post-command', async ({ body, set }) => {
    const command = coerceString((body as any)?.command)
    if (!command) {
      set.status = 400
      return { ok: false, error: 'BAD_COMMAND' }
    }
    const result = await handleCommand(command, (body as any)?.payload)
    if (!result.ok) {
      set.status = 400
      return { ok: false, error: result.error }
    }
    return { ok: true }
  })
  .get('/kv/:key', async ({ params, set }) => {
    const key = decodeURIComponent(coerceString((params as any)?.key))
    if (!key) {
      set.status = 400
      return { ok: false, error: 'BAD_KEY' }
    }
    try {
      const value = await getValue(db, key)
      emitEvent('KV_GET', { key })
      return { ok: true, value }
    } catch (e) {
      const err = e as any
      if (err?.notFound === true || String(err?.code ?? '') === 'LEVEL_NOT_FOUND') {
        set.status = 404
        return { ok: false, error: 'kv_not_found' }
      }
      set.status = 500
      return { ok: false, error: String(e) }
    }
  })
  .put('/kv/:key', async ({ params, body, set }) => {
    const key = decodeURIComponent(coerceString((params as any)?.key))
    if (!key) {
      set.status = 400
      return { ok: false, error: 'BAD_KEY' }
    }
    await putValue(db, key, (body as any)?.value)
    emitEvent('KV_PUT', { key })
    return { ok: true }
  })
  .get('/ui/:windowId', ({ params, set }) => {
    const windowId = decodeURIComponent(coerceString((params as any)?.windowId))
    if (!windowId) {
      set.status = 400
      return { ok: false, error: 'BAD_WINDOW_ID' }
    }
    const state = getOrInitUiState(windowId)
    emitEvent('UI_STATE_GET', { windowId })
    return { ok: true, state }
  })
  .put('/ui/:windowId/:key', ({ params, body, set }) => {
    const windowId = decodeURIComponent(coerceString((params as any)?.windowId))
    const key = decodeURIComponent(coerceString((params as any)?.key))
    if (!windowId || !key) {
      set.status = 400
      return { ok: false, error: 'BAD_UI_STATE_KEY' }
    }
    const state = getOrInitUiState(windowId)
    state[key] = (body as any)?.value
    emitEvent('UI_STATE_PUT', { windowId, key, value: (body as any)?.value })
    return { ok: true }
  })
  .delete('/ui/:windowId/:key', ({ params, set }) => {
    const windowId = decodeURIComponent(coerceString((params as any)?.windowId))
    const key = decodeURIComponent(coerceString((params as any)?.key))
    if (!windowId || !key) {
      set.status = 400
      return { ok: false, error: 'BAD_UI_STATE_KEY' }
    }
    const state = getOrInitUiState(windowId)
    delete state[key]
    emitEvent('UI_STATE_DEL', { windowId, key })
    return { ok: true }
  })
  .post('/dialog/select-image-file', async () => {
    if (!useStdioRpc) return { ok: false, error: 'UNSUPPORTED_IN_WEB' }
    const result = await requestMainRpc<{ fileUrl?: string }>('selectImageFile')
    const fileUrl = typeof (result as any)?.fileUrl === 'string' ? (result as any).fileUrl : undefined
    return { ok: true, fileUrl }
  })
  .post('/dialog/select-directory', async () => {
    if (!useStdioRpc) return { ok: false, error: 'UNSUPPORTED_IN_WEB' }
    const result = await requestMainRpc<{ dir?: string; dirUrl?: string }>('selectDirectory')
    const dir = typeof (result as any)?.dir === 'string' ? (result as any).dir : undefined
    const dirUrl = typeof (result as any)?.dirUrl === 'string' ? (result as any).dirUrl : undefined
    return { ok: true, dir, dirUrl }
  })
  .post('/dialog/select-cunox-export-file', async () => {
    if (!useStdioRpc) return { ok: false, error: 'UNSUPPORTED_IN_WEB' }
    const result = await requestMainRpc<{ file?: string; fileUrl?: string }>('selectCunoxExportFile')
    const file = typeof (result as any)?.file === 'string' ? (result as any).file : undefined
    const fileUrl = typeof (result as any)?.fileUrl === 'string' ? (result as any).fileUrl : undefined
    return { ok: true, file, fileUrl }
  })
  .post('/dialog/select-cunox-import-file', async () => {
    if (!useStdioRpc) return { ok: false, error: 'UNSUPPORTED_IN_WEB' }
    const result = await requestMainRpc<{ file?: string; fileUrl?: string }>('selectCunoxImportFile')
    const file = typeof (result as any)?.file === 'string' ? (result as any).file : undefined
    const fileUrl = typeof (result as any)?.fileUrl === 'string' ? (result as any).fileUrl : undefined
    return { ok: true, file, fileUrl }
  })
  .post(
    '/img/file-to-data-url',
    async ({ body, set }) => {
      const fileUrl = typeof (body as any)?.fileUrl === 'string' ? String((body as any).fileUrl) : ''
      const maxBytesRaw = (body as any)?.maxBytes
      const maxBytes = Number.isFinite(Number(maxBytesRaw)) ? Math.max(1024, Math.floor(Number(maxBytesRaw))) : 15 * 1024 * 1024

      if (!fileUrl || !fileUrl.startsWith('file:')) {
        set.status = 400
        return { ok: false, error: 'BAD_FILE_URL' }
      }

      let filePath = ''
      try {
        filePath = fileURLToPath(fileUrl)
      } catch {
        set.status = 400
        return { ok: false, error: 'BAD_FILE_URL' }
      }

      const ext = extname(filePath).toLowerCase()
      const mime =
        ext === '.png'
          ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.webp'
              ? 'image/webp'
              : ext === '.bmp'
                ? 'image/bmp'
                : ext === '.gif'
                  ? 'image/gif'
                  : ''

      if (!mime) {
        set.status = 415
        return { ok: false, error: 'UNSUPPORTED_IMAGE_TYPE' }
      }

      try {
        const st = await stat(filePath)
        const size = Number(st.size)
        if (!Number.isFinite(size) || size <= 0) {
          set.status = 400
          return { ok: false, error: 'BAD_FILE_SIZE' }
        }
        if (size > maxBytes) {
          set.status = 413
          return { ok: false, error: 'FILE_TOO_LARGE', size, maxBytes }
        }

        const buf = await readFile(filePath)
        const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
        return { ok: true, dataUrl, mime, size }
      } catch (e) {
        set.status = 500
        return { ok: false, error: String(e) }
      }
    },
    { body: t.Object({ fileUrl: t.String(), maxBytes: t.Optional(t.Number()) }) }
  )
  .group('/webrtc', (app) =>
    app
      .get('/local-addrs', () => ({ ok: true, hostAddrs: getLocalIpv4Addrs(), port: castPort }))
      .post('/session', () => {
        const s = createWebrtcSession()
        return { ok: true, sessionId: s.id, ttlMs: WEBRTC_SESSION_TTL_MS, hostAddrs: getLocalIpv4Addrs(), port: castPort }
      })
      .get(
        '/session/:id/offer',
        ({ params, set }) => {
          const s = webrtcSessions.get(params.id)
          if (!s?.offer) {
            set.status = 404
            return { ok: false, error: 'OFFER_NOT_FOUND' }
          }
          return { ok: true, offer: s.offer }
        },
        { params: t.Object({ id: t.String() }) }
      )
      .post(
        '/session/:id/offer',
        ({ params, body }) => {
          const s = webrtcSessions.get(params.id) ?? { id: params.id, createdAt: nowMs(), updatedAt: nowMs() }
          s.offer = body
          s.updatedAt = nowMs()
          webrtcSessions.set(params.id, s)
          return { ok: true }
        },
        { params: t.Object({ id: t.String() }), body: t.Object({ type: t.String(), sdp: t.String() }) }
      )
      .get(
        '/session/:id/answer',
        ({ params, set }) => {
          const s = webrtcSessions.get(params.id)
          if (!s?.answer) {
            set.status = 404
            return { ok: false, error: 'ANSWER_NOT_FOUND' }
          }
          return { ok: true, answer: s.answer }
        },
        { params: t.Object({ id: t.String() }) }
      )
      .post(
        '/session/:id/answer',
        ({ params, body }) => {
          const s = webrtcSessions.get(params.id)
          if (!s?.offer) return { ok: false, error: 'OFFER_NOT_FOUND' }
          s.answer = body
          s.updatedAt = nowMs()
          return { ok: true }
        },
        { params: t.Object({ id: t.String() }), body: t.Object({ type: t.String(), sdp: t.String() }) }
      )
  )
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
  .post(
    '/cunox/export',
    async ({ body, set }) => {
      try {
        const rawName = typeof (body as any)?.name === 'string' ? String((body as any).name) : ''
        const safeName = rawName.replace(/[\\/:*?"<>|\r\n]+/g, '-').replace(/\s+/g, ' ').trim()
        const rawOutFile = typeof (body as any)?.outFile === 'string' ? String((body as any).outFile) : ''
        const rawDir = typeof (body as any)?.dir === 'string' ? String((body as any).dir) : ''
        const baseDir = rawDir && rawDir.startsWith('file:') ? fileURLToPath(rawDir) : rawDir
        const outFileFromBody = rawOutFile && rawOutFile.startsWith('file:') ? fileURLToPath(rawOutFile) : rawOutFile

        let outFile = outFileFromBody
        if (!outFile) {
          if (!baseDir) throw new Error('BAD_DIR')
          outFile = join(
            baseDir,
            (safeName || `LanStartWrite-${new Date().toISOString().replace(/[:.]/g, '-')}`).replace(/\.cunox$/i, '') + '.cunox'
          )
        }
        const outLower = outFile.toLowerCase()
        if (!outLower.endsWith('.cunox') && !outLower.endsWith('.zip')) outFile = outFile + '.cunox'

        emitEvent('CUNOX_EXPORT_START', { outFile })
        const res = await exportDbToCunoxFile(db, {
          outFile,
          overwrite: Boolean((body as any).overwrite),
          include: (body as any).include ?? undefined
        })
        emitEvent('CUNOX_EXPORT_DONE', { outFile: res.outFile })
        return { ok: true, outFile: res.outFile, manifest: res.manifest }
      } catch (e) {
        emitEvent('CUNOX_EXPORT_ERROR', { error: String(e) })
        set.status = 400
        return { ok: false, error: String(e) }
      }
    },
    {
      body: t.Object({
        dir: t.Optional(t.String()),
        outFile: t.Optional(t.String()),
        name: t.Optional(t.String()),
        overwrite: t.Optional(t.Boolean()),
        include: t.Optional(
          t.Object({
            board: t.Optional(t.Boolean()),
            ppt: t.Optional(t.Boolean()),
            screen: t.Optional(t.Boolean()),
            video_booth: t.Optional(t.Boolean())
          })
        )
      })
    }
  )
  .post(
    '/cunox/import',
    async ({ body, set }) => {
      try {
        const rawFile = typeof (body as any)?.file === 'string' ? String((body as any).file) : ''
        const rawDir = typeof (body as any)?.dir === 'string' ? String((body as any).dir) : ''
        if (rawFile) {
          await importCunoxFileToDb(db, { file: rawFile, mode: 'replace' })
        } else {
          const dir = rawDir.startsWith('file:') ? fileURLToPath(rawDir) : rawDir
          if (!dir) throw new Error('BAD_DIR')
          await importCunoxDirToDb(db, { dir, mode: 'replace' })
        }
        return { ok: true }
      } catch (e) {
        set.status = 400
        return { ok: false, error: String(e) }
      }
    },
    {
      body: t.Object({
        dir: t.Optional(t.String()),
        file: t.Optional(t.String())
      })
    }
  )
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

const senderHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>LanStartWrite 手机投屏</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; background: #0b0b0f; color: rgba(255,255,255,.92); }
      .wrap { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
      .card { border: 1px solid rgba(255,255,255,.12); border-radius: 14px; background: rgba(255,255,255,.06); padding: 12px; }
      .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
      button { height: 38px; border-radius: 12px; border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.08); color: rgba(255,255,255,.92); padding: 0 12px; font-weight: 600; }
      video { width: 100%; border-radius: 14px; background: #000; }
      .muted { opacity: .72; font-size: 12px; }
      .ok { color: #7fffb1; }
      .bad { color: #ff9aa0; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="row">
          <div>
            <div style="font-size: 13px; font-weight: 700;">鎵嬫満鎽勫儚澶存姇灞?/div>
            <div class="muted">璇蜂繚鎸佹墜鏈轰笌鐢佃剳鍦ㄥ悓涓€灞€域网</div>
          </div>
          <button id="btnStart">寮€濮嬫姇灞?/button>
        </div>
        <div style="height: 10px;"></div>
        <div class="row">
          <div class="muted">会话</div>
          <div id="session" class="mono muted">-</div>
        </div>
        <div class="row">
          <div class="muted">鐘舵€?/div>
          <div id="status" class="mono muted">idle</div>
        </div>
      </div>
      <video id="preview" autoplay playsinline muted></video>
      <div class="muted">鑻ユ彁绀轰笉鏀寔鎽勫儚澶存潈闄愶紝璇峰皾璇曚娇鐢?HTTPS 鎴栧湪娴忚鍣ㄤ腑鍏佽鐩告満鏉冮檺銆?/div>
    </div>
    <script>
      const $ = (id) => document.getElementById(id);
      const elSession = $('session');
      const elStatus = $('status');
      const btnStart = $('btnStart');
      const video = $('preview');
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      async function ensureSessionId() {
        const u = new URL(location.href);
        let sid = u.searchParams.get('session') || '';
        if (sid) return sid;
        const res = await fetch('/webrtc/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        const json = await res.json().catch(() => ({}));
        sid = String(json.sessionId || '');
        if (!sid) throw new Error('no_session_id');
        u.searchParams.set('session', sid);
        history.replaceState(null, '', u.toString());
        return sid;
      }

      async function waitIceComplete(pc, timeoutMs) {
        if (pc.iceGatheringState === 'complete') return;
        await Promise.race([
          new Promise((resolve) => {
            const onChange = () => {
              if (pc.iceGatheringState === 'complete') {
                pc.removeEventListener('icegatheringstatechange', onChange);
                resolve();
              }
            };
            pc.addEventListener('icegatheringstatechange', onChange);
          }),
          sleep(timeoutMs || 2000)
        ]);
      }

      async function start() {
        btnStart.disabled = true;
        const sid = await ensureSessionId();
        elSession.textContent = sid;
        elStatus.textContent = 'requesting_camera';

        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        video.srcObject = stream;
        await video.play().catch(() => undefined);

        const pc = new RTCPeerConnection({ iceServers: [] });
        for (const track of stream.getTracks()) pc.addTrack(track, stream);

        pc.onconnectionstatechange = () => {
          const s = pc.connectionState || 'unknown';
          elStatus.textContent = s;
          elStatus.className = 'mono ' + (s === 'connected' ? 'ok' : s === 'failed' || s === 'disconnected' ? 'bad' : 'muted');
        };

        elStatus.textContent = 'creating_offer';
        const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);
        await waitIceComplete(pc, 2500);

        const finalOffer = pc.localDescription;
        if (!finalOffer) throw new Error('no_local_description');
        elStatus.textContent = 'sending_offer';
        await fetch('/webrtc/session/' + encodeURIComponent(sid) + '/offer', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: finalOffer.type, sdp: finalOffer.sdp })
        });

        elStatus.textContent = 'waiting_answer';
        for (;;) {
          const res = await fetch('/webrtc/session/' + encodeURIComponent(sid) + '/answer');
          if (res.ok) {
            const json = await res.json().catch(() => ({}));
            const answer = json && json.answer ? json.answer : null;
            if (answer && answer.type && answer.sdp) {
              await pc.setRemoteDescription(answer);
              elStatus.textContent = 'connected';
              return;
            }
          }
          await sleep(800);
        }
      }

      btnStart.addEventListener('click', () => start().catch((e) => {
        elStatus.textContent = 'error:' + (e && e.message ? e.message : String(e));
        elStatus.className = 'mono bad';
        btnStart.disabled = false;
      }));

      ensureSessionId().then((sid) => { elSession.textContent = sid; }).catch(() => undefined);
    </script>
  </body>
</html>`;

const castApi = new Elysia()
  .onRequest(({ request, set }) => {
    set.headers['Access-Control-Allow-Origin'] = '*'
    set.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS'
    set.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    if (request.method === 'OPTIONS') {
      set.status = 204
      return ''
    }
  })
  .group('/webrtc', (app) =>
    app
      .get('/', ({ set }) => {
        set.headers['content-type'] = 'text/html; charset=utf-8'
        return senderHtml
      })
      .get('/local-addrs', () => ({ ok: true, hostAddrs: getLocalIpv4Addrs(), port: castPort }))
      .post('/session', () => {
        const s = createWebrtcSession()
        return { ok: true, sessionId: s.id, ttlMs: WEBRTC_SESSION_TTL_MS }
      })
      .get(
        '/session/:id/offer',
        ({ params, set }) => {
          const s = webrtcSessions.get(params.id)
          if (!s?.offer) {
            set.status = 404
            return { ok: false, error: 'OFFER_NOT_FOUND' }
          }
          return { ok: true, offer: s.offer }
        },
        { params: t.Object({ id: t.String() }) }
      )
      .post(
        '/session/:id/offer',
        ({ params, body }) => {
          const s = webrtcSessions.get(params.id) ?? { id: params.id, createdAt: nowMs(), updatedAt: nowMs() }
          s.offer = body
          s.updatedAt = nowMs()
          webrtcSessions.set(params.id, s)
          return { ok: true }
        },
        { params: t.Object({ id: t.String() }), body: t.Object({ type: t.String(), sdp: t.String() }) }
      )
      .get(
        '/session/:id/answer',
        ({ params, set }) => {
          const s = webrtcSessions.get(params.id)
          if (!s?.answer) {
            set.status = 404
            return { ok: false, error: 'ANSWER_NOT_FOUND' }
          }
          return { ok: true, answer: s.answer }
        },
        { params: t.Object({ id: t.String() }) }
      )
      .post(
        '/session/:id/answer',
        ({ params, body }) => {
          const s = webrtcSessions.get(params.id)
          if (!s?.offer) return { ok: false, error: 'OFFER_NOT_FOUND' }
          s.answer = body
          s.updatedAt = nowMs()
          return { ok: true }
        },
        { params: t.Object({ id: t.String() }), body: t.Object({ type: t.String(), sdp: t.String() }) }
      )
  )

async function bootstrap(): Promise<void> {
  try {
    await cleanupLegacyPersistedMonitoringData()
  } catch {}

  try {
    await initNotesSessionOnStartup()
  } catch {}

  try {
    await castApi.listen({ hostname: castHost, port: castPort })
  } catch (e) {
    emitEvent('CAST_HTTP_LISTEN_FAILED', { host: castHost, port: castPort, error: String(e) })
  }

  if (transport === 'http') {
    try {
      await api.listen({ hostname: host, port })
    } catch (e) {
      emitEvent('BACKEND_HTTP_LISTEN_FAILED', { host, port, error: String(e) })
    }
  }

  emitEvent('BACKEND_STARTED', { transport, host, port, castHost, castPort, dbPath, csBaseUrl: csBaseUrl || undefined })
}

bootstrap().catch((e) => {
  process.stderr.write(String(e))
})



