export type ProcessSample = {
  pid: number
  name: string
  cpuPercent?: number
  cpuTimeMs?: number
  memoryBytes?: number
}

export type ForegroundWindowSample = {
  pid?: number
  processName?: string
  title: string
  handle?: string
  bounds?: { x: number; y: number; width: number; height: number }
}

export type WatcherSnapshot = {
  ts: number
  processes: ProcessSample[]
  foregroundWindow?: ForegroundWindowSample
}

export type TaskWatcherStatus = {
  running: boolean
  intervalMs: number
  ts: number
  lastError?: string
}

export type TaskWatcherAdapter = {
  getProcesses: () => Promise<ProcessSample[]>
  getForegroundWindow: () => Promise<ForegroundWindowSample | undefined>
}

