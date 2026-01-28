import type { SystemColors } from './types'

export async function fetchSystemColors(
  backendUrl: string,
  options?: { mode?: 'auto' | 'light' | 'dark' }
): Promise<SystemColors> {
  const mode = options?.mode ?? 'auto'
  const res = await fetch(`${backendUrl}/system/colors?mode=${encodeURIComponent(mode)}`)
  const json = (await res.json()) as { ok: boolean; colors?: SystemColors }
  if (!res.ok || !json.ok || !json.colors) throw new Error('SYSTEM_COLORS_FAILED')
  return json.colors
}

