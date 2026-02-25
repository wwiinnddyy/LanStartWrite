import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type {
  CapabilityMethodName,
  CapabilityRequest,
  CapabilityRequestMap,
  CapabilityResponse
} from './protocol'

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT_MS = 4_000
const HEALTH_TIMEOUT_MS = 5_000

function pushUniquePath(out: string[], input: string | undefined): void {
  if (!input) return
  const normalized = input.trim()
  if (!normalized) return
  if (!out.includes(normalized)) out.push(normalized)
}

function collectRuntimeRoots(): string[] {
  const roots: string[] = []
  pushUniquePath(roots, process.cwd())

  try {
    const fileDir = dirname(__filename)
    pushUniquePath(roots, fileDir)
    pushUniquePath(roots, dirname(fileDir))
    pushUniquePath(roots, dirname(dirname(fileDir)))
  } catch {}

  try {
    const execPath = String(process.execPath ?? '')
    if (execPath) {
      const execDir = dirname(execPath)
      pushUniquePath(roots, execDir)
      pushUniquePath(roots, dirname(execDir))
      pushUniquePath(roots, dirname(dirname(execDir)))
    }
  } catch {}

  const expanded: string[] = []
  for (const root of roots) {
    pushUniquePath(expanded, root)
    pushUniquePath(expanded, join(root, 'Resources'))
    pushUniquePath(expanded, join(root, 'resources'))
    pushUniquePath(expanded, join(root, 'Resources', 'app'))
    pushUniquePath(expanded, join(root, 'resources', 'app'))
    pushUniquePath(expanded, join(root, 'app'))
  }

  return expanded
}

function resolvePathFromEnv(raw: string | undefined): string | undefined {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return undefined
  try {
    const decoded = value.startsWith('file://') ? fileURLToPath(value) : value
    if (existsSync(decoded)) return pathToFileURL(resolve(decoded)).toString()
  } catch {}
  return undefined
}

function resolveDefaultWorkerEntry(): string {
  const fromEnv = resolvePathFromEnv(process.env.LANSTART_CAPABILITY_WORKER_ENTRY)
  if (fromEnv) return fromEnv

  const runtimeRoots = collectRuntimeRoots()
  const candidates: string[] = []
  const rel = [
    ['src', 'system', 'capabilities', 'winapi', 'winapi.worker.ts'],
    ['out', 'system', 'capabilities', 'winapi', 'winapi.worker.js'],
    ['Resources', 'out', 'system', 'capabilities', 'winapi', 'winapi.worker.js'],
    ['resources', 'out', 'system', 'capabilities', 'winapi', 'winapi.worker.js'],
    ['Resources', 'app', 'out', 'system', 'capabilities', 'winapi', 'winapi.worker.js'],
    ['resources', 'app', 'out', 'system', 'capabilities', 'winapi', 'winapi.worker.js'],
    ['app', 'out', 'system', 'capabilities', 'winapi', 'winapi.worker.js']
  ]
  for (const root of runtimeRoots) for (const item of rel) pushUniquePath(candidates, join(root, ...item))

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return pathToFileURL(resolve(candidate)).toString()
    } catch {}
  }

  return pathToFileURL(resolve(candidates[0]!)).toString()
}

export class CapabilityClient {
  private worker: Worker | undefined
  private pending = new Map<number, PendingRequest>()
  private nextId = 1
  private readyPromise: Promise<void> | undefined
  private restartTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private workerHealthy = false
  private readonly workerEntry: string

  constructor(workerEntry = resolveDefaultWorkerEntry()) {
    this.workerEntry = workerEntry
  }

  async request<M extends CapabilityMethodName>(
    method: M,
    params: CapabilityRequestMap[M]['params'],
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<CapabilityRequestMap[M]['result']> {
    await this.ensureReady()
    const result = await this.requestWithWorker(method, params, timeoutMs)
    return result as CapabilityRequestMap[M]['result']
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.workerHealthy = false
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = undefined
    }

    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id)
      clearTimeout(pending.timer)
      pending.reject(new Error('capability_client_disposed'))
    }

    const worker = this.worker
    this.worker = undefined
    if (worker) {
      try {
        worker.terminate()
      } catch {}
    }
  }

  private async ensureReady(): Promise<void> {
    if (this.disposed) throw new Error('capability_client_disposed')
    if (this.worker && this.workerHealthy) return
    if (this.readyPromise) return await this.readyPromise

    this.readyPromise = (async () => {
      const worker = this.spawnWorker()
      await this.requestWithWorker('cap.health', null, HEALTH_TIMEOUT_MS, worker)
      this.workerHealthy = true
    })()
      .catch((error) => {
        this.handleWorkerFailure(error)
        throw error
      })
      .finally(() => {
        this.readyPromise = undefined
      })

    return await this.readyPromise
  }

  private spawnWorker(): Worker {
    const existing = this.worker
    if (existing) {
      try {
        existing.terminate()
      } catch {}
    }

    const worker = new Worker(this.workerEntry, { type: 'module' })
    this.worker = worker
    this.workerHealthy = false

    worker.onmessage = (event: MessageEvent<CapabilityResponse>) => {
      this.handleWorkerMessage(event.data)
    }

    worker.onerror = (event: ErrorEvent) => {
      const message = event?.message ? String(event.message) : 'capability_worker_error'
      this.handleWorkerFailure(new Error(message))
    }

    return worker
  }

  private requestWithWorker<M extends CapabilityMethodName>(
    method: M,
    params: CapabilityRequestMap[M]['params'],
    timeoutMs: number,
    preferredWorker?: Worker
  ): Promise<CapabilityRequestMap[M]['result']> {
    const worker = preferredWorker ?? this.worker
    if (!worker) return Promise.reject(new Error('capability_worker_unavailable'))

    const id = this.nextId++
    const request: CapabilityRequest<M> = { id, method, params }

    return new Promise<CapabilityRequestMap[M]['result']>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`capability_request_timeout:${method}`))
      }, Math.max(1, Math.floor(timeoutMs)))

      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })

      try {
        worker.postMessage(request)
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private handleWorkerMessage(message: CapabilityResponse): void {
    if (!message || typeof message !== 'object') return
    const id = Number((message as any).id)
    if (!Number.isFinite(id)) return
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)

    if ((message as any).ok) {
      pending.resolve((message as any).result)
      return
    }

    const errorMessage = String((message as any)?.error?.message ?? 'capability_request_failed')
    pending.reject(new Error(errorMessage))
  }

  private handleWorkerFailure(reason: unknown): void {
    this.workerHealthy = false
    const worker = this.worker
    this.worker = undefined

    if (worker) {
      try {
        worker.terminate()
      } catch {}
    }

    const message = reason instanceof Error ? reason.message : String(reason)
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id)
      clearTimeout(pending.timer)
      pending.reject(new Error(`capability_worker_failed:${message}`))
    }

    if (this.disposed || this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      void this.ensureReady().catch(() => undefined)
    }, 400)
  }
}

let capabilityClientSingleton: CapabilityClient | undefined

export function getCapabilityClient(): CapabilityClient {
  if (!capabilityClientSingleton) capabilityClientSingleton = new CapabilityClient()
  return capabilityClientSingleton
}

export async function disposeCapabilityClient(): Promise<void> {
  const singleton = capabilityClientSingleton
  capabilityClientSingleton = undefined
  if (singleton) await singleton.dispose()
}
