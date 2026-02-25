import { getCapabilityClient } from '../capabilities/client'
import type { WallpaperThumbnailResult } from '../capabilities/protocol'

export async function captureWallpaperThumbnail(options: { maxSide?: number } = {}): Promise<WallpaperThumbnailResult> {
  const maxSideRaw = Number(options.maxSide)
  const maxSide = Number.isFinite(maxSideRaw) ? Math.max(32, Math.floor(maxSideRaw)) : undefined
  return await getCapabilityClient().request('cap.wallpaper.captureThumbnail', {
    ...(typeof maxSide === 'number' ? { maxSide } : {})
  })
}
