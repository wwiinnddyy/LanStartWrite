type CaptureOptions = { maxSide?: number }

type BackendEventItem = {
  id: number
  type: string
  payload?: unknown
  ts: number
}

type BackendRpcWsMessage =
  | { type: 'RPC_RESPONSE'; id: number; ok: boolean; result?: unknown; error?: unknown }
  | { type: 'EVENT'; event: BackendEventItem }

const BACKEND_WS_URL = 'ws://127.0.0.1:3131/rpc'
const BACKEND_HTTP_RPC_URL = 'http://127.0.0.1:3131/rpc-http'
const FALLBACK_API_RESPONSE = { status: 503, body: { ok: false, error: 'backend_unavailable' } }
const FALLBACK_WALLPAPER_THUMBNAIL = {
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7YfVQAAAAASUVORK5CYII=',
  width: 1,
  height: 1,
  wallpaper: {
    path: '',
    size: { width: 1, height: 1 }
  }
}

let backendWs: WebSocket | undefined
let backendWsOpening: Promise<void> | undefined
let nextBackendWsId = 1
let wsFallbackUntil = 0

const backendWsPending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason: unknown) => void; timer: ReturnType<typeof setTimeout> }
>()

const backendEventBuffer: BackendEventItem[] = []
const BACKEND_EVENT_BUFFER_MAX = 200

let zoomLevel = 0

function logBridgeError(scope: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[lanstart-bridge] ${scope} failed: ${message}`)
}

function pushBackendEvent(item: BackendEventItem): void {
  backendEventBuffer.push(item)
  if (backendEventBuffer.length > BACKEND_EVENT_BUFFER_MAX) {
    backendEventBuffer.splice(0, backendEventBuffer.length - BACKEND_EVENT_BUFFER_MAX)
  }
}

function getBufferedEventsSince(since: number): { items: BackendEventItem[]; latest: number } {
  const s = Number.isFinite(since) ? Math.floor(since) : 0
  const items = backendEventBuffer.filter((e) => e.id > s)
  const latest = backendEventBuffer.length ? backendEventBuffer[backendEventBuffer.length - 1]!.id : s
  return { items, latest }
}

function handleBackendWsMessage(msg: BackendRpcWsMessage): void {
  if (!msg || typeof msg !== 'object') return

  if ((msg as any).type === 'RPC_RESPONSE') {
    const id = Number((msg as any).id)
    const p = backendWsPending.get(id)
    if (!p) return
    backendWsPending.delete(id)
    try {
      clearTimeout(p.timer)
    } catch {}
    if ((msg as any).ok) p.resolve((msg as any).result)
    else p.reject(new Error(String((msg as any).error ?? 'backend_rpc_failed')))
    return
  }

  if ((msg as any).type === 'EVENT' && (msg as any).event) {
    const event = (msg as any).event as BackendEventItem
    if (event && Number.isFinite(event.id)) pushBackendEvent(event)
  }
}

function parseBackendPayload(raw: unknown): void {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return
    try {
      handleBackendWsMessage(JSON.parse(trimmed) as BackendRpcWsMessage)
    } catch {}
    return
  }

  if (raw instanceof ArrayBuffer) {
    const text = new TextDecoder().decode(raw)
    parseBackendPayload(text)
    return
  }

  if (raw instanceof Blob) {
    raw
      .text()
      .then((text) => parseBackendPayload(text))
      .catch(() => undefined)
  }
}

function ensureBackendWsOpen(timeoutMs = 1200): Promise<void> {
  const ws = backendWs
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve()
  if (backendWsOpening) return backendWsOpening

  backendWsOpening = new Promise<void>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      backendWsOpening = undefined
      reject(new Error('backend_ws_timeout'))
    }, Math.max(1, Math.floor(timeoutMs)))

    try {
      const created = new WebSocket(BACKEND_WS_URL)
      backendWs = created

      created.addEventListener('open', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        backendWsOpening = undefined
        resolve()
      })

      created.addEventListener('close', () => {
        if (backendWs === created) backendWs = undefined
        const pending = Array.from(backendWsPending.entries())
        backendWsPending.clear()
        for (const [, p] of pending) {
          try {
            clearTimeout(p.timer)
          } catch {}
          try {
            p.reject(new Error('backend_ws_closed'))
          } catch {}
        }
      })

      created.addEventListener('message', (ev) => {
        parseBackendPayload(ev.data)
      })

      created.addEventListener('error', () => undefined)
    } catch (e) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      backendWsOpening = undefined
      reject(e)
    }
  })

  return backendWsOpening
}

async function backendWsRpcCall(method: string, params?: unknown, timeoutMs = 30_000): Promise<unknown> {
  await ensureBackendWsOpen()
  const ws = backendWs
  if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('backend_ws_not_ready')

  const id = nextBackendWsId++
  return await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      backendWsPending.delete(id)
      reject(new Error('backend_rpc_timeout'))
    }, Math.max(1, Math.floor(timeoutMs)))

    backendWsPending.set(id, { resolve, reject, timer })

    try {
      ws.send(JSON.stringify({ type: 'RPC_REQUEST', id, method, params }))
    } catch (e) {
      backendWsPending.delete(id)
      clearTimeout(timer)
      reject(e)
    }
  })
}

async function backendHttpRpcCall(method: string, params?: unknown, timeoutMs = 30_000): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.floor(timeoutMs)))
  try {
    const res = await fetch(BACKEND_HTTP_RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params }),
      signal: controller.signal
    })
    const json = (await res.json().catch(() => null)) as { ok?: unknown; result?: unknown; error?: unknown } | null
    if (!res.ok || !json?.ok) {
      throw new Error(String(json?.error ?? `http_rpc_failed:${res.status}`))
    }
    return json.result
  } finally {
    clearTimeout(timer)
  }
}

async function backendRpcCall(method: string, params?: unknown, timeoutMs = 30_000): Promise<unknown> {
  const now = Date.now()
  if (now >= wsFallbackUntil) {
    try {
      return await backendWsRpcCall(method, params, timeoutMs)
    } catch (error) {
      wsFallbackUntil = Date.now() + 8_000
      logBridgeError('rpc.ws', error)
    }
  }
  return await backendHttpRpcCall(method, params, timeoutMs)
}

function toZoomFactor(level: number): number {
  return Math.pow(1.2, level)
}

function applyZoomLevel(level: number): void {
  zoomLevel = Number.isFinite(level) ? level : 0
  const factor = toZoomFactor(zoomLevel)
  try {
    document.documentElement.style.setProperty('zoom', String(factor))
  } catch {}
}

function createLanstartBridge(): NonNullable<Window['lanstart']> {
  return {
    postCommand: async (command: string, payload?: unknown) => {
      try {
        await backendRpcCall('postCommand', { command, payload })
      } catch (error) {
        logBridgeError('postCommand', error)
      }
      return null
    },
    getEvents: async (since: number) => {
      const { items, latest } = getBufferedEventsSince(since)
      if (items.length || latest !== since) return { items, latest }
      try {
        return (await backendRpcCall('getEvents', { since })) as { items: BackendEventItem[]; latest: number }
      } catch (error) {
        logBridgeError('getEvents', error)
        return { items: [], latest: since }
      }
    },
    getKv: async (key: string) => {
      try {
        return await backendRpcCall('getKv', { key })
      } catch (error) {
        logBridgeError('getKv', error)
        return undefined
      }
    },
    putKv: async (key: string, value: unknown) => {
      try {
        await backendRpcCall('putKv', { key, value })
      } catch (error) {
        logBridgeError('putKv', error)
      }
      return null
    },
    getUiState: async (windowId: string) => {
      try {
        return (await backendRpcCall('getUiState', { windowId })) as Record<string, unknown>
      } catch (error) {
        logBridgeError('getUiState', error)
        return {}
      }
    },
    putUiStateKey: async (windowId: string, key: string, value: unknown) => {
      try {
        await backendRpcCall('putUiStateKey', { windowId, key, value })
      } catch (error) {
        logBridgeError('putUiStateKey', error)
      }
      return null
    },
    deleteUiStateKey: async (windowId: string, key: string) => {
      try {
        await backendRpcCall('deleteUiStateKey', { windowId, key })
      } catch (error) {
        logBridgeError('deleteUiStateKey', error)
      }
      return null
    },
    apiRequest: async (input: { method: string; path: string; body?: unknown }) => {
      try {
        return (await backendRpcCall('apiRequest', input)) as { status: number; body: unknown }
      } catch (error) {
        logBridgeError('apiRequest', error)
        return FALLBACK_API_RESPONSE
      }
    },
    clipboardWriteText: async (text: string) => {
      try {
        await backendRpcCall('clipboardWriteText', { text })
      } catch (error) {
        logBridgeError('clipboardWriteText', error)
      }
      return null
    },
    getToolbarNoticeKind: async () => {
      try {
        return String((await backendRpcCall('getToolbarNoticeKind', {})) ?? '')
      } catch (error) {
        logBridgeError('getToolbarNoticeKind', error)
        return ''
      }
    },
    setToolbarNoticeVisible: async (input: { visible: boolean; kind?: string }) => {
      try {
        await backendRpcCall('setToolbarNoticeVisible', input)
      } catch (error) {
        logBridgeError('setToolbarNoticeVisible', error)
      }
      return null
    },
    setToolbarNoticeBounds: async (input: { width: number; height: number }) => {
      try {
        await backendRpcCall('setToolbarNoticeBounds', input)
      } catch (error) {
        logBridgeError('setToolbarNoticeBounds', error)
      }
      return null
    },
    restartBackendAll: async () => {
      try {
        await backendRpcCall('restartBackendAll', {})
      } catch (error) {
        logBridgeError('restartBackendAll', error)
      }
      return null
    },
    setZoomLevel: (level: number) => applyZoomLevel(level),
    getZoomLevel: () => zoomLevel
  }
}

function createHyperGlassBridge(): NonNullable<Window['hyperGlass']> {
  return {
    captureWallpaperThumbnail: async (options: CaptureOptions = {}) => {
      const maxSide = typeof options.maxSide === 'number' ? Math.max(32, Math.floor(options.maxSide)) : 320
      try {
        return (await backendRpcCall('captureWallpaperThumbnail', { maxSide })) as {
          dataUrl: string
          width: number
          height: number
          wallpaper: { path: string; size: { width: number; height: number } }
        }
      } catch (error) {
        logBridgeError('captureWallpaperThumbnail', error)
        return FALLBACK_WALLPAPER_THUMBNAIL
      }
    },
    captureDisplayThumbnail: async (options: CaptureOptions = {}) => {
      const wallpaper = await (window.hyperGlass as any)?.captureWallpaperThumbnail?.(options)
      if (!wallpaper?.dataUrl) throw new Error('capture_display_thumbnail_unavailable')

      const bounds = {
        x: Math.round(window.screenX),
        y: Math.round(window.screenY),
        width: Math.max(1, Math.round(window.outerWidth || window.innerWidth)),
        height: Math.max(1, Math.round(window.outerHeight || window.innerHeight))
      }

      return {
        dataUrl: wallpaper.dataUrl,
        width: Number(wallpaper.width) || bounds.width,
        height: Number(wallpaper.height) || bounds.height,
        display: {
          id: 0,
          scaleFactor: window.devicePixelRatio || 1,
          bounds,
          size: { width: bounds.width, height: bounds.height }
        }
      }
    }
  }
}

function ensureElectrobunBridge(): void {
  if (typeof window === 'undefined') return
  if (!window.lanstart) window.lanstart = createLanstartBridge()
  if (!window.hyperGlass) window.hyperGlass = createHyperGlassBridge()
}

ensureElectrobunBridge()
