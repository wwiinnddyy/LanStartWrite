import type { TaskWatcherAdapter } from '../task_windows_watcher/types'
import { createDarwinAdapter } from './darwin'
import { createLinuxAdapter } from './linux'
import { createWindowsAdapter } from './windows'

export function createTaskWatcherAdapter(platform: NodeJS.Platform = process.platform): TaskWatcherAdapter {
  if (platform === 'win32') return createWindowsAdapter()
  if (platform === 'darwin') return createDarwinAdapter()
  return createLinuxAdapter()
}

