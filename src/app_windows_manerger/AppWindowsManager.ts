import { BrowserWindow, screen, type IpcMain } from 'electron'
 
export type AppManagedWindowKind = 'child' | 'watcher' | 'settings'
 
export type AppWindowsManagerDeps = {
  preloadPath: string
  rendererHtmlPath: string
  getDevServerUrl: () => string | undefined
  getAppearance: () => 'light' | 'dark'
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
 
    if (type === 'SET_APP_WINDOW_BOUNDS') {
      const windowId = String((message as any).windowId ?? '')
      const kind =
        windowId === 'child' ? 'child' : windowId === 'watcher' ? 'watcher' : windowId === 'settings-window' ? 'settings' : undefined
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
    const next = {
      x: typeof input.x === 'number' ? Math.round(input.x) : current.x,
      y: typeof input.y === 'number' ? Math.round(input.y) : current.y,
      width: typeof input.width === 'number' ? Math.max(100, Math.round(input.width)) : current.width,
      height: typeof input.height === 'number' ? Math.max(80, Math.round(input.height)) : current.height,
    }
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
 
  private createChildWindow(): BrowserWindow {
    const appearance = this.deps.getAppearance()
    const win = new BrowserWindow({
      width: 420,
      height: 260,
      resizable: true,
      title: 'LanStart Window',
      backgroundColor: this.deps.surfaceBackgroundColor(appearance),
      backgroundMaterial: 'mica',
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
 
    this.deps.applyWindowsBackdrop(win)
    this.deps.wireWindowDebug(win, 'child-window')
    this.deps.wireWindowStatus(win, 'child')
 
    const devUrl = this.deps.getDevServerUrl()
    if (devUrl) win.loadURL(`${devUrl}?window=child`)
    else win.loadFile(this.deps.rendererHtmlPath, { query: { window: 'child' } })
 
    return win
  }
 
  private createWatcherWindow(): BrowserWindow {
    const appearance = this.deps.getAppearance()
    const win = new BrowserWindow({
      width: 980,
      height: 720,
      resizable: true,
      title: '系统监视器',
      backgroundColor: this.deps.surfaceBackgroundColor(appearance),
      backgroundMaterial: 'mica',
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
 
    this.deps.applyWindowsBackdrop(win)
    this.deps.wireWindowDebug(win, 'watcher-window')
    this.deps.wireWindowStatus(win, 'watcher')
 
    const devUrl = this.deps.getDevServerUrl()
    if (devUrl) win.loadURL(`${devUrl}?window=${encodeURIComponent('watcher')}`)
    else win.loadFile(this.deps.rendererHtmlPath, { query: { window: 'watcher' } })
 
    return win
  }
 
  private createSettingsWindow(): BrowserWindow {
    const existing = this.windows.get('settings')
    if (existing && !existing.isDestroyed()) return existing
 
    const appearance = this.deps.getAppearance()
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
    const winWidth = 800
    const winHeight = 500
 
    const win = new BrowserWindow({
      width: winWidth,
      height: winHeight,
      x: Math.round((screenWidth - winWidth) / 2),
      y: Math.round((screenHeight - winHeight) / 2),
      title: '设置',
      resizable: true,
      minimizable: true,
      maximizable: true,
      fullscreenable: false,
      show: false,
      frame: false,
      transparent: true,
      backgroundMaterial: 'mica',
      backgroundColor: this.deps.surfaceBackgroundColor(appearance),
      webPreferences: {
        preload: this.deps.preloadPath,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
 
    this.deps.applyWindowsBackdrop(win)
    this.deps.wireWindowDebug(win, 'settings-window')
    this.deps.wireWindowStatus(win, 'settings-window')
 
    const devUrl = this.deps.getDevServerUrl()
    if (devUrl) win.loadURL(`${devUrl}?window=${encodeURIComponent('settings-window')}`)
    else win.loadFile(this.deps.rendererHtmlPath, { query: { window: 'settings-window' } })
 
    win.webContents.on('did-finish-load', () => {
      this.deps.adjustWindowForDPI(win, 800, 500)
    })
 
    return win
  }
}
