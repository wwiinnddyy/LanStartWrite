import { TaskWindowsWatcher, type TaskWatcherEmit } from '../../task_windows_watcher/TaskWindowsWatcher'
import type { TaskWatcherStatus } from '../../task_windows_watcher/types'
import { getCapabilityClient } from '../capabilities/client'

export type TaskWatcherService = {
  start: (intervalMs?: number) => void
  stop: () => void
  getStatus: () => TaskWatcherStatus
}

export function createTaskWatcherService(options: {
  emit: TaskWatcherEmit
  now?: () => number
  defaultIntervalMs?: number
}): TaskWatcherService {
  const watcher = new TaskWindowsWatcher({
    emit: options.emit,
    now: options.now,
    defaultIntervalMs: options.defaultIntervalMs,
    adapter: {
      getProcesses: async () => {
        return await getCapabilityClient().request('cap.process.getProcesses', null)
      },
      getForegroundWindow: async () => {
        return await getCapabilityClient().request('cap.window.getForegroundWindow', null)
      }
    }
  })

  return {
    start(intervalMs?: number) {
      watcher.start(intervalMs)
    },
    stop() {
      watcher.stop()
    },
    getStatus() {
      return watcher.getStatus()
    }
  }
}
