import { BrowserWindow, Menu, Tray, app, dialog, ipcMain, nativeImage, nativeTheme, screen, session, type OpenDialogOptions } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { platform } from 'node:process'
import { pathToFileURL } from 'node:url'
import { AppWindowsManager, startWindowTopmostPolling } from '../app_windows_manerger'
import { createTaskWatcherAdapter, forceTopmostWindows } from '../system_different_code'
import { TaskWindowsWatcher } from '../task_windows_watcher/TaskWindowsWatcher'
import { createLanstartwriteLinkController } from '../url_http_link'

let backendProcess: ChildProcessWithoutNullStreams | undefined

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
const WINDOW_ID_MUT_PAGE_THUMBNAILS_MENU = 'mut-page-thumbnails-menu'
const TOOLBAR_HANDLE_GAP = 10
const TOOLBAR_HANDLE_WIDTH = 30
const APPEARANCE_KV_KEY = 'app-appearance'
const NATIVE_MICA_KV_KEY = 'native-mica-enabled'
const LEGACY_WINDOW_IMPL_KV_KEY = 'legacy-window-implementation'

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
        try {
          backendProcess?.kill()
        } catch {}
        try {
          app.relaunch()
        } catch {}
        try {
          app.exit(0)
        } catch {}
      }
    },
    {
      label: '退出',
      click: () => {
        try {
          backendProcess?.kill()
        } catch {}
        try {
          app.quit()
        } catch {}
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

function applyLegacyWindowImplementation(enabled: boolean, opts?: { rebuild?: boolean }): void {
  legacyWindowImplementation = enabled
  if (!enabled) applyNativeMica(false)
  if (opts?.rebuild === false) return

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

function applyToolbarUiZoom(zoom: number): void {
  const targets = [
    floatingToolbarWindow,
    floatingToolbarHandleWindow,
    toolbarNoticeWindow,
    multiPageControlWindow,
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
let mutPageThumbnailsMenuWindow: BrowserWindow | undefined
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
    backgroundColor: legacyWindowImplementation ? effectiveSurfaceBackgroundColor(currentAppearance) : '#00000000',
    backgroundMaterial: legacyWindowImplementation && nativeMicaEnabled ? 'mica' : 'none',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
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
    backgroundColor: legacyWindowImplementation ? effectiveSurfaceBackgroundColor(currentAppearance) : '#00000000',
    backgroundMaterial: legacyWindowImplementation && nativeMicaEnabled ? 'mica' : 'none',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
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
    backgroundColor: legacyWindowImplementation ? effectiveSurfaceBackgroundColor(currentAppearance) : '#00000000',
    backgroundMaterial: legacyWindowImplementation && nativeMicaEnabled ? 'mica' : 'none',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
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
  const display = screen.getDisplayMatching(ownerBounds)
  const area = owner === whiteboardBackgroundWindow && owner && !owner.isDestroyed() ? display.bounds : display.workArea

  const width = 360
  const height = 66
  const margin = 14
  const x = area.x + margin
  const y = area.y + area.height - height - margin

  try {
    win.setBounds({ x, y, width, height }, false)
  } catch {}
  const menu = mutPageThumbnailsMenuWindow
  if (menu && !menu.isDestroyed() && menu.isVisible()) repositionMutPageThumbnailsMenuWindow()
}

function getOrCreateMultiPageControlWindow(): BrowserWindow {
  const existing = multiPageControlWindow
  if (existing && !existing.isDestroyed()) return existing

  const owner = whiteboardBackgroundWindow ?? floatingToolbarWindow
  if (!owner || owner.isDestroyed()) throw new Error('mut_page_owner_missing')

  const win = new BrowserWindow({
    ...(APP_ICON_PATH ? { icon: APP_ICON_PATH } : {}),
    width: 360,
    height: 66,
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
    backgroundColor: legacyWindowImplementation ? effectiveSurfaceBackgroundColor(currentAppearance) : '#00000000',
    backgroundMaterial: legacyWindowImplementation && nativeMicaEnabled ? 'mica' : 'none',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
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
  })
  win.on('closed', () => {
    if (multiPageControlWindow === win) multiPageControlWindow = undefined
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

function repositionMutPageThumbnailsMenuWindow(): void {
  const win = mutPageThumbnailsMenuWindow
  const owner = multiPageControlWindow
  if (!win || win.isDestroyed()) return
  if (!owner || owner.isDestroyed()) return

  const ownerBounds = owner.getBounds()
  const display = screen.getDisplayMatching(ownerBounds)
  const area = display.workArea

  const width = 800
  const height = 520
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

  const win = new BrowserWindow({
    ...(APP_ICON_PATH ? { icon: APP_ICON_PATH } : {}),
    width: 800,
    height: 520,
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
    backgroundColor: legacyWindowImplementation ? effectiveSurfaceBackgroundColor(currentAppearance) : '#00000000',
    backgroundMaterial: legacyWindowImplementation && nativeMicaEnabled ? 'mica' : 'none',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
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
  const toolbar = floatingToolbarWindow
  if (toolbar && !toolbar.isDestroyed()) {
    toolbar.setAlwaysOnTop(true, level)
    if (toolbar.isVisible()) {
      toolbar.moveTop()
    }
  }

  const handle = floatingToolbarHandleWindow
  if (handle && !handle.isDestroyed()) {
    handle.setAlwaysOnTop(true, level)
    if (handle.isVisible()) {
      handle.moveTop()
    }
  }

  const notice = toolbarNoticeWindow
  if (notice && !notice.isDestroyed() && notice.isVisible()) {
    notice.setAlwaysOnTop(true, level)
    notice.moveTop()
  }

  for (const item of toolbarSubwindows.values()) {
    const win = item.win
    if (win.isDestroyed()) continue
    if (!win.isVisible()) continue
    win.setAlwaysOnTop(true, level)
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

function createPaintBoardWindow(kind?: 'video-show'): BrowserWindow {
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
    title: kind === 'video-show' ? '视频展台' : '白板',
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
      win.setAlwaysOnTop(true, 'floating')
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
    backgroundColor: legacyWindowImplementation ? effectiveSurfaceBackgroundColor(currentAppearance) : '#00000000',
    backgroundMaterial: legacyWindowImplementation && nativeMicaEnabled ? 'mica' : 'none',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
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

  let mode: 'toolbar' | 'whiteboard' | 'video-show' = 'toolbar'
  try {
    const raw = await backendGetKv('app-mode')
    if (raw === 'whiteboard') mode = 'whiteboard'
    if (raw === 'video-show') mode = 'video-show'
  } catch {}

  const notesHistoryKvKey =
    mode === 'whiteboard' ? 'annotation-notes-whiteboard-prev' : mode === 'video-show' ? 'annotation-notes-video-show-prev' : 'annotation-notes-toolbar-prev'
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

  if (message.type === 'SET_UI_ZOOM') {
    const zoom = Number(message.zoom)
    if (Number.isFinite(zoom)) {
      toolbarUiZoom = zoom
      applyToolbarUiZoom(zoom)
    }
    return
  }

  if (appWindowsManager.handleBackendControlMessage(message)) return

  if (message.type === 'SET_APP_MODE') {
    const modeRaw = String((message as any).mode ?? '')
    const mode = modeRaw === 'whiteboard' ? 'whiteboard' : modeRaw === 'video-show' ? 'video-show' : 'toolbar'
    if (mode === 'whiteboard' || mode === 'video-show') {
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
        whiteboardBackgroundWindow = createPaintBoardWindow(mode === 'video-show' ? 'video-show' : undefined)
      } else {
        try {
          const devUrl = getDevServerUrl()
          if (devUrl) {
            whiteboardBackgroundWindow.loadURL(
              `${devUrl}?window=${encodeURIComponent('paint-board')}${mode === 'video-show' ? `&kind=${encodeURIComponent('video-show')}` : ''}`
            )
          } else {
            whiteboardBackgroundWindow.loadFile(join(__dirname, '../renderer/index.html'), {
              query: mode === 'video-show' ? { window: 'paint-board', kind: 'video-show' } : { window: 'paint-board' }
            })
          }
        } catch {}
        try {
          whiteboardBackgroundWindow.setTitle(mode === 'video-show' ? '视频展台' : '白板')
        } catch {}
        whiteboardBackgroundWindow.show()
      }
      if (!annotationOverlayWindow || annotationOverlayWindow.isDestroyed()) {
        const bg = whiteboardBackgroundWindow
        if (bg && !bg.isDestroyed()) annotationOverlayWindow = createAnnotationOverlayWindow(bg)
      } else {
        annotationOverlayWindow.show()
      }
      try {
        const bg = whiteboardBackgroundWindow
        if (bg && !bg.isDestroyed()) bg.setAlwaysOnTop(true, 'normal')
      } catch {}
      try {
        const overlay = annotationOverlayWindow
        if (overlay && !overlay.isDestroyed()) overlay.setAlwaysOnTop(true, 'floating')
      } catch {}
      applyToolbarOnTopLevel('screen-saver')

      const mp = getOrCreateMultiPageControlWindow()
      repositionMultiPageControlWindow()
      const showMutPage = () => {
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
      }
      if (mp.webContents.isLoading()) mp.once('ready-to-show', showMutPage)
      else showMutPage()
    } else {
      const mp = multiPageControlWindow
      if (mp && !mp.isDestroyed()) {
        try {
          if (mp.isVisible()) mp.hide()
        } catch {}
      }
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
          overlay.setAlwaysOnTop(true, 'floating')
        } catch {}
        try {
          overlay.moveTop()
        } catch {}
        try {
          overlay.setIgnoreMouseEvents(false)
        } catch {}
        applyToolbarOnTopLevel('screen-saver')
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

function startBackend(): void {
  const dbPath = join(app.getPath('userData'), 'leveldb')
  const transport = process.env.LANSTART_BACKEND_TRANSPORT === 'http' ? 'http' : 'stdio'
  const host = process.env.LANSTART_BACKEND_HOST ?? '127.0.0.1'
  const env = {
    ...process.env,
    LANSTART_BACKEND_PORT: String(BACKEND_PORT),
    LANSTART_BACKEND_HOST: host,
    LANSTART_DB_PATH: dbPath,
    LANSTART_BACKEND_TRANSPORT: transport
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

  backendProcess.stdin.on('error', () => undefined)

  backendProcess.on('exit', () => {
    backendProcess = undefined
    for (const [id, pending] of pendingBackendRpc.entries()) {
      pendingBackendRpc.delete(id)
      clearTimeout(pending.timer)
      pending.reject(new Error('backend_exited'))
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
        startBackend()
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

        if (backendResponded) break
        await new Promise((r) => setTimeout(r, 220))
      }

      applyLegacyWindowImplementation(loadedLegacyWindowImplementation ?? false, { rebuild: false })
      applyNativeMica(loadedNativeMica ?? false)
      applyAppearance(loadedAppearance ?? currentAppearance)

      sendToBackend({ type: 'PROCESS_STATUS', name: 'main', status: 'ready', pid: process.pid, ts: Date.now() })
      ensureTaskWatcherStarted()
      const win = createFloatingToolbarWindow()
      floatingToolbarWindow = win
      const handle = createFloatingToolbarHandleWindow(win)
      floatingToolbarHandleWindow = handle
      ensureTray()
      if (!stopToolbarTopmostPolling) {
        const poller = startWindowTopmostPolling({
          intervalMs: 5000,
          getTargets: () => {
            const out: BrowserWindow[] = []
            const toolbar = floatingToolbarWindow
            if (toolbar && !toolbar.isDestroyed()) out.push(toolbar)
            const h = floatingToolbarHandleWindow
            if (h && !h.isDestroyed()) out.push(h)
            const notice = toolbarNoticeWindow
            if (notice && !notice.isDestroyed()) out.push(notice)
            const mp = multiPageControlWindow
            if (mp && !mp.isDestroyed()) out.push(mp)
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

app.on('before-quit', () => {
  sendToBackend({ type: 'PROCESS_STATUS', name: 'main', status: 'before-quit', pid: process.pid, ts: Date.now() })
  sendToBackend({ type: 'CLEANUP_RUNTIME' })
  try {
    stopToolbarTopmostPolling?.()
  } catch {}
  taskWatcher?.stop()
  if (backendProcess && !backendProcess.killed) backendProcess.kill()
})
