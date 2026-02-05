import type { App } from 'electron'
import { resolve } from 'node:path'

type Dispatch = (input: { command: string; payload?: unknown; sourceUrl: string }) => Promise<void>

function stripSurroundingQuotes(s: string): string {
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) return s.slice(1, -1)
  return s
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function extractLanstartwriteUrlFromArgv(argv: string[]): string | undefined {
  for (const raw of argv) {
    const v = stripSurroundingQuotes(String(raw ?? ''))
    if (v.startsWith('lanstartwrite://')) return v
  }
  return undefined
}

export function parseLanstartwriteUrl(rawUrl: string): { command: string; payload?: unknown } | undefined {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return undefined
  }

  if (u.protocol !== 'lanstartwrite:') return undefined

  const commandParam = u.searchParams.get('command') ?? ''
  const host = u.host ?? ''
  const path = (u.pathname ?? '').replace(/^\/+/, '')

  let command = commandParam
  if (!command) {
    if (host && !path) command = host
    else if (host && path) command = `${host}.${path}`
    else if (path) command = path
  }

  command = command.replaceAll('/', '.').replaceAll('\\', '.').replaceAll('..', '.').replace(/^\.+/, '').replace(/\.+$/, '')
  if (!command) return undefined

  const payloadRaw = u.searchParams.get('payload')
  if (payloadRaw != null) {
    const decoded = decodeURIComponent(payloadRaw)
    const parsed = safeParseJson(decoded)
    if (parsed !== undefined) return { command, payload: parsed }
    return { command, payload: decoded }
  }

  const payload: Record<string, unknown> = {}
  for (const [k, v] of u.searchParams.entries()) {
    if (k === 'command') continue
    payload[k] = v
  }
  if (Object.keys(payload).length > 0) return { command, payload }

  return { command }
}

function registerAsDefaultProtocolClient(app: App, scheme: string): void {
  try {
    if (process.platform === 'win32') {
      if (process.defaultApp) {
        const appPath = process.argv[1] ? resolve(process.argv[1]) : process.execPath
        app.setAsDefaultProtocolClient(scheme, process.execPath, [appPath])
      } else {
        app.setAsDefaultProtocolClient(scheme)
      }
      return
    }
    app.setAsDefaultProtocolClient(scheme)
  } catch {
    return
  }
}

export function createLanstartwriteLinkController(opts: {
  scheme?: string
  dispatch: Dispatch
  focusApp?: () => void
}) {
  const scheme = opts.scheme ?? 'lanstartwrite'
  const pending: string[] = []

  const tryDispatch = async (rawUrl: string): Promise<boolean> => {
    const parsed = parseLanstartwriteUrl(rawUrl)
    if (!parsed) return true
    try {
      opts.focusApp?.()
    } catch {}
    try {
      await opts.dispatch({ command: parsed.command, payload: parsed.payload, sourceUrl: rawUrl })
      return true
    } catch {
      return false
    }
  }

  const enqueue = (rawUrl: string): void => {
    if (!rawUrl) return
    if (pending.length > 50) pending.shift()
    pending.push(rawUrl)
  }

  const handleRawUrl = (rawUrl: string): void => {
    const normalized = stripSurroundingQuotes(String(rawUrl ?? ''))
    if (!normalized.startsWith(`${scheme}://`)) return
    void tryDispatch(normalized).then((ok) => {
      if (!ok) enqueue(normalized)
    })
  }

  const register = (app: App): boolean => {
    registerAsDefaultProtocolClient(app, scheme)

    const gotLock = app.requestSingleInstanceLock()
    if (!gotLock) {
      try {
        app.quit()
      } catch {}
      return false
    }

    app.on('open-url', (e, url) => {
      try {
        e.preventDefault()
      } catch {}
      handleRawUrl(url)
    })

    app.on('second-instance', (_e, argv) => {
      const url = extractLanstartwriteUrlFromArgv(argv)
      if (url) handleRawUrl(url)
      else opts.focusApp?.()
    })

    app.once('ready', () => {
      const initialUrl = extractLanstartwriteUrlFromArgv(process.argv)
      if (initialUrl) handleRawUrl(initialUrl)
    })

    return true
  }

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return
    const batch = pending.splice(0, pending.length)
    for (const item of batch) {
      const ok = await tryDispatch(item)
      if (!ok) enqueue(item)
    }
  }

  return { register, flush }
}
