import { BrowserWindow, app, ipcMain, nativeTheme, screen } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { platform } from 'node:process'
import { createTaskWatcherAdapter } from '../system_different_code'
import { TaskWindowsWatcher } from '../task_windows_watcher/TaskWindowsWatcher'

let backendProcess: ChildProcessWithoutNullStreams | undefined

const BACKEND_PORT = 3131
const BACKEND_STDIO_PREFIX = '__LANSTART__'
const WINDOW_ID_FLOATING_TOOLBAR = '浮动工具栏'
const WINDOW_ID_FLOATING_TOOLBAR_HANDLE = 'floating-toolbar-handle'
const WINDOW_TITLE_FLOATING_TOOLBAR = '浮动工具栏'
const WINDOW_ID_TOOLBAR_SUBWINDOW = 'toolbar-subwindow'
const WINDOW_ID_WATCHER = 'watcher'
const TOOLBAR_HANDLE_GAP = 10
const TOOLBAR_HANDLE_WIDTH = 30
const APPEARANCE_KV_KEY = 'app-appearance'

type Appearance = 'light' | 'dark'

function isAppearance(v: unknown): v is Appearance {
  return v === 'light' || v === 'dark'
}

function surfaceBackgroundColor(appearance: Appearance): string {
  return appearance === 'dark' ? '#191c24ff' : '#f4f5f7ff'
}

let currentAppearance: Appearance = 'light'
let didApplyAppearance = false

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
  const bg = surfaceBackgroundColor(appearance)
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.setBackgroundColor(bg)
    } catch {}
  }
  broadcastAppearanceToUiState(appearance)
}

let floatingToolbarWindow: BrowserWindow | undefined
let floatingToolbarHandleWindow: BrowserWindow | undefined
let paintBoardWindow: BrowserWindow | undefined
let watcherWindow: BrowserWindow | undefined
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
    const bounds = win.isDestroyed() ? undefined : win.getBounds()
    const payload = {
      type: 'WINDOW_STATUS',
      windowId,
      event,
      ts: Date.now(),
      bounds,
      visible: !win.isDestroyed() ? win.isVisible() : false,
      focused: !win.isDestroyed() ? win.isFocused() : false,
      minimized: !win.isDestroyed() ? win.isMinimized() : false,
      maximized: !win.isDestroyed() ? win.isMaximized() : false,
      fullscreen: !win.isDestroyed() ? win.isFullScreen() : false,
      title: !win.isDestroyed() ? win.getTitle() : '',
      rendererPid: win.webContents.getOSProcessId?.(),
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
  if (typeof setMaterial === 'function') {
    try {
      setMaterial('mica')
      return
    } catch {}
    try {
      setMaterial('acrylic')
      return
    } catch {}
  }
}

function createFloatingToolbarWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 360,
    height: 160,
    frame: false,
    transparent: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: WINDOW_TITLE_FLOATING_TOOLBAR,
    backgroundColor: surfaceBackgroundColor(currentAppearance),
    backgroundMaterial: 'mica',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  applyWindowsBackdrop(win)
  win.setAlwaysOnTop(true, 'floating')
  wireWindowDebug(win, 'floating-toolbar')
  wireWindowStatus(win, WINDOW_ID_FLOATING_TOOLBAR)
  win.on('move', scheduleRepositionToolbarSubwindows)
  win.on('resize', scheduleRepositionToolbarSubwindows)
  win.on('show', () => {
    scheduleRepositionToolbarSubwindows()
    const handle = floatingToolbarHandleWindow
    if (handle && !handle.isDestroyed()) handle.showInactive()
  })
  win.on('hide', () => {
    const handle = floatingToolbarHandleWindow
    if (handle && !handle.isDestroyed() && handle.isVisible()) handle.hide()
    for (const item of toolbarSubwindows.values()) {
      if (item.win.isDestroyed()) continue
      item.win.hide()
    }
  })
  win.on('closed', () => {
    const handle = floatingToolbarHandleWindow
    if (handle && !handle.isDestroyed()) handle.close()
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
    width: TOOLBAR_HANDLE_WIDTH,
    height: ownerBounds.height,
    frame: false,
    transparent: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    parent: owner,
    title: '拖动把手',
    backgroundColor: surfaceBackgroundColor(currentAppearance),
    backgroundMaterial: 'mica',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  applyWindowsBackdrop(win)
  win.setAlwaysOnTop(true, 'floating')
  wireWindowDebug(win, 'floating-toolbar-handle')
  wireWindowStatus(win, WINDOW_ID_FLOATING_TOOLBAR_HANDLE)

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
    scheduleRepositionToolbarSubwindows()
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

function createChildWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 260,
    resizable: true,
    title: 'LanStart Window',
    backgroundColor: surfaceBackgroundColor(currentAppearance),
    backgroundMaterial: 'mica',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  applyWindowsBackdrop(win)
  wireWindowDebug(win, 'child-window')
  wireWindowStatus(win, 'child')
  const devUrl = getDevServerUrl()
  if (devUrl) {
    win.loadURL(`${devUrl}?window=child`)
    if (process.env.LANSTART_OPEN_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: 'child' } })
  }

  return win
}

function createWatcherWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 980,
    height: 720,
    resizable: true,
    title: '系统监视器',
    backgroundColor: surfaceBackgroundColor(currentAppearance),
    backgroundMaterial: 'mica',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  applyWindowsBackdrop(win)
  wireWindowDebug(win, 'watcher-window')
  wireWindowStatus(win, WINDOW_ID_WATCHER)

  const devUrl = getDevServerUrl()
  if (devUrl) {
    win.loadURL(`${devUrl}?window=${encodeURIComponent(WINDOW_ID_WATCHER)}`)
    if (process.env.LANSTART_OPEN_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: WINDOW_ID_WATCHER } })
  }

  return win
}

function applyToolbarOnTopLevel(level: 'normal' | 'floating' | 'torn-off-menu' | 'modal-panel' | 'main-menu' | 'status' | 'pop-up-menu' | 'screen-saver') {
  const toolbar = floatingToolbarWindow
  if (toolbar && !toolbar.isDestroyed()) {
    toolbar.setAlwaysOnTop(true, level)
    toolbar.showInactive()
    toolbar.moveTop()
  }

  const handle = floatingToolbarHandleWindow
  if (handle && !handle.isDestroyed()) {
    handle.setAlwaysOnTop(true, level)
    handle.showInactive()
    handle.moveTop()
  }

  for (const item of toolbarSubwindows.values()) {
    const win = item.win
    if (win.isDestroyed()) continue
    win.setAlwaysOnTop(true, level)
    if (win.isVisible()) win.showInactive()
    win.moveTop()
  }
}

function restoreToolbarAlwaysOnTopFromPersistedState() {
  requestBackendRpc('getKv', { key: 'toolbar-state' })
    .then((raw: any) => {
      const alwaysOnTop = Boolean(raw?.alwaysOnTop)
      const toolbar = floatingToolbarWindow
      if (toolbar && !toolbar.isDestroyed()) toolbar.setAlwaysOnTop(alwaysOnTop, 'floating')

      const handle = floatingToolbarHandleWindow
      if (handle && !handle.isDestroyed()) handle.setAlwaysOnTop(alwaysOnTop, 'floating')

      for (const item of toolbarSubwindows.values()) {
        const win = item.win
        if (win.isDestroyed()) continue
        win.setAlwaysOnTop(alwaysOnTop, 'floating')
      }
    })
    .catch(() => undefined)
}

function scheduleRepositionToolbarSubwindows() {
  if (scheduledRepositionTimer) return
  scheduledRepositionTimer = setTimeout(() => {
    scheduledRepositionTimer = undefined
    repositionToolbarSubwindows()
  }, 0)
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

function computeToolbarSubwindowBounds(
  item: { effectivePlacement: 'top' | 'bottom'; width: number; height: number },
  ownerBounds: Bounds,
  workArea: WorkArea
) {
  const gap = 10
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

function repositionToolbarSubwindows() {
  const owner = floatingToolbarWindow
  if (!owner || owner.isDestroyed()) return
  const ownerBounds = owner.getBounds()
  const display = screen.getDisplayMatching(ownerBounds)
  const workArea = display.workArea

  const handle = floatingToolbarHandleWindow
  if (handle && !handle.isDestroyed() && handle.isVisible()) {
    const next = {
      x: ownerBounds.x + ownerBounds.width + TOOLBAR_HANDLE_GAP,
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

  for (const item of toolbarSubwindows.values()) {
    const win = item.win
    if (win.isDestroyed() || !win.isVisible()) continue
    const { bounds, atEdge } = computeToolbarSubwindowBounds(item, ownerBounds, workArea)
    animateToolbarSubwindowTo(item, bounds, atEdge)
  }
}

function createPaintBoardWindow(): BrowserWindow {
  const owner = floatingToolbarWindow
  const ownerBounds = owner && !owner.isDestroyed() ? owner.getBounds() : screen.getPrimaryDisplay().bounds
  const display = screen.getDisplayMatching(ownerBounds)
  const bounds = display.bounds

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: false,
    resizable: false,
    maximizable: false,
    fullscreenable: true,
    skipTaskbar: true,
    title: '白板',
    backgroundColor: '#ffffffff',
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
    win.loadURL(`${devUrl}?window=${encodeURIComponent('paint-board')}`)
    if (process.env.LANSTART_OPEN_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: 'paint-board' } })
  }

  const raiseToolbar = () => {
    applyToolbarOnTopLevel('screen-saver')
  }

  win.once('ready-to-show', () => {
    try {
      win.setFullScreen(true)
    } catch {}
    win.show()
    raiseToolbar()
  })

  win.on('show', raiseToolbar)
  win.on('focus', raiseToolbar)
  win.on('enter-full-screen', raiseToolbar)

  win.on('closed', () => {
    if (paintBoardWindow === win) paintBoardWindow = undefined
    requestBackendRpc('putUiStateKey', { windowId: 'app', key: 'mode', value: 'toolbar' }).catch(() => undefined)
    requestBackendRpc('putKv', { key: 'app-mode', value: 'toolbar' }).catch(() => undefined)
    restoreToolbarAlwaysOnTopFromPersistedState()
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
    width: 360,
    height: 220,
    frame: false,
    transparent: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    parent: owner,
    title: `二级菜单-${kind}`,
    backgroundColor: surfaceBackgroundColor(currentAppearance),
    backgroundMaterial: 'mica',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  applyWindowsBackdrop(win)
  win.setAlwaysOnTop(true, 'floating')
  wireWindowDebug(win, `subwindow-${kind}`)
  wireWindowStatus(win, `${WINDOW_ID_TOOLBAR_SUBWINDOW}:${kind}`)

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
  scheduleRepositionToolbarSubwindows()
  return win
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

  item.effectivePlacement = placement
  closeOtherToolbarSubwindows(kind)
  const owner = floatingToolbarWindow
  if (owner && !owner.isDestroyed()) {
    const ownerBounds = owner.getBounds()
    const display = screen.getDisplayMatching(ownerBounds)
    const { bounds } = computeToolbarSubwindowBounds(item, ownerBounds, display.workArea)
    win.setBounds(bounds, false)
  }
  scheduleRepositionToolbarSubwindows()
  win.showInactive()
}

function setToolbarSubwindowHeight(kind: string, height: number) {
  const item = toolbarSubwindows.get(kind)
  if (!item || item.win.isDestroyed()) return
  item.height = height
  scheduleRepositionToolbarSubwindows()
}

function setToolbarSubwindowBounds(kind: string, bounds: { width: number; height: number }) {
  const item = toolbarSubwindows.get(kind)
  if (!item || item.win.isDestroyed()) return
  item.width = bounds.width
  item.height = bounds.height
  scheduleRepositionToolbarSubwindows()
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

  if (message.type === 'SET_APPEARANCE') {
    const appearance = (message as any).appearance
    if (!isAppearance(appearance)) return
    applyAppearance(appearance)
    return
  }

  if (message.type === 'CREATE_WINDOW') {
    const win = createChildWindow()
    win.once('ready-to-show', () => win.show())
    sendToBackend({ type: 'WINDOW_CREATED', window: 'child' })
    return
  }

  if (message.type === 'OPEN_WATCHER_WINDOW') {
    const existing = watcherWindow
    if (existing && !existing.isDestroyed()) {
      existing.show()
      existing.focus()
      return
    }
    const win = createWatcherWindow()
    watcherWindow = win
    win.once('ready-to-show', () => win.show())
    win.on('closed', () => {
      if (watcherWindow === win) watcherWindow = undefined
    })
    return
  }

  if (message.type === 'SET_APP_MODE') {
    const modeRaw = String((message as any).mode ?? '')
    const mode = modeRaw === 'whiteboard' ? 'whiteboard' : 'toolbar'
    if (mode === 'whiteboard') {
      applyToolbarOnTopLevel('screen-saver')
      if (!paintBoardWindow || paintBoardWindow.isDestroyed()) {
        paintBoardWindow = createPaintBoardWindow()
      } else {
        paintBoardWindow.show()
      }
    } else {
      if (paintBoardWindow && !paintBoardWindow.isDestroyed()) paintBoardWindow.close()
      paintBoardWindow = undefined
      restoreToolbarAlwaysOnTopFromPersistedState()
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
    setToolbarSubwindowBounds(kind, { width, height })
    return
  }

  if (message.type === 'SET_TOOLBAR_ALWAYS_ON_TOP') {
    const value = Boolean(message.value)
    if (paintBoardWindow && !paintBoardWindow.isDestroyed()) {
      applyToolbarOnTopLevel('screen-saver')
      return
    }
    floatingToolbarWindow?.setAlwaysOnTop(value, 'floating')
    floatingToolbarHandleWindow?.setAlwaysOnTop(value, 'floating')
    for (const item of toolbarSubwindows.values()) {
      if (item.win.isDestroyed()) continue
      item.win.setAlwaysOnTop(value, 'floating')
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
    scheduleRepositionToolbarSubwindows()
    return
  }

  if (message.type === 'START_TASK_WATCHER') {
    const intervalMs = Number((message as any).intervalMs)
    ensureTaskWatcherStarted(Number.isFinite(intervalMs) ? intervalMs : undefined)
    return
  }

  if (message.type === 'STOP_TASK_WATCHER') {
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
    const backendEntry = join(__dirname, '..', 'elysia', 'index.js')
    backendProcess = spawn(process.execPath, [backendEntry], {
      cwd: join(__dirname, '..'),
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

ipcMain.handle('lanstart:postCommand', async (_event, input: { command?: unknown; payload?: unknown }) => {
  const command = coerceString(input?.command)
  if (!command) throw new Error('BAD_COMMAND')
  await requestBackendRpc('postCommand', { command, payload: input?.payload })
  return null
})

ipcMain.handle('lanstart:getEvents', async (_event, input: { since?: unknown }) => {
  const since = Number(input?.since ?? 0)
  const res = (await requestBackendRpc('getEvents', { since })) as { items?: unknown; latest?: unknown }
  return {
    items: Array.isArray(res?.items) ? res.items : [],
    latest: Number(res?.latest ?? since)
  }
})

ipcMain.handle('lanstart:getKv', async (_event, input: { key?: unknown }) => {
  const key = coerceString(input?.key)
  if (!key) throw new Error('BAD_KEY')
  return await requestBackendRpc('getKv', { key })
})

ipcMain.handle('lanstart:putKv', async (_event, input: { key?: unknown; value?: unknown }) => {
  const key = coerceString(input?.key)
  if (!key) throw new Error('BAD_KEY')
  await requestBackendRpc('putKv', { key, value: input?.value })
  return null
})

ipcMain.handle('lanstart:getUiState', async (_event, input: { windowId?: unknown }) => {
  const windowId = coerceString(input?.windowId)
  if (!windowId) throw new Error('BAD_WINDOW_ID')
  return await requestBackendRpc('getUiState', { windowId })
})

ipcMain.handle('lanstart:putUiStateKey', async (_event, input: { windowId?: unknown; key?: unknown; value?: unknown }) => {
  const windowId = coerceString(input?.windowId)
  const key = coerceString(input?.key)
  if (!windowId || !key) throw new Error('BAD_UI_STATE_KEY')
  await requestBackendRpc('putUiStateKey', { windowId, key, value: input?.value })
  return null
})

ipcMain.handle('lanstart:deleteUiStateKey', async (_event, input: { windowId?: unknown; key?: unknown }) => {
  const windowId = coerceString(input?.windowId)
  const key = coerceString(input?.key)
  if (!windowId || !key) throw new Error('BAD_UI_STATE_KEY')
  await requestBackendRpc('deleteUiStateKey', { windowId, key })
  return null
})

ipcMain.handle('lanstart:apiRequest', async (_event, input: { method?: unknown; path?: unknown; body?: unknown }) => {
  const method = coerceString(input?.method).toUpperCase() || 'GET'
  const path = coerceString(input?.path)
  if (!path.startsWith('/')) throw new Error('BAD_PATH')
  const res = (await requestBackendRpc('apiRequest', { method, path, body: input?.body })) as { status?: unknown; body?: unknown }
  return { status: Number(res?.status ?? 200), body: (res as any)?.body }
})

app
  .whenReady()
  .then(() => {
    try {
      startBackend()
    } catch (e) {
      process.stderr.write(String(e))
    }
    ;(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const value = await backendGetKv(APPEARANCE_KV_KEY)
          if (isAppearance(value)) applyAppearance(value)
          return
        } catch {
          await new Promise((r) => setTimeout(r, 220))
        }
      }
      applyAppearance(currentAppearance)
    })().catch(() => {
      applyAppearance(currentAppearance)
    })
    sendToBackend({ type: 'PROCESS_STATUS', name: 'main', status: 'ready', pid: process.pid, ts: Date.now() })
    ensureTaskWatcherStarted()
    const win = createFloatingToolbarWindow()
    floatingToolbarWindow = win
    const handle = createFloatingToolbarHandleWindow(win)
    floatingToolbarHandleWindow = handle
    win.once('ready-to-show', () => {
      win.show()
      scheduleRepositionToolbarSubwindows()
      if (!handle.isDestroyed()) handle.showInactive()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const toolbar = createFloatingToolbarWindow()
        floatingToolbarWindow = toolbar
        const nextHandle = createFloatingToolbarHandleWindow(toolbar)
        floatingToolbarHandleWindow = nextHandle
        toolbar.once('ready-to-show', () => {
          toolbar.show()
          scheduleRepositionToolbarSubwindows()
          if (!nextHandle.isDestroyed()) nextHandle.showInactive()
        })
      }
    })
  })
  .catch((e) => {
    process.stderr.write(String(e))
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  sendToBackend({ type: 'PROCESS_STATUS', name: 'main', status: 'before-quit', pid: process.pid, ts: Date.now() })
  sendToBackend({ type: 'CLEANUP_RUNTIME' })
  taskWatcher?.stop()
  if (backendProcess && !backendProcess.killed) backendProcess.kill()
})
