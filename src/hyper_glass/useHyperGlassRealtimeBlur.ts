import { useEffect } from 'react'
import { computeThumbnailBlur } from './thumbnailBlur'

type DisplayInfo = {
  id: number
  scaleFactor: number
  bounds: { x: number; y: number; width: number; height: number }
  size: { width: number; height: number }
}

type CaptureResult = {
  dataUrl: string
  width: number
  height: number
  display: DisplayInfo
}

declare global {
  interface Window {
    hyperGlass?: {
      captureDisplayThumbnail: (options?: { maxSide?: number }) => Promise<CaptureResult>
    }
  }
}

export function useHyperGlassRealtimeBlur(options: {
  root: HTMLElement | null
  captureMaxSide?: number
  blurRadius?: number
  blurPasses?: number
  blurMaxSide?: number
}) {
  useEffect(() => {
    const root = options.root
    const api = window.hyperGlass
    if (!root || !api) return

    let disposed = false
    let rafId = 0
    let lastCaptureAt = 0
    let lastX = Number.NaN
    let lastY = Number.NaN
    let lastW = Number.NaN
    let lastH = Number.NaN
    let lastUrl = ''
    let inFlight = false

    const captureMaxSide = typeof options.captureMaxSide === 'number' ? options.captureMaxSide : 320
    const blurRadius = typeof options.blurRadius === 'number' ? options.blurRadius : 48
    const blurPasses = typeof options.blurPasses === 'number' ? options.blurPasses : 3
    const blurMaxSide = typeof options.blurMaxSide === 'number' ? options.blurMaxSide : 64

    const decodeToImageBitmap = async (dataUrl: string) => {
      const res = await fetch(dataUrl)
      const blob = await res.blob()
      return await createImageBitmap(blob)
    }

    const update = async () => {
      if (inFlight) return
      const x = window.screenX
      const y = window.screenY
      const w = window.outerWidth
      const h = window.outerHeight
      const moved = x !== lastX || y !== lastY || w !== lastW || h !== lastH

      lastX = x
      lastY = y
      lastW = w
      lastH = h

      const now = performance.now()
      const interval = moved ? 60 : 320
      if (!moved && now - lastCaptureAt < interval) return
      if (moved && now - lastCaptureAt < interval) return

      lastCaptureAt = now
      inFlight = true

      let capture: CaptureResult | undefined
      try {
        capture = await api.captureDisplayThumbnail({ maxSide: captureMaxSide })
      } catch {
        inFlight = false
        return
      }
      if (!capture || disposed) return

      let bmp: ImageBitmap | undefined
      try {
        bmp = await decodeToImageBitmap(capture.dataUrl)
      } catch {
        inFlight = false
        return
      }
      if (!bmp || disposed) return

      const bounds = capture.display.bounds
      const relX = x - bounds.x
      const relY = y - bounds.y
      const sx = (relX / bounds.width) * capture.width
      const sy = (relY / bounds.height) * capture.height
      const sw = (w / bounds.width) * capture.width
      const sh = (h / bounds.height) * capture.height

      const cropW = Math.max(1, Math.round(sw))
      const cropH = Math.max(1, Math.round(sh))

      // 考虑 DPI 缩放
      const dpr = window.devicePixelRatio || 1

      const canvas = document.createElement('canvas')
      canvas.width = cropW * dpr
      canvas.height = cropH * dpr
      canvas.style.width = `${cropW}px`
      canvas.style.height = `${cropH}px`
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return

      ctx.scale(dpr, dpr)
      ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, cropW, cropH)
      bmp.close()

      const imageData = ctx.getImageData(0, 0, cropW * dpr, cropH * dpr)
      const { image } = computeThumbnailBlur(
        { width: imageData.width, height: imageData.height, data: imageData.data },
        { maxSide: blurMaxSide * dpr, radius: blurRadius * dpr, passes: blurPasses }
      )

      const outCanvas = document.createElement('canvas')
      outCanvas.width = image.width
      outCanvas.height = image.height
      outCanvas.style.width = `${image.width / dpr}px`
      outCanvas.style.height = `${image.height / dpr}px`
      const outCtx = outCanvas.getContext('2d', { willReadFrequently: false })
      if (!outCtx) return
      const outImageData = new ImageData(image.data, image.width, image.height)
      outCtx.putImageData(outImageData, 0, 0)
      const url = outCanvas.toDataURL('image/png')
      inFlight = false
      if (disposed) return
      if (url === lastUrl) return
      lastUrl = url
      root.style.setProperty('--hyper-glass-bg', `url("${url}")`)
    }

    const loop = () => {
      rafId = requestAnimationFrame(loop)
      void update()
    }

    rafId = requestAnimationFrame(loop)
    return () => {
      disposed = true
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [options.root, options.captureMaxSide, options.blurRadius, options.blurPasses, options.blurMaxSide])
}
