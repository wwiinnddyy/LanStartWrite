import { Elysia, t } from 'elysia'
import { node } from '@elysiajs/node'
import { createInterface } from 'node:readline'
import { deleteValue, getValue, openLeavelDb, putValue } from '../LeavelDB'

type EventItem = {
  id: number
  type: string
  payload?: unknown
  ts: number
}

type PendingSystemColors = {
  resolve: (value: unknown) => void
  reject: (err: unknown) => void
  timer: NodeJS.Timeout
}

const port = Number(process.env.LANSTART_BACKEND_PORT ?? 3131)
const dbPath = process.env.LANSTART_DB_PATH ?? './leveldb'

const db = openLeavelDb(dbPath)

let nextEventId = 1
const events: EventItem[] = []
const MAX_EVENTS = 200

function emitEvent(type: string, payload?: unknown): EventItem {
  const item: EventItem = { id: nextEventId++, type, payload, ts: Date.now() }
  events.push(item)
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  return item
}

function requestMain(message: unknown): void {
  process.stdout.write(`__LANSTART__${JSON.stringify(message)}\n`)
}

const pendingSystemColors = new Map<string, PendingSystemColors>()

function requestSystemColors(mode: 'auto' | 'light' | 'dark' = 'auto'): Promise<unknown> {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingSystemColors.delete(requestId)
      reject(new Error('SYSTEM_COLORS_TIMEOUT'))
    }, 2000)
    pendingSystemColors.set(requestId, { resolve, reject, timer })
    requestMain({ type: 'GET_SYSTEM_COLORS', requestId, mode })
  })
}

const stdin = createInterface({ input: process.stdin, crlfDelay: Infinity })
stdin.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    const msg = JSON.parse(trimmed)
    if (msg && typeof msg === 'object' && (msg as any).type === 'SYSTEM_COLORS') {
      const requestId = String((msg as any).requestId ?? '')
      if (requestId) {
        const pending = pendingSystemColors.get(requestId)
        if (pending) {
          clearTimeout(pending.timer)
          pendingSystemColors.delete(requestId)
          pending.resolve((msg as any).colors)
        }
      }
    }
    emitEvent('MAIN_MESSAGE', msg)
  } catch {
    return
  }
})

const api = new Elysia({ adapter: node() })
  .onRequest(({ request, set }) => {
    set.headers['Access-Control-Allow-Origin'] = '*'
    set.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS'
    set.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    if (request.method === 'OPTIONS') {
      set.status = 204
      return ''
    }
  })
  .get('/health', () => ({ ok: true, port }))
  .get(
    '/kv/:key',
    async ({ params, set }) => {
      try {
        const value = await getValue(db, params.key)
        emitEvent('KV_GET', { key: params.key })
        return { ok: true, key: params.key, value }
      } catch {
        set.status = 404
        return { ok: false, key: params.key, error: 'NOT_FOUND' }
      }
    },
    { params: t.Object({ key: t.String() }) }
  )
  .put(
    '/kv/:key',
    async ({ params, body }) => {
      await putValue(db, params.key, body)
      emitEvent('KV_PUT', { key: params.key })
      return { ok: true, key: params.key }
    },
    { params: t.Object({ key: t.String() }), body: t.Any() }
  )
  .delete(
    '/kv/:key',
    async ({ params }) => {
      await deleteValue(db, params.key)
      emitEvent('KV_DEL', { key: params.key })
      return { ok: true, key: params.key }
    },
    { params: t.Object({ key: t.String() }) }
  )
  .post(
    '/commands',
    async ({ body, set }) => {
      const { command, payload } = body

      emitEvent('COMMAND', { command, payload })

      if (command === 'create-window') {
        requestMain({ type: 'CREATE_WINDOW' })
        return { ok: true }
      }

      if (command === 'toggle-subwindow') {
        const kind = String((payload as any)?.kind ?? '')
        const placementRaw = String((payload as any)?.placement ?? '')
        const placement = placementRaw === 'top' ? 'top' : placementRaw === 'bottom' ? 'bottom' : undefined
        if (!kind || !placement) {
          set.status = 400
          return { ok: false, error: 'BAD_SUBWINDOW' }
        }
        requestMain({ type: 'TOGGLE_SUBWINDOW', kind, placement })
        return { ok: true }
      }

      if (command === 'set-subwindow-height') {
        const kind = String((payload as any)?.kind ?? '')
        const height = Number((payload as any)?.height)
        if (!kind || !Number.isFinite(height)) {
          set.status = 400
          return { ok: false, error: 'BAD_SUBWINDOW_HEIGHT' }
        }
        requestMain({ type: 'SET_SUBWINDOW_HEIGHT', kind, height })
        return { ok: true }
      }

      if (command === 'set-subwindow-bounds') {
        const kind = String((payload as any)?.kind ?? '')
        const width = Number((payload as any)?.width)
        const height = Number((payload as any)?.height)
        if (!kind || !Number.isFinite(width) || !Number.isFinite(height)) {
          set.status = 400
          return { ok: false, error: 'BAD_SUBWINDOW_BOUNDS' }
        }
        requestMain({ type: 'SET_SUBWINDOW_BOUNDS', kind, width, height })
        return { ok: true }
      }

      if (command === 'set-toolbar-always-on-top') {
        const value = Boolean((payload as any)?.value)
        requestMain({ type: 'SET_TOOLBAR_ALWAYS_ON_TOP', value })
        return { ok: true }
      }

      if (command === 'set-toolbar-bounds') {
        const width = Number((payload as any)?.width)
        const height = Number((payload as any)?.height)
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
          set.status = 400
          return { ok: false, error: 'BAD_BOUNDS' }
        }
        requestMain({ type: 'SET_TOOLBAR_BOUNDS', width, height })
        return { ok: true }
      }

      if (command === 'quit') {
        requestMain({ type: 'QUIT_APP' })
        return { ok: true }
      }

      set.status = 400
      return { ok: false, error: 'UNKNOWN_COMMAND' }
    },
    {
      body: t.Object({
        command: t.String(),
        payload: t.Optional(t.Any())
      })
    }
  )
  .get(
    '/events',
    ({ query }) => {
      const since = Number(query.since ?? 0)
      const items = events.filter((e) => e.id > since)
      return { ok: true, items, latest: events.at(-1)?.id ?? since }
    },
    { query: t.Object({ since: t.Optional(t.String()) }) }
  )
  .get(
    '/system/colors',
    async ({ query, set }) => {
      const modeRaw = String(query.mode ?? 'auto')
      const mode = modeRaw === 'light' || modeRaw === 'dark' || modeRaw === 'auto' ? modeRaw : 'auto'
      try {
        const colors = await requestSystemColors(mode)
        emitEvent('SYSTEM_COLORS', { mode })
        return { ok: true, colors }
      } catch {
        set.status = 504
        return { ok: false, error: 'TIMEOUT' }
      }
    },
    { query: t.Object({ mode: t.Optional(t.String()) }) }
  )

api.listen({ hostname: '127.0.0.1', port })

emitEvent('BACKEND_STARTED', { port, dbPath })
console.log(`[backend] listening on http://127.0.0.1:${port}`)
