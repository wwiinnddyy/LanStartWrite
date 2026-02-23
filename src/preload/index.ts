import { contextBridge, desktopCapturer, ipcRenderer, screen, webFrame } from 'electron'
import type { BackendEventItem, BackendRpcWsMessage } from '../rpc/schema'

type CaptureOptions = { maxSide?: number }

function computeThumbnailSize(input: { width: number; height: number }, maxSide: number) {
  const maxInputSide = Math.max(input.width, input.height)
  if (maxInputSide <= maxSide) return { width: input.width, height: input.height }
  const scale = maxSide / maxInputSide
  return { width: Math.max(1, Math.round(input.width * scale)), height: Math.max(1, Math.round(input.height * scale)) }
}

contextBridge.exposeInMainWorld('hyperGlass', {
  captureDisplayThumbnail: async (options: CaptureOptions = {}) => {
    const bounds = {
      x: Math.round(globalThis.screenX),
      y: Math.round(globalThis.screenY),
      width: Math.round(globalThis.outerWidth),
      height: Math.round(globalThis.outerHeight)
    }
    const display = screen.getDisplayMatching(bounds)
    const maxSide = typeof options.maxSide === 'number' ? Math.max(32, Math.floor(options.maxSide)) : 320
    const thumbSize = computeThumbnailSize(display.size, maxSide)

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbSize.width, height: thumbSize.height },
      fetchWindowIcons: false
    })

    let source = sources[0]
    const displayId = String(display.id)
    for (const s of sources) {
      const sid = String((s as any).display_id ?? (s as any).displayId ?? '')
      if (sid && sid === displayId) {
        source = s
        break
      }
    }

    if (!source) throw new Error('no_screen_source')
    const img = source.thumbnail
    return {
      dataUrl: img.toDataURL(),
      width: img.getSize().width,
      height: img.getSize().height,
      display: {
        id: display.id,
        scaleFactor: display.scaleFactor,
        bounds: display.bounds,
        size: display.size
      }
    }
  },
  captureWallpaperThumbnail: async (options: CaptureOptions = {}) => {
    const maxSide = typeof options.maxSide === 'number' ? Math.max(32, Math.floor(options.maxSide)) : 320
    return await ipcRenderer.invoke('hyperGlass:captureWallpaperThumbnail', { maxSide })
  }
})

contextBridge.exposeInMainWorld('lanstart', {
  postCommand: async (command: string, payload?: unknown) => {
    try {
      await backendRpcCall('postCommand', { command, payload })
      return null
    } catch {
      return await ipcRenderer.invoke('lanstart:postCommand', { command, payload })
    }
  },
  getEvents: async (since: number) => {
    const { items, latest } = getBufferedEventsSince(since)
    if (items.length || latest !== since) return { items, latest }
    try {
      return (await backendRpcCall('getEvents', { since })) as { items: BackendEventItem[]; latest: number }
    } catch {
      return await ipcRenderer.invoke('lanstart:getEvents', { since })
    }
  },
  getKv: async (key: string) => {
    try {
      return await backendRpcCall('getKv', { key })
    } catch {
      return await ipcRenderer.invoke('lanstart:getKv', { key })
    }
  },
  putKv: async (key: string, value: unknown) => {
    try {
      await backendRpcCall('putKv', { key, value })
      return null
    } catch {
      return await ipcRenderer.invoke('lanstart:putKv', { key, value })
    }
  },
  getUiState: async (windowId: string) => {
    try {
      return (await backendRpcCall('getUiState', { windowId })) as Record<string, unknown>
    } catch {
      return await ipcRenderer.invoke('lanstart:getUiState', { windowId })
    }
  },
  putUiStateKey: async (windowId: string, key: string, value: unknown) => {
    try {
      await backendRpcCall('putUiStateKey', { windowId, key, value })
      return null
    } catch {
      return await ipcRenderer.invoke('lanstart:putUiStateKey', { windowId, key, value })
    }
  },
  deleteUiStateKey: async (windowId: string, key: string) => {
    try {
      await backendRpcCall('deleteUiStateKey', { windowId, key })
      return null
    } catch {
      return await ipcRenderer.invoke('lanstart:deleteUiStateKey', { windowId, key })
    }
  },
  apiRequest: async (input: { method: string; path: string; body?: unknown }) => {
    try {
      return (await backendRpcCall('apiRequest', input)) as { status: number; body: unknown }
    } catch {
      return await ipcRenderer.invoke('lanstart:apiRequest', input)
    }
  },
  clipboardWriteText: (text: string) => ipcRenderer.invoke('lanstart:clipboardWriteText', { text }),
  getToolbarNoticeKind: () => ipcRenderer.invoke('lanstart:getToolbarNoticeKind'),
  setToolbarNoticeVisible: (input: { visible: boolean; kind?: string }) => ipcRenderer.invoke('lanstart:setToolbarNoticeVisible', input),
  setToolbarNoticeBounds: (input: { width: number; height: number }) => ipcRenderer.invoke('lanstart:setToolbarNoticeBounds', input),
  restartBackendAll: () => ipcRenderer.invoke('lanstart:restartBackendAll'),
  setZoomLevel: (level: number) => webFrame.setZoomLevel(level),
  getZoomLevel: () => webFrame.getZoomLevel()
})

const BACKEND_WS_URL = 'ws://127.0.0.1:3131/rpc'
let backendWs: WebSocket | undefined
let backendWsOpening: Promise<void> | undefined
let nextBackendWsId = 1
const backendWsPending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason: unknown) => void; timer: ReturnType<typeof setTimeout> }
>()

const backendEventBuffer: BackendEventItem[] = []
const BACKEND_EVENT_BUFFER_MAX = 200

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

function ensureBackendWsOpen(timeoutMs = 1200): Promise<void> {
  const ws = backendWs
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve()
  if (backendWsOpening) return backendWsOpening

  backendWsOpening = new Promise<void>((resolve, reject) => {
    let resolved = false
    const timer = setTimeout(() => {
      if (resolved) return
      resolved = true
      backendWsOpening = undefined
      reject(new Error('backend_ws_timeout'))
    }, Math.max(1, Math.floor(timeoutMs)))

    try {
      const created = new WebSocket(BACKEND_WS_URL)
      backendWs = created

      created.addEventListener('open', () => {
        if (resolved) return
        resolved = true
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
        const raw = typeof ev.data === 'string' ? ev.data : ev.data instanceof ArrayBuffer ? Buffer.from(ev.data).toString('utf8') : String(ev.data ?? '')
        const trimmed = raw.trim()
        if (!trimmed) return
        let msg: BackendRpcWsMessage | undefined
        try {
          msg = JSON.parse(trimmed) as BackendRpcWsMessage
        } catch {
          return
        }
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
          const evItem = (msg as any).event as BackendEventItem
          if (evItem && Number.isFinite(evItem.id)) pushBackendEvent(evItem)
        }
      })

      created.addEventListener('error', () => undefined)
    } catch (e) {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      backendWsOpening = undefined
      reject(e)
    }
  })

  return backendWsOpening
}

async function backendRpcCall(method: string, params?: unknown, timeoutMs = 30_000): Promise<unknown> {
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
