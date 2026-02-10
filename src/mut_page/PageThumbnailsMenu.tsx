import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  APP_MODE_UI_STATE_KEY,
  NOTES_PAGE_INDEX_UI_STATE_KEY,
  NOTES_PAGE_TOTAL_UI_STATE_KEY,
  UI_STATE_APP_WINDOW_ID,
  WHITEBOARD_BG_COLOR_KV_KEY,
  WHITEBOARD_BG_IMAGE_URL_KV_KEY,
  WHITEBOARD_BG_IMAGE_OPACITY_KV_KEY,
  WHITEBOARD_CANVAS_PAGES_KV_KEY,
  getKv,
  isFileOrDataUrl,
  isAppMode,
  isHexColor,
  postCommand,
  useUiStateBus
} from '../status'
import { Button } from '../button'
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

export function PageThumbnailsMenuWindow() {
  useZoomOnWheel()
  const bus = useUiStateBus(UI_STATE_APP_WINDOW_ID)
  const events = useEventsPoll(900)

  const appModeRaw = bus.state[APP_MODE_UI_STATE_KEY]
  const appMode = isAppMode(appModeRaw) ? appModeRaw : 'toolbar'

  const pageIndexRaw = bus.state[NOTES_PAGE_INDEX_UI_STATE_KEY]
  const pageTotalRaw = bus.state[NOTES_PAGE_TOTAL_UI_STATE_KEY]

  const { index, total } = useMemo(() => {
    const totalV = typeof pageTotalRaw === 'number' ? pageTotalRaw : typeof pageTotalRaw === 'string' ? Number(pageTotalRaw) : 1
    const indexV = typeof pageIndexRaw === 'number' ? pageIndexRaw : typeof pageIndexRaw === 'string' ? Number(pageIndexRaw) : 0
    const t = Number.isFinite(totalV) ? Math.max(1, Math.floor(totalV)) : 1
    const i = Number.isFinite(indexV) ? Math.max(0, Math.min(t - 1, Math.floor(indexV))) : 0
    return { index: i, total: t }
  }, [pageIndexRaw, pageTotalRaw])

  const notesKvKey = appMode === 'whiteboard' || appMode === 'video-show' ? 'annotation-notes-whiteboard' : 'annotation-notes-toolbar'

  const [pages, setPages] = useState<PersistedAnnotationDocV1[]>([])
  const [canvasPages, setCanvasPages] = useState<WhiteboardCanvasPageV1[]>([])
  const [defaultBg, setDefaultBg] = useState<{ color: string; imageUrl: string; imageOpacity: number }>({ color: '#ffffff', imageUrl: '', imageOpacity: 0.5 })
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
  }

  useEffect(() => {
    void reload()
  }, [notesKvKey])

  useEffect(() => {
    const latest = events[events.length - 1]
    if (!latest) return
    if (latest.type !== 'KV_PUT') return
    const key = (latest.payload as any)?.key
    if (
      typeof key !== 'string' ||
      (key !== notesKvKey &&
        key !== WHITEBOARD_CANVAS_PAGES_KV_KEY &&
        key !== WHITEBOARD_BG_COLOR_KV_KEY &&
        key !== WHITEBOARD_BG_IMAGE_URL_KV_KEY &&
        key !== WHITEBOARD_BG_IMAGE_OPACITY_KV_KEY)
    )
      return
    void reload()
  }, [events, notesKvKey])

  const effectivePages = useMemo(() => {
    const src = pages.length ? pages : new Array(total).fill(null).map(() => ({ version: 1 as const, nodes: [] }))
    if (src.length >= total) return src.slice(0, total)
    return [...src, ...new Array(total - src.length).fill(null).map(() => ({ version: 1 as const, nodes: [] }))]
  }, [pages, total])

  const effectiveCanvasPages = useMemo(() => {
    const src = canvasPages.length ? canvasPages : new Array(total).fill(null).map(() => ({} as WhiteboardCanvasPageV1))
    if (src.length >= total) return src.slice(0, total)
    return [...src, ...new Array(total - src.length).fill(null).map(() => ({} as WhiteboardCanvasPageV1))]
  }, [canvasPages, total])

  return (
    <div style={{ width: '100%', height: '100%', padding: 10, boxSizing: 'border-box', background: 'transparent' }}>
      <div className="subwindowRoot" style={{ width: '100%', height: '100%', boxShadow: 'none' }}>
        <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 650 }}>页面缩略图查看菜单</div>
            <Button size="sm" kind="text" ariaLabel="关闭" title="关闭" onClick={() => postCommand('app.togglePageThumbnailsMenu').catch(() => undefined)}>
              关闭
            </Button>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12, paddingTop: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              {effectivePages.map((doc, i) => (
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
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
