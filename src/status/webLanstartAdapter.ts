function getApiBaseUrl(): string {
  const raw = String((import.meta as any)?.env?.VITE_LANSTART_API_BASE ?? 'http://127.0.0.1:3131')
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
}

async function parseApiResponse(res: Response): Promise<unknown> {
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    try {
      return await res.json()
    } catch {
      return null
    }
  }
  return await res.text()
}

function pickImageAsDataUrl(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        reject(new Error('no_file_selected'))
        return
      }
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('file_read_failed'))
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : ''
        if (!dataUrl) {
          reject(new Error('file_read_failed'))
          return
        }
        resolve(dataUrl)
      }
      reader.readAsDataURL(file)
    }
    input.click()
  })
}

export function ensureWebLanstartAdapter(): void {
  if (typeof window === 'undefined') return
  if (window.lanstart) return

  const w = window as any
  if (w.__lanstartWebAdapter) {
    window.lanstart = w.__lanstartWebAdapter
    return
  }

  const apiBase = getApiBaseUrl()
  let zoomLevel = 0

  const api: NonNullable<Window['lanstart']> = {
    postCommand: async (command: string, payload?: unknown) => {
      const res = await fetch(`${apiBase}/rpc/post-command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command, payload })
      })
      const body = (await parseApiResponse(res)) as any
      if (!res.ok || body?.ok !== true) throw new Error(String(body?.error ?? 'post_command_failed'))
      return null
    },
    getEvents: async (since: number) => {
      const s = Number.isFinite(Number(since)) ? Math.max(0, Math.floor(Number(since))) : 0
      const res = await fetch(`${apiBase}/events?since=${encodeURIComponent(String(s))}`, { method: 'GET' })
      const body = (await parseApiResponse(res)) as any
      if (!res.ok || body?.ok !== true) return { items: [], latest: s }
      const items = Array.isArray(body?.items) ? body.items : []
      const latest = Number.isFinite(Number(body?.latest)) ? Number(body.latest) : s
      return { items, latest }
    },
    getKv: async (key: string) => {
      const res = await fetch(`${apiBase}/kv/${encodeURIComponent(key)}`, { method: 'GET' })
      const body = (await parseApiResponse(res)) as any
      if (!res.ok || body?.ok !== true) throw new Error(String(body?.error ?? 'kv_not_found'))
      return body?.value
    },
    putKv: async (key: string, value: unknown) => {
      const res = await fetch(`${apiBase}/kv/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value })
      })
      const body = (await parseApiResponse(res)) as any
      if (!res.ok || body?.ok !== true) throw new Error(String(body?.error ?? 'kv_put_failed'))
      return null
    },
    getUiState: async (windowId: string) => {
      const res = await fetch(`${apiBase}/ui/${encodeURIComponent(windowId)}`, { method: 'GET' })
      const body = (await parseApiResponse(res)) as any
      if (!res.ok || body?.ok !== true) throw new Error(String(body?.error ?? 'ui_state_get_failed'))
      const state = body?.state
      return state && typeof state === 'object' ? (state as Record<string, unknown>) : {}
    },
    putUiStateKey: async (windowId: string, key: string, value: unknown) => {
      const res = await fetch(`${apiBase}/ui/${encodeURIComponent(windowId)}/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value })
      })
      const body = (await parseApiResponse(res)) as any
      if (!res.ok || body?.ok !== true) throw new Error(String(body?.error ?? 'ui_state_put_failed'))
      return null
    },
    deleteUiStateKey: async (windowId: string, key: string) => {
      const res = await fetch(`${apiBase}/ui/${encodeURIComponent(windowId)}/${encodeURIComponent(key)}`, { method: 'DELETE' })
      const body = (await parseApiResponse(res)) as any
      if (!res.ok || body?.ok !== true) throw new Error(String(body?.error ?? 'ui_state_delete_failed'))
      return null
    },
    apiRequest: async (input: { method: string; path: string; body?: unknown }) => {
      const method = String(input?.method ?? 'GET').toUpperCase()
      const path = String(input?.path ?? '')
      const body = input?.body

      if (method === 'POST' && path === '/dialog/select-image-file') {
        try {
          const dataUrl = await pickImageAsDataUrl()
          return { status: 200, body: { ok: true, fileUrl: dataUrl } }
        } catch (e) {
          return { status: 400, body: { ok: false, error: String(e) } }
        }
      }

      if (method === 'POST' && path === '/img/file-to-data-url') {
        const fileUrl = typeof (body as any)?.fileUrl === 'string' ? String((body as any).fileUrl) : ''
        if (fileUrl.startsWith('data:')) return { status: 200, body: { ok: true, dataUrl: fileUrl } }
      }

      const headers: Record<string, string> = {}
      let payload: BodyInit | undefined
      if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
        headers['content-type'] = 'application/json'
        payload = JSON.stringify(body)
      }
      const res = await fetch(`${apiBase}${path}`, { method, headers, body: payload })
      return { status: res.status, body: await parseApiResponse(res) }
    },
    clipboardWriteText: async (text: string) => {
      await navigator.clipboard?.writeText?.(text)
      return null
    },
    getToolbarNoticeKind: async () => '',
    setToolbarNoticeVisible: async (_input: { visible: boolean; kind?: string }) => null,
    setToolbarNoticeBounds: async (_input: { width: number; height: number }) => null,
    restartBackendAll: async () => null,
    setZoomLevel: (level: number) => {
      zoomLevel = Number.isFinite(level) ? level : 0
    },
    getZoomLevel: () => zoomLevel
  }

  w.__lanstartWebAdapter = api
  window.lanstart = api
}
