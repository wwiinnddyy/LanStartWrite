export type BackendEventItem = {
  id: number
  type: string
  payload?: unknown
  ts: number
}

let suppressCommandErrors = false

function getFallbackLanstart() {
  const w = window as any
  if (w.__lanstartFallback) return w.__lanstartFallback as NonNullable<Window['lanstart']>

  const kv = new Map<string, unknown>()
  const uiState = new Map<string, Record<string, unknown>>()

  const api: NonNullable<Window['lanstart']> = {
    postCommand: async () => null,
    getEvents: async (since: number) => ({ items: [], latest: since }),
    getKv: async (key: string) => {
      if (kv.has(key)) return kv.get(key)
      throw new Error('kv_not_found')
    },
    putKv: async (key: string, value: unknown) => {
      kv.set(key, value)
      return null
    },
    getUiState: async (windowId: string) => uiState.get(windowId) ?? {},
    putUiStateKey: async (windowId: string, key: string, value: unknown) => {
      const prev = uiState.get(windowId) ?? {}
      uiState.set(windowId, { ...prev, [key]: value })
      return null
    },
    deleteUiStateKey: async (windowId: string, key: string) => {
      const prev = uiState.get(windowId) ?? {}
      if (!(key in prev)) return null
      const next = { ...prev } as any
      delete next[key]
      uiState.set(windowId, next)
      return null
    },
    apiRequest: async () => ({ status: 503, body: { ok: false, error: 'lanstart_unavailable' } }),
    clipboardWriteText: async () => null,
    setZoomLevel: () => undefined,
    getZoomLevel: () => 0
  }

  w.__lanstartFallback = api
  return api
}

function requireLanstart() {
  const api = window.lanstart
  return api ?? getFallbackLanstart()
}

export function markQuitting(): void {
  suppressCommandErrors = true
}

export async function postCommand(command: string, payload?: unknown): Promise<void> {
  const realApi = window.lanstart
  if (!realApi) return
  console.log('[useBackend] postCommand:', command, payload)
  try {
    await realApi.postCommand(command, payload)
    console.log('[useBackend] postCommand success:', command)
  } catch (e) {
    console.error('[useBackend] postCommand failed:', command, e)
    if (command === 'quit' || suppressCommandErrors) return
    throw e
  }
}

export async function getEvents(since: number): Promise<{ items: BackendEventItem[]; latest: number }> {
  return await requireLanstart().getEvents(since)
}

export async function getKv<T>(key: string): Promise<T> {
  return (await requireLanstart().getKv(key)) as T
}

export async function putKv<T>(key: string, value: T): Promise<void> {
  await requireLanstart().putKv(key, value)
}

export async function getUiState(windowId: string): Promise<Record<string, unknown>> {
  return await requireLanstart().getUiState(windowId)
}

export async function putUiStateKey(windowId: string, key: string, value: unknown): Promise<void> {
  await requireLanstart().putUiStateKey(windowId, key, value)
}

export async function deleteUiStateKey(windowId: string, key: string): Promise<void> {
  await requireLanstart().deleteUiStateKey(windowId, key)
}
