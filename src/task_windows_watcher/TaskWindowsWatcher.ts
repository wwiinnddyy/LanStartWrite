import os from 'node:os'
import type { ForegroundWindowSample, ProcessSample, TaskWatcherAdapter, TaskWatcherStatus } from './types'

export type TaskWatcherEmit = (message: unknown) => void

type CpuBaseline = { ts: number; cpuTimeMs: number; cpuPercent?: number }

function normalizeProcessList(list: ProcessSample[]): ProcessSample[] {
  const out: ProcessSample[] = []
  for (const p of list) {
    const pid = Number(p.pid)
    if (!Number.isFinite(pid) || pid <= 0) continue
    const name = typeof p.name === 'string' ? p.name : ''
    if (!name) continue
    out.push({
      pid,
      name,
      cpuPercent: Number.isFinite(p.cpuPercent ?? NaN) ? (p.cpuPercent as number) : undefined,
      cpuTimeMs: Number.isFinite(p.cpuTimeMs ?? NaN) ? (p.cpuTimeMs as number) : undefined,
      memoryBytes: Number.isFinite(p.memoryBytes ?? NaN) ? (p.memoryBytes as number) : undefined
    })
  }
  return out
}

function normalizeForegroundWindow(sample: ForegroundWindowSample | undefined): ForegroundWindowSample | undefined {
  if (!sample) return undefined
  const title = typeof sample.title === 'string' ? sample.title : ''
  const pid = Number.isFinite(sample.pid ?? NaN) ? (sample.pid as number) : undefined
  const processName = typeof sample.processName === 'string' ? sample.processName : undefined
  const handle = typeof sample.handle === 'string' ? sample.handle : undefined
  if (!title && pid === undefined && processName === undefined && handle === undefined) return undefined
  const bounds = sample.bounds && Number.isFinite(sample.bounds.x) && Number.isFinite(sample.bounds.y) && Number.isFinite(sample.bounds.width) && Number.isFinite(sample.bounds.height)
    ? { x: sample.bounds.x, y: sample.bounds.y, width: sample.bounds.width, height: sample.bounds.height }
    : undefined
  return { title, pid, processName, handle, bounds }
}

function keyForWindow(sample: ForegroundWindowSample | undefined): string {
  if (!sample) return ''
  const pid = sample.pid ?? 0
  const handle = sample.handle ?? ''
  const title = sample.title ?? ''
  return `${pid}|${handle}|${title}`
}

export class TaskWindowsWatcher {
  private readonly adapter: TaskWatcherAdapter
  private readonly emit: TaskWatcherEmit
  private readonly now: () => number
  private readonly cpuCount: number
  private timer: NodeJS.Timeout | undefined
  private intervalMs: number
  private lastError: string | undefined
  private readonly cpuBaselines = new Map<number, CpuBaseline>()
  private lastProcessFingerprint = ''
  private lastWindowKey = ''
  private running = false

  constructor(options: { adapter: TaskWatcherAdapter; emit: TaskWatcherEmit; now?: () => number; defaultIntervalMs?: number }) {
    this.adapter = options.adapter
    this.emit = options.emit
    this.now = options.now ?? (() => Date.now())
    this.intervalMs = Number.isFinite(options.defaultIntervalMs ?? NaN) ? Math.max(200, Number(options.defaultIntervalMs)) : 1000
    this.cpuCount = Math.max(1, os.cpus().length || 1)
  }

  getStatus(): TaskWatcherStatus {
    return { running: this.running, intervalMs: this.intervalMs, ts: this.now(), lastError: this.lastError }
  }

  start(intervalMs?: number): void {
    if (Number.isFinite(intervalMs ?? NaN)) this.intervalMs = Math.max(200, Number(intervalMs))
    if (this.running) return
    this.running = true
    this.emit({ type: 'TASK_WATCHER_STATUS', status: this.getStatus() })
    this.schedule()
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.emit({ type: 'TASK_WATCHER_STATUS', status: this.getStatus() })
  }

  async tick(): Promise<void> {
    if (!this.running) return
    const ts = this.now()

    const [processesResult, windowResult] = await Promise.allSettled([this.adapter.getProcesses(), this.adapter.getForegroundWindow()])

    if (processesResult.status === 'fulfilled') {
      const processes = this.withDerivedCpu(normalizeProcessList(processesResult.value), ts)
      const fingerprint = this.fingerprintProcesses(processes)
      if (fingerprint !== this.lastProcessFingerprint) {
        this.lastProcessFingerprint = fingerprint
        this.emit({ type: 'TASK_WATCHER_PROCESS_SNAPSHOT', ts, processes })
      }
    } else {
      this.captureError('getProcesses', processesResult.reason)
      this.emit({ type: 'TASK_WATCHER_ERROR', ts, stage: 'getProcesses', error: this.lastError })
    }

    if (windowResult.status === 'fulfilled') {
      const sample = normalizeForegroundWindow(windowResult.value)
      const nextKey = keyForWindow(sample)
      if (nextKey && nextKey !== this.lastWindowKey) {
        this.lastWindowKey = nextKey
        this.emit({ type: 'TASK_WATCHER_WINDOW_FOCUS', ts, window: sample })
      }
    } else {
      this.captureError('getForegroundWindow', windowResult.reason)
      this.emit({ type: 'TASK_WATCHER_ERROR', ts, stage: 'getForegroundWindow', error: this.lastError })
    }
  }

  private schedule(): void {
    if (!this.running) return
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule())
    }, this.intervalMs)
  }

  private captureError(scope: string, reason: unknown): void {
    const raw = reason instanceof Error ? reason.message : String(reason)
    this.lastError = `${scope}:${raw}`
  }

  private withDerivedCpu(list: ProcessSample[], ts: number): ProcessSample[] {
    const out: ProcessSample[] = []
    for (const p of list) {
      if (p.cpuPercent === undefined && p.cpuTimeMs !== undefined) {
        const prev = this.cpuBaselines.get(p.pid)
        if (prev) {
          const dt = ts - prev.ts
          if (dt > 0) {
            const dCpu = Math.max(0, p.cpuTimeMs - prev.cpuTimeMs)
            const percent = (dCpu / dt) * (100 / this.cpuCount)
            const nextPercent = Number.isFinite(percent) ? percent : undefined
            out.push({ ...p, cpuPercent: nextPercent })
            this.cpuBaselines.set(p.pid, { ts, cpuTimeMs: p.cpuTimeMs, cpuPercent: nextPercent })
          } else {
            out.push(prev.cpuPercent === undefined ? p : { ...p, cpuPercent: prev.cpuPercent })
            this.cpuBaselines.set(p.pid, { ts: prev.ts, cpuTimeMs: p.cpuTimeMs, cpuPercent: prev.cpuPercent })
          }
        } else {
          out.push(p)
          this.cpuBaselines.set(p.pid, { ts, cpuTimeMs: p.cpuTimeMs })
        }
        continue
      }
      out.push(p)
      if (p.cpuTimeMs !== undefined) this.cpuBaselines.set(p.pid, { ts, cpuTimeMs: p.cpuTimeMs, cpuPercent: p.cpuPercent })
    }
    return out
  }

  private fingerprintProcesses(processes: ProcessSample[]): string {
    const parts: string[] = []
    const max = Math.min(600, processes.length)
    for (let i = 0; i < max; i++) {
      const p = processes[i]
      const cpu = p.cpuPercent !== undefined ? Math.round(p.cpuPercent * 10) : -1
      const mem = p.memoryBytes !== undefined ? Math.round(p.memoryBytes / 4096) : -1
      parts.push(`${p.pid}:${p.name}:${cpu}:${mem}`)
    }
    return `${processes.length}|${parts.join(',')}`
  }
}
