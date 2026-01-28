import { nativeImage } from 'electron'
import type { SystemColors } from './types'
import { buildMonetPalette, extractMonetSeedFromRgbaBitmap } from './monet'
import { computeMicaFromSeed, type MicaMode } from './mica'
import { getWindowsAppsThemeMode, getWindowsWallpaperPath } from './win32'

async function decodeWallpaperToRgba(path: string): Promise<{ rgba: Uint8Array; width: number; height: number } | undefined> {
  try {
    const thumb = await nativeImage.createThumbnailFromPath(path, { width: 256, height: 256 })
    const { width, height } = thumb.getSize()
    const bgra = thumb.toBitmap()
    const rgba = new Uint8Array(bgra.length)
    for (let i = 0; i < bgra.length; i += 4) {
      const b = bgra[i] ?? 0
      const g = bgra[i + 1] ?? 0
      const r = bgra[i + 2] ?? 0
      const a = bgra[i + 3] ?? 255
      rgba[i] = r
      rgba[i + 1] = g
      rgba[i + 2] = b
      rgba[i + 3] = a
    }
    return { rgba, width, height }
  } catch {
    try {
      const img = nativeImage.createFromPath(path)
      const { width, height } = img.getSize()
      const bgra = img.toBitmap()
      const rgba = new Uint8Array(bgra.length)
      for (let i = 0; i < bgra.length; i += 4) {
        const b = bgra[i] ?? 0
        const g = bgra[i + 1] ?? 0
        const r = bgra[i + 2] ?? 0
        const a = bgra[i + 3] ?? 255
        rgba[i] = r
        rgba[i + 1] = g
        rgba[i + 2] = b
        rgba[i + 3] = a
      }
      return { rgba, width, height }
    } catch {
      return undefined
    }
  }
}

let cached: { ts: number; mode: MicaMode; value: SystemColors } | undefined

export async function getSystemColors(options?: { mode?: 'auto' | MicaMode; maxAgeMs?: number }): Promise<SystemColors> {
  const maxAgeMs = Math.max(0, Math.min(60_000, options?.maxAgeMs ?? 5_000))
  const mode: MicaMode =
    options?.mode === 'light' || options?.mode === 'dark'
      ? options.mode
      : process.platform === 'win32'
        ? await getWindowsAppsThemeMode()
        : 'dark'

  if (cached && cached.mode === mode && Date.now() - cached.ts <= maxAgeMs) return cached.value

  const wallpaperPath = process.platform === 'win32' ? await getWindowsWallpaperPath() : undefined
  const decoded = wallpaperPath ? await decodeWallpaperToRgba(wallpaperPath) : undefined

  const seed = decoded
    ? extractMonetSeedFromRgbaBitmap(decoded.rgba, decoded.width, decoded.height)
    : { r: 82, g: 92, b: 120, a: 255 }

  const monet = buildMonetPalette(seed)
  const mica = computeMicaFromSeed(monet.seed, mode)

  const value: SystemColors = { ok: true, mode, wallpaperPath, monet, mica }
  cached = { ts: Date.now(), mode, value }
  return value
}

