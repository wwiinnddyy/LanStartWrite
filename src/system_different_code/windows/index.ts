import type { ForegroundWindowSample, ProcessSample, TaskWatcherAdapter } from '../../task_windows_watcher/types'
import { getCapabilityClient } from '../../system/capabilities/client'
import { forceTopmostWindows as forceTopmostWindowsFeature } from '../../system/features/topmostService'
import { sendSimulatedKeys } from '../../system/features/inputService'

export async function getProcessesWindows(): Promise<ProcessSample[]> {
  return await getCapabilityClient().request('cap.process.getProcesses', null)
}

export async function getForegroundWindowWindows(): Promise<ForegroundWindowSample | undefined> {
  return await getCapabilityClient().request('cap.window.getForegroundWindow', null)
}

export function createWindowsAdapter(): TaskWatcherAdapter {
  return {
    getProcesses: getProcessesWindows,
    getForegroundWindow: getForegroundWindowWindows
  }
}

export type SimulatedKeyWindows = 'escape' | 'left' | 'right'

export async function forceTopmostWindowsWindows(hwnds: bigint[]): Promise<void> {
  await forceTopmostWindowsFeature(hwnds)
}

export async function sendKeysWindows(keys: SimulatedKeyWindows[]): Promise<void> {
  const list = Array.isArray(keys) ? keys.filter((key): key is SimulatedKeyWindows => key === 'escape' || key === 'left' || key === 'right') : []
  if (!list.length) return
  await sendSimulatedKeys(list)
}
