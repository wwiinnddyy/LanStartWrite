import type { TaskWatcherAdapter } from '../task_windows_watcher/types'
import { createDarwinAdapter } from './darwin'
import { createLinuxAdapter } from './linux'
import { createWindowsAdapter } from './windows'
import { forceTopmostWindowsDarwin } from './darwin'
import { forceTopmostWindowsLinux } from './linux'
import { forceTopmostWindowsWindows } from './windows'
import { sendKeysWindows, type SimulatedKeyWindows } from './windows'

export function createTaskWatcherAdapter(platform: NodeJS.Platform = process.platform): TaskWatcherAdapter {
  if (platform === 'win32') return createWindowsAdapter()
  if (platform === 'darwin') return createDarwinAdapter()
  return createLinuxAdapter()
}

export async function forceTopmostWindows(hwnds: bigint[], platform: NodeJS.Platform = process.platform): Promise<void> {
  if (!Array.isArray(hwnds) || hwnds.length === 0) return
  if (platform === 'win32') return await forceTopmostWindowsWindows(hwnds)
  if (platform === 'darwin') return await forceTopmostWindowsDarwin(hwnds)
  return await forceTopmostWindowsLinux(hwnds)
}

export type SimulatedKey = SimulatedKeyWindows

export async function sendSimulatedKeys(keys: SimulatedKey[], platform: NodeJS.Platform = process.platform): Promise<void> {
  if (!Array.isArray(keys) || keys.length === 0) return
  if (platform === 'win32') return await sendKeysWindows(keys)
  return
}
