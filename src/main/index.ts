import { BrowserWindow, Menu, Tray, app, dialog, ipcMain, nativeImage, nativeTheme, screen, session, type OpenDialogOptions } from 'electron'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { platform } from 'node:process'
import { pathToFileURL } from 'node:url'
import { AppWindowsManager, startWindowTopmostPolling } from '../app_windows_manerger'
import { createTaskWatcherAdapter, forceTopmostWindows } from '../system_different_code'
import { TaskWindowsWatcher } from '../task_windows_watcher/TaskWindowsWatcher'
import { createLanstartwriteLinkController } from '../url_http_link'

let backendProcess: ChildProcessWithoutNullStreams | undefined
let pptWrapperProcess: ChildProcessWithoutNullStreams | undefined
let pptWrapperRestartTimer: NodeJS.Timeout | undefined
let pptWrapperPort: number | undefined

const BACKEND_PORT = 3131
const BACKEND_STDIO_PREFIX = '__LANSTART__'
const WINDOW_ID_FLOATING_TOOLBAR = '浮动工具栏'
const WINDOW_ID_FLOATING_TOOLBAR_HANDLE = 'floating-toolbar-handle'
const WINDOW_TITLE_FLOATING_TOOLBAR = '浮动工具栏'
const WINDOW_ID_TOOLBAR_SUBWINDOW = 'toolbar-subwindow'
const WINDOW_ID_TOOLBAR_NOTICE = 'toolbar-notice'
const WINDOW_ID_WATCHER = 'watcher'
const WINDOW_ID_SETTINGS_WINDOW = 'settings-window'
const WINDOW_ID_MUT_PAGE = 'mut-page'
const WINDOW_ID_MUT_PAGE_HANDLE = 'mut-page-handle'
const WINDOW_ID_MUT_PAGE_THUMBNAILS_MENU = 'mut-page-thumbnails-menu'
const TOOLBAR_HANDLE_GAP = 10
const TOOLBAR_HANDLE_WIDTH = 30
const MUT_PAGE_HANDLE_WIDTH = 60
const APPEARANCE_KV_KEY = 'app-appearance'
const NATIVE_MICA_KV_KEY = 'native-mica-enabled'
const LEGACY_WINDOW_IMPL_KV_KEY = 'legacy-window-implementation'
const VIDEO_SHOW_MERGE_LAYERS_KV_KEY = 'video-show-merge-layers'
const SYSTEM_UIA_TOPMOST_KV_KEY = 'system-uia-topmost'
const SYSTEM_MERGE_RENDERER_PIPELINE_KV_KEY = 'system-merge-renderer-pipeline'
const SYSTEM_WINDOW_PRELOAD_KV_KEY = 'system-window-preload'
const SYSTEM_UIA_TOPMOST_UI_STATE_KEY = 'systemUiaTopmost'
const ADMIN_STATUS_UI_STATE_KEY = 'isAdmin'
const SHARED_RENDERER_AFFINITY = 'lanstartwrite-ui'

type Appearance = 'light' | 'dark'

function isAppearance(v: unknown): v is Appearance {
  return v === 'light' || v === 'dark'
}

function surfaceBackgroundColor(appearance: Appearance): string {
  return appearance === 'dark' ? '#191c24ff' : '#f4f5f7ff'
}

function effectiveSurfaceBackgroundColor(appearance: Appearance): string {
  return surfaceBackgroundColor(appearance)
}

let currentAppearance: Appearance = 'light'
let didApplyAppearance = false
let toolbarUiZoom = Math.log(0.8) / Math.log(1.2)
let nativeMicaEnabled = false
let legacyWindowImplementation = false
let mergeRendererPipelineEnabled = false
let systemUiaTopmostEnabled = true
let systemWindowPreloadEnabled = false
let isRunningAsAdmin = false
let topmostRelativeLevel = 0
let stopToolbarTopmostPolling: (() => void) | undefined

function resolveAppIconPath(): string | undefined {
  const candidates = [
    join(process.resourcesPath, 'iconpack', 'LanStartWrite.png'),
    join(process.resourcesPath, 'LanStartWrite.png'),
    join(__dirname, '../../iconpack/LanStartWrite.png'),
    join(process.cwd(), 'iconpack', 'LanStartWrite.png'),
  ]
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p
    } catch {}
  }
  return undefined
}

function detectWindowsAdmin(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        '[bool]([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)'
      ],
      { windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(false)
        const s = String(stdout ?? '').trim().toLowerCase()
        resolve(s === 'true')
      }
    )
  })
}

const APP_ICON_PATH = resolveAppIconPath()
let tray: Tray | undefined

const pendingFullscreenWindows = new WeakSet<BrowserWindow>()
const lastFullscreenRequestAtMs = new WeakMap<BrowserWindow, number>()

function ensureFullScreenSoon(target: BrowserWindow): void {
  if (!target || target.isDestroyed()) return
  try {
    if (target.isFullScreen()) return
  } catch {}

  if (pendingFullscreenWindows.has(target)) return

  const now = Date.now()
  const last = lastFullscreenRequestAtMs.get(target) ?? 0
  if (now - last < 800) return
  lastFullscreenRequestAtMs.set(target, now)

  pendingFullscreenWindows.add(target)
  setTimeout(() => {
    pendingFullscreenWindows.delete(target)
    if (!target || target.isDestroyed()) return
    try {
      if (!target.isFullScreen()) target.setFullScreen(true)
    } catch {}
  }, 0)
}

type BackendRpcResponse =
  | { type: 'RPC_RESPONSE'; id: number; ok: true; result: unknown }
  | { type: 'RPC_RESPONSE'; id: number; ok: false; error: string }

let nextBackendRpcId = 1
const pendingBackendRpc = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timer: NodeJS.Timeout }
>()

let backendRestartTimer: NodeJS.Timeout | undefined
let backendRestartAttempt = 0
let backendExtraEnv: Record<string, string> | undefined

let isAppQuitting = false
let isAppRestarting = false
let allowQuitToProceed = false
let backendShutdownInFlight = false

function requestBackendRpc<T>(method: string, params?: unknown): Promise<T> {
  const proc = backendProcess
  if (!proc || !proc.stdin.writable) return Promise.reject(new Error('backend_not_ready'))

  const id = nextBackendRpcId++

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingBackendRpc.delete(id)
      reject(new Error('backend_rpc_timeout'))
    }, 2400)
    pendingBackendRpc.set(id, { resolve: resolve as unknown as (value: unknown) => void, reject, timer })
    sendToBackend({ type: 'RPC_REQUEST', id, method, params })
  })
}

function waitForChildExit(proc: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const done = (err?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      proc.off('exit', onExit)
      proc.off('close', onClose)
      if (err) reject(err)
      else resolve()
    }

    const onExit = () => done()
    const onClose = () => done()
    const timer = setTimeout(() => done(new Error('wait_child_exit_timeout')), Math.max(1, Math.floor(timeoutMs)))

    proc.once('exit', onExit)
    proc.once('close', onClose)
  })
}

async function shutdownBackendGracefully(timeoutMs = 1800): Promise<void> {
  const proc = backendProcess
  if (!proc) return
  if (backendShutdownInFlight) {
    await waitForChildExit(proc, timeoutMs).catch(() => undefined)
    return
  }

  backendShutdownInFlight = true
  try {
    await requestBackendRpc('shutdown', null)
  } catch {}

  await waitForChildExit(proc, timeoutMs).catch(() => undefined)

  try {
    if (backendProcess && !backendProcess.killed) backendProcess.kill()
  } catch {}

  backendShutdownInFlight = false
}

function spawnRestartGuardian(): void {
  const execPath = process.execPath
  const args = process.argv.slice(1)
  const cwd = process.cwd()
  const env = { ...process.env }
  delete (env as any).ELECTRON_RUN_AS_NODE

  const payload = Buffer.from(JSON.stringify({ ppid: process.pid, execPath, args, cwd, env }), 'utf8').toString('base64')
  const script = `
const payload = process.argv[2] || ''
let cfg = null
try { cfg = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) } catch { process.exit(2) }
const { ppid, execPath, args, cwd, env } = cfg || {}
function alive(pid) { try { process.kill(pid, 0); return true } catch { return false } }
const startedAt = Date.now()
function tick() {
  if (!alive(ppid)) {
    try {
      const { spawn } = require('node:child_process')
      const cp = spawn(execPath, Array.isArray(args) ? args : [], { detached: true, stdio: 'ignore', cwd: cwd || undefined, env: env || process.env, windowsHide: true })
      cp.unref()
      process.exit(0)
    } catch {
      process.exit(3)
    }
    return
  }
  if (Date.now() - startedAt > 20000) process.exit(1)
  setTimeout(tick, 200)
}
tick()
`.trim()

  try {
    const proc = spawn(execPath, ['-e', script, payload], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    proc.unref()
  } catch {}
}

function requestAppQuit(): void {
  if (isAppQuitting || isAppRestarting) return
  isAppQuitting = true
  try {
    app.quit()
  } catch {}
}

function requestAppRestart(): void {
  if (isAppRestarting) return
  isAppRestarting = true
  spawnRestartGuardian()
  try {
    app.quit()
  } catch {}
}

const lanstartwriteLink = createLanstartwriteLinkController({
  dispatch: ({ command, payload }) => requestBackendRpc('postCommand', { command, payload }),
  focusApp: () => {
    const win =
      floatingToolbarWindow && !floatingToolbarWindow.isDestroyed()
        ? floatingToolbarWindow
        : BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (!win || win.isDestroyed()) return
    try {
      if (win.isMinimized()) win.restore()
    } catch {}
    try {
      if (!win.isVisible()) win.show()
    } catch {}
    try {
      win.focus()
    } catch {}
  }
})

if (process.platform === 'win32') {
  try {
    app.setAppUserModelId('com.lanstart.write')
  } catch {}
}

const hasSingleInstanceLock = lanstartwriteLink.register(app)

function focusFloatingToolbarOrAnyWindow(): void {
  const win =
    floatingToolbarWindow && !floatingToolbarWindow.isDestroyed()
      ? floatingToolbarWindow
      : BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win || win.isDestroyed()) return
  try {
    if (win.isMinimized()) win.restore()
  } catch {}
  try {
    if (!win.isVisible()) win.show()
  } catch {}
  try {
    win.focus()
  } catch {}
}

function openSettingsWindow(): void {
  const win = appWindowsManager.getOrCreate('settings')
  if (!win || win.isDestroyed()) return
  try {
    if (win.isMinimized()) win.restore()
  } catch {}
  try {
    if (!win.isVisible()) win.show()
  } catch {}
  try {
    win.focus()
  } catch {}
}

function ensureTray(): void {
  if (tray) return
  if (!APP_ICON_PATH) return
  const base = nativeImage.createFromPath(APP_ICON_PATH)
  const img = process.platform === 'win32' ? base.resize({ width: 16, height: 16, quality: 'best' }) : base
  if (img.isEmpty()) return
  tray = new Tray(img)
  try {
    tray.setToolTip('LanStartWrite')
  } catch {}

  const menu = Menu.buildFromTemplate([
    { label: '打开设置', click: () => openSettingsWindow() },
    { type: 'separator' },
    {
      label: '快速重启',
      click: () => {
        requestAppRestart()
      }
    },
    {
      label: '退出',
      click: () => {
        requestAppQuit()
      }
    },
  ])
  try {
    tray.setContextMenu(menu)
  } catch {}
  try {
    tray.on('click', () => focusFloatingToolbarOrAnyWindow())
  } catch {}
}

async function backendPutUiStateKey(windowId: string, key: string, value: unknown): Promise<void> {
  await requestBackendRpc('putUiStateKey', { windowId, key, value })
}

async function backendGetKv(key: string): Promise<unknown> {
  return await requestBackendRpc('getKv', { key })
}

function coerceString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function broadcastAppearanceToUiState(appearance: Appearance): void {
  backendPutUiStateKey('app', 'appearance', appearance).catch(() => undefined)
}

function applyAppearance(appearance: Appearance): void {
  if (didApplyAppearance && appearance === currentAppearance) return
  didApplyAppearance = true
  currentAppearance = appearance
  try {
    nativeTheme.themeSource = appearance
  } catch {}
  const bg = legacyWindowImplementation ? effectiveSurfaceBackgroundColor(appearance) : '#00000000'
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.setBackgroundColor(bg)
    } catch {}
  }
  broadcastAppearanceToUiState(appearance)
}

function applyNativeMica(enabled: boolean): void {
  if (!legacyWindowImplementation) enabled = false
  nativeMicaEnabled = enabled
  const bg = legacyWindowImplementation ? effectiveSurfaceBackgroundColor(currentAppearance) : '#00000000'

  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.setBackgroundColor(bg)
    } catch {}

    if (process.platform !== 'win32') continue
    const setMaterial = (win as any).setBackgroundMaterial as undefined | ((m: string) => void)
    if (typeof setMaterial !== 'function') continue
    try {
      setMaterial(enabled ? 'mica' : 'none')
    } catch {}
  }
}

function rebuildAllUiWindows(): void {
  const prevToolbar = floatingToolbarWindow
  const prevToolbarBounds = prevToolbar && !prevToolbar.isDestroyed() ? prevToolbar.getBounds() : undefined
  const prevToolbarVisible = prevToolbar && !prevToolbar.isDestroyed() ? prevToolbar.isVisible() : true

  const visibleSubwindows: Array<{ kind: string; placement: 'top' | 'bottom' }> = []
  for (const [kind, item] of toolbarSubwindows.entries()) {
    const win = item.win
    if (win.isDestroyed()) continue
    if (!win.isVisible()) continue
    visibleSubwindows.push({ kind, placement: item.placement })
  }

  const windowsToClose: BrowserWindow[] = []
  if (floatingToolbarHandleWindow && !floatingToolbarHandleWindow.isDestroyed()) windowsToClose.push(floatingToolbarHandleWindow)
  if (toolbarNoticeWindow && !toolbarNoticeWindow.isDestroyed()) windowsToClose.push(toolbarNoticeWindow)
  if (multiPageControlWindow && !multiPageControlWindow.isDestroyed()) windowsToClose.push(multiPageControlWindow)
  if (mutPageHandleWindow && !mutPageHandleWindow.isDestroyed()) windowsToClose.push(mutPageHandleWindow)
  for (const item of toolbarSubwindows.values()) {
    if (item.win.isDestroyed()) continue
    windowsToClose.push(item.win)
  }
  if (floatingToolbarWindow && !floatingToolbarWindow.isDestroyed()) windowsToClose.push(floatingToolbarWindow)

  for (const w of windowsToClose) {
    try {
      w.close()
      continue
    } catch {}
    try {
      w.destroy()
    } catch {}
  }

  toolbarSubwindows.clear()
  floatingToolbarWindow = undefined
  floatingToolbarHandleWindow = undefined
  toolbarNoticeWindow = undefined
  toolbarNoticeItem = undefined
  mutPageHandleWindow = undefined

  appWindowsManager.destroyAll()

  const nextToolbar = createFloatingToolbarWindow()
  floatingToolbarWindow = nextToolbar
  if (prevToolbarBounds) {
    try {
      nextToolbar.setBounds(prevToolbarBounds, false)
    } catch {}
  }
  const nextHandle = createFloatingToolbarHandleWindow(nextToolbar)
  floatingToolbarHandleWindow = nextHandle

  if (!prevToolbarVisible) {
    try {
      nextToolbar.hide()
    } catch {}
    try {
      nextHandle.hide()
    } catch {}
  }

  if (toolbarNoticeDesiredVisible && prevToolbarVisible) {
    try {
      showToolbarNoticeWindow()
    } catch {}
  }

  if (prevToolbarVisible) {
    for (const sub of visibleSubwindows) {
      try {
        toggleToolbarSubwindow(sub.kind, sub.placement)
      } catch {}
    }
  }
}

function applyLegacyWindowImplementation(enabled: boolean, opts?: { rebuild?: boolean }): void {
  legacyWindowImplementation = enabled
  if (!enabled) applyNativeMica(false)
  if (opts?.rebuild === false) return
  rebuildAllUiWindows()
}

function applyMergeRendererPipeline(enabled: boolean, opts?: { rebuild?: boolean }): void {
  if (mergeRendererPipelineEnabled === enabled) return
  mergeRendererPipelineEnabled = enabled
  if (opts?.rebuild === false) return
  rebuildAllUiWindows()
}

let windowPreloadInFlight = false
function preloadAllUiWindows(): void {
  if (windowPreloadInFlight) return
  windowPreloadInFlight = true
  setTimeout(() => {
    windowPreloadInFlight = false
    if (!systemWindowPreloadEnabled) return
    const toolbar = floatingToolbarWindow
    if (!toolbar || toolbar.isDestroyed()) return

    try {
      getOrCreateToolbarNoticeWindow()
    } catch {}

    for (const kind of ['feature-panel', 'events', 'clock', 'db']) {
      try {
        getOrCreateToolbarSubwindow(kind, 'bottom')
      } catch {}
    }

    try {
      const mp = getOrCreateMultiPageControlWindow()
      getOrCreateMutPageHandleWindow(mp)
      getOrCreateMutPageThumbnailsMenuWindow(mp)
    } catch {}

    try {
      appWindowsManager.getOrCreate('settings')
      appWindowsManager.getOrCreate('watcher')
      appWindowsManager.getOrCreate('child')
    } catch {}
  }, 0)
}

function applyToolbarUiZoom(zoom: number): void {
  const targets = [
    floatingToolbarWindow,
    floatingToolbarHandleWindow,
    toolbarNoticeWindow,
    multiPageControlWindow,
    mutPageHandleWindow,
    mutPageThumbnailsMenuWindow,
    ...Array.from(toolbarSubwindows.values()).map((v) => v.win)
  ]
  for (const win of targets) {
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.setZoomLevel(zoom)
      } catch {}
    }
  }
}

let floatingToolbarWindow: BrowserWindow | undefined
let floatingToolbarHandleWindow: BrowserWindow | undefined
let toolbarNoticeWindow: BrowserWindow | undefined
let toolbarNoticeDesiredVisible = false
let toolbarNoticeItem:
  | {
      win: BrowserWindow
      placement: 'top' | 'bottom'
      effectivePlacement: 'top' | 'bottom'
      width: number
      height: number
      animationTimer?: NodeJS.Timeout
    }
  | undefined
let multiPageControlWindow: BrowserWindow | undefined
let mutPageHandleWindow: BrowserWindow | undefined
let mutPageThumbnailsMenuWindow: BrowserWindow | undefined
let mutPageDesiredFromAppMode = false
let mutPageDesiredFromPpt = false
let mutPagePptHideTimer: NodeJS.Timeout | undefined
let mutPagePptLastShownAt = 0
let mutPageAnchorBounds: { x: number; y: number; width: number; height: number } | undefined
let mutPageUiBounds: { width: number; height: number } | undefined
let whiteboardBackgroundWindow: BrowserWindow | undefined
let annotationOverlayWindow: BrowserWindow | undefined
let screenAnnotationOverlayWindow: BrowserWindow | undefined
let closingWhiteboardWindows = false
let taskWatcher: TaskWindowsWatcher | undefined
let syncingToolbarPair = false
const toolbarSubwindows = new Map<
  string,
  {
    win: BrowserWindow
    placement: 'top' | 'bottom'
    effectivePlacement: 'top' | 'bottom'
    width: number
    height: number
    animationTimer?: NodeJS.Timeout
  }
>()
let scheduledRepositionTimer: NodeJS.Timeout | undefined
type ToolbarRepositionReason = 'move' | 'resize' | 'other'
let scheduledRepositionReason: ToolbarRepositionReason = 'other'

function sendToBackend(message: unknown): void {
  try {
    if (!backendProcess?.stdin.writable) return
    backendProcess.stdin.write(`${JSON.stringify(message)}\n`)
  } catch {
    return
  }
}

function ensureTaskWatcherStarted(intervalMs?: number): void {
  const nextInterval = Number.isFinite(intervalMs ?? NaN) ? Number(intervalMs) : undefined
  if (!taskWatcher) {
    const adapter = createTaskWatcherAdapter()
    taskWatcher = new TaskWindowsWatcher({
      adapter,
      emit: (msg) => {
        sendToBackend(msg)
      },
      defaultIntervalMs: nextInterval ?? 1000
    })
  }
  taskWatcher.start(nextInterval)
}

function getDevServerUrl(): string | undefined {
  const url = process.env.VITE_DEV_SERVER_URL
  if (url) return url
  if (!app.isPackaged) return 'http://localhost:5173/'
  return undefined
}

function adjustWindowForDPI(win: BrowserWindow, baseWidth: number, baseHeight: number): void {
  const display = screen.getDisplayMatching(win.getBounds())
  const { width: maxWidth, height: maxHeight } = display.workAreaSize

  const zoomFactor = getUiZoomFactor()
  let width = Math.round(baseWidth * zoomFactor)
  let height = Math.round(baseHeight * zoomFactor)

  width = Math.max(100, Math.min(width, maxWidth))
  height = Math.max(80, Math.min(height, maxHeight))

  win.setSize(width, height)
}

type CaptureOptions = { maxSide?: unknown }

function computeThumbnailSize(input: { width: number; height: number }, maxSide: number) {
  const maxInputSide = Math.max(input.width, input.height)
  if (maxInputSide <= maxSide) return { width: input.width, height: input.height }
  const scale = maxSide / maxInputSide
  return { width: Math.max(1, Math.round(input.width * scale)), height: Math.max(1, Math.round(input.height * scale)) }
}

function runCommandToString(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { windowsHide: true })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => {
      out += String(d)
    })
    proc.stderr.on('data', (d) => {
      err += String(d)
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(err || `exit_${code ?? 'unknown'}`))
    })
  })
}

async function getWindowsWallpaperPath(): Promise<string | undefined> {
  const candidates: string[] = []

  try {
    const out = await runCommandToString('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper'])
    for (const rawLine of out.split(/\r?\n/g)) {
      const line = rawLine.trim()
      if (!line) continue
      const m = line.match(/^WallPaper\s+REG_\w+\s+(.*)$/i)
      if (!m) continue
      const value = String(m[1] ?? '').trim()
      if (value) candidates.push(value)
    }
  } catch {}

  const appData = process.env.APPDATA
  if (appData) candidates.push(join(appData, 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper'))

  for (const p of candidates) {
    if (!p) continue
    if (existsSync(p)) return p
  }
  return undefined
}

const appWindowsManager = new AppWindowsManager({
  preloadPath: join(__dirname, '../preload/index.js'),
  rendererHtmlPath: join(__dirname, '../renderer/index.html'),
  getDevServerUrl,
  getAppearance: () => currentAppearance,
  getUiZoomLevel: () => toolbarUiZoom,
  getNativeMicaEnabled: () => nativeMicaEnabled,
  getLegacyWindowImplementation: () => legacyWindowImplementation,
  getMergeRendererPipelineEnabled: () => mergeRendererPipelineEnabled,
  surfaceBackgroundColor: effectiveSurfaceBackgroundColor,
  applyWindowsBackdrop,
  wireWindowDebug,
  wireWindowStatus,
  adjustWindowForDPI,
  sendToBackend,
  ensureTaskWatcherStarted,
})

appWindowsManager.registerIpcHandlers({ ipcMain, requestBackendRpc, coerceString })

ipcMain.handle('hyperGlass:captureWallpaperThumbnail', async (_event, input: CaptureOptions = {}) => {
  if (platform !== 'win32') throw new Error('unsupported_platform')
  const maxSide = typeof input.maxSide === 'number' ? Math.max(32, Math.floor(input.maxSide)) : 320
  const wallpaperPath = await getWindowsWallpaperPath()
  if (!wallpaperPath) throw new Error('no_wallpaper_path')

  const img = nativeImage.createFromPath(wallpaperPath)
  if (img.isEmpty()) throw new Error('wallpaper_image_empty')

  const size = img.getSize()
  const thumbSize = computeThumbnailSize(size, maxSide)
  const thumb = img.resize({ width: thumbSize.width, height: thumbSize.height, quality: 'best' })
  const outSize = thumb.getSize()

  return {
    dataUrl: thumb.toDataURL(),
    width: outSize.width,
    height: outSize.height,
    wallpaper: { path: wallpaperPath, size },
  }
})

function wireWindowDebug(win: BrowserWindow, name: string): void {
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    process.stderr.write(`[${name}] did-fail-load ${errorCode} ${errorDescription} ${validatedURL}\n`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    process.stderr.write(`[${name}] render-process-gone ${details.reason} ${details.exitCode}\n`)
  })
  win.webContents.on('unresponsive', () => {
    process.stderr.write(`[${name}] unresponsive\n`)
  })
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    process.stdout.write(`[${name}] console(${level}) ${sourceId}:${line} ${message}\n`)
  })
}

function wireWindowStatus(win: BrowserWindow, windowId: string): void {
  const snapshot = (event: string, extra?: Record<string, unknown>) => {
    const destroyed = win.isDestroyed()
    let bounds: Electron.Rectangle | undefined
    if (!destroyed) {
      try {
        bounds = win.getBounds()
      } catch {
        bounds = undefined
      }
    }
    const rendererPid = !destroyed && !win.webContents.isDestroyed() ? win.webContents.getOSProcessId?.() : undefined
    const payload = {
      type: 'WINDOW_STATUS',
      windowId,
      event,
      ts: Date.now(),
      bounds,
      visible: !destroyed ? win.isVisible() : false,
      focused: !destroyed ? win.isFocused() : false,
      minimized: !destroyed ? win.isMinimized() : false,
      maximized: !destroyed ? win.isMaximized() : false,
      fullscreen: !destroyed ? win.isFullScreen() : false,
      title: !destroyed ? win.getTitle() : '',
      rendererPid,
      ...extra
    }
    sendToBackend(payload)
  }

  snapshot('created')
  win.on('show', () => snapshot('show'))
  win.on('hide', () => snapshot('hide'))
  win.on('focus', () => snapshot('focus'))
  win.on('blur', () => snapshot('blur'))
  win.on('move', () => snapshot('move'))
  win.on('resize', () => snapshot('resize'))
  win.on('minimize', () => snapshot('minimize'))
  win.on('restore', () => snapshot('restore'))
  win.on('closed', () => snapshot('closed'))
  win.webContents.on('did-finish-load', () => snapshot('did-finish-load'))
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    snapshot('did-fail-load', { errorCode, errorDescription, validatedURL })
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    snapshot('render-process-gone', { reason: details.reason, exitCode: details.exitCode })
  })
}

function applyWindowsBackdrop(win: BrowserWindow): void {
  // Windows 11: DWM backdrop (Mica/Acrylic) needs a non-transparent window surface.
  if (process.platform !== 'win32') return
  const setMaterial = (win as any).setBackgroundMaterial as undefined | ((m: string) => void)
  if (typeof setMaterial !== 'function') return
  if (!legacyWindowImplementation) {
    try {
      setMaterial('none')
    } catch {}
    return
  }
  if (!nativeMicaEnabled) {
    try {
      setMaterial('none')
    } catch {}
    return
  }
  try {
    setMaterial('mica')
    return
  } catch {}
  try {
    setMaterial('acrylic')
    return
  } catch {}
}

function buildUiWebPreferences(): any {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    ...(mergeRendererPipelineEnabled ? { affinity: SHARED_RENDERER_AFFINITY } : {})
  }
}

function createFloatingToolbarWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...(APP_ICON_PATH ? { icon: APP_ICON_PATH } : {}),
    width: 360,
    height: 160,
    ...(legacyWindowImplementation ? { type: 'toolbar' as const } : {}),
    frame: false,
    autoHideMenuBar: true,
    transparent: !legacyWindowImplementation,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: WINDOW_TITLE_FLOATING_TOOLBAR,
    backgroundColor: legacyWindowImplementation ? effectiveSurfaceBackgroundColor(currentAppearance) : '#01000000',
    backgroundMaterial: legacyWindowImplementation && nativeMicaEnabled ? 'mica' : 'none',
    roundedCorners: legacyWindowImplementation,
    hasShadow: legacyWindowImplementation,
    webPreferences: buildUiWebPreferences()
  })

  applyWindowsBackdrop(win)
  try {
    win.setMenu(null)
  } catch {}
  try {
    win.setMenuBarVisibility(false)
  } catch {}
  try {
    win.setAutoHideMenuBar(true)
  } catch {}
  win.setAlwaysOnTop(true, 'screen-saver')
  wireWindowDebug(win, 'floating-toolbar')
  wireWindowStatus(win, WINDOW_ID_FLOATING_TOOLBAR)
  try {
    win.webContents.setZoomLevel(toolbarUiZoom)
  } catch {}
  win.on('move', () => scheduleRepositionToolbarSubwindows('move'))
  win.on('resize', () => scheduleRepositionToolbarSubwindows('resize'))
  win.on('show', () => {
    scheduleRepositionToolbarSubwindows('other')
    const handle = floatingToolbarHandleWindow
    if (handle && !handle.isDestroyed()) handle.showInactive()
    if (toolbarNoticeDesiredVisible) showToolbarNoticeWindow()
  })
  win.on('hide', () => {
    const handle = floatingToolbarHandleWindow
    if (handle && !handle.isDestroyed() && handle.isVisible()) handle.hide()
    const notice = toolbarNoticeWindow
    if (notice && !notice.isDestroyed() && notice.isVisible()) notice.hide()
    for (const item of toolbarSubwindows.values()) {
      if (item.win.isDestroyed()) continue
      item.win.hide()
    }
  })
  win.on('closed', () => {
    const handle = floatingToolbarHandleWindow
    if (handle && !handle.isDestroyed()) handle.close()
    floatingToolbarHandleWindow = undefined

    const notice = toolbarNoticeWindow
    if (notice && !notice.isDestroyed()) notice.close()
    toolbarNoticeWindow = undefined
    toolbarNoticeItem = undefined
    toolbarNoticeDesiredVisible = false

    hideAllToolbarSubwindows()
  })

  const devUrl = getDevServerUrl()
  if (devUrl) {
    win.loadURL(`${devUrl}?window=${encodeURIComponent(WINDOW_ID_FLOATING_TOOLBAR)}`)
    if (process.env.LANSTART_OPEN_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: WINDOW_ID_FLOATING_TOOLBAR } })
  }

  return win
}

function createFloatingToolbarHandleWindow(owner: BrowserWindow): BrowserWindow {
  const ownerBounds = owner.getBounds()
  const win = new BrowserWindow({
    ...(APP_ICON_PATH ? { icon: APP_ICON_PATH } : {}),
    width: TOOLBAR_HANDLE_WIDTH,
    height: ownerBounds.height,
    ...(legacyWindowImplementation ? { type: 'toolbar' as const } : {}),
    frame: false,
    autoHideMenuBar: true,
    transparent: !legacyWindowImplementation,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    parent: owner,
    title: '浮动工具栏拖动把手',
    backgroundColor: legacyWindowImplementation ? effectiveSurfaceBackgroundColor(currentAppearance) : '#01000000',
    backgroundMaterial: legacyWindowImplementation && nativeMicaEnabled ? 'mica' : 'none',
    roundedCorners: legacyWindowImplementation,
    hasShadow: legacyWindowImplementation,
    webPreferences: buildUiWebPreferences()
  })

  applyWindowsBackdrop(win)
  try {
    win.setMenu(null)
  } catch {}
  try {
    win.setMenuBarVisibility(false)
  } catch {}
  try {
    win.setAutoHideMenuBar(true)
  } catch {}
  win.setAlwaysOnTop(true, 'screen-saver')
  wireWindowDebug(win, 'floating-toolbar-handle')
  wireWindowStatus(win, WINDOW_ID_FLOATING_TOOLBAR_HANDLE)
  try {
    win.webContents.setZoomLevel(toolbarUiZoom)
  } catch {}

  win.on('move', () => {
    if (syncingToolbarPair) return
    const toolbar = floatingToolbarWindow
    if (!toolbar || toolbar.isDestroyed()) return
    const handleBounds = win.getBounds()
    const toolbarBounds = toolbar.getBounds()
    const nextX = handleBounds.x - toolbarBounds.width - TOOLBAR_HANDLE_GAP
    const nextY = handleBounds.y
    if (nextX === toolbarBounds.x && nextY === toolbarBounds.y) return
    syncingToolbarPair = true
    toolbar.setBounds({ ...toolbarBounds, x: nextX, y: nextY }, false)
    setTimeout(() => {
      syncingToolbarPair = false
    }, 0)
    scheduleRepositionToolbarSubwindows('move')
  })

  const devUrl = getDevServerUrl()
  if (devUrl) {
    win.loadURL(`${devUrl}?window=${encodeURIComponent(WINDOW_ID_FLOATING_TOOLBAR_HANDLE)}`)
    if (process.env.LANSTART_OPEN_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: WINDOW_ID_FLOATING_TOOLBAR_HANDLE } })
  }

  return win
}

function getOrCreateToolbarNoticeWindow(): BrowserWindow {
  const existing = toolbarNoticeWindow
  if (existing && !existing.isDestroyed()) return existing

  const owner = floatingToolbarWindow
  if (!owner || owner.isDestroyed()) throw new Error('toolbar_owner_missing')

  const win = new BrowserWindow({
    ...(APP_ICON_PATH ? { icon: APP_ICON_PATH } : {}),
    width: 340,
    height: 64,
    show: false,
    ...(legacyWindowImplementation ? { type: 'toolbar' as const } : {}),
    frame: false,
    autoHideMenuBar: true,
    transparent: !legacyWindowImplementation,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    parent: owner,
    title: '浮动通知',
    backgroundColor: legacyWindowImplementation ? effectiveSurfaceBackgroundColor(currentAppearance) : '#01000000',
    backgroundMaterial: legacyWindowImplementation && nativeMicaEnabled ? 'mica' : 'none',
    roundedCorners: legacyWindowImplementation,
    hasShadow: legacyWindowImplementation,
    webPreferences: buildUiWebPreferences()
  })

  applyWindowsBackdrop(win)
  try {
    win.setMenu(null)
  } catch {}
  try {
    win.setMenuBarVisibility(false)
  } catch {}
  try {
    win.setAutoHideMenuBar(true)
  } catch {}
  win.setAlwaysOnTop(true, 'screen-saver')
  wireWindowDebug(win, 'toolbar-notice')
  wireWindowStatus(win, WINDOW_ID_TOOLBAR_NOTICE)
  try {
    win.webContents.setZoomLevel(toolbarUiZoom)
  } catch {}

  const devUrl = getDevServerUrl()
  if (devUrl) {
    win.loadURL(`${devUrl}?window=${encodeURIComponent(WINDOW_ID_TOOLBAR_NOTICE)}`)
    if (process.env.LANSTART_OPEN_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: WINDOW_ID_TOOLBAR_NOTICE } })
  }

  win.on('closed', () => {
    if (toolbarNoticeWindow === win) toolbarNoticeWindow = undefined
    if (toolbarNoticeItem?.win === win) toolbarNoticeItem = undefined
  })

  toolbarNoticeWindow = win
  toolbarNoticeItem = {
    win,
    placement: 'bottom',
    effectivePlacement: 'bottom',
    width: 340,
    height: 64
  }
  scheduleRepositionToolbarSubwindows('other')
  return win
}

function repositionMultiPageControlWindow(): void {
  const win = multiPageControlWindow
  if (!win || win.isDestroyed()) return

  const owner = whiteboardBackgroundWindow ?? floatingToolbarWindow
  const ownerBounds = owner && !owner.isDestroyed() ? owner.getBounds() : screen.getPrimaryDisplay().bounds
  const anchor = mutPageAnchorBounds
  const display = screen.getDisplayMatching(anchor ?? ownerBounds)
  const useFullBounds =
    mutPageDesiredFromPpt || !!anchor || (owner === whiteboardBackgroundWindow && owner && !owner.isDestroyed())
  const area = useFullBounds ? display.bounds : display.workArea

  const base = mutPageUiBounds
  const widthLimit = Math.max(140, area.width - 20)
  const heightLimit = Math.max(40, area.height - 20)
  const width = Math.max(140, Math.min(widthLimit, Math.round(base?.width ?? 360)))
  const height = Math.max(40, Math.min(heightLimit, Math.round(base?.height ?? 66)))
  const margin = mutPageDesiredFromPpt ? 0 : 14
  const x = area.x + margin
  const y = area.y + area.height - height - margin

  try {
    win.setBounds({ x, y, width, height }, false)
  } catch {}

  const handle = mutPageHandleWindow
  if (handle && !handle.isDestroyed()) {
    const hx = x + width + TOOLBAR_HANDLE_GAP
    try {
      handle.setBounds({ x: hx, y, width: MUT_PAGE_HANDLE_WIDTH, height }, false)
    } catch {}
  }

  const menu = mutPageThumbnailsMenuWindow
  if (menu && !menu.isDestroyed() && menu.isVisible()) repositionMutPageThumbnailsMenuWindow()
}

function getOrCreateMutPageHandleWindow(owner: BrowserWindow): BrowserWindow {
  const existing = mutPageHandleWindow
  if (existing && !existing.isDestroyed()) return existing

  const ownerBounds = owner.getBounds()
  const win = new BrowserWindow({
    ...(APP_ICON_PATH ? { icon: APP_ICON_PATH } : {}),
    width: MUT_PAGE_HANDLE_WIDTH,
    height: ownerBounds.height,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    transparent: !legacyWindowImplementation,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    parent: owner,
    title: '页面控制器把手',
    backgroundColor: legacyWindowImplementation ? effectiveSurfaceBackgroundColor(currentAppearance) : '#01000000',
    backgroundMaterial: legacyWindowImplementation && nativeMicaEnabled ? 'mica' : 'none',
    roundedCorners: legacyWindowImplementation,
    hasShadow: legacyWindowImplementation,
    webPreferences: buildUiWebPreferences()
  })

  applyWindowsBackdrop(win)
  try {
    win.setMenu(null)
  } catch {}
  try {
    win.setMenuBarVisibility(false)
  } catch {}
  try {
    win.setAutoHideMenuBar(true)
  } catch {}
  win.setAlwaysOnTop(true, 'screen-saver')
  wireWindowDebug(win, WINDOW_ID_MUT_PAGE_HANDLE)
  wireWindowStatus(win, WINDOW_ID_MUT_PAGE_HANDLE)
  try {
    win.webContents.setZoomLevel(toolbarUiZoom)
  } catch {}

  const devUrl = getDevServerUrl()
  if (devUrl) {
    win.loadURL(`${devUrl}?window=${encodeURIComponent(WINDOW_ID_MUT_PAGE_HANDLE)}`)
    if (process.env.LANSTART_OPEN_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: WINDOW_ID_MUT_PAGE_HANDLE } })
  }

  win.on('closed', () => {
    if (mutPageHandleWindow === win) mutPageHandleWindow = undefined
  })

  mutPageHandleWindow = win
  return win
}

function getOrCreateMultiPageControlWindow(): BrowserWindow {
  const existing = multiPageControlWindow
  if (existing && !existing.isDestroyed()) return existing

  const bg = whiteboardBackgroundWindow
  const owner =
    bg && !bg.isDestroyed() && bg.isVisible()
      ? bg
      : floatingToolbarWindow
  if (!owner || owner.isDestroyed()) throw new Error('mut_page_owner_missing')

  const base = mutPageUiBounds
  const win = new BrowserWindow({
    ...(APP_ICON_PATH ? { icon: APP_ICON_PATH } : {}),
    width: Math.max(140, Math.round(base?.width ?? 360)),
    height: Math.max(40, Math.round(base?.height ?? 66)),
    show: false,
    frame: false,
    autoHideMenuBar: true,
    transparent: !legacyWindowImplementation,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    parent: owner,
    title: '多页控制',
    backgroundColor: legacyWindowImplementation ? effectiveSurfaceBackgroundColor(currentAppearance) : '#01000000',
    backgroundMaterial: legacyWindowImplementation && nativeMicaEnabled ? 'mica' : 'none',
    roundedCorners: legacyWindowImplementation,
    hasShadow: legacyWindowImplementation,
    webPreferences: buildUiWebPreferences()
  })

  applyWindowsBackdrop(win)
  try {
    win.setMenu(null)
  } catch {}
  try {
    win.setMenuBarVisibility(false)
  } catch {}
  try {
    win.setAutoHideMenuBar(true)
  } catch {}
  win.setAlwaysOnTop(true, 'screen-saver')
  wireWindowDebug(win, WINDOW_ID_MUT_PAGE)
  wireWindowStatus(win, WINDOW_ID_MUT_PAGE)
  try {
    win.webContents.setZoomLevel(toolbarUiZoom)
  } catch {}

  const devUrl = getDevServerUrl()
  if (devUrl) {
    win.loadURL(`${devUrl}?window=${encodeURIComponent(WINDOW_ID_MUT_PAGE)}`)
    if (process.env.LANSTART_OPEN_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: WINDOW_ID_MUT_PAGE } })
  }

  win.once('ready-to-show', () => {
    repositionMultiPageControlWindow()
  })
  win.on('show', repositionMultiPageControlWindow)
  win.on('hide', () => {
    const menu = mutPageThumbnailsMenuWindow
    if (menu && !menu.isDestroyed() && menu.isVisible()) {
      try {
        menu.hide()
      } catch {}
    }
    const handle = mutPageHandleWindow
    if (handle && !handle.isDestroyed() && handle.isVisible()) {
      try {
        handle.hide()
      } catch {}
    }
  })
  win.on('closed', () => {
    if (multiPageControlWindow === win) multiPageControlWindow = undefined
    const handle = mutPageHandleWindow
    if (handle && !handle.isDestroyed()) {
      try {
        handle.close()
      } catch {}
    }
    mutPageHandleWindow = undefined
    const menu = mutPageThumbnailsMenuWindow
    if (menu && !menu.isDestroyed()) {
      try {
        menu.close()
      } catch {}
    }
    mutPageThumbnailsMenuWindow = undefined
  })

  multiPageControlWindow = win
  return win
}

function applyMutPageVisibility(): void {
  const desired = mutPageDesiredFromAppMode || mutPageDesiredFromPpt
  if (desired) {
    try {
      const mp = getOrCreateMultiPageControlWindow()
      const handle = getOrCreateMutPageHandleWindow(mp)
      repositionMultiPageControlWindow()
      const doShow = () => {
        if (mp.isDestroyed()) return
        try {
          if (!mp.isVisible()) mp.showInactive()
        } catch {
          try {
            if (!mp.isVisible()) mp.show()
          } catch {}
        }
        try {
          mp.setAlwaysOnTop(true, 'screen-saver')
        } catch {}
        try {
          mp.moveTop()
        } catch {}

        if (!handle.isDestroyed()) {
          try {
            if (!handle.isVisible()) handle.showInactive()
          } catch {
            try {
              if (!handle.isVisible()) handle.show()
            } catch {}
          }
          try {
            handle.setAlwaysOnTop(true, 'screen-saver')
          } catch {}
          try {
            handle.moveTop()
          } catch {}
        }
      }
      if (mp.webContents.isLoading()) mp.once('ready-to-show', doShow)
      else doShow()
    } catch {}
    return
  }

  const mp = multiPageControlWindow
  if (mp && !mp.isDestroyed()) {
    try {
      if (mp.isVisible()) mp.hide()
    } catch {}
  }
  const handle = mutPageHandleWindow
  if (handle && !handle.isDestroyed()) {
    try {
      if (handle.isVisible()) handle.hide()
    } catch {}
  }
}

function repositionMutPageThumbnailsMenuWindow(): void {
  const win = mutPageThumbnailsMenuWindow
  const owner = multiPageControlWindow
  if (!win || win.isDestroyed()) return
  if (!owner || owner.isDestroyed()) return

  const ownerBounds = owner.getBounds()
  const display = screen.getDisplayMatching(ownerBounds)
  const area = display.workArea

  const z = getUiZoomFactor()
  const widthLimit = Math.max(320, area.width - 16)
  const heightLimit = Math.max(240, area.height - 16)
  const width = Math.max(320, Math.min(widthLimit, Math.round(800 * z)))
  const height = Math.max(240, Math.min(heightLimit, Math.round(520 * z)))
  const gap = 10
  const x = Math.round(ownerBounds.x + (ownerBounds.width - width) / 2)
  const y = Math.round(ownerBounds.y - height - gap)

  const clampedX = Math.max(area.x + 8, Math.min(area.x + area.width - width - 8, x))
  const clampedY = Math.max(area.y + 8, Math.min(area.y + area.height - height - 8, y))

  try {
    win.setBounds({ x: clampedX, y: clampedY, width, height }, false)
  } catch {}
}

function getOrCreateMutPageThumbnailsMenuWindow(owner: BrowserWindow): BrowserWindow {
  const existing = mutPageThumbnailsMenuWindow
  if (existing && !existing.isDestroyed()) return existing

  const z = getUiZoomFactor()
  const win = new BrowserWindow({
    ...(APP_ICON_PATH ? { icon: APP_ICON_PATH } : {}),
    width: Math.max(320, Math.round(800 * z)),
    height: Math.max(240, Math.round(520 * z)),
    show: false,
    frame: false,
    autoHideMenuBar: true,
    transparent: !legacyWindowImplementation,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    parent: owner,
    title: '页面缩略图查看菜单',
    backgroundColor: legacyWindowImplementation ? effectiveSurfaceBackgroundColor(currentAppearance) : '#01000000',
    backgroundMaterial: legacyWindowImplementation && nativeMicaEnabled ? 'mica' : 'none',
    roundedCorners: legacyWindowImplementation,
    hasShadow: legacyWindowImplementation,
    webPreferences: buildUiWebPreferences()
  })

  applyWindowsBackdrop(win)
  try {
    win.setMenu(null)
  } catch {}
  try {
    win.setMenuBarVisibility(false)
  } catch {}
  try {
    win.setAutoHideMenuBar(true)
  } catch {}
  win.setAlwaysOnTop(true, 'screen-saver')
  wireWindowDebug(win, WINDOW_ID_MUT_PAGE_THUMBNAILS_MENU)
  wireWindowStatus(win, WINDOW_ID_MUT_PAGE_THUMBNAILS_MENU)
  try {
    win.webContents.setZoomLevel(toolbarUiZoom)
  } catch {}

  const devUrl = getDevServerUrl()
  if (devUrl) {
    win.loadURL(`${devUrl}?window=${encodeURIComponent(WINDOW_ID_MUT_PAGE_THUMBNAILS_MENU)}`)
    if (process.env.LANSTART_OPEN_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: WINDOW_ID_MUT_PAGE_THUMBNAILS_MENU } })
  }

  win.on('blur', () => {
    if (win.isDestroyed()) return
    try {
      if (win.isVisible()) win.hide()
    } catch {}
  })

  win.on('closed', () => {
    if (mutPageThumbnailsMenuWindow === win) mutPageThumbnailsMenuWindow = undefined
  })

  mutPageThumbnailsMenuWindow = win
  return win
}

function toggleMutPageThumbnailsMenuWindow(): void {
  const owner = multiPageControlWindow
  if (!owner || owner.isDestroyed()) return

  const existing = mutPageThumbnailsMenuWindow
  if (existing && !existing.isDestroyed() && existing.isVisible()) {
    try {
      existing.hide()
    } catch {}
    return
  }

  const win = getOrCreateMutPageThumbnailsMenuWindow(owner)
  const doShow = () => {
    if (win.isDestroyed()) return
    repositionMutPageThumbnailsMenuWindow()
    try {
      win.showInactive()
    } catch {
      win.show()
    }
  }
  if (win.webContents.isLoading()) win.once('ready-to-show', doShow)
  else doShow()
}

function applyToolbarOnTopLevel(level: 'normal' | 'floating' | 'torn-off-menu' | 'modal-panel' | 'main-menu' | 'status' | 'pop-up-menu' | 'screen-saver') {
  const rel = topmostRelativeLevel
  const toolbar = floatingToolbarWindow
  if (toolbar && !toolbar.isDestroyed()) {
    toolbar.setAlwaysOnTop(true, level, rel)
    if (toolbar.isVisible()) {
      toolbar.moveTop()
    }
  }

  const handle = floatingToolbarHandleWindow
  if (handle && !handle.isDestroyed()) {
    handle.setAlwaysOnTop(true, level, rel)
    if (handle.isVisible()) {
      handle.moveTop()
    }
  }

  const mp = multiPageControlWindow
  if (mp && !mp.isDestroyed()) {
    mp.setAlwaysOnTop(true, level, rel)
    if (mp.isVisible()) {
      mp.moveTop()
    }
  }
  const mph = mutPageHandleWindow
  if (mph && !mph.isDestroyed()) {
    mph.setAlwaysOnTop(true, level, rel)
    if (mph.isVisible()) {
      mph.moveTop()
    }
  }

  const notice = toolbarNoticeWindow
  if (notice && !notice.isDestroyed() && notice.isVisible()) {
    notice.setAlwaysOnTop(true, level, rel)
    notice.moveTop()
  }

  for (const item of toolbarSubwindows.values()) {
    const win = item.win
    if (win.isDestroyed()) continue
    if (!win.isVisible()) continue
    win.setAlwaysOnTop(true, level, rel)
    win.moveTop()
  }
}

function refreshToolbarWindowsLayoutAndSurface() {
  try {
    repositionToolbarSubwindows(false)
  } catch {}
  try {
    repositionMultiPageControlWindow()
  } catch {}

  const reapplyVisibleBounds = (win: BrowserWindow | undefined, nextBounds?: Electron.Rectangle) => {
    if (!win || win.isDestroyed()) return
    if (!win.isVisible()) return
    try {
      const b = nextBounds ?? win.getBounds()
      win.setBounds(b, false)
    } catch {}
  }

  reapplyVisibleBounds(floatingToolbarWindow)
  reapplyVisibleBounds(floatingToolbarHandleWindow)
  reapplyVisibleBounds(toolbarNoticeWindow)
  for (const item of toolbarSubwindows.values()) {
    reapplyVisibleBounds(item.win)
  }

  reapplyVisibleBounds(multiPageControlWindow)
  reapplyVisibleBounds(mutPageHandleWindow)

  const refBounds =
    (floatingToolbarWindow && !floatingToolbarWindow.isDestroyed() ? floatingToolbarWindow.getBounds() : undefined) ??
    screen.getPrimaryDisplay().bounds
  const fullBounds = screen.getDisplayMatching(refBounds).bounds
  reapplyVisibleBounds(whiteboardBackgroundWindow, fullBounds)
  reapplyVisibleBounds(annotationOverlayWindow, fullBounds)
  reapplyVisibleBounds(screenAnnotationOverlayWindow, fullBounds)
}

function readWin32Hwnd(win: BrowserWindow): bigint | undefined {
  if (process.platform !== 'win32') return undefined
  try {
    const buf = win.getNativeWindowHandle()
    if (!buf || typeof (buf as any).length !== 'number') return undefined
    if (buf.length >= 8 && typeof (buf as any).readBigInt64LE === 'function') return (buf as any).readBigInt64LE(0) as bigint
    if (buf.length >= 4 && typeof (buf as any).readUInt32LE === 'function') return BigInt((buf as any).readUInt32LE(0))
    return undefined
  } catch {
    return undefined
  }
}

function hideAllToolbarSubwindows() {
  for (const item of toolbarSubwindows.values()) {
    const win = item.win
    if (win.isDestroyed()) continue
    stopToolbarSubwindowAnimation(item)
    if (win.isVisible()) win.hide()
  }
}

function scheduleRepositionToolbarSubwindows(reason: ToolbarRepositionReason) {
  scheduledRepositionReason = reason
  if (scheduledRepositionTimer) return
  scheduledRepositionTimer = setTimeout(() => {
    scheduledRepositionTimer = undefined
    const nextReason = scheduledRepositionReason
    scheduledRepositionReason = 'other'
    repositionToolbarSubwindows(nextReason !== 'move')
  }, reason === 'move' ? 16 : 0)
}

type Bounds = { x: number; y: number; width: number; height: number }
type WorkArea = { x: number; y: number; width: number; height: number }

function stopToolbarSubwindowAnimation(item: { animationTimer?: NodeJS.Timeout }) {
  if (!item.animationTimer) return
  clearTimeout(item.animationTimer)
  item.animationTimer = undefined
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

function easeOutBack(t: number) {
  const c1 = 1.08
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

function animateToolbarSubwindowTo(item: { win: BrowserWindow; animationTimer?: NodeJS.Timeout }, to: Bounds, atEdge: boolean) {
  stopToolbarSubwindowAnimation(item)
  const from = item.win.getBounds()
  if (from.x === to.x && from.y === to.y && from.width === to.width && from.height === to.height) return

  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.hypot(dx, dy)
  const durationMs = Math.max(140, Math.min(240, Math.round(140 + dist * 0.18)))
  const startAt = Date.now()
  const ease = atEdge ? easeOutCubic : easeOutBack

  const tick = () => {
    item.animationTimer = undefined
    if (item.win.isDestroyed()) return
    const now = Date.now()
    const t = Math.max(0, Math.min(1, (now - startAt) / durationMs))
    const k = ease(t)
    const next: Bounds = {
      x: Math.round(from.x + (to.x - from.x) * k),
      y: Math.round(from.y + (to.y - from.y) * k),
      width: Math.round(from.width + (to.width - from.width) * k),
      height: Math.round(from.height + (to.height - from.height) * k)
    }
    item.win.setBounds(next, false)
    if (t >= 1) return
    item.animationTimer = setTimeout(tick, 16)
  }

  item.animationTimer = setTimeout(tick, 0)
}

function getUiZoomFactor(): number {
  return Math.pow(1.2, toolbarUiZoom)
}

function computeToolbarSubwindowBounds(
  item: { effectivePlacement: 'top' | 'bottom'; width: number; height: number },
  ownerBounds: Bounds,
  workArea: WorkArea
) {
  const gap = Math.round(TOOLBAR_HANDLE_GAP * getUiZoomFactor())
  const widthLimit = Math.max(60, workArea.width - 20)
  const width = Math.max(60, Math.min(widthLimit, Math.round(item.width)))
  const heightLimit = Math.max(60, workArea.height - 20)
  const height = Math.max(60, Math.min(heightLimit, Math.round(item.height)))

  let x = ownerBounds.x
  let y =
    item.effectivePlacement === 'bottom'
      ? ownerBounds.y + ownerBounds.height + gap
      : ownerBounds.y - height - gap

  const xMax = workArea.x + workArea.width - width
  x = Math.max(workArea.x, Math.min(xMax, x))

  const yMax = workArea.y + workArea.height - height
  if (y < workArea.y || y > yMax) {
    item.effectivePlacement = item.effectivePlacement === 'bottom' ? 'top' : 'bottom'
    y =
      item.effectivePlacement === 'bottom'
        ? ownerBounds.y + ownerBounds.height + gap
        : ownerBounds.y - height - gap
    y = Math.max(workArea.y, Math.min(yMax, y))
  }

  const xi = Math.round(x)
  const yi = Math.round(y)
  return {
    bounds: { x: xi, y: yi, width, height },
    atEdge: xi === workArea.x || xi === xMax || yi === workArea.y || yi === yMax
  }
}

function computeToolbarNoticeBounds(
  item: { effectivePlacement: 'top' | 'bottom'; width: number; height: number },
  ownerBounds: Bounds,
  workArea: WorkArea
) {
  const gap = Math.round(TOOLBAR_HANDLE_GAP * getUiZoomFactor())
  const widthLimit = Math.max(60, workArea.width - 20)
  const width = Math.max(60, Math.min(widthLimit, Math.round(item.width)))
  const heightLimit = Math.max(60, workArea.height - 20)
  const height = Math.max(60, Math.min(heightLimit, Math.round(item.height)))

  let x = ownerBounds.x
  let y =
    item.effectivePlacement === 'bottom'
      ? ownerBounds.y + ownerBounds.height + gap
      : ownerBounds.y - height - gap

  const xMax = workArea.x + workArea.width - width
  x = Math.max(workArea.x, Math.min(xMax, x))

  const yMax = workArea.y + workArea.height - height
  if (y < workArea.y || y > yMax) {
    item.effectivePlacement = item.effectivePlacement === 'bottom' ? 'top' : 'bottom'
    y =
      item.effectivePlacement === 'bottom'
        ? ownerBounds.y + ownerBounds.height + gap
        : ownerBounds.y - height - gap
    y = Math.max(workArea.y, Math.min(yMax, y))
  }

  const xi = Math.round(x)
  const yi = Math.round(y)
  return {
    bounds: { x: xi, y: yi, width, height },
    atEdge: xi === workArea.x || xi === xMax || yi === workArea.y || yi === yMax
  }
}

function repositionToolbarSubwindows(animate: boolean) {
  const owner = floatingToolbarWindow
  if (!owner || owner.isDestroyed()) return
  const ownerBounds = owner.getBounds()
  const display = screen.getDisplayMatching(ownerBounds)
  const workArea = display.workArea

  const handle = floatingToolbarHandleWindow
  if (handle && !handle.isDestroyed() && handle.isVisible()) {
    const gap = Math.round(TOOLBAR_HANDLE_GAP * getUiZoomFactor())
    const next = {
      x: ownerBounds.x + ownerBounds.width + gap,
      y: ownerBounds.y,
      width: TOOLBAR_HANDLE_WIDTH,
      height: ownerBounds.height
    }
    const current = handle.getBounds()
    if (
      current.x !== next.x ||
      current.y !== next.y ||
      current.width !== next.width ||
      current.height !== next.height
    ) {
      if (!syncingToolbarPair) {
        syncingToolbarPair = true
        handle.setBounds(next, false)
        setTimeout(() => {
          syncingToolbarPair = false
        }, 0)
      }
    }
  }

  const noticeItem = toolbarNoticeItem
  const notice = toolbarNoticeWindow
  if (noticeItem && notice && !notice.isDestroyed() && toolbarNoticeDesiredVisible) {
    const prevEffectivePlacement = noticeItem.effectivePlacement
    const { bounds, atEdge } = computeToolbarNoticeBounds(noticeItem, ownerBounds, workArea)
    const placementChanged = noticeItem.effectivePlacement !== prevEffectivePlacement
    const shouldAnimate = animate || placementChanged || Boolean(noticeItem.animationTimer)
    if (shouldAnimate) {
      animateToolbarSubwindowTo(noticeItem, bounds, atEdge)
    } else {
      stopToolbarSubwindowAnimation(noticeItem)
      const current = notice.getBounds()
      if (
        current.x !== bounds.x ||
        current.y !== bounds.y ||
        current.width !== bounds.width ||
        current.height !== bounds.height
      ) {
        notice.setBounds(bounds, false)
      }
    }
  }

  for (const item of toolbarSubwindows.values()) {
    const win = item.win
    if (win.isDestroyed() || !win.isVisible()) continue
    const prevEffectivePlacement = item.effectivePlacement
    const { bounds, atEdge } = computeToolbarSubwindowBounds(item, ownerBounds, workArea)
    const placementChanged = item.effectivePlacement !== prevEffectivePlacement
    const shouldAnimate = animate || placementChanged || Boolean(item.animationTimer)
    if (shouldAnimate) {
      animateToolbarSubwindowTo(item, bounds, atEdge)
    } else {
      stopToolbarSubwindowAnimation(item)
      const current = win.getBounds()
      if (
        current.x !== bounds.x ||
        current.y !== bounds.y ||
        current.width !== bounds.width ||
        current.height !== bounds.height
      ) {
        win.setBounds(bounds, false)
      }
    }
  }
}

function createPaintBoardWindow(kind?: 'video-show' | 'pdf'): BrowserWindow {
  const owner = floatingToolbarWindow
  const ownerBounds = owner && !owner.isDestroyed() ? owner.getBounds() : screen.getPrimaryDisplay().bounds
  const display = screen.getDisplayMatching(ownerBounds)
  const bounds = display.bounds

  const win = new BrowserWindow({
    ...(APP_ICON_PATH ? { icon: APP_ICON_PATH } : {}),
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: kind === 'video-show' ? '视频展台' : kind === 'pdf' ? 'PDF' : '白板',
    backgroundColor: kind === 'video-show' ? '#000000ff' : '#ffffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  wireWindowDebug(win, 'paint-board')
  wireWindowStatus(win, 'paint-board')

  const devUrl = getDevServerUrl()
  if (devUrl) {
    win.loadURL(
      `${devUrl}?window=${encodeURIComponent('paint-board')}${kind ? `&kind=${encodeURIComponent(kind)}` : ''}`
    )
    if (process.env.LANSTART_OPEN_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: kind ? { window: 'paint-board', kind } : { window: 'paint-board' } })
  }

  const applyWhiteboardZOrder = () => {
    const WHITEBOARD_BG_LEVEL: Parameters<BrowserWindow['setAlwaysOnTop']>[1] = 'normal'
    const WHITEBOARD_OVERLAY_LEVEL: Parameters<BrowserWindow['setAlwaysOnTop']>[1] = 'floating'
    const WHITEBOARD_TOOLBAR_LEVEL: Parameters<BrowserWindow['setAlwaysOnTop']>[1] = 'screen-saver'

    const ensureTop = (target: BrowserWindow, level: Parameters<BrowserWindow['setAlwaysOnTop']>[1]) => {
      try {
        target.setAlwaysOnTop(true, level)
      } catch {}
      try {
        target.moveTop()
      } catch {}
    }

    const bg = whiteboardBackgroundWindow
    if (bg && !bg.isDestroyed()) {
      ensureTop(bg, WHITEBOARD_BG_LEVEL)
    }

    const overlay = annotationOverlayWindow
    if (overlay && !overlay.isDestroyed()) {
      ensureTop(overlay, WHITEBOARD_OVERLAY_LEVEL)
    }

    applyToolbarOnTopLevel(WHITEBOARD_TOOLBAR_LEVEL)

    const mp = multiPageControlWindow
    if (mp && !mp.isDestroyed() && mp.isVisible()) {
      try {
        mp.setAlwaysOnTop(true, WHITEBOARD_TOOLBAR_LEVEL)
      } catch {}
      try {
        mp.moveTop()
      } catch {}
    }
  }

  win.once('ready-to-show', () => {
    try {
      win.setAlwaysOnTop(true, 'normal')
    } catch {}
    try {
      win.setBounds(bounds, false)
    } catch {}
    win.show()
    applyWhiteboardZOrder()
  })

  win.on('show', applyWhiteboardZOrder)
  win.on('focus', applyWhiteboardZOrder)

  win.on('closed', () => {
    if (whiteboardBackgroundWindow === win) whiteboardBackgroundWindow = undefined
    if (!closingWhiteboardWindows) {
      closingWhiteboardWindows = true
      try {
        if (multiPageControlWindow && !multiPageControlWindow.isDestroyed()) multiPageControlWindow.close()
        if (annotationOverlayWindow && !annotationOverlayWindow.isDestroyed()) annotationOverlayWindow.close()
      } finally {
        multiPageControlWindow = undefined
        annotationOverlayWindow = undefined
        closingWhiteboardWindows = false
      }
    }
    requestBackendRpc('putUiStateKey', { windowId: 'app', key: 'mode', value: 'toolbar' }).catch(() => undefined)
    requestBackendRpc('putKv', { key: 'app-mode', value: 'toolbar' }).catch(() => undefined)
  })

  return win
}

function createAnnotationOverlayWindow(ownerWindow: BrowserWindow): BrowserWindow {
  const owner = floatingToolbarWindow
  const ownerBounds = owner && !owner.isDestroyed() ? owner.getBounds() : screen.getPrimaryDisplay().bounds
  const display = screen.getDisplayMatching(ownerBounds)
  const bounds = display.bounds

  const win = new BrowserWindow({
    ...(APP_ICON_PATH ? { icon: APP_ICON_PATH } : {}),
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    parent: ownerWindow,
    title: '批注层',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  wireWindowDebug(win, 'annotation-overlay')
  wireWindowStatus(win, 'annotation-overlay')

  const devUrl = getDevServerUrl()
  if (devUrl) {
    win.loadURL(`${devUrl}?window=${encodeURIComponent('paint-board')}&kind=${encodeURIComponent('annotation')}`)
    if (process.env.LANSTART_OPEN_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: 'paint-board', kind: 'annotation' } })
  }

  const applyWhiteboardZOrder = () => {
    const WHITEBOARD_BG_LEVEL: Parameters<BrowserWindow['setAlwaysOnTop']>[1] = 'normal'
    const WHITEBOARD_OVERLAY_LEVEL: Parameters<BrowserWindow['setAlwaysOnTop']>[1] = 'floating'
    const WHITEBOARD_TOOLBAR_LEVEL: Parameters<BrowserWindow['setAlwaysOnTop']>[1] = 'screen-saver'

    const ensureTop = (target: BrowserWindow, level: Parameters<BrowserWindow['setAlwaysOnTop']>[1]) => {
      try {
        target.setAlwaysOnTop(true, level)
      } catch {}
      try {
        target.moveTop()
      } catch {}
    }

    const bg = whiteboardBackgroundWindow
    if (bg && !bg.isDestroyed()) {
      ensureTop(bg, WHITEBOARD_BG_LEVEL)
    }

    const overlay = annotationOverlayWindow
    if (overlay && !overlay.isDestroyed()) {
      ensureTop(overlay, WHITEBOARD_OVERLAY_LEVEL)
    }

    applyToolbarOnTopLevel(WHITEBOARD_TOOLBAR_LEVEL)

    const mp = multiPageControlWindow
    if (mp && !mp.isDestroyed() && mp.isVisible()) {
      try {
        mp.setAlwaysOnTop(true, WHITEBOARD_TOOLBAR_LEVEL)
      } catch {}
      try {
        mp.moveTop()
      } catch {}
    }
  }

  win.once('ready-to-show', () => {
    try {
      win.setAlwaysOnTop(true, 'floating')
    } catch {}
    try {
      win.setBounds(bounds, false)
    } catch {}
    try {
      win.setIgnoreMouseEvents(true, { forward: true })
    } catch {}
    win.show()
    applyWhiteboardZOrder()
  })

  win.on('show', applyWhiteboardZOrder)
  win.on('focus', applyWhiteboardZOrder)

  win.on('closed', () => {
    if (annotationOverlayWindow === win) annotationOverlayWindow = undefined
    if (!closingWhiteboardWindows) {
      closingWhiteboardWindows = true
      try {
        if (whiteboardBackgroundWindow && !whiteboardBackgroundWindow.isDestroyed()) whiteboardBackgroundWindow.close()
      } finally {
        whiteboardBackgroundWindow = undefined
        closingWhiteboardWindows = false
      }
    }
    requestBackendRpc('putUiStateKey', { windowId: 'app', key: 'mode', value: 'toolbar' }).catch(() => undefined)
    requestBackendRpc('putKv', { key: 'app-mode', value: 'toolbar' }).catch(() => undefined)
  })

  return win
}

function createScreenAnnotationOverlayWindow(): BrowserWindow {
  const owner = floatingToolbarWindow
  const ownerBounds = owner && !owner.isDestroyed() ? owner.getBounds() : screen.getPrimaryDisplay().bounds
  const display = screen.getDisplayMatching(ownerBounds)
  const bounds = display.bounds

  const win = new BrowserWindow({
    ...(APP_ICON_PATH ? { icon: APP_ICON_PATH } : {}),
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    title: '屏幕批注层',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  wireWindowDebug(win, 'screen-annotation-overlay')
  wireWindowStatus(win, 'screen-annotation-overlay')

  const devUrl = getDevServerUrl()
  if (devUrl) {
    win.loadURL(`${devUrl}?window=${encodeURIComponent('paint-board')}&kind=${encodeURIComponent('annotation')}`)
    if (process.env.LANSTART_OPEN_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: 'paint-board', kind: 'annotation' } })
  }

  win.once('ready-to-show', () => {
    try {
      win.setAlwaysOnTop(true, 'screen-saver', topmostRelativeLevel)
    } catch {}
    try {
      win.setBounds(bounds, false)
    } catch {}
    try {
      win.setIgnoreMouseEvents(true, { forward: true })
    } catch {}
  })

  win.on('closed', () => {
    if (screenAnnotationOverlayWindow === win) screenAnnotationOverlayWindow = undefined
  })

  return win
}

function getOrCreateToolbarSubwindow(kind: string, placement: 'top' | 'bottom'): BrowserWindow {
  const existing = toolbarSubwindows.get(kind)
  if (existing && !existing.win.isDestroyed()) {
    existing.placement = placement
    return existing.win
  }

  const owner = floatingToolbarWindow
  if (!owner || owner.isDestroyed()) throw new Error('toolbar_owner_missing')

  const win = new BrowserWindow({
    ...(APP_ICON_PATH ? { icon: APP_ICON_PATH } : {}),
    width: 360,
    height: 220,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    transparent: !legacyWindowImplementation,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    parent: owner,
    title: `二级菜单-${kind}`,
    backgroundColor: legacyWindowImplementation ? effectiveSurfaceBackgroundColor(currentAppearance) : '#01000000',
    backgroundMaterial: legacyWindowImplementation && nativeMicaEnabled ? 'mica' : 'none',
    roundedCorners: legacyWindowImplementation,
    hasShadow: legacyWindowImplementation,
    webPreferences: buildUiWebPreferences()
  })

  applyWindowsBackdrop(win)
  try {
    win.setMenu(null)
  } catch {}
  try {
    win.setMenuBarVisibility(false)
  } catch {}
  try {
    win.setAutoHideMenuBar(true)
  } catch {}
  win.setAlwaysOnTop(true, 'screen-saver')
  wireWindowDebug(win, `subwindow-${kind}`)
  wireWindowStatus(win, `${WINDOW_ID_TOOLBAR_SUBWINDOW}:${kind}`)
  try {
    win.webContents.setZoomLevel(toolbarUiZoom)
  } catch {}

  const devUrl = getDevServerUrl()
  if (devUrl) {
    win.loadURL(
      `${devUrl}?window=${encodeURIComponent(WINDOW_ID_TOOLBAR_SUBWINDOW)}&kind=${encodeURIComponent(kind)}`
    )
    if (process.env.LANSTART_OPEN_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { window: WINDOW_ID_TOOLBAR_SUBWINDOW, kind }
    })
  }

  win.on('closed', () => {
    const item = toolbarSubwindows.get(kind)
    if (item) stopToolbarSubwindowAnimation(item)
    toolbarSubwindows.delete(kind)
  })

  toolbarSubwindows.set(kind, {
    win,
    placement,
    effectivePlacement: placement,
    width: 360,
    height: 220
  })
  scheduleRepositionToolbarSubwindows('other')
  return win
}

function showToolbarNoticeWindow() {
  const owner = floatingToolbarWindow
  if (!owner || owner.isDestroyed()) return
  const win = getOrCreateToolbarNoticeWindow()
  const item = toolbarNoticeItem
  if (!item) return

  closeOtherToolbarSubwindows('__notice__')

  item.placement = 'bottom'
  item.effectivePlacement = item.placement

  const ownerBounds = owner.getBounds()
  const display = screen.getDisplayMatching(ownerBounds)
  const { bounds } = computeToolbarNoticeBounds(item, ownerBounds, display.workArea)
  win.setBounds(bounds, false)
  scheduleRepositionToolbarSubwindows('other')

  const doShow = () => {
    if (win.isDestroyed()) return
    if (win.isVisible()) return
    win.showInactive()
  }
  if (win.webContents.isLoading()) win.once('ready-to-show', doShow)
  else doShow()
}

function hideToolbarNoticeWindow() {
  const win = toolbarNoticeWindow
  if (!win || win.isDestroyed()) return
  if (win.isVisible()) win.hide()
}

function setToolbarNoticeBounds(bounds: { width: number; height: number }) {
  const item = toolbarNoticeItem
  if (!item || item.win.isDestroyed()) return
  item.width = bounds.width
  item.height = bounds.height
  scheduleRepositionToolbarSubwindows('other')
}

async function maybeShowRestoreNotesNotice(): Promise<void> {
  const owner = floatingToolbarWindow
  if (!owner || owner.isDestroyed()) return

  let mode: 'toolbar' | 'whiteboard' | 'video-show' | 'pdf' = 'toolbar'
  try {
    const raw = await backendGetKv('app-mode')
    if (raw === 'whiteboard') mode = 'whiteboard'
    if (raw === 'video-show') mode = 'video-show'
    if (raw === 'pdf') mode = 'pdf'
  } catch {}

  const notesHistoryKvKey =
    mode === 'whiteboard'
      ? 'annotation-notes-whiteboard-prev'
      : mode === 'video-show'
        ? 'annotation-notes-video-show-prev'
        : mode === 'pdf'
          ? 'annotation-notes-pdf-prev'
          : 'annotation-notes-toolbar-prev'
  try {
    await backendGetKv(notesHistoryKvKey)
  } catch (e) {
    if (String(e).includes('kv_not_found')) return
    return
  }

  backendPutUiStateKey('app', 'noticeKind', 'notesRestore').catch(() => undefined)
  toolbarNoticeDesiredVisible = true
  try {
    showToolbarNoticeWindow()
  } catch {}
}

function closeOtherToolbarSubwindows(exceptKind: string) {
  for (const [kind, item] of toolbarSubwindows.entries()) {
    if (kind === exceptKind) continue
    const win = item.win
    if (win.isDestroyed()) continue
    stopToolbarSubwindowAnimation(item)
    if (win.isVisible()) win.hide()
  }
}

function toggleToolbarSubwindow(kind: string, placement: 'top' | 'bottom') {
  const win = getOrCreateToolbarSubwindow(kind, placement)
  const item = toolbarSubwindows.get(kind)
  if (!item) return

  item.placement = placement

  if (win.isVisible()) {
    win.hide()
    return
  }

  toolbarNoticeDesiredVisible = false
  hideToolbarNoticeWindow()

  item.effectivePlacement = placement
  closeOtherToolbarSubwindows(kind)
  const owner = floatingToolbarWindow
  if (owner && !owner.isDestroyed()) {
    const ownerBounds = owner.getBounds()
    const display = screen.getDisplayMatching(ownerBounds)
    const { bounds } = computeToolbarSubwindowBounds(item, ownerBounds, display.workArea)
    win.setBounds(bounds, false)
  }
  scheduleRepositionToolbarSubwindows('other')
  const doShow = () => {
    if (win.isDestroyed()) return
    if (win.isVisible()) return
    win.showInactive()
  }
  if (win.webContents.isLoading()) {
    win.once('ready-to-show', doShow)
  } else {
    doShow()
  }
}

function setToolbarSubwindowHeight(kind: string, height: number) {
  const item = toolbarSubwindows.get(kind)
  if (!item || item.win.isDestroyed()) return
  item.height = height
  scheduleRepositionToolbarSubwindows('other')
}

function setToolbarSubwindowBounds(kind: string, bounds: { width: number; height: number }) {
  const item = toolbarSubwindows.get(kind)
  if (!item || item.win.isDestroyed()) return
  item.width = bounds.width
  item.height = bounds.height
  scheduleRepositionToolbarSubwindows('other')
}

function handleBackendControlMessage(message: any): void {
  if (!message || typeof message !== 'object') return

  if (message.type === 'RPC_RESPONSE') {
    const id = Number((message as BackendRpcResponse).id)
    if (!Number.isFinite(id)) return
    const pending = pendingBackendRpc.get(id)
    if (!pending) return
    pendingBackendRpc.delete(id)
    clearTimeout(pending.timer)
    const ok = Boolean((message as BackendRpcResponse).ok)
    if (ok) {
      pending.resolve((message as any).result)
    } else {
      pending.reject(new Error(coerceString((message as any).error) || 'backend_rpc_failed'))
    }
    return
  }

  if (message.type === 'MAIN_RPC_REQUEST') {
    const id = Number((message as any).id)
    const method = String((message as any).method ?? '')
    const params = (message as any).params as unknown
    if (!Number.isFinite(id) || !method) return

    void (async () => {
      try {
        if (method === 'selectImageFile') {
          const parent =
            BrowserWindow.getFocusedWindow() ??
            whiteboardBackgroundWindow ??
            annotationOverlayWindow ??
            screenAnnotationOverlayWindow ??
            undefined
          const options: OpenDialogOptions = {
            properties: ['openFile'],
            filters: [
              { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] },
              { name: 'All Files', extensions: ['*'] }
            ]
          }
          const res = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
          const fileUrl = res.canceled || !res.filePaths?.[0] ? undefined : pathToFileURL(res.filePaths[0]).toString()
          sendToBackend({ type: 'MAIN_RPC_RESPONSE', id, ok: true, result: { fileUrl } })
          return
        }

        if (method === 'selectPdfFile') {
          const parent =
            BrowserWindow.getFocusedWindow() ??
            whiteboardBackgroundWindow ??
            annotationOverlayWindow ??
            screenAnnotationOverlayWindow ??
            undefined
          const options: OpenDialogOptions = {
            properties: ['openFile'],
            filters: [
              { name: 'PDF', extensions: ['pdf'] },
              { name: 'All Files', extensions: ['*'] }
            ]
          }
          const res = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
          const fileUrl = res.canceled || !res.filePaths?.[0] ? undefined : pathToFileURL(res.filePaths[0]).toString()
          sendToBackend({ type: 'MAIN_RPC_RESPONSE', id, ok: true, result: { fileUrl } })
          return
        }

        throw new Error('UNKNOWN_MAIN_RPC_METHOD')
      } catch (e) {
        sendToBackend({ type: 'MAIN_RPC_RESPONSE', id, ok: false, error: String(e) })
      }
    })()
    return
  }

  if (message.type === 'SET_APPEARANCE') {
    const appearance = (message as any).appearance
    if (!isAppearance(appearance)) return
    applyAppearance(appearance)
    return
  }

  if (message.type === 'SET_NATIVE_MICA') {
    applyNativeMica(Boolean((message as any).enabled))
    return
  }

  if (message.type === 'SET_LEGACY_WINDOW_IMPLEMENTATION') {
    applyLegacyWindowImplementation(Boolean((message as any).enabled))
    return
  }

  if (message.type === 'SET_MERGE_RENDERER_PIPELINE') {
    applyMergeRendererPipeline(Boolean((message as any).enabled))
    return
  }

  if (message.type === 'SET_SYSTEM_UIA_TOPMOST') {
    systemUiaTopmostEnabled = Boolean((message as any).enabled)
    return
  }

  if (message.type === 'SET_WINDOW_PRELOAD') {
    systemWindowPreloadEnabled = Boolean((message as any).enabled)
    if (systemWindowPreloadEnabled) preloadAllUiWindows()
    return
  }

  if (message.type === 'SET_UI_ZOOM') {
    const zoom = Number(message.zoom)
    if (Number.isFinite(zoom)) {
      toolbarUiZoom = zoom
      applyToolbarUiZoom(zoom)
    }
    return
  }

  if (appWindowsManager.handleBackendControlMessage(message)) return

  if (message.type === 'SET_MUT_PAGE_VISIBLE') {
    const source = String((message as any).source ?? '')
    const visible = Boolean((message as any).visible)
    if (source === 'ppt') {
      if (visible) {
        mutPagePptLastShownAt = Date.now()
        mutPageDesiredFromPpt = true
        if (mutPagePptHideTimer) {
          clearTimeout(mutPagePptHideTimer)
          mutPagePptHideTimer = undefined
        }
        applyMutPageVisibility()
        return
      }

      if (mutPageAnchorBounds) return

      if (mutPagePptHideTimer) clearTimeout(mutPagePptHideTimer)
      mutPagePptHideTimer = setTimeout(() => {
        mutPagePptHideTimer = undefined
        if (Date.now() - mutPagePptLastShownAt < 900) return
        mutPageDesiredFromPpt = false
        applyMutPageVisibility()
      }, 900)
    }
    return
  }

  if (message.type === 'SET_MUT_PAGE_ANCHOR') {
    const source = String((message as any).source ?? '')
    const b = (message as any).bounds
    if (source === 'ppt') {
      if (b && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.width) && Number.isFinite(b.height)) {
        mutPageAnchorBounds = { x: Number(b.x), y: Number(b.y), width: Number(b.width), height: Number(b.height) }
        mutPagePptLastShownAt = Date.now()
        mutPageDesiredFromPpt = true
        if (mutPagePptHideTimer) {
          clearTimeout(mutPagePptHideTimer)
          mutPagePptHideTimer = undefined
        }
        applyMutPageVisibility()
      } else {
        mutPageAnchorBounds = undefined
        if (mutPagePptHideTimer) clearTimeout(mutPagePptHideTimer)
        mutPagePptHideTimer = setTimeout(() => {
          mutPagePptHideTimer = undefined
          if (Date.now() - mutPagePptLastShownAt < 1200) return
          mutPageDesiredFromPpt = false
          applyMutPageVisibility()
        }, 1200)
      }
      repositionMultiPageControlWindow()
    }
    return
  }

  if (message.type === 'SET_MUT_PAGE_BOUNDS') {
    const width = Number((message as any).width)
    const height = Number((message as any).height)
    if (Number.isFinite(width) && Number.isFinite(height)) {
      mutPageUiBounds = { width: Math.max(140, Math.round(width)), height: Math.max(40, Math.round(height)) }
      repositionMultiPageControlWindow()
    }
    return
  }

  if (message.type === 'SET_APP_MODE') {
    const modeRaw = String((message as any).mode ?? '')
    const mode =
      modeRaw === 'whiteboard' ? 'whiteboard' : modeRaw === 'video-show' ? 'video-show' : modeRaw === 'pdf' ? 'pdf' : 'toolbar'
    if (mode === 'whiteboard' || mode === 'video-show' || mode === 'pdf') {
      mutPageDesiredFromAppMode = true
      const screenOverlay = screenAnnotationOverlayWindow
      if (screenOverlay && !screenOverlay.isDestroyed()) {
        try {
          screenOverlay.setIgnoreMouseEvents(true, { forward: true })
        } catch {}
        try {
          if (screenOverlay.isVisible()) screenOverlay.hide()
        } catch {}
      }
      hideAllToolbarSubwindows()
      appWindowsManager.hideAll()
      if (!whiteboardBackgroundWindow || whiteboardBackgroundWindow.isDestroyed()) {
        whiteboardBackgroundWindow =
          createPaintBoardWindow(mode === 'video-show' ? 'video-show' : mode === 'pdf' ? 'pdf' : undefined)
      } else {
        try {
          const devUrl = getDevServerUrl()
          if (devUrl) {
            whiteboardBackgroundWindow.loadURL(
              `${devUrl}?window=${encodeURIComponent('paint-board')}${
                mode === 'video-show'
                  ? `&kind=${encodeURIComponent('video-show')}`
                  : mode === 'pdf'
                    ? `&kind=${encodeURIComponent('pdf')}`
                    : ''
              }`
            )
          } else {
            whiteboardBackgroundWindow.loadFile(join(__dirname, '../renderer/index.html'), {
              query:
                mode === 'video-show'
                  ? { window: 'paint-board', kind: 'video-show' }
                  : mode === 'pdf'
                    ? { window: 'paint-board', kind: 'pdf' }
                    : { window: 'paint-board' }
            })
          }
        } catch {}
        try {
          whiteboardBackgroundWindow.setTitle(mode === 'video-show' ? '视频展台' : mode === 'pdf' ? 'PDF' : '白板')
        } catch {}
        whiteboardBackgroundWindow.show()
      }
      const ensureOverlayVisible = () => {
        if (!annotationOverlayWindow || annotationOverlayWindow.isDestroyed()) {
          const bg = whiteboardBackgroundWindow
          if (bg && !bg.isDestroyed()) annotationOverlayWindow = createAnnotationOverlayWindow(bg)
        } else {
          annotationOverlayWindow.show()
        }
        try {
          const overlay = annotationOverlayWindow
          if (overlay && !overlay.isDestroyed()) overlay.setAlwaysOnTop(true, 'floating')
        } catch {}
      }
      const ensureOverlayHidden = () => {
        const overlay = annotationOverlayWindow
        if (overlay && !overlay.isDestroyed()) {
          try {
            if (overlay.isVisible()) overlay.hide()
          } catch {}
        }
      }

      if (mode === 'video-show') {
        backendGetKv(VIDEO_SHOW_MERGE_LAYERS_KV_KEY)
          .then((v) => {
            if (v === true) ensureOverlayHidden()
            else ensureOverlayVisible()
          })
          .catch(() => ensureOverlayVisible())
      } else {
        ensureOverlayVisible()
      }
      try {
        const bg = whiteboardBackgroundWindow
        if (bg && !bg.isDestroyed()) bg.setAlwaysOnTop(true, 'normal')
      } catch {}
      applyToolbarOnTopLevel('screen-saver')
      applyMutPageVisibility()
    } else {
      mutPageDesiredFromAppMode = false
      applyMutPageVisibility()
      const overlay = annotationOverlayWindow
      if (overlay && !overlay.isDestroyed()) {
        try {
          if (overlay.isVisible()) overlay.hide()
        } catch {}
      }
      const bg = whiteboardBackgroundWindow
      if (bg && !bg.isDestroyed()) {
        try {
          if (bg.isVisible()) bg.hide()
        } catch {}
      }
      applyToolbarOnTopLevel('screen-saver')
      requestBackendRpc<Record<string, unknown>>('getUiState', { windowId: 'app' })
        .then((state) => {
          const toolRaw = (state as any)?.tool
          const tool = toolRaw === 'pen' || toolRaw === 'eraser' ? toolRaw : 'mouse'
          handleBackendControlMessage({ type: 'SET_SCREEN_ANNOTATION_VISIBLE', visible: tool !== 'mouse' })
        })
        .catch(() => undefined)
    }
    return
  }

  if (message.type === 'SET_ANNOTATION_INPUT') {
    const enabled = Boolean((message as any).enabled)
    const targets = [annotationOverlayWindow, screenAnnotationOverlayWindow]
    for (const win of targets) {
      if (!win || win.isDestroyed()) continue
      try {
        if (enabled) win.setIgnoreMouseEvents(false)
        else win.setIgnoreMouseEvents(true, { forward: true })
      } catch {}
    }
    return
  }

  if (message.type === 'SET_SCREEN_ANNOTATION_VISIBLE') {
    const visible = Boolean((message as any).visible)

    if (
      (whiteboardBackgroundWindow && !whiteboardBackgroundWindow.isDestroyed() && whiteboardBackgroundWindow.isVisible()) ||
      (annotationOverlayWindow && !annotationOverlayWindow.isDestroyed() && annotationOverlayWindow.isVisible())
    ) {
      const overlay = screenAnnotationOverlayWindow
      if (overlay && !overlay.isDestroyed()) {
        try {
          overlay.setIgnoreMouseEvents(true, { forward: true })
        } catch {}
        try {
          if (overlay.isVisible()) overlay.hide()
        } catch {}
      }
      return
    }

    if (visible) {
      if (!screenAnnotationOverlayWindow || screenAnnotationOverlayWindow.isDestroyed()) {
        screenAnnotationOverlayWindow = createScreenAnnotationOverlayWindow()
      }

      const overlay = screenAnnotationOverlayWindow
      if (!overlay || overlay.isDestroyed()) return

      const applyOverlayZOrder = () => {
        if (overlay.isDestroyed()) return
        try {
          overlay.setAlwaysOnTop(true, 'screen-saver', topmostRelativeLevel)
        } catch {}
        try {
          overlay.moveTop()
        } catch {}
        try {
          overlay.setIgnoreMouseEvents(false)
        } catch {}
        applyToolbarOnTopLevel('screen-saver')
        applyMutPageVisibility()
      }

      const doShow = () => {
        if (overlay.isDestroyed()) return
        if (!overlay.isVisible()) {
          try {
            overlay.showInactive()
          } catch {
            overlay.show()
          }
        }
        applyOverlayZOrder()
      }

      if (overlay.webContents.isLoading()) overlay.once('ready-to-show', doShow)
      else doShow()
    } else {
      const overlay = screenAnnotationOverlayWindow
      if (overlay && !overlay.isDestroyed()) {
        try {
          overlay.setIgnoreMouseEvents(true, { forward: true })
        } catch {}
        try {
          if (overlay.isVisible()) overlay.hide()
        } catch {}
      }
      applyToolbarOnTopLevel('screen-saver')
    }

    return
  }

  if (message.type === 'TOGGLE_MUT_PAGE_THUMBNAILS_MENU') {
    try {
      toggleMutPageThumbnailsMenuWindow()
    } catch {
      return
    }
    return
  }

  if (message.type === 'TOGGLE_SUBWINDOW') {
    const kind = String((message as any).kind ?? '')
    const placementRaw = String((message as any).placement ?? '')
    const placement = placementRaw === 'top' ? 'top' : placementRaw === 'bottom' ? 'bottom' : undefined
    if (!kind || !placement) return
    try {
      toggleToolbarSubwindow(kind, placement)
    } catch {
      return
    }
    return
  }

  if (message.type === 'SET_SUBWINDOW_HEIGHT') {
    const kind = String((message as any).kind ?? '')
    const height = Number((message as any).height)
    if (!kind || !Number.isFinite(height)) return
    setToolbarSubwindowHeight(kind, height)
    return
  }

  if (message.type === 'SET_SUBWINDOW_BOUNDS') {
    const kind = String((message as any).kind ?? '')
    const width = Number((message as any).width)
    const height = Number((message as any).height)
    if (!kind || !Number.isFinite(width) || !Number.isFinite(height)) return
    if (kind === 'notice') {
      setToolbarNoticeBounds({ width, height })
    } else {
      setToolbarSubwindowBounds(kind, { width, height })
    }
    return
  }

  if (message.type === 'SET_NOTICE_VISIBLE') {
    const visible = Boolean((message as any).visible)
    toolbarNoticeDesiredVisible = visible
    if (visible) showToolbarNoticeWindow()
    else {
      backendPutUiStateKey('app', 'noticeKind', '').catch(() => undefined)
      hideToolbarNoticeWindow()
    }
    return
  }

  if (message.type === 'SET_TOOLBAR_BOUNDS') {
    const width = Number(message.width)
    const height = Number(message.height)
    if (!Number.isFinite(width) || !Number.isFinite(height)) return
    const win = floatingToolbarWindow
    if (!win) return
    const bounds = win.getBounds()
    const nextWidth = Math.max(1, Math.min(1200, Math.round(width)))
    const nextHeight = Math.max(1, Math.min(600, Math.round(height)))
    win.setBounds({ ...bounds, width: nextWidth, height: nextHeight }, false)
    scheduleRepositionToolbarSubwindows('resize')
    return
  }

  if (message.type === 'QUIT_APP') {
    setTimeout(() => {
      app.quit()
    }, 120)
    return
  }
}

function wireBackendStdout(stdout: NodeJS.ReadableStream): void {
  let buffer = ''
  stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith(BACKEND_STDIO_PREFIX)) {
        if (trimmed) process.stdout.write(`${trimmed}\n`)
        continue
      }
      const jsonText = trimmed.slice(BACKEND_STDIO_PREFIX.length)
      try {
        const msg = JSON.parse(jsonText)
        handleBackendControlMessage(msg)
      } catch {
        continue
      }
    }
  })
}

async function pickFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

function resolvePptWrapperExecutablePath(): string | undefined {
  const candidates = [
    join(process.resourcesPath, 'ppt-wrapper', platform === 'win32' ? 'PptHttpWrapper.exe' : 'PptHttpWrapper'),
    join(process.resourcesPath, 'PptHttpWrapper', platform === 'win32' ? 'PptHttpWrapper.exe' : 'PptHttpWrapper'),
    join(process.cwd(), 'out', 'ppt-wrapper', platform === 'win32' ? 'PptHttpWrapper.exe' : 'PptHttpWrapper'),
  ]
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p
    } catch {}
  }
  return undefined
}

async function waitForHttpOk(url: string, timeoutMs = 3500): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 450)
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(t)
      if (res.ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 120))
  }
  return false
}

async function ensurePptWrapperStarted(): Promise<{ port: number; baseUrl: string } | undefined> {
  if (pptWrapperPort && pptWrapperProcess && !pptWrapperProcess.killed) {
    return { port: pptWrapperPort, baseUrl: `http://127.0.0.1:${pptWrapperPort}` }
  }

  if (!pptWrapperPort) {
    const picked = await pickFreePort().catch(() => 0)
    pptWrapperPort = Number.isFinite(picked) && picked > 0 ? picked : 3133
  }

  const port = pptWrapperPort
  const baseUrl = `http://127.0.0.1:${port}`

  const isDev = Boolean(getDevServerUrl())
  const projectRoot = process.cwd()
  const exePath = resolvePptWrapperExecutablePath()

  try {
    if (pptWrapperProcess && !pptWrapperProcess.killed) {
      try {
        pptWrapperProcess.kill()
      } catch {}
    }
  } catch {}

  if (pptWrapperRestartTimer) {
    clearTimeout(pptWrapperRestartTimer)
    pptWrapperRestartTimer = undefined
  }

  if (exePath) {
    pptWrapperProcess = spawn(exePath, ['--port', String(port)], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LANSTART_PPT_WRAPPER_PORT: String(port) }
    })
  } else if (isDev && platform === 'win32') {
    const csproj = join(projectRoot, 'src', 'office', 'PowerPoint', 'inkeys', 'PptHttpWrapper', 'PptHttpWrapper.csproj')
    pptWrapperProcess = spawn('dotnet', ['run', '--project', csproj, '--', '--port', String(port)], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: projectRoot,
      env: { ...process.env, LANSTART_PPT_WRAPPER_PORT: String(port) }
    })
  } else {
    pptWrapperProcess = undefined
    return undefined
  }

  const proc = pptWrapperProcess
  if (!proc) return undefined

  try {
    proc.stdin.end()
  } catch {}

  try {
    sendToBackend({ type: 'PROCESS_STATUS', name: 'ppt-wrapper', status: 'spawned', pid: proc.pid, ts: Date.now() })
  } catch {}

  proc.stdout.on('data', (c) => {
    const s = String(c ?? '')
    if (s.trim()) process.stdout.write(s)
  })
  proc.stderr.on('data', (c) => {
    const s = String(c ?? '')
    if (s.trim()) process.stderr.write(s)
  })
  proc.on('exit', () => {
    pptWrapperProcess = undefined
    if (pptWrapperRestartTimer) clearTimeout(pptWrapperRestartTimer)
    pptWrapperRestartTimer = setTimeout(() => {
      void ensurePptWrapperStarted().catch(() => undefined)
    }, 650)
  })

  await waitForHttpOk(`${baseUrl}/health`).catch(() => false)
  return { port, baseUrl }
}

function startBackend(extraEnv?: Record<string, string>): void {
  backendExtraEnv = extraEnv
  const dbPath = join(app.getPath('userData'), 'leveldb')
  const transport = process.env.LANSTART_BACKEND_TRANSPORT === 'http' ? 'http' : 'stdio'
  const host = process.env.LANSTART_BACKEND_HOST ?? '127.0.0.1'
  const env = {
    ...process.env,
    LANSTART_BACKEND_PORT: String(BACKEND_PORT),
    LANSTART_BACKEND_HOST: host,
    LANSTART_DB_PATH: dbPath,
    LANSTART_BACKEND_TRANSPORT: transport,
    ...(extraEnv ?? {})
  }

  const isDev = Boolean(getDevServerUrl())
  const projectRoot = process.cwd()

  if (isDev) {
    const backendEntry = join(projectRoot, 'src/elysia/index.ts')
    const tsxCliMjs = join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
    if (existsSync(tsxCliMjs)) {
      backendProcess = spawn(process.execPath, [tsxCliMjs, backendEntry], {
        cwd: projectRoot,
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } else {
      const localTsxBin =
        platform === 'win32'
          ? join(projectRoot, 'node_modules', '.bin', 'tsx.cmd')
          : join(projectRoot, 'node_modules', '.bin', 'tsx')
      const tsxBin = existsSync(localTsxBin) ? localTsxBin : 'tsx'

      if (platform === 'win32' && tsxBin.toLowerCase().endsWith('.cmd')) {
        const comspec = process.env.comspec ?? 'cmd.exe'
        const cmdLine = `""${tsxBin}" "${backendEntry}""`
        backendProcess = spawn(comspec, ['/d', '/s', '/c', cmdLine], {
          cwd: projectRoot,
          env,
          stdio: ['pipe', 'pipe', 'pipe']
        })
      } else {
        backendProcess = spawn(tsxBin, [backendEntry], {
          cwd: projectRoot,
          env,
          stdio: ['pipe', 'pipe', 'pipe']
        })
      }
    }
  } else {
    const appPath = app.getAppPath()
    const unpackedAppPath = appPath.replace('app.asar', 'app.asar.unpacked')
    const backendEntryUnpacked = join(unpackedAppPath, 'out', 'elysia', 'index.js')
    const backendEntryPacked = join(appPath, 'out', 'elysia', 'index.js')
    const backendEntry = existsSync(backendEntryUnpacked) ? backendEntryUnpacked : backendEntryPacked
    backendProcess = spawn(process.execPath, [backendEntry], {
      cwd: existsSync(unpackedAppPath) ? unpackedAppPath : process.resourcesPath,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
  }

  sendToBackend({ type: 'PROCESS_STATUS', name: 'backend', status: 'spawned', pid: backendProcess.pid, ts: Date.now() })

  const spawnedBackendProc = backendProcess
  setTimeout(() => {
    if (backendProcess === spawnedBackendProc && spawnedBackendProc && !spawnedBackendProc.killed) backendRestartAttempt = 0
  }, 5000)

  backendProcess.stdin.on('error', () => undefined)

  backendProcess.on('exit', () => {
    backendProcess = undefined
    for (const [id, pending] of pendingBackendRpc.entries()) {
      pendingBackendRpc.delete(id)
      clearTimeout(pending.timer)
      pending.reject(new Error('backend_exited'))
    }

    if (!isAppQuitting && !isAppRestarting) {
      if (backendRestartTimer) clearTimeout(backendRestartTimer)
      backendRestartAttempt += 1
      const delay = Math.min(6000, 600 + backendRestartAttempt * 600)
      backendRestartTimer = setTimeout(() => {
        backendRestartTimer = undefined
        try {
          startBackend(backendExtraEnv)
        } catch {}
      }, delay)
    }
  })

  wireBackendStdout(backendProcess.stdout)

  backendProcess.stderr.on('data', (chunk) => {
    process.stderr.write(chunk)
  })
}

if (hasSingleInstanceLock) {
  app
    .whenReady()
    .then(async () => {
      try {
        const ppt = await ensurePptWrapperStarted().catch(() => undefined)
        const extraEnv = ppt
          ? {
              LANSTART_PPT_WRAPPER_PORT: String(ppt.port),
              LANSTART_PPT_WRAPPER_BASE_URL: ppt.baseUrl
            }
          : undefined
        startBackend(extraEnv)
      } catch (e) {
        process.stderr.write(String(e))
      }

      try {
        const ses = session.defaultSession
        if (ses) {
          const isTrustedUrl = (url: string) =>
            url.startsWith('file://') ||
            url.startsWith('http://localhost:5173') ||
            url.startsWith('http://127.0.0.1:5173') ||
            url.startsWith('http://[::1]:5173')

          ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
            try {
              const url = webContents.getURL()
              if (!isTrustedUrl(url)) return callback(false)
              if (permission !== 'media') return callback(false)
              const mediaTypes = Array.isArray((details as any)?.mediaTypes) ? (details as any).mediaTypes.map(String) : []
              if (mediaTypes.length && !mediaTypes.includes('video')) return callback(false)
              return callback(true)
            } catch {
              return callback(false)
            }
          })

          ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
            try {
              const url = webContents?.getURL?.() ?? ''
              const origin = typeof requestingOrigin === 'string' && requestingOrigin ? requestingOrigin : url
              if (!isTrustedUrl(origin)) return false
              if (permission !== 'media') return false
              const mediaTypes = Array.isArray((details as any)?.mediaTypes) ? (details as any).mediaTypes.map(String) : []
              if (mediaTypes.length && !mediaTypes.includes('video')) return false
              return true
            } catch {
              return false
            }
          })
        }
      } catch {}

      lanstartwriteLink.flush().catch(() => undefined)

      let loadedAppearance: Appearance | undefined
      let loadedNativeMica: boolean | undefined
      let loadedLegacyWindowImplementation: boolean | undefined
      let loadedSystemUiaTopmost: boolean | undefined
      let loadedMergeRendererPipeline: boolean | undefined
      let loadedSystemWindowPreload: boolean | undefined

      for (let attempt = 0; attempt < 3; attempt++) {
        let backendResponded = false

        try {
          const value = await backendGetKv(APPEARANCE_KV_KEY)
          backendResponded = true
          if (isAppearance(value)) loadedAppearance = value
        } catch (e) {
          if (String(e).includes('kv_not_found')) backendResponded = true
        }

        try {
          const raw = await backendGetKv(NATIVE_MICA_KV_KEY)
          backendResponded = true
          if (typeof raw === 'boolean') loadedNativeMica = raw
          else if (raw === 'true' || raw === 1 || raw === '1') loadedNativeMica = true
          else if (raw === 'false' || raw === 0 || raw === '0') loadedNativeMica = false
        } catch (e) {
          if (String(e).includes('kv_not_found')) backendResponded = true
        }

        try {
          const raw = await backendGetKv(LEGACY_WINDOW_IMPL_KV_KEY)
          backendResponded = true
          if (typeof raw === 'boolean') loadedLegacyWindowImplementation = raw
          else if (raw === 'true' || raw === 1 || raw === '1') loadedLegacyWindowImplementation = true
          else if (raw === 'false' || raw === 0 || raw === '0') loadedLegacyWindowImplementation = false
        } catch (e) {
          if (String(e).includes('kv_not_found')) backendResponded = true
        }

        try {
          const raw = await backendGetKv(SYSTEM_UIA_TOPMOST_KV_KEY)
          backendResponded = true
          if (typeof raw === 'boolean') loadedSystemUiaTopmost = raw
          else if (raw === 'true' || raw === 1 || raw === '1') loadedSystemUiaTopmost = true
          else if (raw === 'false' || raw === 0 || raw === '0') loadedSystemUiaTopmost = false
        } catch (e) {
          if (String(e).includes('kv_not_found')) backendResponded = true
        }

        try {
          const raw = await backendGetKv(SYSTEM_MERGE_RENDERER_PIPELINE_KV_KEY)
          backendResponded = true
          if (typeof raw === 'boolean') loadedMergeRendererPipeline = raw
          else if (raw === 'true' || raw === 1 || raw === '1') loadedMergeRendererPipeline = true
          else if (raw === 'false' || raw === 0 || raw === '0') loadedMergeRendererPipeline = false
        } catch (e) {
          if (String(e).includes('kv_not_found')) backendResponded = true
        }

        try {
          const raw = await backendGetKv(SYSTEM_WINDOW_PRELOAD_KV_KEY)
          backendResponded = true
          if (typeof raw === 'boolean') loadedSystemWindowPreload = raw
          else if (raw === 'true' || raw === 1 || raw === '1') loadedSystemWindowPreload = true
          else if (raw === 'false' || raw === 0 || raw === '0') loadedSystemWindowPreload = false
        } catch (e) {
          if (String(e).includes('kv_not_found')) backendResponded = true
        }

        if (backendResponded) break
        await new Promise((r) => setTimeout(r, 220))
      }

      applyMergeRendererPipeline(loadedMergeRendererPipeline ?? false, { rebuild: false })
      applyLegacyWindowImplementation(loadedLegacyWindowImplementation ?? false, { rebuild: false })
      applyNativeMica(loadedNativeMica ?? false)
      applyAppearance(loadedAppearance ?? currentAppearance)
      systemUiaTopmostEnabled = loadedSystemUiaTopmost ?? true
      systemWindowPreloadEnabled = loadedSystemWindowPreload ?? false

      isRunningAsAdmin = await detectWindowsAdmin().catch(() => false)
      topmostRelativeLevel = isRunningAsAdmin ? 20 : 0
      backendPutUiStateKey('app', ADMIN_STATUS_UI_STATE_KEY, isRunningAsAdmin).catch(() => undefined)
      backendPutUiStateKey('app', SYSTEM_UIA_TOPMOST_UI_STATE_KEY, systemUiaTopmostEnabled).catch(() => undefined)

      sendToBackend({ type: 'PROCESS_STATUS', name: 'main', status: 'ready', pid: process.pid, ts: Date.now() })
      ensureTaskWatcherStarted()
      const win = createFloatingToolbarWindow()
      floatingToolbarWindow = win
      const handle = createFloatingToolbarHandleWindow(win)
      floatingToolbarHandleWindow = handle
      ensureTray()
      if (!stopToolbarTopmostPolling) {
        const poller = startWindowTopmostPolling({
          intervalMs: 1000,
          getTargets: () => {
            const out: BrowserWindow[] = []
            const toolbar = floatingToolbarWindow
            if (toolbar && !toolbar.isDestroyed()) out.push(toolbar)
            const h = floatingToolbarHandleWindow
            if (h && !h.isDestroyed()) out.push(h)
            const notice = toolbarNoticeWindow
            if (notice && !notice.isDestroyed()) out.push(notice)
            const screenOverlay = screenAnnotationOverlayWindow
            if (screenOverlay && !screenOverlay.isDestroyed()) out.push(screenOverlay)
            const mp = multiPageControlWindow
            if (mp && !mp.isDestroyed()) out.push(mp)
            const mph = mutPageHandleWindow
            if (mph && !mph.isDestroyed()) out.push(mph)
            for (const item of toolbarSubwindows.values()) {
              const sw = item.win
              if (sw && !sw.isDestroyed()) out.push(sw)
            }
            return out
          },
          tick: async (targets) => {
            refreshToolbarWindowsLayoutAndSurface()
            applyToolbarOnTopLevel('screen-saver')
            if (process.platform !== 'win32') return
            if (!systemUiaTopmostEnabled) return
            const hwnds: bigint[] = []
            for (const w of targets) {
              if (!w || w.isDestroyed()) continue
              if (!w.isVisible()) continue
              const hwnd = readWin32Hwnd(w)
              if (typeof hwnd === 'bigint') hwnds.push(hwnd)
            }
            await forceTopmostWindows(hwnds)
          }
        })
        stopToolbarTopmostPolling = poller.stop
      }
      win.once('ready-to-show', () => {
        win.show()
        scheduleRepositionToolbarSubwindows('other')
        if (!handle.isDestroyed()) handle.showInactive()
        applyToolbarOnTopLevel('screen-saver')
        void maybeShowRestoreNotesNotice()
        if (systemWindowPreloadEnabled) preloadAllUiWindows()
      })

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          const toolbar = createFloatingToolbarWindow()
          floatingToolbarWindow = toolbar
          const nextHandle = createFloatingToolbarHandleWindow(toolbar)
          floatingToolbarHandleWindow = nextHandle
          toolbar.once('ready-to-show', () => {
            toolbar.show()
            scheduleRepositionToolbarSubwindows('other')
            if (!nextHandle.isDestroyed()) nextHandle.showInactive()
          })
        }
      })
    })
    .catch((e) => {
      process.stderr.write(String(e))
    })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (allowQuitToProceed) return

  if (backendRestartTimer) clearTimeout(backendRestartTimer)

  sendToBackend({ type: 'PROCESS_STATUS', name: 'main', status: 'before-quit', pid: process.pid, ts: Date.now() })
  sendToBackend({ type: 'CLEANUP_RUNTIME' })
  try {
    stopToolbarTopmostPolling?.()
  } catch {}
  taskWatcher?.stop()

  if (backendProcess && !backendProcess.killed) {
    event.preventDefault()
    void (async () => {
      await shutdownBackendGracefully().catch(() => undefined)
      if (pptWrapperRestartTimer) clearTimeout(pptWrapperRestartTimer)
      try {
        if (pptWrapperProcess && !pptWrapperProcess.killed) pptWrapperProcess.kill()
      } catch {}
      allowQuitToProceed = true
      try {
        app.quit()
      } catch {}
    })()
    return
  }

  allowQuitToProceed = true
  if (pptWrapperRestartTimer) clearTimeout(pptWrapperRestartTimer)
  if (pptWrapperProcess && !pptWrapperProcess.killed) pptWrapperProcess.kill()
})
