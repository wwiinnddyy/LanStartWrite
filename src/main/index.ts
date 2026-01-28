import { BrowserWindow, app, screen } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { platform } from 'node:process'
import { getSystemColors } from '../color__feture/mainSystemColors'

let backendProcess: ChildProcessWithoutNullStreams | undefined

const BACKEND_PORT = 3131
const BACKEND_STDIO_PREFIX = '__LANSTART__'
const WINDOW_ID_FLOATING_TOOLBAR = '浮动工具栏'
const WINDOW_TITLE_FLOATING_TOOLBAR = '浮动工具栏'
const WINDOW_ID_TOOLBAR_SUBWINDOW = 'toolbar-subwindow'

let floatingToolbarWindow: BrowserWindow | undefined
const toolbarSubwindows = new Map<
  string,
  { win: BrowserWindow; placement: 'top' | 'bottom'; width: number; height: number }
>()
let scheduledRepositionTimer: NodeJS.Timeout | undefined

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
    backgroundColor: '#191C24',
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
  win.on('move', scheduleRepositionToolbarSubwindows)
  win.on('resize', scheduleRepositionToolbarSubwindows)
  win.on('show', scheduleRepositionToolbarSubwindows)
  win.on('hide', () => {
    for (const item of toolbarSubwindows.values()) {
      if (item.win.isDestroyed()) continue
      item.win.hide()
    }
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

function createChildWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 260,
    resizable: true,
    title: 'LanStart Window',
    backgroundColor: '#00000000',
    backgroundMaterial: 'mica',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  applyWindowsBackdrop(win)
  wireWindowDebug(win, 'child-window')
  const devUrl = getDevServerUrl()
  if (devUrl) {
    win.loadURL(`${devUrl}?window=child`)
    if (process.env.LANSTART_OPEN_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: 'child' } })
  }

  return win
}

function scheduleRepositionToolbarSubwindows() {
  if (scheduledRepositionTimer) return
  scheduledRepositionTimer = setTimeout(() => {
    scheduledRepositionTimer = undefined
    repositionToolbarSubwindows()
  }, 0)
}

function repositionToolbarSubwindows() {
  const owner = floatingToolbarWindow
  if (!owner || owner.isDestroyed()) return
  const ownerBounds = owner.getBounds()
  const display = screen.getDisplayMatching(ownerBounds)
  const workArea = display.workArea

  for (const item of toolbarSubwindows.values()) {
    const win = item.win
    if (win.isDestroyed() || !win.isVisible()) continue
    const widthLimit = Math.max(360, workArea.width - 20)
    const width = Math.max(360, Math.min(widthLimit, Math.round(item.width)))
    const heightLimit = Math.max(60, workArea.height - 20)
    const height = Math.max(60, Math.min(heightLimit, Math.round(item.height)))

    let x = ownerBounds.x
    let y =
      item.placement === 'bottom' ? ownerBounds.y + ownerBounds.height : ownerBounds.y - height

    const xMax = workArea.x + workArea.width - width
    x = Math.max(workArea.x, Math.min(xMax, x))

    const yMax = workArea.y + workArea.height - height
    if (y < workArea.y || y > yMax) {
      const altY =
        item.placement === 'bottom' ? ownerBounds.y - height : ownerBounds.y + ownerBounds.height
      y = Math.max(workArea.y, Math.min(yMax, altY))
    }

    win.setBounds({ x: Math.round(x), y: Math.round(y), width, height }, false)
  }
}

function getOrCreateToolbarSubwindow(kind: string, placement: 'top' | 'bottom'): BrowserWindow {
  const existing = toolbarSubwindows.get(kind)
  if (existing && !existing.win.isDestroyed()) {
    existing.placement = placement
    return existing.win
  }

  const owner = floatingToolbarWindow
  if (!owner || owner.isDestroyed()) throw new Error('toolbar_owner_missing')

  const ownerBounds = owner.getBounds()

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
    backgroundColor: '#00000000',
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
    toolbarSubwindows.delete(kind)
  })

  toolbarSubwindows.set(kind, { win, placement, width: Math.max(360, ownerBounds.width), height: 220 })
  scheduleRepositionToolbarSubwindows()
  return win
}

function closeOtherToolbarSubwindows(exceptKind: string) {
  for (const [kind, item] of toolbarSubwindows.entries()) {
    if (kind === exceptKind) continue
    const win = item.win
    if (win.isDestroyed()) continue
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

  closeOtherToolbarSubwindows(kind)
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

function sendToBackend(message: unknown): void {
  if (!backendProcess?.stdin.writable) return
  backendProcess.stdin.write(`${JSON.stringify(message)}\n`)
}

function handleBackendControlMessage(message: any): void {
  if (!message || typeof message !== 'object') return

  if (message.type === 'CREATE_WINDOW') {
    const win = createChildWindow()
    win.once('ready-to-show', () => win.show())
    sendToBackend({ type: 'WINDOW_CREATED', window: 'child' })
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
    floatingToolbarWindow?.setAlwaysOnTop(value, 'floating')
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

  if (message.type === 'GET_SYSTEM_COLORS') {
    const requestId = String((message as any).requestId ?? '')
    const modeRaw = String((message as any).mode ?? '')
    const mode = modeRaw === 'light' || modeRaw === 'dark' ? modeRaw : modeRaw === 'auto' ? 'auto' : undefined
    if (!requestId) return
    void getSystemColors({ mode, maxAgeMs: 5_000 })
      .then((colors) => {
        sendToBackend({ type: 'SYSTEM_COLORS', requestId, colors })
      })
      .catch(() => {
        sendToBackend({
          type: 'SYSTEM_COLORS',
          requestId,
          colors: {
            ok: false,
            mode: 'dark',
            monet: { seed: { r: 82, g: 92, b: 120, a: 255 }, tones: {} },
            mica: {
              background: { r: 20, g: 22, b: 28, a: 220 },
              surface: { r: 24, g: 26, b: 32, a: 220 },
              border: { r: 255, g: 255, b: 255, a: 28 }
            }
          }
        })
      })
    return
  }

  if (message.type === 'QUIT_APP') {
    app.quit()
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
  const env = {
    ...process.env,
    LANSTART_BACKEND_PORT: String(BACKEND_PORT),
    LANSTART_DB_PATH: dbPath
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

  backendProcess.on('exit', () => {
    backendProcess = undefined
  })

  wireBackendStdout(backendProcess.stdout)

  backendProcess.stderr.on('data', (chunk) => {
    process.stderr.write(chunk)
  })
}

app
  .whenReady()
  .then(() => {
    try {
      startBackend()
    } catch (e) {
      process.stderr.write(String(e))
    }
    const win = createFloatingToolbarWindow()
    floatingToolbarWindow = win
    win.once('ready-to-show', () => win.show())

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        floatingToolbarWindow = createFloatingToolbarWindow()
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
  if (backendProcess && !backendProcess.killed) backendProcess.kill()
})
