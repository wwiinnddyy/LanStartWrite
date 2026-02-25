import Electrobun, { BrowserWindow, BuildConfig, Screen, Tray, Utils } from 'electrobun/bun'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { disposeCapabilityClient } from '../system/capabilities/client'
import { parseLanstartwriteUrl } from '../url_http_link'
import {
  AppWindowsManager,
  type CreateWindowFn as AppWindowsCreateWindowFn
} from './windows/appWindowsManager'
import { WindowRegistry } from './windows/registry'
import { buildDevWindowUrl, buildViewsWindowUrl } from './windows/routes'
import { MutPageOrchestrator, type CreateWindowFn as MutPageCreateWindowFn } from './windows/mutPageOrchestrator'
import {
  ToolbarOrchestrator,
  type CreateWindowFn as ToolbarCreateWindowFn,
  type ToolbarLayoutEvent
} from './windows/toolbarOrchestrator'
import type { ManagedWindowRecord, MainControlMessage, Rect, WindowRole } from './windows/types'

type SpawnedProcess = ReturnType<typeof Bun.spawn>

type MainRpcRequestMessage = {
  type: 'MAIN_RPC_REQUEST'
  id: number
  method: string
  params?: unknown
}

type BackendRpcResponseMessage = {
  type: 'RPC_RESPONSE'
  id: number
  ok: boolean
  result?: unknown
  error?: unknown
}

type PendingBackendRpc = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type CreateWindowInput = {
  key: string
  windowId: string
  kind?: string
  role: WindowRole
  title: string
  bounds: Rect
  alwaysOnTop?: boolean
  transparent?: boolean
  styleMask?: Record<string, boolean>
  titleBarStyle?: 'hidden' | 'hiddenInset' | 'default'
  frame?: boolean
  skipTaskbar?: boolean
  resizable?: boolean
  backgroundColor?: string
  focusable?: boolean
}

type AppMode = 'toolbar' | 'whiteboard' | 'video-show' | 'pdf'

const BACKEND_STDIO_PREFIX = '__LANSTART__'
const BACKEND_PORT = Number(process.env.LANSTART_BACKEND_PORT ?? 3131)
const BACKEND_HOST = String(process.env.LANSTART_BACKEND_HOST ?? '127.0.0.1')
const DEFAULT_BACKEND_RESTART_BASE_MS = 450
const MAX_BACKEND_RESTART_DELAY_MS = 5_000
const MAIN_WINDOW_KEY = 'floating-toolbar'
const HANDLE_WINDOW_KEY = 'floating-toolbar-handle'
const DEFAULT_WINDOW_ROLE: WindowRole = 'unknown'
const DEFAULT_PPT_PORT = Number(process.env.LANSTART_PPT_WRAPPER_PORT ?? 3133)
const DEFAULT_PPT_BASE_URL = String(process.env.LANSTART_PPT_WRAPPER_BASE_URL ?? `http://127.0.0.1:${DEFAULT_PPT_PORT}`)
const WINDOW_STATUS_VERSION = 1
const BACKEND_HEALTH_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}/health`
const TOOLBAR_STARTUP_TARGET_MARGIN = 8
const TOOLBAR_STARTUP_FROM_BOTTOM_OFFSET = 6

let isShuttingDown = false
let backendRestartAttempt = 0
let backendRestartTimer: ReturnType<typeof setTimeout> | undefined
let backendProcess: SpawnedProcess | undefined
let backendStdInBroken = false
let backendManualRestarting = false
let backendRuntimeBin = ''
let backendEntry = ''
let backendCwd = ''
let backendExtraEnv: Record<string, string> | undefined

let pptWrapperProcess: SpawnedProcess | undefined
let pptWrapperRestartTimer: ReturnType<typeof setTimeout> | undefined
let pptWrapperPort = DEFAULT_PPT_PORT
let pptWrapperBaseUrl = DEFAULT_PPT_BASE_URL

let tray: Tray | undefined
let currentAppMode: AppMode = 'toolbar'
let toolbarNoticeKind = ''
let uiZoomLevel = 0
let appearance: 'light' | 'dark' = 'light'
let nativeMicaEnabled = false
let legacyWindowImplementation = false
let mergeRendererPipelineEnabled = false
let systemWindowPreloadEnabled = false
let systemUiaTopmostEnabled = false
let annotationInputEnabled = false

let topmostTimer: ReturnType<typeof setInterval> | undefined

const pendingBackendRpc = new Map<number, PendingBackendRpc>()
let nextBackendRpcId = 1

const paintBoardBackgroundKey = 'paint-board:bg'
const paintBoardAnnotationOverlayKey = 'paint-board:annotation-overlay'
const screenAnnotationOverlayKey = 'paint-board:screen-annotation-overlay'

const windowCloseHandlers = new Map<string, () => void>()

let paintBoardKind: string | undefined
let floatingToolbarBoundsReportedAt = 0
let floatingToolbarBoundsWaiters: Array<() => void> = []
let startupChoreographyRunning = false

const rendererConfig = await BuildConfig.get()
const rendererType = rendererConfig.defaultRenderer

function log(scope: string, detail: unknown): void {
  const text = detail instanceof Error ? `${detail.name}:${detail.message}` : String(detail)
  console.log(`[main:${scope}] ${text}`)
}

function logError(scope: string, detail: unknown): void {
  const text = detail instanceof Error ? `${detail.name}:${detail.message}` : String(detail)
  console.error(`[main:${scope}] ${text}`)
}

function pushUniquePath(out: string[], candidate: string | undefined): void {
  if (!candidate) return
  const v = candidate.trim()
  if (!v) return
  if (!out.includes(v)) out.push(v)
}

function collectRuntimeRoots(): string[] {
  const roots: string[] = []
  pushUniquePath(roots, process.cwd())
  try {
    pushUniquePath(roots, resolve('.'))
  } catch {}
  try {
    const exec = process.execPath
    if (exec) {
      pushUniquePath(roots, resolve(exec, '..'))
      pushUniquePath(roots, resolve(exec, '..', '..'))
    }
  } catch {}

  const expanded: string[] = []
  for (const root of roots) {
    pushUniquePath(expanded, root)
    pushUniquePath(expanded, join(root, 'Resources'))
    pushUniquePath(expanded, join(root, 'resources'))
    pushUniquePath(expanded, join(root, 'Resources', 'app'))
    pushUniquePath(expanded, join(root, 'resources', 'app'))
    pushUniquePath(expanded, join(root, 'app'))
  }
  return expanded
}

function resolveFirstExisting(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return resolve(candidate)
    } catch {}
  }
  return undefined
}

function resolveBackendEntry(): string {
  const env = process.env.LANSTART_BACKEND_ENTRY
  if (env && existsSync(env)) return resolve(env)

  const roots = collectRuntimeRoots()
  const candidates: string[] = []
  for (const root of roots) {
    pushUniquePath(candidates, join(root, 'src', 'elysia', 'index.ts'))
    pushUniquePath(candidates, join(root, 'out', 'elysia', 'index.js'))
    pushUniquePath(candidates, join(root, 'Resources', 'out', 'elysia', 'index.js'))
    pushUniquePath(candidates, join(root, 'resources', 'out', 'elysia', 'index.js'))
    pushUniquePath(candidates, join(root, 'Resources', 'app', 'out', 'elysia', 'index.js'))
    pushUniquePath(candidates, join(root, 'resources', 'app', 'out', 'elysia', 'index.js'))
    pushUniquePath(candidates, join(root, 'app', 'out', 'elysia', 'index.js'))
  }

  const hit = resolveFirstExisting(candidates)
  if (hit) return hit
  return resolve(candidates[0] ?? join(process.cwd(), 'src', 'elysia', 'index.ts'))
}

function resolveBackendCwd(resolvedEntry: string): string {
  const env = process.env.LANSTART_BACKEND_CWD
  if (env && existsSync(env)) return resolve(env)

  const roots = collectRuntimeRoots()
  for (const root of roots) {
    const srcEntry = join(root, 'src', 'elysia', 'index.ts')
    const outEntry = join(root, 'out', 'elysia', 'index.js')
    if (resolve(srcEntry) === resolvedEntry || resolve(outEntry) === resolvedEntry) return root
  }

  return process.cwd()
}

function resolveCapabilityWorkerEntry(): string | undefined {
  const env = process.env.LANSTART_CAPABILITY_WORKER_ENTRY
  if (env && existsSync(env)) return resolve(env)

  const roots = collectRuntimeRoots()
  const candidates: string[] = []
  for (const root of roots) {
    pushUniquePath(candidates, join(root, 'src', 'system', 'capabilities', 'winapi', 'winapi.worker.ts'))
    pushUniquePath(candidates, join(root, 'out', 'system', 'capabilities', 'winapi', 'winapi.worker.js'))
    pushUniquePath(candidates, join(root, 'Resources', 'out', 'system', 'capabilities', 'winapi', 'winapi.worker.js'))
    pushUniquePath(candidates, join(root, 'resources', 'out', 'system', 'capabilities', 'winapi', 'winapi.worker.js'))
    pushUniquePath(
      candidates,
      join(root, 'Resources', 'app', 'out', 'system', 'capabilities', 'winapi', 'winapi.worker.js')
    )
    pushUniquePath(
      candidates,
      join(root, 'resources', 'app', 'out', 'system', 'capabilities', 'winapi', 'winapi.worker.js')
    )
    pushUniquePath(candidates, join(root, 'app', 'out', 'system', 'capabilities', 'winapi', 'winapi.worker.js'))
  }

  return resolveFirstExisting(candidates)
}

function resolvePptWrapperExecutable(): string | undefined {
  const env = process.env.LANSTART_PPT_WRAPPER_EXE
  if (env && existsSync(env)) return resolve(env)

  const roots = collectRuntimeRoots()
  const exeName = process.platform === 'win32' ? 'PptHttpWrapper.exe' : 'PptHttpWrapper'
  const candidates: string[] = []
  for (const root of roots) {
    pushUniquePath(candidates, join(root, 'out', 'ppt-wrapper', exeName))
    pushUniquePath(candidates, join(root, 'Resources', 'out', 'ppt-wrapper', exeName))
    pushUniquePath(candidates, join(root, 'resources', 'out', 'ppt-wrapper', exeName))
    pushUniquePath(candidates, join(root, 'Resources', 'app', 'out', 'ppt-wrapper', exeName))
    pushUniquePath(candidates, join(root, 'resources', 'app', 'out', 'ppt-wrapper', exeName))
    pushUniquePath(candidates, join(root, 'app', 'out', 'ppt-wrapper', exeName))
  }

  return resolveFirstExisting(candidates)
}

function resolveRuntimeBin(): string {
  const execPath = String(process.execPath ?? '')
  if (execPath && /(^|[\\/])bun(\.exe)?$/i.test(basename(execPath))) return execPath
  const fromPath = Bun.which('bun')
  if (fromPath) return fromPath
  return 'bun'
}

function resolveAppIconPath(): string | undefined {
  const roots = collectRuntimeRoots()
  const candidates: string[] = []
  for (const root of roots) {
    pushUniquePath(candidates, join(root, 'iconpack', 'LanStartWrite.png'))
    pushUniquePath(candidates, join(root, 'iconpack', 'LanStartWrite_old.ico'))
    pushUniquePath(candidates, join(root, 'LanStartWrite.png'))
  }
  return resolveFirstExisting(candidates)
}

function getDevServerUrl(): string | undefined {
  const injected = String(process.env.LANSTART_WEBVIEW_DEV_URL ?? '').trim()
  if (/^https?:\/\//i.test(injected)) return injected
  const vite = String(process.env.VITE_DEV_SERVER_URL ?? '').trim()
  if (/^https?:\/\//i.test(vite)) return vite
  return undefined
}

function resolveWindowUrl(windowId: string, kind?: string): string {
  const devUrl = getDevServerUrl()
  if (devUrl) return buildDevWindowUrl(devUrl, windowId, kind)
  return buildViewsWindowUrl(windowId, kind)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function intersectionArea(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
}
function getAllDisplays(): Array<{ id: number; bounds: Rect; workArea: Rect; isPrimary: boolean }> {
  try {
    const displays = Screen.getAllDisplays()
    if (Array.isArray(displays) && displays.length > 0) {
      return displays as Array<{ id: number; bounds: Rect; workArea: Rect; isPrimary: boolean }>
    }
  } catch {}
  try {
    const display = Screen.getPrimaryDisplay() as unknown as {
      id: number
      bounds: Rect
      workArea: Rect
      isPrimary: boolean
    }
    return [display]
  } catch {
    return [
      {
        id: 0,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
        isPrimary: true
      }
    ]
  }
}

function getDisplayByBounds(bounds: Rect): { id: number; bounds: Rect; workArea: Rect; isPrimary: boolean } {
  const displays = getAllDisplays()
  let best = displays.find((display) => display.isPrimary) ?? displays[0]!
  let score = -1
  for (const display of displays) {
    const current = intersectionArea(bounds, display.workArea)
    if (current > score) {
      score = current
      best = display
    }
  }
  return best
}

function getReferenceBounds(): Rect {
  const toolbar = registry.get(MAIN_WINDOW_KEY)
  if (toolbar) return registry.getFrame(toolbar)
  const primary = getAllDisplays().find((d) => d.isPrimary) ?? getAllDisplays()[0]!
  return primary.bounds
}

function getDisplayBoundsForCurrentContext(): Rect {
  const display = getDisplayByBounds(getReferenceBounds())
  return display.bounds
}

function pathToFileUrl(path: string | undefined): string | undefined {
  if (!path) return undefined
  try {
    return pathToFileURL(path).toString()
  } catch {
    return undefined
  }
}

function safeFrame(record: ManagedWindowRecord): Rect {
  try {
    return registry.getFrame(record)
  } catch {
    return record.lastVisibleBounds
  }
}

function emitWindowStatus(record: ManagedWindowRecord, event: string, extra?: Record<string, unknown>): void {
  sendToBackend({
    type: 'WINDOW_STATUS',
    version: WINDOW_STATUS_VERSION,
    ts: Date.now(),
    event,
    key: record.descriptor.key,
    role: record.descriptor.role,
    windowId: record.descriptor.windowId,
    kind: record.descriptor.kind,
    visible: record.virtualVisible,
    bounds: safeFrame(record),
    ...extra
  })
}

function emitProcessStatus(name: string, status: string, extra?: Record<string, unknown>): void {
  sendToBackend({
    type: 'PROCESS_STATUS',
    name,
    status,
    ts: Date.now(),
    ...extra
  })
}

function resetFloatingToolbarBoundsReported(): void {
  floatingToolbarBoundsReportedAt = 0
  floatingToolbarBoundsWaiters = []
}

function notifyFloatingToolbarBoundsReported(): void {
  floatingToolbarBoundsReportedAt = Date.now()
  const waiters = floatingToolbarBoundsWaiters
  floatingToolbarBoundsWaiters = []
  for (const resolve of waiters) {
    try {
      resolve()
    } catch {}
  }
}

function waitForFloatingToolbarBoundsReported(timeoutMs = 1_000): Promise<void> {
  if (floatingToolbarBoundsReportedAt > 0) return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    floatingToolbarBoundsWaiters.push(done)
    setTimeout(() => {
      if (settled) return
      floatingToolbarBoundsWaiters = floatingToolbarBoundsWaiters.filter((fn) => fn !== done)
      done()
    }, Math.max(0, Math.round(timeoutMs)))
  })
}

function applyZoomToRecord(record: ManagedWindowRecord): void {
  const zoom = Number.isFinite(uiZoomLevel) ? uiZoomLevel : 0
  try {
    record.win.webview.executeJavascript(`window.lanstart?.setZoomLevel?.(${JSON.stringify(zoom)});`)
  } catch {}
}

function applyZoomToAllWindows(): void {
  for (const record of registry.list()) applyZoomToRecord(record)
}

function setAnnotationPointerInput(enabled: boolean): void {
  annotationInputEnabled = enabled
  const cssValue = enabled ? 'auto' : 'none'
  const targets = [registry.get(paintBoardAnnotationOverlayKey), registry.get(screenAnnotationOverlayKey)]
  for (const record of targets) {
    if (!record) continue
    try {
      record.win.webview.executeJavascript(`document.documentElement.style.pointerEvents='${cssValue}';`)
    } catch {}
  }
}

function styleMaskForRole(role: WindowRole, input?: Record<string, boolean>): Record<string, boolean> {
  const base: Record<string, boolean> = { ...(input ?? {}) }
  if (
    role === 'toolbar' ||
    role === 'toolbar-handle' ||
    role === 'toolbar-subwindow' ||
    role === 'toolbar-notice'
  ) {
    base.Resizable = base.Resizable ?? false
  }
  if (role === 'mut-page' || role === 'mut-page-handle' || role === 'mut-page-thumbnails') {
    base.Resizable = base.Resizable ?? false
  }
  if (role === 'annotation-overlay' || role === 'screen-annotation-overlay') {
    base.Resizable = false
  }
  return base
}

function attachManagedWindowLifecycle(record: ManagedWindowRecord): void {
  const key = record.descriptor.key
  const win = record.win

  emitWindowStatus(record, 'created')

  const onMove = () => emitWindowStatus(record, 'move')
  const onResize = () => emitWindowStatus(record, 'resize')
  const onFocus = () => emitWindowStatus(record, 'focus')
  const onClose = () => {
    emitWindowStatus(record, 'closed')
    registry.remove(key)
    const handler = windowCloseHandlers.get(key)
    if (handler) {
      try {
        handler()
      } catch {}
    }
    windowCloseHandlers.delete(key)
  }

  win.on('move', onMove)
  win.on('resize', onResize)
  win.on('focus', onFocus)
  win.on('close', onClose)
  win.webview.on('dom-ready', () => {
    applyZoomToRecord(record)
    emitWindowStatus(record, 'did-finish-load')
  })
  win.webview.on('did-navigate', () => {
    emitWindowStatus(record, 'did-navigate')
  })
}

function createManagedWindow(input: CreateWindowInput): ManagedWindowRecord {
  const existing = registry.get(input.key)
  if (existing) return existing

  const descriptor = {
    key: input.key,
    windowId: input.windowId,
    kind: input.kind,
    role: input.role ?? DEFAULT_WINDOW_ROLE,
    defaultBounds: input.bounds,
    alwaysOnTop: Boolean(input.alwaysOnTop)
  }

  // Build styleMask with role-specific defaults
  const baseStyleMask = styleMaskForRole(input.role, input.styleMask)
  
  // Add frame property if specified (default to false for toolbar-like windows)
  const shouldHaveFrame = input.frame ?? (input.role === 'settings' || input.role === 'child' || input.role === 'watcher')
  
  // Add skipTaskbar for toolbar-like windows
  const shouldSkipTaskbar = input.skipTaskbar ?? (
    input.role === 'toolbar' ||
    input.role === 'toolbar-handle' ||
    input.role === 'toolbar-subwindow' ||
    input.role === 'toolbar-notice' ||
    input.role === 'annotation-overlay' ||
    input.role === 'screen-annotation-overlay' ||
    input.role === 'mut-page' ||
    input.role === 'mut-page-handle' ||
    input.role === 'mut-page-thumbnails'
  )

  const win = new BrowserWindow({
    title: input.title,
    frame: {
      x: input.bounds.x,
      y: input.bounds.y,
      width: input.bounds.width,
      height: input.bounds.height
    },
    url: resolveWindowUrl(input.windowId, input.kind),
    html: null,
    preload: null,
    renderer: rendererType,
    styleMask: {
      ...baseStyleMask,
      Titled: shouldHaveFrame,
      Closable: true,
      Miniaturizable: shouldHaveFrame,
      Resizable: input.resizable ?? (input.role === 'settings' || input.role === 'child'),
      ...(shouldSkipTaskbar ? { Utility: true } : {})
    },
    titleBarStyle: input.titleBarStyle ?? (shouldHaveFrame ? 'default' : 'hidden'),
    transparent: Boolean(input.transparent),
    sandbox: false,
    ...(input.focusable === false ? { focusable: false } : {})
  })

  const record = registry.upsert(descriptor, win)
  attachManagedWindowLifecycle(record)
  
  // Set always on top if needed
  if (input.alwaysOnTop) {
    try {
      win.setAlwaysOnTop(true)
    } catch {}
  }
  
  if (process.env.LANSTART_OPEN_DEVTOOLS === '1') {
    try {
      win.webview.openDevTools()
    } catch {}
  }
  return record
}

const registry = new WindowRegistry({
  onShow(record) {
    emitWindowStatus(record, 'show')
  },
  onHide(record) {
    emitWindowStatus(record, 'hide')
  }
})

const toolbarOrchestrator = new ToolbarOrchestrator(
  registry,
  createManagedWindow as ToolbarCreateWindowFn,
  (event: ToolbarLayoutEvent) => {
    if (event !== 'toolbar-bounds-reported') return
    const toolbar = registry.get(MAIN_WINDOW_KEY)
    if (!toolbar) return
    emitWindowStatus(toolbar, 'bounds-reported')
    notifyFloatingToolbarBoundsReported()
  }
)

const appWindowsManager = new AppWindowsManager(registry, createManagedWindow as AppWindowsCreateWindowFn)
const mutPageOrchestrator = new MutPageOrchestrator(
  registry,
  createManagedWindow as MutPageCreateWindowFn,
  () => toolbarOrchestrator.getToolbarBounds(),
  {
    onNeedAlignToolbarWithMutPageOnce() {
      alignFloatingToolbarWithMutPageOnce()
    }
  }
)

function closeAndForgetWindow(key: string): void {
  const record = registry.get(key)
  if (!record) return
  try {
    record.win.close()
  } catch {}
  registry.remove(key)
}

function ensurePaintBoardBackgroundWindow(kind?: string): ManagedWindowRecord {
  const existing = registry.get(paintBoardBackgroundKey)
  if (existing) {
    if ((existing.descriptor.kind ?? undefined) === (kind ?? undefined)) return existing
    closeAndForgetWindow(paintBoardBackgroundKey)
  }

  paintBoardKind = kind
  const bounds = getDisplayBoundsForCurrentContext()
  return createManagedWindow({
    key: paintBoardBackgroundKey,
    windowId: 'paint-board',
    kind,
    role: 'paint-board',
    title: kind === 'video-show' ? 'Video Show' : kind === 'pdf' ? 'PDF' : 'Whiteboard',
    bounds,
    transparent: true,
    alwaysOnTop: true,
    titleBarStyle: 'hidden',
    styleMask: { Resizable: false }
  })
}

function ensurePaintBoardAnnotationOverlayWindow(): ManagedWindowRecord {
  const existing = registry.get(paintBoardAnnotationOverlayKey)
  if (existing) return existing
  const bounds = getDisplayBoundsForCurrentContext()
  const created = createManagedWindow({
    key: paintBoardAnnotationOverlayKey,
    windowId: 'paint-board',
    kind: 'annotation',
    role: 'annotation-overlay',
    title: 'Annotation Overlay',
    bounds,
    transparent: true,
    alwaysOnTop: true,
    titleBarStyle: 'hidden',
    styleMask: { Resizable: false }
  })
  setAnnotationPointerInput(annotationInputEnabled)
  return created
}

function ensureScreenAnnotationOverlayWindow(): ManagedWindowRecord {
  const existing = registry.get(screenAnnotationOverlayKey)
  if (existing) return existing
  const bounds = getDisplayBoundsForCurrentContext()
  const created = createManagedWindow({
    key: screenAnnotationOverlayKey,
    windowId: 'paint-board',
    kind: 'annotation',
    role: 'screen-annotation-overlay',
    title: 'Screen Annotation Overlay',
    bounds,
    transparent: true,
    alwaysOnTop: true,
    titleBarStyle: 'hidden',
    styleMask: { Resizable: false },
    focusable: false
  })
  setAnnotationPointerInput(annotationInputEnabled)
  return created
}

function repositionFullscreenWindows(): void {
  const bounds = getDisplayBoundsForCurrentContext()
  for (const key of [paintBoardBackgroundKey, paintBoardAnnotationOverlayKey, screenAnnotationOverlayKey]) {
    const record = registry.get(key)
    if (!record) continue
    registry.setFrame(record, bounds)
    if (record.virtualVisible) registry.show(record, bounds)
  }
}

function applyModeWindows(mode: AppMode): void {
  currentAppMode = mode
  if (mode === 'toolbar') {
    mutPageOrchestrator.setModeVisible(false)
    const screenOverlay = registry.get(screenAnnotationOverlayKey)
    if (screenOverlay) registry.hide(screenOverlay)
    const annotationOverlay = registry.get(paintBoardAnnotationOverlayKey)
    if (annotationOverlay) registry.hide(annotationOverlay)
    const background = registry.get(paintBoardBackgroundKey)
    if (background) registry.hide(background)
    return
  }

  const kind = mode === 'video-show' ? 'video-show' : mode === 'pdf' ? 'pdf' : undefined
  const background = ensurePaintBoardBackgroundWindow(kind)
  const annotationOverlay = ensurePaintBoardAnnotationOverlayWindow()
  repositionFullscreenWindows()
  registry.show(background)
  registry.show(annotationOverlay)
  const screenOverlay = registry.get(screenAnnotationOverlayKey)
  if (screenOverlay) registry.hide(screenOverlay)
  mutPageOrchestrator.setModeVisible(true)
}

function setScreenAnnotationVisible(visible: boolean): void {
  if (currentAppMode !== 'toolbar') {
    const screenOverlay = registry.get(screenAnnotationOverlayKey)
    if (screenOverlay) registry.hide(screenOverlay)
    return
  }

  if (visible) {
    const overlay = ensureScreenAnnotationOverlayWindow()
    repositionFullscreenWindows()
    registry.show(overlay)
    return
  }

  const overlay = registry.get(screenAnnotationOverlayKey)
  if (overlay) registry.hide(overlay)
}

function waitForWindowDomReady(key: string, timeoutMs = 2_200): Promise<void> {
  const record = registry.get(key)
  if (!record) return Promise.resolve()
  const webview = (record.win as any)?.webview
  try {
    if (webview && typeof webview.isLoading === 'function' && webview.isLoading() === false) {
      return Promise.resolve()
    }
  } catch {}

  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    try {
      if (webview && typeof webview.once === 'function') webview.once('dom-ready', done)
    } catch {}
    setTimeout(done, Math.max(0, Math.round(timeoutMs)))
  })
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function computeStartupToolbarChoreography():
  | {
      x: number
      startY: number
      targetY: number
    }
  | undefined {
  const toolbarBounds = toolbarOrchestrator.getToolbarBounds()
  if (!toolbarBounds) return undefined

  const display = getDisplayByBounds(toolbarBounds)
  const bounds = display.bounds
  const workArea = display.workArea
  const gap = toolbarOrchestrator.getToolbarHandleGap()
  const handleWidth = toolbarOrchestrator.getToolbarHandleWidth()
  const totalWidth = toolbarBounds.width + gap + handleWidth

  const x = clamp(
    Math.round(bounds.x + (bounds.width - totalWidth) / 2),
    bounds.x,
    bounds.x + bounds.width - totalWidth
  )
  const targetY = clamp(
    Math.round(workArea.y + workArea.height - toolbarBounds.height - TOOLBAR_STARTUP_TARGET_MARGIN),
    bounds.y,
    bounds.y + bounds.height - toolbarBounds.height
  )
  const startY = Math.round(bounds.y + bounds.height + TOOLBAR_STARTUP_FROM_BOTTOM_OFFSET)
  return { x, startY, targetY }
}

function alignFloatingToolbarWithMutPageOnce(): void {
  const existingMutBounds = mutPageOrchestrator.getMutPageBounds()
  if (!existingMutBounds) return

  mutPageOrchestrator.reposition()

  const mutBounds = mutPageOrchestrator.getMutPageBounds() ?? existingMutBounds
  const toolbarBounds = toolbarOrchestrator.getToolbarBounds()
  if (!toolbarBounds) return

  const display = getDisplayByBounds(mutBounds)
  const bounds = display.bounds

  const toolbarGap = toolbarOrchestrator.getToolbarHandleGap()
  const toolbarHandleWidth = toolbarOrchestrator.getToolbarHandleWidth()
  const totalWidth = toolbarBounds.width + toolbarGap + toolbarHandleWidth

  const xMin = bounds.x
  const xMax = bounds.x + bounds.width - totalWidth
  const centeredX = Math.round(bounds.x + (bounds.width - totalWidth) / 2)
  let nextX = clamp(centeredX, xMin, xMax)

  const mutGroupLeft = mutBounds.x
  const mutGroupRight =
    mutBounds.x +
    mutBounds.width +
    mutPageOrchestrator.getMutPageHandleGap() +
    mutPageOrchestrator.getMutPageHandleWidth()
  const overlapGap = 8
  const overlaps = nextX < mutGroupRight && nextX + totalWidth > mutGroupLeft
  if (overlaps) {
    const leftX = clamp(Math.round(mutGroupLeft - totalWidth - overlapGap), xMin, xMax)
    const rightX = clamp(Math.round(mutGroupRight + overlapGap), xMin, xMax)
    const leftDistance = Math.abs(leftX - centeredX)
    const rightDistance = Math.abs(rightX - centeredX)
    nextX = rightDistance <= leftDistance ? rightX : leftX
  }

  const yMin = bounds.y
  const yMax = bounds.y + bounds.height - toolbarBounds.height
  const mpBottom = mutBounds.y + mutBounds.height
  const nextY = clamp(mpBottom - toolbarBounds.height, yMin, yMax)

  if (toolbarBounds.x === nextX && toolbarBounds.y === nextY) return
  toolbarOrchestrator.moveToolbarTo({ x: nextX, y: nextY }, { show: true })
  toolbarOrchestrator.forceReposition()
}

async function runMainWindowStartupChoreography(): Promise<void> {
  if (startupChoreographyRunning) return
  startupChoreographyRunning = true
  try {
    await Promise.all([
      waitForWindowDomReady(MAIN_WINDOW_KEY, 2_400),
      waitForWindowDomReady(HANDLE_WINDOW_KEY, 2_400),
      waitForFloatingToolbarBoundsReported(1_200)
    ])

    const plan = computeStartupToolbarChoreography()
    if (!plan) {
      toolbarOrchestrator.showPrimaryWindows({ focus: true })
      toolbarOrchestrator.forceReposition()
      return
    }

    toolbarOrchestrator.moveToolbarTo({ x: plan.x, y: plan.startY }, { show: true })

    const durationMs = 650
    const startAt = Date.now()
    while (true) {
      const t = Math.max(0, Math.min(1, (Date.now() - startAt) / Math.max(1, durationMs)))
      const eased = easeOutCubic(t)
      const y = Math.round(plan.startY + (plan.targetY - plan.startY) * eased)
      toolbarOrchestrator.moveToolbarTo({ x: plan.x, y }, { show: true, focus: t >= 1 })
      if (t >= 1) break
      await Bun.sleep(16)
    }
    toolbarOrchestrator.forceReposition()
  } catch (error) {
    logError('startup-choreography', error)
    toolbarOrchestrator.showPrimaryWindows({ focus: true })
    toolbarOrchestrator.forceReposition()
  } finally {
    startupChoreographyRunning = false
  }
}

function reapplyTopmost(): void {
  for (const record of registry.list()) {
    if (!record.virtualVisible) continue
    if (!record.descriptor.alwaysOnTop) continue
    try {
      record.win.setAlwaysOnTop(true)
    } catch {}
  }
  toolbarOrchestrator.reapplyTopmost()
}

function startTopmostPolling(): void {
  if (topmostTimer) return
  topmostTimer = setInterval(() => {
    if (!systemUiaTopmostEnabled) return
    reapplyTopmost()
  }, 1300)
}

function stopTopmostPolling(): void {
  if (!topmostTimer) return
  clearInterval(topmostTimer)
  topmostTimer = undefined
}

function rejectAllPendingBackendRpc(error: Error): void {
  for (const [id, pending] of pendingBackendRpc.entries()) {
    pendingBackendRpc.delete(id)
    clearTimeout(pending.timer)
    pending.reject(error)
  }
}

function sendToBackend(message: unknown): void {
  const proc = backendProcess
  if (!proc) return
  if (backendStdInBroken) return
  const stdin = proc.stdin
  if (!stdin || typeof stdin === 'number' || typeof (stdin as any).write !== 'function') return
  try {
    ;(stdin as any).write(`${JSON.stringify(message)}\n`)
  } catch (error) {
    backendStdInBroken = true
    logError('backend-stdin', error)
  }
}

function requestBackendRpc<T>(method: string, params?: unknown, timeoutMs = 40_000): Promise<T> {
  if (!backendProcess) return Promise.reject(new Error('backend_not_started'))
  const id = nextBackendRpcId++
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingBackendRpc.delete(id)
      reject(new Error(`backend_rpc_timeout:${method}`))
    }, Math.max(1, Math.round(timeoutMs)))
    pendingBackendRpc.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
    sendToBackend({ type: 'RPC_REQUEST', id, method, params })
  })
}

async function readStreamLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) onLine(line)
    }
    buffer += decoder.decode()
    if (buffer.trim()) onLine(buffer)
  } catch {}
}

function handleBackendRpcResponse(message: BackendRpcResponseMessage): void {
  const id = Number(message.id)
  if (!Number.isFinite(id)) return
  const pending = pendingBackendRpc.get(id)
  if (!pending) return
  pendingBackendRpc.delete(id)
  clearTimeout(pending.timer)
  if (message.ok) {
    pending.resolve(message.result)
    return
  }
  pending.reject(new Error(String(message.error ?? 'backend_rpc_failed')))
}
async function selectFileDialog(options: {
  allowedFileTypes: string
  canChooseFiles: boolean
  canChooseDirectory: boolean
}): Promise<string | undefined> {
  const items = await Utils.openFileDialog({
    allowedFileTypes: options.allowedFileTypes,
    canChooseFiles: options.canChooseFiles,
    canChooseDirectory: options.canChooseDirectory,
    allowsMultipleSelection: false
  }).catch(() => [])
  const path = Array.isArray(items) ? String(items[0] ?? '') : ''
  return path || undefined
}

async function handleMainRpcRequest(message: MainRpcRequestMessage): Promise<void> {
  const id = Number(message.id)
  if (!Number.isFinite(id)) return
  const method = String(message.method ?? '')
  const params = message.params as Record<string, unknown> | undefined

  try {
    if (method === 'selectImageFile') {
      const file = await selectFileDialog({
        allowedFileTypes: 'png,jpg,jpeg,webp,bmp,gif',
        canChooseFiles: true,
        canChooseDirectory: false
      })
      sendToBackend({ type: 'MAIN_RPC_RESPONSE', id, ok: true, result: { fileUrl: pathToFileUrl(file) } })
      return
    }

    if (method === 'selectPdfFile') {
      const file = await selectFileDialog({
        allowedFileTypes: 'pdf',
        canChooseFiles: true,
        canChooseDirectory: false
      })
      sendToBackend({ type: 'MAIN_RPC_RESPONSE', id, ok: true, result: { fileUrl: pathToFileUrl(file) } })
      return
    }

    if (method === 'selectDirectory') {
      const dir = await selectFileDialog({
        allowedFileTypes: '*',
        canChooseFiles: false,
        canChooseDirectory: true
      })
      sendToBackend({
        type: 'MAIN_RPC_RESPONSE',
        id,
        ok: true,
        result: { dir, dirUrl: pathToFileUrl(dir) }
      })
      return
    }

    if (method === 'selectCunoxExportFile') {
      const dir = await selectFileDialog({
        allowedFileTypes: '*',
        canChooseFiles: false,
        canChooseDirectory: true
      })
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      const file = dir ? join(dir, `LanStartWrite-${ts}.cunox`) : undefined
      sendToBackend({
        type: 'MAIN_RPC_RESPONSE',
        id,
        ok: true,
        result: { file, fileUrl: pathToFileUrl(file) }
      })
      return
    }

    if (method === 'selectCunoxImportFile') {
      const file = await selectFileDialog({
        allowedFileTypes: 'cunox,zip',
        canChooseFiles: true,
        canChooseDirectory: false
      })
      sendToBackend({
        type: 'MAIN_RPC_RESPONSE',
        id,
        ok: true,
        result: { file, fileUrl: pathToFileUrl(file) }
      })
      return
    }

    if (method === 'clipboardWriteText') {
      const text = typeof params?.text === 'string' ? params.text : ''
      Utils.clipboardWriteText(text)
      sendToBackend({ type: 'MAIN_RPC_RESPONSE', id, ok: true, result: null })
      return
    }

    if (method === 'getToolbarNoticeKind') {
      sendToBackend({ type: 'MAIN_RPC_RESPONSE', id, ok: true, result: { kind: toolbarNoticeKind } })
      return
    }

    if (method === 'setToolbarNoticeVisible') {
      const visible = Boolean(params?.visible)
      const kind = typeof params?.kind === 'string' ? params.kind : ''
      if (kind) toolbarNoticeKind = kind
      handleBackendControlMessage({ type: 'SET_NOTICE_VISIBLE', visible })
      sendToBackend({ type: 'MAIN_RPC_RESPONSE', id, ok: true, result: null })
      return
    }

    if (method === 'setToolbarNoticeBounds') {
      const width = Number(params?.width)
      const height = Number(params?.height)
      if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('BAD_NOTICE_BOUNDS')
      handleBackendControlMessage({ type: 'SET_SUBWINDOW_BOUNDS', kind: 'notice', width, height })
      sendToBackend({ type: 'MAIN_RPC_RESPONSE', id, ok: true, result: null })
      return
    }

    if (method === 'restartBackendAll') {
      await restartBackend('rpc')
      sendToBackend({ type: 'MAIN_RPC_RESPONSE', id, ok: true, result: null })
      return
    }

    if (method === 'shutdown') {
      sendToBackend({ type: 'MAIN_RPC_RESPONSE', id, ok: true, result: null })
      void requestQuit()
      return
    }

    throw new Error(`UNKNOWN_MAIN_RPC_METHOD:${method}`)
  } catch (error) {
    sendToBackend({
      type: 'MAIN_RPC_RESPONSE',
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

function handleBackendControlMessage(message: unknown): void {
  if (!message || typeof message !== 'object') return
  const type = String((message as any).type ?? '')
  if (!type) return

  if (type === 'RPC_RESPONSE') {
    handleBackendRpcResponse(message as BackendRpcResponseMessage)
    return
  }

  if (type === 'MAIN_RPC_REQUEST') {
    void handleMainRpcRequest(message as MainRpcRequestMessage)
    return
  }

  if (type === 'SET_APPEARANCE') {
    const next = String((message as any).appearance ?? '')
    appearance = next === 'dark' ? 'dark' : 'light'
    return
  }

  if (type === 'SET_UI_ZOOM') {
    const next = Number((message as any).zoom)
    if (Number.isFinite(next)) {
      uiZoomLevel = next
      applyZoomToAllWindows()
    }
    return
  }

  if (type === 'SET_NATIVE_MICA') {
    nativeMicaEnabled = Boolean((message as any).enabled)
    return
  }

  if (type === 'SET_LEGACY_WINDOW_IMPLEMENTATION') {
    legacyWindowImplementation = Boolean((message as any).enabled)
    return
  }

  if (type === 'SET_MERGE_RENDERER_PIPELINE') {
    mergeRendererPipelineEnabled = Boolean((message as any).enabled)
    return
  }

  if (type === 'SET_WINDOW_PRELOAD') {
    systemWindowPreloadEnabled = Boolean((message as any).enabled)
    return
  }

  if (type === 'SET_SYSTEM_UIA_TOPMOST') {
    systemUiaTopmostEnabled = Boolean((message as any).enabled)
    return
  }

  if (type === 'SET_NOTICE_VISIBLE') {
    const kind = String((message as any).kind ?? '')
    if (kind) toolbarNoticeKind = kind
  }

  if (toolbarOrchestrator.handleMainMessage(message as MainControlMessage)) return
  if (appWindowsManager.handleMainMessage(message as MainControlMessage)) return
  if (mutPageOrchestrator.handleMainMessage(message as MainControlMessage)) return

  if (type === 'SET_APP_MODE') {
    const raw = String((message as any).mode ?? '')
    const mode: AppMode = raw === 'whiteboard' ? 'whiteboard' : raw === 'video-show' ? 'video-show' : raw === 'pdf' ? 'pdf' : 'toolbar'
    toolbarOrchestrator.hideAllSubwindows()
    applyModeWindows(mode)
    if (mode !== 'toolbar') {
      setTimeout(() => {
        try {
          alignFloatingToolbarWithMutPageOnce()
        } catch {}
      }, 0)
    }
    return
  }

  if (type === 'SET_ANNOTATION_INPUT') {
    setAnnotationPointerInput(Boolean((message as any).enabled))
    return
  }

  if (type === 'SET_SCREEN_ANNOTATION_VISIBLE') {
    setScreenAnnotationVisible(Boolean((message as any).visible))
    return
  }

  if (type === 'QUIT_APP') {
    void requestQuit()
    return
  }
}

function attachBackendPipes(proc: SpawnedProcess): void {
  if (proc.stdout && typeof proc.stdout !== 'number') {
    void readStreamLines(proc.stdout, (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      if (!trimmed.startsWith(BACKEND_STDIO_PREFIX)) {
        console.log(trimmed)
        return
      }
      const jsonRaw = trimmed.slice(BACKEND_STDIO_PREFIX.length)
      try {
        const message = JSON.parse(jsonRaw)
        handleBackendControlMessage(message)
      } catch (error) {
        logError('backend-stdout-json', error)
      }
    })
  }

  if (proc.stderr && typeof proc.stderr !== 'number') {
    void readStreamLines(proc.stderr, (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      console.error(trimmed)
    })
  }
}

async function waitForHealth(url: string, timeoutMs = 3_500): Promise<boolean> {
  const startAt = Date.now()
  while (Date.now() - startAt < timeoutMs) {
    try {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 480)
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(t)
      if (res.ok) return true
    } catch {}
    await Bun.sleep(120)
  }
  return false
}

async function stopBackend(): Promise<void> {
  const proc = backendProcess
  if (!proc) return
  try {
    await requestBackendRpc('shutdown', {}, 1_200).catch(() => undefined)
  } catch {}
  try {
    proc.kill()
  } catch {}
  await proc.exited.catch(() => undefined)
}

function scheduleBackendRestart(reason: string): void {
  if (isShuttingDown) return
  if (backendManualRestarting) return
  if (backendRestartTimer) return
  backendRestartAttempt += 1
  const delay = Math.min(
    MAX_BACKEND_RESTART_DELAY_MS,
    DEFAULT_BACKEND_RESTART_BASE_MS * Math.pow(2, Math.max(0, backendRestartAttempt - 1))
  )
  backendRestartTimer = setTimeout(() => {
    backendRestartTimer = undefined
    void startBackend(reason).catch((error) => {
      logError('backend-restart', error)
      scheduleBackendRestart('restart-failed')
    })
  }, delay)
}

async function startBackend(reason: string): Promise<void> {
  const resolvedEntry = resolveBackendEntry()
  const resolvedCwd = resolveBackendCwd(resolvedEntry)
  const resolvedRuntimeBin = resolveRuntimeBin()
  const resolvedWorkerEntry = resolveCapabilityWorkerEntry()

  backendRuntimeBin = resolvedRuntimeBin
  backendEntry = resolvedEntry
  backendCwd = resolvedCwd
  backendStdInBroken = false

  const env: Record<string, string> = {
    ...process.env,
    LANSTART_BACKEND_PORT: String(BACKEND_PORT),
    LANSTART_BACKEND_HOST: BACKEND_HOST,
    LANSTART_DB_PATH: String(process.env.LANSTART_DB_PATH ?? join(process.cwd(), 'leveldb')),
    LANSTART_BACKEND_TRANSPORT: String(process.env.LANSTART_BACKEND_TRANSPORT ?? 'http'),
    LANSTART_PPT_WRAPPER_PORT: String(pptWrapperPort),
    LANSTART_PPT_WRAPPER_BASE_URL: pptWrapperBaseUrl,
    ...(backendExtraEnv ?? {})
  }

  if (resolvedWorkerEntry) env.LANSTART_CAPABILITY_WORKER_ENTRY = resolvedWorkerEntry

  log(
    'backend-spawn',
    `reason=${reason} runtimeBin=${resolvedRuntimeBin} backendEntry=${resolvedEntry} backendCwd=${resolvedCwd}`
  )

  const proc = Bun.spawn({
    cmd: [resolvedRuntimeBin, resolvedEntry],
    cwd: resolvedCwd,
    env,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe'
  })

  backendProcess = proc
  attachBackendPipes(proc)
  emitProcessStatus('backend', 'spawned', { pid: proc.pid, reason })

  void proc.exited.then((code) => {
    if (backendProcess !== proc) return
    backendProcess = undefined
    backendStdInBroken = true
    rejectAllPendingBackendRpc(new Error(`backend_exited:${code}`))
    emitProcessStatus('backend', 'exited', { code })
    if (!isShuttingDown) scheduleBackendRestart(`exit:${code}`)
  })

  const healthy = await waitForHealth(BACKEND_HEALTH_URL, 3_500)
  if (!healthy) {
    logError('backend-health', `health check failed: ${BACKEND_HEALTH_URL}`)
  } else {
    backendRestartAttempt = 0
    emitProcessStatus('backend', 'healthy', { url: BACKEND_HEALTH_URL })
  }
}

async function restartBackend(reason: string): Promise<void> {
  backendManualRestarting = true
  try {
    if (backendRestartTimer) {
      clearTimeout(backendRestartTimer)
      backendRestartTimer = undefined
    }
    await stopBackend()
    await startBackend(reason)
  } finally {
    backendManualRestarting = false
  }
}
async function startPptWrapper(): Promise<void> {
  const executable = resolvePptWrapperExecutable()
  if (!executable) {
    log('ppt-wrapper', 'not found, skip')
    return
  }

  const port = Number(process.env.LANSTART_PPT_WRAPPER_PORT ?? DEFAULT_PPT_PORT)
  pptWrapperPort = Number.isFinite(port) && port > 0 ? port : DEFAULT_PPT_PORT
  pptWrapperBaseUrl = String(process.env.LANSTART_PPT_WRAPPER_BASE_URL ?? `http://127.0.0.1:${pptWrapperPort}`)

  const proc = Bun.spawn({
    cmd: [executable, '--port', String(pptWrapperPort)],
    cwd: process.cwd(),
    env: { ...process.env, LANSTART_PPT_WRAPPER_PORT: String(pptWrapperPort) },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe'
  })

  pptWrapperProcess = proc
  emitProcessStatus('ppt-wrapper', 'spawned', { pid: proc.pid, port: pptWrapperPort })

  if (proc.stdout && typeof proc.stdout !== 'number') {
    void readStreamLines(proc.stdout, (line) => {
      const trimmed = line.trim()
      if (trimmed) console.log(`[ppt-wrapper] ${trimmed}`)
    })
  }
  if (proc.stderr && typeof proc.stderr !== 'number') {
    void readStreamLines(proc.stderr, (line) => {
      const trimmed = line.trim()
      if (trimmed) console.error(`[ppt-wrapper] ${trimmed}`)
    })
  }
  void proc.exited.then((code) => {
    if (pptWrapperProcess !== proc) return
    pptWrapperProcess = undefined
    emitProcessStatus('ppt-wrapper', 'exited', { code })
    if (isShuttingDown) return
    if (pptWrapperRestartTimer) return
    pptWrapperRestartTimer = setTimeout(() => {
      pptWrapperRestartTimer = undefined
      void startPptWrapper().catch((error) => logError('ppt-wrapper-restart', error))
    }, 800)
  })

  await waitForHealth(`${pptWrapperBaseUrl.replace(/\/+$/, '')}/health`, 3_000).catch(() => false)
}

async function stopPptWrapper(): Promise<void> {
  const proc = pptWrapperProcess
  if (!proc) return
  try {
    proc.kill()
  } catch {}
  await proc.exited.catch(() => undefined)
}

function ensureTray(): void {
  if (tray) return
  const icon = resolveAppIconPath()
  if (!icon) {
    log('tray', 'icon missing, skip tray')
    return
  }

  const created = new Tray({
    image: icon,
    title: 'LanStartWrite',
    template: false,
    width: 16,
    height: 16
  })

  created.setMenu([
    { type: 'normal', label: '打开设置', action: 'open-settings' },
    { type: 'separator' },
    { type: 'normal', label: '重启后端', action: 'restart-backend' },
    { type: 'normal', label: '退出', action: 'quit-app' }
  ])

  created.on('tray-clicked', (event: unknown) => {
    const data = (event as any)?.data ?? {}
    const action = String(data?.action ?? '')
    if (action === 'open-settings') {
      appWindowsManager.openSettingsWindow()
      return
    }
    if (action === 'restart-backend') {
      void restartBackend('tray').catch((error) => logError('tray-restart', error))
      return
    }
    if (action === 'quit-app') {
      void requestQuit()
      return
    }

    const toolbar = registry.get(MAIN_WINDOW_KEY)
    if (toolbar) registry.show(toolbar, undefined, { focus: true })
  })

  tray = created
}

function applyMainWindowBootstrap(): void {
  resetFloatingToolbarBoundsReported()
  toolbarOrchestrator.ensurePrimaryWindows({ show: false })
}

function handleOpenUrl(url: string): void {
  const raw = String(url ?? '').trim()
  if (!raw.startsWith('lanstartwrite://')) return
  const parsed = parseLanstartwriteUrl(raw)
  if (!parsed) return
  void requestBackendRpc('postCommand', { command: parsed.command, payload: parsed.payload }).catch(() => undefined)
}

function wireAppEvents(): void {
  Electrobun.events.on('open-url', (event: unknown) => {
    const url = String((event as any)?.data?.url ?? '')
    if (url) handleOpenUrl(url)
  })
}

async function bootstrap(): Promise<void> {
  wireAppEvents()
  const initialUrl = process.argv.find((arg) => String(arg).startsWith('lanstartwrite://'))
  if (initialUrl) handleOpenUrl(initialUrl)

  await startPptWrapper().catch((error) => logError('ppt-wrapper-start', error))
  backendExtraEnv = {
    LANSTART_PPT_WRAPPER_PORT: String(pptWrapperPort),
    LANSTART_PPT_WRAPPER_BASE_URL: pptWrapperBaseUrl
  }
  await startBackend('initial')

  applyMainWindowBootstrap()
  void runMainWindowStartupChoreography()
  startTopmostPolling()
  ensureTray()

  emitProcessStatus('main', 'ready', {
    pid: process.pid,
    runtimeBin: backendRuntimeBin,
    backendEntry,
    backendCwd,
    renderer: rendererType,
    devUrl: getDevServerUrl() ?? null,
    appearance,
    nativeMicaEnabled,
    legacyWindowImplementation,
    mergeRendererPipelineEnabled,
    systemWindowPreloadEnabled,
    paintBoardKind
  })
}

async function requestQuit(): Promise<void> {
  if (isShuttingDown) return
  isShuttingDown = true
  stopTopmostPolling()
  if (backendRestartTimer) {
    clearTimeout(backendRestartTimer)
    backendRestartTimer = undefined
  }
  if (pptWrapperRestartTimer) {
    clearTimeout(pptWrapperRestartTimer)
    pptWrapperRestartTimer = undefined
  }

  try {
    await stopBackend()
  } catch {}
  try {
    await stopPptWrapper()
  } catch {}
  try {
    await disposeCapabilityClient()
  } catch {}
  try {
    mutPageOrchestrator.dispose()
  } catch {}
  try {
    registry.closeAll()
  } catch {}
  try {
    tray?.remove()
  } catch {}
  tray = undefined

  try {
    Utils.quit()
  } catch {
    process.exit(0)
  }
}

process.on('SIGINT', () => {
  void requestQuit()
})

process.on('SIGTERM', () => {
  void requestQuit()
})

bootstrap().catch((error) => {
  logError('bootstrap', error)
  void requestQuit()
})
