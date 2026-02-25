import { getCapabilityClient } from '../capabilities/client'

export async function isAdmin(): Promise<boolean> {
  return await getCapabilityClient().request('cap.privilege.isAdmin', null)
}
