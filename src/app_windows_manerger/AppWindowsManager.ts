import { BrowserWindow, app, clipboard, screen, type IpcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
 
export type AppManagedWindowKind = 'child' | 'watcher' | 'settings'

const WINDOW_ID_BY_KIND: Record<AppManagedWindowKind, string> = {
  child: 'child',
  watcher: 'watcher',
  settings: 'settings-window'
}

const SHARED_RENDERER_AFFINITY = 'lanstartwrite-ui'

function resolveAppIconPath(): string | undefined {
  const candidates = [
    join(process.resourcesPath, 'iconpack', 'LanStartWrite.png'),
    join(process.resourcesPath, 'LanStartWrite.png'),
    join(__dirname, '../../iconpack/LanStartWrite.png'),
    join(app.getAppPath(), 'iconpack', 'LanStartWrite.png'),
    join(process.cwd(), 'iconpack', 'LanStartWrite.png'),
  ]
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p
    } catch {}
  }
  return undefined
}

function kindFromWindowId(windowId: string): AppManagedWindowKind | undefined {
  if (windowId === WINDOW_ID_BY_KIND.child) return 'child'
  if (windowId === WINDOW_ID_BY_KIND.watcher) return 'watcher'
  if (windowId === WINDOW_ID_BY_KIND.settings) return 'settings'
  return undefined
}
 
export type AppWindowsManagerDeps = {
  preloadPath: string
  rendererHtmlPath: string
  getDevServerUrl: () => string | undefined
  getAppearance: () => 'light' | 'dark'
  getUiZoomLevel: () => number
  getNativeMicaEnabled: () => boolean
  getLegacyWindowImplementation: () => boolean
  getMergeRendererPipelineEnabled: () => boolean
  surfaceBackgroundColor: (appearance: 'light' | 'dark') => string
  applyWindowsBackdrop: (win: BrowserWindow) => void
  wireWindowDebug: (win: BrowserWindow, name: string) => void
  wireWindowStatus: (win: BrowserWindow, windowId: string) => void
  adjustWindowForDPI: (win: BrowserWindow, baseWidth: number, baseHeight: number) => void
  sendToBackend: (message: unknown) => void
  ensureTaskWatcherStarted: (intervalMs?: number) => void
}
 
export class AppWindowsManager {
  private readonly deps: AppWindowsManagerDeps
  private readonly windows = new Map<AppManagedWindowKind, BrowserWindow>()
 
  constructor(deps: AppWindowsManagerDeps) {
    this.deps = deps
  }
 
  registerIpcHandlers(args: {
    ipcMain: IpcMain
    requestBackendRpc: <T>(method: string, params?: unknown) => Promise<T>
    coerceString: (v: unknown) => string
  }): void {
    const { ipcMain, requestBackendRpc, coerceString } = args
 
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
        latest: Number(res?.latest ?? since),
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
 
    ipcMain.handle(
      'lanstart:putUiStateKey',
      async (_event, input: { windowId?: unknown; key?: unknown; value?: unknown }) => {
        const windowId = coerceString(input?.windowId)
        const key = coerceString(input?.key)
        if (!windowId || !key) throw new Error('BAD_UI_STATE_KEY')
        await requestBackendRpc('putUiStateKey', { windowId, key, value: input?.value })
        return null
      }
    )
 
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
      const res = (await requestBackendRpc('apiRequest', { method, path, body: input?.body })) as {
        status?: unknown
        body?: unknown
      }
      return { status: Number(res?.status ?? 200), body: (res as any)?.body }
    })

    ipcMain.handle('lanstart:clipboardWriteText', async (_event, input: { text?: unknown }) => {
      const text = coerceString(input?.text)
      clipboard.writeText(text ?? '')
      return null
    })

  }
 
  handleBackendControlMessage(message: unknown): boolean {
    if (!message || typeof message !== 'object') return false
    const type = String((message as any).type ?? '')
 
    if (type === 'CREATE_WINDOW') {
      const win = this.getOrCreate('child')
      this.showWindowWhenReady(win, { focus: false })
      this.deps.sendToBackend({ type: 'WINDOW_CREATED', window: 'child' })
      return true
    }
 
    if (type === 'OPEN_WATCHER_WINDOW') {
      const win = this.getOrCreate('watcher')
      this.showWindowWhenReady(win, { focus: true })
      return true
    }
 
    if (type === 'OPEN_SETTINGS_WINDOW') {
      const win = this.getOrCreate('settings')
      this.showWindowWhenReady(win, { focus: true })
      return true
    }

    if (type === 'MINIMIZE_SETTINGS_WINDOW') {
      const win = this.windows.get('settings')
      if (win && !win.isDestroyed()) {
        try {
          win.minimize()
        } catch {}
      }
      return true
    }

    if (type === 'CLOSE_SETTINGS_WINDOW') {
      const win = this.windows.get('settings')
      if (win && !win.isDestroyed()) {
        try {
          win.close()
        } catch {}
      }
      return true
    }
 
    if (type === 'CONTROL_APP_WINDOW') {
      const windowId = String((message as any).windowId ?? '')
      const action = String((message as any).action ?? '')
      const kind = kindFromWindowId(windowId)
      if (!kind) return true
      const win = this.windows.get(kind)
      if (!win || win.isDestroyed()) return true

      if (action === 'minimize') {
        try {
          win.minimize()
        } catch {}
        return true
      }

      if (action === 'close') {
        try {
          win.close()
        } catch {}
        return true
      }

      if (action === 'toggleMaximize') {
        try {
          if (win.isMaximized()) win.unmaximize()
          else win.maximize()
        } catch {}
        return true
      }

      return true
    }

    if (type === 'SET_APP_WINDOW_BOUNDS') {
      const windowId = String((message as any).windowId ?? '')
      const kind = kindFromWindowId(windowId)
      if (!kind) return true
      const width = Number((message as any).width)
      const height = Number((message as any).height)
      const x = (message as any).x
      const y = (message as any).y
      this.setWindowBounds(kind, {
        width: Number.isFinite(width) ? width : undefined,
        height: Number.isFinite(height) ? height : undefined,
        x: Number.isFinite(Number(x)) ? Number(x) : undefined,
        y: Number.isFinite(Number(y)) ? Number(y) : undefined,
      })
      return true
    }

    if (type === 'START_TASK_WATCHER') {
      const intervalMs = Number((message as any).intervalMs)
      this.deps.ensureTaskWatcherStarted(Number.isFinite(intervalMs) ? intervalMs : undefined)
      return true
    }
 
    if (type === 'STOP_TASK_WATCHER') {
      return true
    }
 
    return false
  }
 
  setWindowBounds(
    kind: AppManagedWindowKind,
    input: { x?: number; y?: number; width?: number; height?: number }
  ): void {
    const win = this.getOrCreate(kind)
    if (win.isDestroyed()) return
    const current = win.getBounds()
    const nextWidth = typeof input.width === 'number' ? Math.max(100, Math.round(input.width)) : current.width
    const nextHeight = typeof input.height === 'number' ? Math.max(80, Math.round(input.height)) : current.height
    const nextX = typeof input.x === 'number' ? Math.round(input.x) : current.x
    const nextY = typeof input.y === 'number' ? Math.round(input.y) : current.y

    const display = screen.getDisplayMatching({ x: nextX, y: nextY, width: nextWidth, height: nextHeight })
    const workArea = display.workArea
    const width = Math.max(100, Math.min(nextWidth, workArea.width))
    const height = Math.max(80, Math.min(nextHeight, workArea.height))
    const maxX = workArea.x + workArea.width - width
    const maxY = workArea.y + workArea.height - height
    const x = Math.max(workArea.x, Math.min(maxX, nextX))
    const y = Math.max(workArea.y, Math.min(maxY, nextY))

    const next = { x, y, width, height }
    try {
      win.setBounds(next, false)
    } catch {}
  }

  getOrCreate(kind: AppManagedWindowKind): BrowserWindow {
    const existing = this.windows.get(kind)
    if (existing && !existing.isDestroyed()) return existing
 
    const win = this.createWindow(kind)
    this.windows.set(kind, win)
    win.on('closed', () => {
      const stored = this.windows.get(kind)
      if (stored === win) this.windows.delete(kind)
    })
    return win
  }

  hideAll(): void {
    for (const win of this.windows.values()) {
      if (win.isDestroyed()) continue
      if (!win.isVisible()) continue
      try {
        win.hide()
      } catch {}
    }
  }

  destroyAll(): void {
    for (const win of this.windows.values()) {
      if (win.isDestroyed()) continue
      try {
        win.close()
      } catch {}
    }
    this.windows.clear()
  }
 
  private showWindowWhenReady(win: BrowserWindow, opts: { focus: boolean }): void {
    const doShow = () => {
      if (win.isDestroyed()) return
      if (!win.isVisible()) win.show()
      if (opts.focus) win.focus()
    }
    if (win.webContents.isLoading()) win.once('ready-to-show', doShow)
    else doShow()
  }
 
  private createWindow(kind: AppManagedWindowKind): BrowserWindow {
    if (kind === 'child') return this.createChildWindow()
    if (kind === 'watcher') return this.createWatcherWindow()
    return this.createSettingsWindow()
  }
 
  private createAppWindow(opts: {
    kind: AppManagedWindowKind
    title: string
    windowId: string
    width: number
    height: number
    x?: number
    y?: number
    resizable: boolean
    frame: boolean
    transparent: boolean
    minimizable: boolean
    maximizable: boolean
    fullscreenable: boolean
    show: boolean
    adjustForDpi?: { baseWidth: number; baseHeight: number }
  }): BrowserWindow {
    const appearance = this.deps.getAppearance()
    const iconPath = resolveAppIconPath()

    const win = new BrowserWindow({
      ...(iconPath ? { icon: iconPath } : {}),
      width: opts.width,
      height: opts.height,
      x: opts.x,
      y: opts.y,
      title: opts.title,
      useContentSize: true,
      resizable: opts.resizable,
      minimizable: opts.minimizable,
      maximizable: opts.maximizable,
      fullscreenable: opts.fullscreenable,
      show: opts.show,
      frame: opts.frame,
      transparent: opts.transparent,
      backgroundColor: opts.transparent ? '#01000000' : this.deps.surfaceBackgroundColor(appearance),
      backgroundMaterial: opts.frame && this.deps.getNativeMicaEnabled() ? 'mica' : 'none',
      roundedCorners: !opts.transparent,
      hasShadow: !opts.transparent,
      webPreferences: ({
        preload: this.deps.preloadPath,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        ...(this.deps.getMergeRendererPipelineEnabled() ? { affinity: SHARED_RENDERER_AFFINITY } : {})
      } as any)
    })

    this.deps.applyWindowsBackdrop(win)
    this.deps.wireWindowDebug(win, opts.windowId)
    this.deps.wireWindowStatus(win, opts.windowId)
    try {
      win.webContents.setZoomLevel(this.deps.getUiZoomLevel())
    } catch {}

    const devUrl = this.deps.getDevServerUrl()
    if (devUrl) win.loadURL(`${devUrl}?window=${encodeURIComponent(opts.windowId)}`)
    else win.loadFile(this.deps.rendererHtmlPath, { query: { window: opts.windowId } })

    if (opts.adjustForDpi) {
      win.webContents.on('did-finish-load', () => {
        this.deps.adjustWindowForDPI(win, opts.adjustForDpi!.baseWidth, opts.adjustForDpi!.baseHeight)
      })
    }

    return win
  }

  private createChildWindow(): BrowserWindow {
    const legacy = this.deps.getLegacyWindowImplementation()
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const workArea = display.workArea
    const width = Math.max(320, Math.min(420, workArea.width))
    const height = Math.max(220, Math.min(260, workArea.height))
    const x = workArea.x + Math.round((workArea.width - width) / 2)
    const y = workArea.y + Math.round((workArea.height - height) / 2)
    return this.createAppWindow({
      kind: 'child',
      title: '数据库',
      windowId: WINDOW_ID_BY_KIND.child,
      width,
      height,
      x,
      y,
      resizable: legacy,
      minimizable: true,
      maximizable: false,
      fullscreenable: false,
      show: false,
      frame: legacy,
      transparent: !legacy,
      adjustForDpi: { baseWidth: width, baseHeight: height }
    })
  }
 
  private createWatcherWindow(): BrowserWindow {
    const legacy = this.deps.getLegacyWindowImplementation()
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const workArea = display.workArea
    const preferredWidth = Math.round(workArea.width * 0.86)
    const preferredHeight = Math.round(workArea.height * 0.82)
    const width = Math.max(720, Math.min(980, Math.min(preferredWidth, workArea.width)))
    const height = Math.max(520, Math.min(720, Math.min(preferredHeight, workArea.height)))
    const x = workArea.x + Math.round((workArea.width - width) / 2)
    const y = workArea.y + Math.round((workArea.height - height) / 2)
    return this.createAppWindow({
      kind: 'watcher',
      title: '系统监视器',
      windowId: WINDOW_ID_BY_KIND.watcher,
      width,
      height,
      x,
      y,
      resizable: legacy,
      minimizable: true,
      maximizable: true,
      fullscreenable: false,
      show: false,
      frame: legacy,
      transparent: !legacy,
      adjustForDpi: { baseWidth: width, baseHeight: height }
    })
  }
 
  private createSettingsWindow(): BrowserWindow {
    const existing = this.windows.get('settings')
    if (existing && !existing.isDestroyed()) return existing
 
    const legacy = this.deps.getLegacyWindowImplementation()
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const workArea = display.workArea
    const preferredWidth = Math.round(workArea.width * 0.86)
    const preferredHeight = Math.round(workArea.height * 0.82)
    const winWidth = Math.max(560, Math.min(980, Math.min(preferredWidth, workArea.width)))
    const winHeight = Math.max(420, Math.min(760, Math.min(preferredHeight, workArea.height)))
    return this.createAppWindow({
      kind: 'settings',
      title: '设置',
      windowId: WINDOW_ID_BY_KIND.settings,
      width: winWidth,
      height: winHeight,
      x: workArea.x + Math.round((workArea.width - winWidth) / 2),
      y: workArea.y + Math.round((workArea.height - winHeight) / 2),
      resizable: legacy,
      minimizable: true,
      maximizable: true,
      fullscreenable: false,
      show: false,
      frame: false,
      transparent: true,
      adjustForDpi: { baseWidth: winWidth, baseHeight: winHeight }
    })
  }
}

export function startWindowTopmostPolling(opts: {
  intervalMs?: number
  getTargets: () => BrowserWindow[]
  tick: (targets: BrowserWindow[]) => void | Promise<void>
}): { stop: () => void } {
  const intervalMs = Number.isFinite(opts.intervalMs) ? Math.max(500, Number(opts.intervalMs)) : 5000
  let stopped = false
  let running = false

  const timer = setInterval(() => {
    if (stopped) return
    if (running) return
    running = true
    Promise.resolve()
      .then(() => opts.getTargets())
      .then((targets) => opts.tick(targets))
      .catch(() => undefined)
      .finally(() => {
        running = false
      })
  }, intervalMs)

  return {
    stop() {
      stopped = true
      clearInterval(timer)
    }
  }
}
