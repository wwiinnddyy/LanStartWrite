import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as QRCode from 'qrcode'
import {
  APP_MODE_UI_STATE_KEY,
  NOTES_PAGE_INDEX_UI_STATE_KEY,
  NOTES_PAGE_TOTAL_UI_STATE_KEY,
  PDF_FILE_URL_KV_KEY,
  PDF_FILE_URL_UI_STATE_KEY,
  UI_STATE_APP_WINDOW_ID,
  WHITEBOARD_BG_COLOR_KV_KEY,
  WHITEBOARD_BG_IMAGE_URL_KV_KEY,
  WHITEBOARD_BG_IMAGE_OPACITY_KV_KEY,
  WHITEBOARD_CANVAS_PAGES_KV_KEY,
  VIDEO_SHOW_LIVE_THUMB_UI_STATE_KEY,
  VIDEO_SHOW_PAGES_KV_KEY,
  VIDEO_SHOW_DEVICE_ID_UI_STATE_KEY,
  VIDEO_SHOW_SOURCE_UI_STATE_KEY,
  VIDEO_SHOW_QUALITY_PRESETS_UI_STATE_KEY,
  VIDEO_SHOW_QUALITY_UI_STATE_KEY,
  VIDEO_SHOW_WEBRTC_SESSION_ID_UI_STATE_KEY,
  VIDEO_SHOW_WEBRTC_STATUS_UI_STATE_KEY,
  getKv,
  isFileOrDataUrl,
  isAppMode,
  isHexColor,
  postCommand,
  useUiStateBus
} from '../status'
import { Button } from '../button'
import { loadPdfjs } from '../PDF/pdfjs'
import { useZoomOnWheel } from '../toolbar/hooks/useZoomOnWheel'
import { useEventsPoll } from '../toolbar/hooks/useEventsPoll'
import '../toolbar-subwindows/styles/subwindow.css'

type PersistedAnnotationNodeV1 = {
  role: 'stroke' | 'eraserPixel'
  strokeWidth: number
  points: number[]
  color?: string
  opacity?: number
}

type PersistedAnnotationDocV1 = { version: 1; nodes: PersistedAnnotationNodeV1[] }

type PersistedAnnotationBookV2 = { version: 2; currentPage: number; pages: PersistedAnnotationDocV1[] }

type WhiteboardCanvasPageV1 = { bgColor?: string; bgImageUrl?: string; bgImageOpacity?: number }
type WhiteboardCanvasBookV1 = { version: 1; pages: WhiteboardCanvasPageV1[] }

type VideoShowPageV1 = { name?: string; imageUrl?: string; createdAt?: number }
type VideoShowPageBookV1 = { version: 1; pages: VideoShowPageV1[] }

function base64ToU8(base64: string): Uint8Array {
  const raw = globalThis.atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i) & 0xff
  return out
}

function isPersistedAnnotationDocV1(v: unknown): v is PersistedAnnotationDocV1 {
  if (!v || typeof v !== 'object') return false
  const d = v as any
  if (d.version !== 1) return false
  if (!Array.isArray(d.nodes)) return false
  return true
}

function isPersistedAnnotationBookV2(v: unknown): v is PersistedAnnotationBookV2 {
  if (!v || typeof v !== 'object') return false
  const b = v as any
  if (b.version !== 2) return false
  if (!Array.isArray(b.pages)) return false
  for (const p of b.pages) if (!isPersistedAnnotationDocV1(p)) return false
  return true
}

function isWhiteboardCanvasBookV1(v: unknown): v is WhiteboardCanvasBookV1 {
  if (!v || typeof v !== 'object') return false
  const b = v as any
  if (b.version !== 1) return false
  if (!Array.isArray(b.pages)) return false
  return true
}

function isVideoShowPageBookV1(v: unknown): v is VideoShowPageBookV1 {
  if (!v || typeof v !== 'object') return false
  const b = v as any
  if (b.version !== 1) return false
  if (!Array.isArray(b.pages)) return false
  return true
}

function normalizeVideoShowPhotoPages(pages: VideoShowPageV1[], photoTotal: number): VideoShowPageV1[] {
  const total = Number.isFinite(photoTotal) ? Math.max(0, Math.floor(photoTotal)) : 0
  const out = Array.isArray(pages) ? [...pages] : []
  if (out.length > total) out.length = total
  while (out.length < total) out.push({})
  return out
}

function computeDocBounds(doc: PersistedAnnotationDocV1): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const node of doc.nodes) {
    if (!node || node.role !== 'stroke') continue
    const pts = Array.isArray(node.points) ? node.points : []
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const x = Number(pts[i])
      const y = Number(pts[i + 1])
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null
  return { minX, minY, maxX, maxY }
}

function prepareCanvas(args: { canvas: HTMLCanvasElement; cssWidth: number; cssHeight: number }) {
  const { canvas, cssWidth, cssHeight } = args
  const dpr = window.devicePixelRatio || 1
  const w = Math.max(1, Math.floor(cssWidth * dpr))
  const h = Math.max(1, Math.floor(cssHeight * dpr))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h

  const ctx = canvas.getContext('2d')
  return { ctx, w, h, dpr }
}

const thumbImageCache = new Map<string, Promise<HTMLImageElement>>()
function loadThumbImage(url: string): Promise<HTMLImageElement> {
  const cached = thumbImageCache.get(url)
  if (cached) return cached
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image_load_failed'))
    img.src = url
  })
  thumbImageCache.set(url, p)
  return p
}

async function drawThumbBackground(args: {
  canvas: HTMLCanvasElement
  cssWidth: number
  cssHeight: number
  bgColor: string
  bgImageUrl: string
  bgImageOpacity: number
}): Promise<{ ctx: CanvasRenderingContext2D; w: number; h: number; dpr: number } | null> {
  const { canvas, cssWidth, cssHeight, bgColor, bgImageUrl, bgImageOpacity } = args
  const prepared = prepareCanvas({ canvas, cssWidth, cssHeight })
  const ctx = prepared.ctx
  if (!ctx) return null
  ctx.clearRect(0, 0, prepared.w, prepared.h)

  ctx.fillStyle = isHexColor(bgColor) ? bgColor : '#ffffff'
  ctx.fillRect(0, 0, prepared.w, prepared.h)

  if (bgImageUrl && isFileOrDataUrl(bgImageUrl)) {
    try {
      const img = await loadThumbImage(bgImageUrl)
      const iw = Math.max(1, img.naturalWidth || img.width || 1)
      const ih = Math.max(1, img.naturalHeight || img.height || 1)
      const scale = Math.max(prepared.w / iw, prepared.h / ih)
      const dw = iw * scale
      const dh = ih * scale
      const dx = (prepared.w - dw) * 0.5
      const dy = (prepared.h - dh) * 0.5
      const opacity = Number.isFinite(bgImageOpacity) ? Math.max(0, Math.min(1, bgImageOpacity)) : 0.5
      ctx.globalAlpha = opacity
      ctx.drawImage(img, dx, dy, dw, dh)
      ctx.globalAlpha = 1
    } catch {}
  }

  return { ctx, w: prepared.w, h: prepared.h, dpr: prepared.dpr }
}

function drawDocStrokesToCanvas(args: {
  doc: PersistedAnnotationDocV1
  ctx: CanvasRenderingContext2D
  w: number
  h: number
  dpr: number
}): void {
  const { doc, ctx, w, h, dpr } = args
  const bounds = computeDocBounds(doc)
  if (!bounds) return

  const pad = 10 * dpr
  const bw = Math.max(1, bounds.maxX - bounds.minX)
  const bh = Math.max(1, bounds.maxY - bounds.minY)
  const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh, 1)
  const contentW = bw * scale
  const contentH = bh * scale
  const ox = (w - contentW) * 0.5 - bounds.minX * scale
  const oy = (h - contentH) * 0.5 - bounds.minY * scale

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const node of doc.nodes) {
    if (!node || node.role !== 'stroke') continue
    const pts = Array.isArray(node.points) ? node.points : []
    if (pts.length < 4) continue
    const strokeWidth = Number(node.strokeWidth)
    if (!Number.isFinite(strokeWidth) || strokeWidth <= 0) continue

    const alpha = Number(node.opacity)
    ctx.globalAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1
    ctx.strokeStyle = typeof node.color === 'string' ? node.color : 'rgba(12,12,12,0.92)'
    ctx.lineWidth = Math.max(0.8 * dpr, strokeWidth * scale)

    ctx.beginPath()
    ctx.moveTo(pts[0] * scale + ox, pts[1] * scale + oy)
    for (let i = 2; i + 1 < pts.length; i += 2) ctx.lineTo(pts[i] * scale + ox, pts[i + 1] * scale + oy)
    ctx.stroke()
  }

  ctx.globalAlpha = 1
}

function PdfThumbnailItem(props: {
  index: number
  selected: boolean
  doc: PersistedAnnotationDocV1 | null
  pdfDoc: any | null
  onPick: () => void
}) {
  const { index, selected, doc, pdfDoc, onPick } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    let renderTask: any = null

    void (async () => {
      const prepared = prepareCanvas({ canvas, cssWidth: 160, cssHeight: 100 })
      const ctx = prepared.ctx
      if (!ctx) return

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalAlpha = 1
      ctx.clearRect(0, 0, prepared.w, prepared.h)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, prepared.w, prepared.h)

      if (pdfDoc) {
        try {
          const page = await pdfDoc.getPage(index + 1)
          if (cancelled) return
          const baseViewport = page.getViewport({ scale: 1 })
          const fitScale = Math.min(prepared.w / baseViewport.width, prepared.h / baseViewport.height)
          const viewport = page.getViewport({ scale: fitScale })
          const dx = (prepared.w - viewport.width) * 0.5
          const dy = (prepared.h - viewport.height) * 0.5
          renderTask = page.render({
            canvasContext: ctx,
            viewport,
            transform: [1, 0, 0, 1, dx, dy]
          })
          await renderTask.promise
          if (cancelled) return
        } catch {}
      }

      if (doc) drawDocStrokesToCanvas({ doc, ctx, w: prepared.w, h: prepared.h, dpr: prepared.dpr })
    })()

    return () => {
      cancelled = true
      if (renderTask) {
        try {
          renderTask.cancel?.()
        } catch {}
      }
    }
  }, [doc, index, pdfDoc])

  return (
    <Button
      size="sm"
      kind="custom"
      ariaLabel={`第${index + 1}页`}
      title={`第${index + 1}页`}
      onClick={onPick}
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 8,
        padding: 10,
        borderRadius: 12,
        border: selected ? '1px solid var(--ls-surface-border)' : undefined,
        background: selected ? 'rgba(255,255,255,0.12)' : undefined
      }}
    >
      <div
        style={{
          width: '100%',
          aspectRatio: '16 / 10',
          borderRadius: 10,
          overflow: 'hidden',
          border: '1px solid rgba(0,0,0,0.12)',
          background: 'rgba(255,255,255,0.04)'
        }}
      >
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 650 }}>第 {index + 1} 页</div>
        {selected ? <div style={{ fontSize: 11, opacity: 0.8 }}>当前</div> : null}
      </div>
    </Button>
  )
}

function PageThumbnailItem(props: {
  index: number
  selected: boolean
  doc: PersistedAnnotationDocV1 | null
  bgColor: string
  bgImageUrl: string
  bgImageOpacity: number
  onPick: () => void
}) {
  const { index, selected, doc, bgColor, bgImageUrl, bgImageOpacity, onPick } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    void (async () => {
      const prepared = await drawThumbBackground({ canvas, cssWidth: 160, cssHeight: 100, bgColor, bgImageUrl, bgImageOpacity })
      if (!prepared || cancelled) return
      if (doc) drawDocStrokesToCanvas({ doc, ...prepared })
    })()
    return () => {
      cancelled = true
    }
  }, [doc, bgColor, bgImageUrl])

  return (
    <Button
      size="sm"
      kind="custom"
      ariaLabel={`第${index + 1}页`}
      title={`第${index + 1}页`}
      onClick={onPick}
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 8,
        padding: 10,
        borderRadius: 12,
        border: selected ? '1px solid var(--ls-surface-border)' : undefined,
        background: selected ? 'rgba(255,255,255,0.12)' : undefined
      }}
    >
      <div
        style={{
          width: '100%',
          aspectRatio: '16 / 10',
          borderRadius: 10,
          overflow: 'hidden',
          border: '1px solid rgba(0,0,0,0.12)',
          background: 'rgba(255,255,255,0.04)'
        }}
      >
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 650 }}>第 {index + 1} 页</div>
        {selected ? <div style={{ fontSize: 11, opacity: 0.8 }}>当前</div> : null}
      </div>
    </Button>
  )
}

function VideoShowThumbnailItem(props: {
  pageIndex: number
  selected: boolean
  name: string
  imageUrl: string
  onPick: () => void
}) {
  const { pageIndex, selected, name, imageUrl, onPick } = props
  const pageLabel = name ? name : pageIndex <= 0 ? 'Live' : `第${pageIndex}页`
  return (
    <Button
      size="sm"
      kind="custom"
      ariaLabel={name ? (pageIndex > 0 ? `${name}（第${pageIndex}页）` : name) : pageIndex > 0 ? `第${pageIndex}页` : 'Live'}
      title={name ? (pageIndex > 0 ? `${name}（第${pageIndex}页）` : name) : pageIndex > 0 ? `第${pageIndex}页` : 'Live'}
      onClick={onPick}
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 8,
        padding: 10,
        borderRadius: 12,
        border: selected ? '1px solid var(--ls-surface-border)' : undefined,
        background: selected ? 'rgba(255,255,255,0.12)' : undefined
      }}
    >
      <div
        style={{
          width: '100%',
          aspectRatio: '16 / 10',
          borderRadius: 10,
          overflow: 'hidden',
          border: '1px solid rgba(0,0,0,0.12)',
          background: 'rgba(0,0,0,0.65)'
        }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            loading="lazy"
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : null}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 650 }}>{pageLabel}</div>
        {selected ? <div style={{ fontSize: 11, opacity: 0.8 }}>当前</div> : null}
      </div>
    </Button>
  )
}

export function PageThumbnailsMenuWindow() {
  useZoomOnWheel()
  const bus = useUiStateBus(UI_STATE_APP_WINDOW_ID)
  const events = useEventsPoll(900)

  const appModeRaw = bus.state[APP_MODE_UI_STATE_KEY]
  const appMode = isAppMode(appModeRaw) ? appModeRaw : 'toolbar'

  const pageIndexRaw = bus.state[NOTES_PAGE_INDEX_UI_STATE_KEY]
  const pageTotalRaw = bus.state[NOTES_PAGE_TOTAL_UI_STATE_KEY]
  const liveThumbRaw = bus.state[VIDEO_SHOW_LIVE_THUMB_UI_STATE_KEY]
  const liveThumbUrl = isFileOrDataUrl(liveThumbRaw) ? String(liveThumbRaw) : ''
  const videoDeviceIdRaw = bus.state[VIDEO_SHOW_DEVICE_ID_UI_STATE_KEY]
  const videoQualityRaw = bus.state[VIDEO_SHOW_QUALITY_UI_STATE_KEY]
  const videoQualityPresetsRaw = bus.state[VIDEO_SHOW_QUALITY_PRESETS_UI_STATE_KEY]

  const { index, total } = useMemo(() => {
    const totalV = typeof pageTotalRaw === 'number' ? pageTotalRaw : typeof pageTotalRaw === 'string' ? Number(pageTotalRaw) : 1
    const indexV = typeof pageIndexRaw === 'number' ? pageIndexRaw : typeof pageIndexRaw === 'string' ? Number(pageIndexRaw) : 0
    const t = Number.isFinite(totalV) ? Math.max(1, Math.floor(totalV)) : 1
    const i = Number.isFinite(indexV) ? Math.max(0, Math.min(t - 1, Math.floor(indexV))) : 0
    return { index: i, total: t }
  }, [pageIndexRaw, pageTotalRaw])

  const videoQualityIdx = useMemo(() => {
    const v = typeof videoQualityRaw === 'string' ? videoQualityRaw : '0'
    if (v === '0' || v === '1' || v === '2') return Number(v)
    return 0
  }, [videoQualityRaw])

  const videoQualityPresets = useMemo(() => {
    const raw = videoQualityPresetsRaw as any
    const heights = Array.isArray(raw?.heights) ? raw.heights.map((v: any) => Number(v)).filter((n: any) => Number.isFinite(n) && n > 0) : []
    const fallback = [1080, 720, 480]
    const out =
      heights.length >= 3 ? heights.slice(0, 3) : heights.length === 2 ? [heights[0], heights[1], fallback[2]] : heights.length === 1 ? [heights[0], fallback[1], fallback[2]] : fallback
    const uniq = out.map((n: number) => Math.max(1, Math.floor(n)))
    return { heights: uniq }
  }, [videoQualityPresetsRaw])

  const [videoDevices, setVideoDevices] = useState<{ deviceId: string; label: string }[]>([])
  const [castInfo, setCastInfo] = useState<{ sessionId: string; urls: string[]; port: number } | null>(null)
  const [phoneQrDataUrl, setPhoneQrDataUrl] = useState<string>('')
  const [phoneConnectCollapsed, setPhoneConnectCollapsed] = useState(false)
  const webrtcInitOnceRef = useRef(false)

  const videoSource = useMemo(() => {
    const raw = bus.state[VIDEO_SHOW_SOURCE_UI_STATE_KEY]
    return raw === 'phone-webrtc' ? ('phone-webrtc' as const) : ('camera' as const)
  }, [bus.state])

  const webrtcSessionId = useMemo(() => {
    const raw = bus.state[VIDEO_SHOW_WEBRTC_SESSION_ID_UI_STATE_KEY]
    return typeof raw === 'string' ? raw : ''
  }, [bus.state])

  const webrtcStatus = useMemo(() => {
    const raw = bus.state[VIDEO_SHOW_WEBRTC_STATUS_UI_STATE_KEY]
    return typeof raw === 'string' ? raw : ''
  }, [bus.state])

  const ensureWebrtcSession = async () => {
    try {
      const res = await window.lanstart?.apiRequest({ method: 'POST', path: '/webrtc/session', body: {} })
      const body = (res as any)?.body as any
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
      const hostAddrs = Array.isArray(body?.hostAddrs) ? body.hostAddrs.map((v: any) => String(v)).filter(Boolean) : []
      const port = Number.isFinite(Number(body?.port)) ? Number(body.port) : 3132
      if (!sessionId) return
      await bus.setKey(VIDEO_SHOW_WEBRTC_SESSION_ID_UI_STATE_KEY, sessionId)
      const urls = hostAddrs.length ? hostAddrs.map((a: string) => `http://${a}:${port}/webrtc/?session=${encodeURIComponent(sessionId)}`) : []
      setCastInfo({ sessionId, urls, port })
    } catch {}
  }

  useEffect(() => {
    if (appMode !== 'video-show') {
      webrtcInitOnceRef.current = false
      setCastInfo(null)
      setPhoneQrDataUrl('')
      setPhoneConnectCollapsed(false)
      return
    }
    if (webrtcInitOnceRef.current) return
    webrtcInitOnceRef.current = true
    ensureWebrtcSession().catch(() => undefined)
  }, [appMode])

  const phoneCastUrl = useMemo(() => {
    const url = castInfo?.urls?.[0]
    return typeof url === 'string' ? url : ''
  }, [castInfo])

  useEffect(() => {
    if (appMode !== 'video-show') return
    if (!phoneCastUrl) {
      setPhoneQrDataUrl('')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const dataUrl = await QRCode.toDataURL(phoneCastUrl, { width: 220, margin: 1 })
        if (!cancelled) setPhoneQrDataUrl(dataUrl)
      } catch {
        if (!cancelled) setPhoneQrDataUrl('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [appMode, phoneCastUrl])

  useEffect(() => {
    if (appMode !== 'video-show') return
    const v = typeof videoQualityRaw === 'string' ? videoQualityRaw : '0'
    if (v !== '0' && v !== '1' && v !== '2') {
      bus.setKey(VIDEO_SHOW_QUALITY_UI_STATE_KEY, '0').catch(() => undefined)
    }
  }, [appMode, bus, videoQualityRaw])

  useEffect(() => {
    if (appMode !== 'video-show') return
    const raw = bus.state[VIDEO_SHOW_SOURCE_UI_STATE_KEY]
    if (raw === 'camera' || raw === 'phone-webrtc') return
    bus.setKey(VIDEO_SHOW_SOURCE_UI_STATE_KEY, 'camera').catch(() => undefined)
  }, [appMode, bus, bus.state])

  useEffect(() => {
    if (appMode !== 'video-show') return
    if (!navigator.mediaDevices?.enumerateDevices) return

    let cancelled = false
    const load = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) return
        const cams = list
          .filter((d) => d.kind === 'videoinput')
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `摄像头 ${i + 1}`
          }))
        setVideoDevices(cams)
      } catch {
        if (!cancelled) setVideoDevices([])
      }
    }

    const onDeviceChange = () => void load()
    navigator.mediaDevices.addEventListener?.('devicechange', onDeviceChange as any)
    void load()
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener?.('devicechange', onDeviceChange as any)
    }
  }, [appMode])

  useEffect(() => {
    if (appMode !== 'video-show') return
    if (videoSource !== 'camera') return
    if (!videoDevices.length) return
    const current = typeof videoDeviceIdRaw === 'string' ? videoDeviceIdRaw : ''
    const ok = current && videoDevices.some((d) => d.deviceId === current)
    if (ok) return
    const first = videoDevices[0]?.deviceId
    if (!first) return
    bus.setKey(VIDEO_SHOW_DEVICE_ID_UI_STATE_KEY, first).catch(() => undefined)
  }, [appMode, bus, videoDeviceIdRaw, videoDevices])

  const notesKvKey =
    appMode === 'whiteboard'
      ? 'annotation-notes-whiteboard'
      : appMode === 'video-show'
        ? 'annotation-notes-video-show'
        : appMode === 'pdf'
          ? 'annotation-notes-pdf'
          : 'annotation-notes-toolbar'

  const [pages, setPages] = useState<PersistedAnnotationDocV1[]>([])
  const [canvasPages, setCanvasPages] = useState<WhiteboardCanvasPageV1[]>([])
  const [videoPages, setVideoPages] = useState<VideoShowPageV1[]>([])
  const [defaultBg, setDefaultBg] = useState<{ color: string; imageUrl: string; imageOpacity: number }>({ color: '#ffffff', imageUrl: '', imageOpacity: 0.5 })
  const [persistedPdfFileUrl, setPersistedPdfFileUrl] = useState<string>('')
  const pdfUiFileUrlRaw = bus.state[PDF_FILE_URL_UI_STATE_KEY]
  const pdfUiFileUrl = isFileOrDataUrl(pdfUiFileUrlRaw) ? String(pdfUiFileUrlRaw ?? '') : ''
  const pdfFileUrl = pdfUiFileUrl || persistedPdfFileUrl
  const [pdfDoc, setPdfDoc] = useState<any | null>(null)
  const pdfDocRef = useRef<any | null>(null)
  const pdfLoadTaskRef = useRef<any | null>(null)
  const pdfTokenRef = useRef<string | null>(null)
  const lastReloadAtRef = useRef(0)

  const reload = async () => {
    const now = Date.now()
    if (now - lastReloadAtRef.current < 200) return
    lastReloadAtRef.current = now
    try {
      const loaded = await getKv<unknown>(notesKvKey)
      if (isPersistedAnnotationBookV2(loaded)) setPages(loaded.pages)
      else if (isPersistedAnnotationDocV1(loaded)) setPages([loaded])
      else setPages([])
    } catch {
      setPages([])
    }

    try {
      const loaded = await getKv<unknown>(WHITEBOARD_CANVAS_PAGES_KV_KEY)
      if (isWhiteboardCanvasBookV1(loaded)) setCanvasPages(loaded.pages)
      else setCanvasPages([])
    } catch {
      setCanvasPages([])
    }

    try {
      const loaded = await getKv<unknown>(VIDEO_SHOW_PAGES_KV_KEY)
      if (isVideoShowPageBookV1(loaded)) setVideoPages(normalizeVideoShowPhotoPages(loaded.pages, Math.max(0, total - 1)))
      else setVideoPages([])
    } catch {
      setVideoPages([])
    }

    try {
      const bgColor = await getKv<unknown>(WHITEBOARD_BG_COLOR_KV_KEY)
      const bgImageUrl = await getKv<unknown>(WHITEBOARD_BG_IMAGE_URL_KV_KEY)
      const bgImageOpacity = await getKv<unknown>(WHITEBOARD_BG_IMAGE_OPACITY_KV_KEY)
      setDefaultBg({
        color: isHexColor(bgColor) ? bgColor : '#ffffff',
        imageUrl: isFileOrDataUrl(bgImageUrl) ? bgImageUrl : '',
        imageOpacity:
          typeof bgImageOpacity === 'number'
            ? Math.max(0, Math.min(1, bgImageOpacity))
            : typeof bgImageOpacity === 'string' && Number.isFinite(Number(bgImageOpacity))
              ? Math.max(0, Math.min(1, Number(bgImageOpacity)))
              : 0.5
      })
    } catch {
      setDefaultBg({ color: '#ffffff', imageUrl: '', imageOpacity: 0.5 })
    }

    if (appMode === 'pdf' && !pdfUiFileUrl) {
      try {
        const loaded = await getKv<unknown>(PDF_FILE_URL_KV_KEY)
        setPersistedPdfFileUrl(isFileOrDataUrl(loaded) ? String(loaded ?? '') : '')
      } catch {
        setPersistedPdfFileUrl('')
      }
    }
  }

  useEffect(() => {
    void reload()
  }, [notesKvKey, total, appMode, pdfUiFileUrl])

  useEffect(() => {
    const latest = events[events.length - 1]
    if (!latest) return
    if (latest.type !== 'KV_PUT') return
    const key = (latest.payload as any)?.key
    if (
      typeof key !== 'string' ||
      (key !== notesKvKey &&
        key !== WHITEBOARD_CANVAS_PAGES_KV_KEY &&
        key !== VIDEO_SHOW_PAGES_KV_KEY &&
        key !== PDF_FILE_URL_KV_KEY &&
        key !== WHITEBOARD_BG_COLOR_KV_KEY &&
        key !== WHITEBOARD_BG_IMAGE_URL_KV_KEY &&
        key !== WHITEBOARD_BG_IMAGE_OPACITY_KV_KEY)
    )
      return
    void reload()
  }, [events, notesKvKey])

  useEffect(() => {
    let cancelled = false
    const last = pdfDocRef.current
    pdfDocRef.current = null
    setPdfDoc(null)
    if (pdfLoadTaskRef.current) {
      try {
        pdfLoadTaskRef.current.destroy?.()
      } catch {}
      pdfLoadTaskRef.current = null
    }
    if (last) {
      try {
        last.destroy?.()
      } catch {}
    }
    const lastToken = pdfTokenRef.current
    pdfTokenRef.current = null
    if (lastToken) {
      window.lanstart?.apiRequest({ method: 'POST', path: '/pdf/close', body: { token: lastToken } }).catch(() => undefined)
    }
    if (appMode !== 'pdf') return
    if (!pdfFileUrl) return

    void (async () => {
      let token: string | null = null
      try {
        const pdfjs = await loadPdfjs()
        const openRes = await window.lanstart?.apiRequest({ method: 'POST', path: '/pdf/open', body: { fileUrl: pdfFileUrl } })
        const openBody = (openRes as any)?.body as any
        if ((openRes as any)?.status !== 200 || openBody?.ok !== true) throw new Error(String(openBody?.error ?? 'PDF_OPEN_FAILED'))
        token = typeof openBody?.token === 'string' ? openBody.token : ''
        const size = Number(openBody?.size ?? 0)
        if (!token || !Number.isFinite(size) || size <= 0) throw new Error('PDF_OPEN_FAILED')
        pdfTokenRef.current = token

        const data = new Uint8Array(size)
        const chunkLen = 512 * 1024
        let offset = 0
        while (offset < size) {
          if (cancelled) return
          const url = `/pdf/chunk/${encodeURIComponent(token)}?offset=${offset}&length=${chunkLen}`
          const res = await window.lanstart?.apiRequest({ method: 'GET', path: url })
          const body = (res as any)?.body as any
          if ((res as any)?.status !== 200 || body?.ok !== true) throw new Error(String(body?.error ?? 'PDF_CHUNK_FAILED'))
          const base64 = typeof body?.base64 === 'string' ? body.base64 : ''
          const bytesRead = Number(body?.length ?? 0)
          if (!base64 || !Number.isFinite(bytesRead) || bytesRead <= 0) throw new Error('PDF_CHUNK_FAILED')
          const chunk = base64ToU8(base64)
          data.set(chunk, offset)
          offset += bytesRead
        }

        const task = (pdfjs as any).getDocument({ data, length: size })
        pdfLoadTaskRef.current = task
        const doc = await task.promise
        if (cancelled) {
          try {
            doc.destroy?.()
          } catch {}
          return
        }
        pdfDocRef.current = doc
        setPdfDoc(doc)
      } catch {
        return
      } finally {
        if (token) {
          window.lanstart?.apiRequest({ method: 'POST', path: '/pdf/close', body: { token } }).catch(() => undefined)
          if (pdfTokenRef.current === token) pdfTokenRef.current = null
        }
        pdfLoadTaskRef.current = null
      }
    })()

    return () => {
      cancelled = true
      const d = pdfDocRef.current
      pdfDocRef.current = null
      if (d) {
        try {
          d.destroy?.()
        } catch {}
      }
      if (pdfLoadTaskRef.current) {
        try {
          pdfLoadTaskRef.current.destroy?.()
        } catch {}
        pdfLoadTaskRef.current = null
      }
    }
  }, [appMode, pdfFileUrl])

  const effectivePages = useMemo(() => {
    const src = pages.length ? pages : new Array(total).fill(null).map(() => ({ version: 1 as const, nodes: [] }))
    if (src.length >= total) return src.slice(0, total)
    return [...src, ...new Array(total - src.length).fill(null).map(() => ({ version: 1 as const, nodes: [] }))]
  }, [pages, total])

  const pageWindow = useMemo(() => {
    const maxThumbs = 120
    const t = Math.max(0, total)
    if (t <= maxThumbs) return { start: 0, end: t }
    const half = Math.floor(maxThumbs / 2)
    let start = Math.max(0, Math.floor(index) - half)
    let end = start + maxThumbs
    if (end > t) {
      end = t
      start = Math.max(0, end - maxThumbs)
    }
    return { start, end }
  }, [index, total])

  const windowedPages = useMemo(
    () => effectivePages.slice(pageWindow.start, pageWindow.end),
    [effectivePages, pageWindow.end, pageWindow.start]
  )

  const effectiveCanvasPages = useMemo(() => {
    const src = canvasPages.length ? canvasPages : new Array(total).fill(null).map(() => ({} as WhiteboardCanvasPageV1))
    if (src.length >= total) return src.slice(0, total)
    return [...src, ...new Array(total - src.length).fill(null).map(() => ({} as WhiteboardCanvasPageV1))]
  }, [canvasPages, total])

  const effectiveVideoPages = useMemo(() => {
    const photoTotal = Math.max(0, total - 1)
    const src = videoPages.length ? videoPages : new Array(photoTotal).fill(null).map(() => ({} as VideoShowPageV1))
    if (src.length >= photoTotal) return src.slice(0, photoTotal)
    return [...src, ...new Array(photoTotal - src.length).fill(null).map(() => ({} as VideoShowPageV1))]
  }, [videoPages, total])

  return (
    <div style={{ width: '100%', height: '100%', padding: 10, boxSizing: 'border-box', background: 'transparent' }}>
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'row', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {appMode === 'video-show' ? (
            <div className="subwindowRoot" style={{ width: '100%', height: 'auto', boxShadow: 'none' }}>
              <div
                style={{
                  position: 'relative',
                  zIndex: 2,
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: 12
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, opacity: 0.9 }}>视频源</div>
                  <select
                    value={videoSource === 'phone-webrtc' ? '__phone_webrtc__' : typeof videoDeviceIdRaw === 'string' ? videoDeviceIdRaw : ''}
                    onChange={(e) => {
                      const v = String(e.target.value || '')
                      if (!v) return
                      if (v === '__phone_webrtc__') {
                        bus.setKey(VIDEO_SHOW_SOURCE_UI_STATE_KEY, 'phone-webrtc').catch(() => undefined)
                        ensureWebrtcSession().catch(() => undefined)
                        return
                      }
                      bus.setKey(VIDEO_SHOW_SOURCE_UI_STATE_KEY, 'camera').catch(() => undefined)
                      bus.setKey(VIDEO_SHOW_DEVICE_ID_UI_STATE_KEY, v).catch(() => undefined)
                    }}
                    style={{
                      height: 30,
                      borderRadius: 10,
                      border: '1px solid rgba(0,0,0,0.16)',
                      background: 'rgba(0,0,0,0.22)',
                      color: 'rgba(255,255,255,0.92)',
                      padding: '0 10px',
                      outline: 'none',
                      maxWidth: '100%'
                    }}
                  >
                    <option value="__phone_webrtc__">手机摄像头（扫码添加）</option>
                    {videoDevices.length
                      ? videoDevices.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label}
                          </option>
                        ))
                      : null}
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: '0 0 160px' }}>
                  <div style={{ fontSize: 11, opacity: 0.9 }}>清晰度</div>
                  <select
                    value={String(videoQualityIdx)}
                    onChange={(e) => {
                      const v = String(e.target.value || '0')
                      bus.setKey(VIDEO_SHOW_QUALITY_UI_STATE_KEY, v).catch(() => undefined)
                    }}
                    style={{
                      height: 30,
                      borderRadius: 10,
                      border: '1px solid rgba(0,0,0,0.16)',
                      background: 'rgba(0,0,0,0.22)',
                      color: 'rgba(255,255,255,0.92)',
                      padding: '0 10px',
                      outline: 'none',
                      maxWidth: '100%'
                    }}
                  >
                    <option value="0">最高（{videoQualityPresets.heights[0]}p）</option>
                    <option value="1">中等（{videoQualityPresets.heights[1]}p）</option>
                    <option value="2">流畅（{videoQualityPresets.heights[2]}p）</option>
                  </select>
                </div>
              </div>
            </div>
          ) : null}

          <div className="subwindowRoot" style={{ width: '100%', flex: 1, minHeight: 0, boxShadow: 'none' }}>
          <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 650 }}>页面缩略图查看菜单</div>
              <Button size="sm" kind="text" ariaLabel="关闭" title="关闭" onClick={() => postCommand('app.togglePageThumbnailsMenu').catch(() => undefined)}>
                关闭
              </Button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12, paddingTop: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                {appMode === 'video-show'
                  ? [
                      <VideoShowThumbnailItem
                        key="live"
                        pageIndex={0}
                        selected={index === 0}
                        name="Live"
                        imageUrl={liveThumbUrl}
                        onPick={() => {
                          postCommand('app.setPageIndex', { index: 0 }).catch(() => undefined)
                          postCommand('app.togglePageThumbnailsMenu').catch(() => undefined)
                        }}
                      />,
                      ...effectiveVideoPages.map((p, photoIdx) => {
                        const pageIndex = photoIdx + 1
                        const frozenUrl = isFileOrDataUrl(p?.imageUrl) ? String(p?.imageUrl ?? '') : ''
                        const name = typeof p?.name === 'string' ? String(p?.name ?? '') : `第${pageIndex}页`
                        const createdAt =
                          typeof p?.createdAt === 'number' ? p.createdAt : typeof p?.createdAt === 'string' ? Number(p.createdAt) : 0
                        return (
                          <VideoShowThumbnailItem
                            key={`${pageIndex}-${Number.isFinite(createdAt) ? Math.floor(createdAt) : 0}`}
                            pageIndex={pageIndex}
                            selected={pageIndex === index}
                            name={name}
                            imageUrl={frozenUrl}
                            onPick={() => {
                              postCommand('app.setPageIndex', { index: pageIndex }).catch(() => undefined)
                              postCommand('app.togglePageThumbnailsMenu').catch(() => undefined)
                            }}
                          />
                        )
                      })
                    ]
                  : appMode === 'pdf'
                    ? windowedPages.map((doc, j) => {
                        const i = pageWindow.start + j
                        return (
                          <PdfThumbnailItem
                            key={i}
                            index={i}
                            selected={i === index}
                            doc={doc ?? null}
                            pdfDoc={pdfDoc}
                            onPick={() => {
                              postCommand('app.setPageIndex', { index: i }).catch(() => undefined)
                              postCommand('app.togglePageThumbnailsMenu').catch(() => undefined)
                            }}
                          />
                        )
                      })
                    : windowedPages.map((doc, j) => {
                        const i = pageWindow.start + j
                        return (
                          <PageThumbnailItem
                            key={i}
                            index={i}
                            selected={i === index}
                            doc={doc ?? null}
                            bgColor={effectiveCanvasPages[i]?.bgColor ?? defaultBg.color}
                            bgImageUrl={effectiveCanvasPages[i]?.bgImageUrl ?? defaultBg.imageUrl}
                            bgImageOpacity={effectiveCanvasPages[i]?.bgImageOpacity ?? defaultBg.imageOpacity}
                            onPick={() => {
                              postCommand('app.setPageIndex', { index: i }).catch(() => undefined)
                              postCommand('app.togglePageThumbnailsMenu').catch(() => undefined)
                            }}
                          />
                        )
                      })}
              </div>
            </div>
          </div>
        </div>
        </div>

        {appMode === 'video-show' ? (
          <div className="subwindowRoot" style={{ width: 240, height: '100%', boxShadow: 'none' }}>
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 12,
                boxSizing: 'border-box'
              }}
            >
                <div
                  style={{
                    position: 'relative',
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 34
                  }}
                >
                  <div style={{ fontSize: 16, fontWeight: 700, opacity: 0.95 }}>扫码连接手机摄像头</div>
                </div>

                {phoneConnectCollapsed ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
                    <div style={{ fontSize: 11, opacity: 0.76, wordBreak: 'break-all' }}>
                      会话：{webrtcSessionId || '-'} {webrtcStatus ? `（${webrtcStatus}）` : ''}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <Button
                        size="sm"
                        kind="text"
                        ariaLabel="复制链接"
                        title="复制链接"
                        appRegion="no-drag"
                        onClick={() => {
                          if (!phoneCastUrl) return
                          window.lanstart?.clipboardWriteText?.(phoneCastUrl).catch(() => undefined)
                          navigator.clipboard?.writeText?.(phoneCastUrl).catch(() => undefined)
                        }}
                      >
                        复制链接
                      </Button>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <Button
                        size="sm"
                        kind="custom"
                        ariaLabel="展开连接信息"
                        title="展开"
                        appRegion="no-drag"
                        onClick={() => setPhoneConnectCollapsed(false)}
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 14,
                          padding: 0,
                          background: 'rgba(255,255,255,0.08)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          color: 'rgba(255,255,255,0.86)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <span style={{ fontSize: 14, lineHeight: 1, fontWeight: 900 }}>▾</span>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {phoneQrDataUrl ? (
                          <img
                            src={phoneQrDataUrl}
                            style={{
                              width: 180,
                              height: 180,
                              borderRadius: 12,
                              background: '#fff',
                              padding: 8,
                              boxSizing: 'border-box',
                              display: 'block'
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 180,
                              height: 180,
                              borderRadius: 12,
                              background: 'rgba(255,255,255,0.06)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 12,
                              opacity: 0.8
                            }}
                          >
                            正在生成二维码…
                          </div>
                        )}
                      </div>
                      
                      <div style={{ position: 'absolute', right: 0, top: 0 }}>
                        <Button
                          size="sm"
                          kind="custom"
                          ariaLabel="折叠连接信息"
                          title="折叠"
                          appRegion="no-drag"
                          onClick={() => setPhoneConnectCollapsed(true)}
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 14,
                            padding: 0,
                            background: 'rgba(255,255,255,0.08)',
                            border: '1px solid rgba(255,255,255,0.12)',
                            color: 'rgba(255,255,255,0.86)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          <span style={{ fontSize: 14, lineHeight: 1, fontWeight: 900 }}>▴</span>
                        </Button>
                      </div>
                    </div>

                    <div style={{ fontSize: 11, opacity: 0.76, textAlign: 'center', wordBreak: 'break-all' }}>
                      会话：{webrtcSessionId || '-'} {webrtcStatus ? `（${webrtcStatus}）` : ''}
                    </div>

                    <div style={{ fontSize: 11, opacity: 0.86, wordBreak: 'break-all', textAlign: 'center' }}>
                      {phoneCastUrl || '正在生成投屏链接…'}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                      <Button
                        size="sm"
                        kind="custom"
                        ariaLabel="复制链接"
                        title="复制链接"
                        appRegion="no-drag"
                        onClick={() => {
                          if (!phoneCastUrl) return
                          window.lanstart?.clipboardWriteText?.(phoneCastUrl).catch(() => undefined)
                          navigator.clipboard?.writeText?.(phoneCastUrl).catch(() => undefined)
                        }}
                        style={{
                          width: '100%',
                          height: 42,
                          borderRadius: 14,
                          padding: '0 12px',
                          background: 'var(--ls-accent-gradient, var(--ls-accent-primary, #3b82f6))',
                          border: '1px solid rgba(255,255,255,0.2)',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15), 0 0 0 2px var(--ls-accent-light, rgba(59, 130, 246, 0.15))',
                          color: '#fff',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 14,
                          fontWeight: 600
                        }}
                      >
                        复制链接
                      </Button>

                      <Button
                        size="sm"
                        kind="custom"
                        ariaLabel="重新生成"
                        title="重新生成"
                        appRegion="no-drag"
                        onClick={() => {
                          bus.deleteKey(VIDEO_SHOW_WEBRTC_SESSION_ID_UI_STATE_KEY).catch(() => undefined)
                          setCastInfo(null)
                          ensureWebrtcSession().catch(() => undefined)
                        }}
                        style={{
                          width: '100%',
                          height: 42,
                          borderRadius: 14,
                          padding: '0 12px',
                          background: 'rgba(255,255,255,0.08)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                          color: 'var(--ls-surface-fg, rgba(255,255,255,0.9))',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 14,
                          fontWeight: 500
                        }}
                      >
                        重新生成
                      </Button>
                    </div>
                  </>
                )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
