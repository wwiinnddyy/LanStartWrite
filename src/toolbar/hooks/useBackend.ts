export type BackendEventItem = {
  id: number
  type: string
  payload?: unknown
  ts: number
}

let suppressCommandErrors = false

function requireLanstart() {
  const api = window.lanstart
  if (!api) throw new Error('lanstart_unavailable')
  return api
}

export function markQuitting(): void {
  suppressCommandErrors = true
}

export async function postCommand(command: string, payload?: unknown): Promise<void> {
  console.log('[useBackend] postCommand:', command, payload)
  try {
    await requireLanstart().postCommand(command, payload)
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
