import { getCapabilityClient } from '../capabilities/client'
import type { CapabilityKeyName } from '../capabilities/protocol'

export type SimulatedKey = CapabilityKeyName

export async function sendSimulatedKeys(keys: SimulatedKey[]): Promise<void> {
  const list = Array.isArray(keys) ? keys.filter((item): item is SimulatedKey => item === 'left' || item === 'right' || item === 'escape') : []
  if (!list.length) return
  await getCapabilityClient().request('cap.input.sendKeys', { keys: list })
}
