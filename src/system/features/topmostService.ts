import { getCapabilityClient } from '../capabilities/client'

export async function forceTopmostWindows(hwnds: bigint[]): Promise<void> {
  const handles: string[] = []
  const seen = new Set<string>()
  for (const hwnd of Array.isArray(hwnds) ? hwnds : []) {
    if (typeof hwnd !== 'bigint' || hwnd <= 0n) continue
    const key = hwnd.toString()
    if (seen.has(key)) continue
    seen.add(key)
    handles.push(key)
  }
  if (!handles.length) return
  await getCapabilityClient().request('cap.window.forceTopmostWindows', { handles })
}
