import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Leafer, Line, Polygon } from 'leafer-ui'
import { getStroke } from 'perfect-freehand'
import {
  APP_MODE_UI_STATE_KEY,
  CLEAR_PAGE_REV_UI_STATE_KEY,
  ERASER_THICKNESS_UI_STATE_KEY,
  ERASER_TYPE_UI_STATE_KEY,
  LEAFER_SETTINGS_KV_KEY,
  LEAFER_SETTINGS_UI_STATE_KEY,
  NOTES_PAGE_INDEX_UI_STATE_KEY,
  NOTES_PAGE_TOTAL_UI_STATE_KEY,
  NOTES_RELOAD_REV_UI_STATE_KEY,
  PEN_COLOR_UI_STATE_KEY,
  PEN_THICKNESS_UI_STATE_KEY,
  PEN_TYPE_UI_STATE_KEY,
  REDO_REV_UI_STATE_KEY,
  TOOL_UI_STATE_KEY,
  UNDO_REV_UI_STATE_KEY,
  UI_STATE_APP_WINDOW_ID,
  VIDEO_SHOW_VIEW_UI_STATE_KEY,
  getKv,
  putKv,
  putUiStateKey,
  isLeaferSettings,
  postCommand,
  type LeaferSettings,
  type VideoShowViewTransform,
  useUiStateBus
} from '../../status'

type LineRole = 'stroke' | 'eraserPixel'

type LineMeta = {
  role: LineRole
  groupId?: number
  strokeWidth: number
  points: number[]
  minX: number
  minY: number
  maxX: number
  maxY: number
  transient?: boolean
}

type PersistedAnnotationNodeV1 = {
  role: LineRole
  groupId?: number
  strokeWidth: number
  points: number[]
  color?: string
  opacity?: number
  pfh?: boolean
}

type PersistedAnnotationDocV1 = { version: 1; nodes: PersistedAnnotationNodeV1[] }

type PersistedAnnotationBookV2 = { version: 2; currentPage: number; pages: PersistedAnnotationDocV1[] }

const rotatedNotesKvKeys = new Set<string>()

function isPersistedAnnotationDocV1(v: unknown): v is PersistedAnnotationDocV1 {
  if (!v || typeof v !== 'object') return false
  const d = v as any
  if (d.version !== 1) return false
  if (!Array.isArray(d.nodes)) return false
  for (const n of d.nodes) {
    if (!n || typeof n !== 'object') return false
    if (n.role !== 'stroke' && n.role !== 'eraserPixel') return false
    if (typeof n.strokeWidth !== 'number' || !Number.isFinite(n.strokeWidth)) return false
    if (!Array.isArray(n.points)) return false
    for (const p of n.points) if (typeof p !== 'number' || !Number.isFinite(p)) return false
    if (n.color !== undefined && typeof n.color !== 'string') return false
    if (n.opacity !== undefined && (typeof n.opacity !== 'number' || !Number.isFinite(n.opacity))) return false
    if (n.pfh !== undefined && typeof n.pfh !== 'boolean') return false
    if (n.groupId !== undefined && (typeof n.groupId !== 'number' || !Number.isFinite(n.groupId))) return false
  }
  return true
}

function isPersistedAnnotationBookV2(v: unknown): v is PersistedAnnotationBookV2 {
  if (!v || typeof v !== 'object') return false
  const b = v as any
  if (b.version !== 2) return false
  if (!Array.isArray(b.pages)) return false
  const currentPage = Number(b.currentPage)
  if (!Number.isFinite(currentPage)) return false
  for (const p of b.pages) {
    if (!isPersistedAnnotationDocV1(p)) return false
  }
  return true
}

function createEmptyDocV1(): PersistedAnnotationDocV1 {
  return { version: 1, nodes: [] }
}

function updateBounds(meta: LineMeta, x: number, y: number): void {
  if (x < meta.minX) meta.minX = x
  if (y < meta.minY) meta.minY = y
  if (x > meta.maxX) meta.maxX = x
  if (y > meta.maxY) meta.maxY = y
}

function recomputeBounds(meta: LineMeta, points: number[]): void {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i]
    const y = points[i + 1]
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return
  meta.minX = minX
  meta.minY = minY
  meta.maxX = maxX
  meta.maxY = maxY
}

function distSqPointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const abLenSq = abx * abx + aby * aby
  if (abLenSq <= 1e-9) return apx * apx + apy * apy
  let t = (apx * abx + apy * aby) / abLenSq
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const cx = ax + t * abx
  const cy = ay + t * aby
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy
}

function hitsLineAtPoint(meta: LineMeta, x: number, y: number, radius: number): boolean {
  const pad = radius + meta.strokeWidth * 0.5
  if (x < meta.minX - pad || x > meta.maxX + pad || y < meta.minY - pad || y > meta.maxY + pad) return false
  const r2 = pad * pad
  const pts = meta.points
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i]
    const ay = pts[i + 1]
    const bx = pts[i + 2]
    const by = pts[i + 3]
    if (distSqPointToSegment(x, y, ax, ay, bx, by) <= r2) return true
  }
  return false
}

function pointsToPerfectFreehandInput(points: number[], scale = 1): number[][] {
  const out: number[][] = []
  for (let i = 0; i + 1 < points.length; i += 2) out.push([points[i] * scale, points[i + 1] * scale])
  return out
}

const DEFAULT_LEAFER_SETTINGS: LeaferSettings = {
  multiTouch: false,
  inkSmoothing: true,
  showInkWhenPassthrough: true,
  freezeScreen: false,
  rendererEngine: 'canvas2d',
  nibMode: 'off',
  postBakeOptimize: false,
  postBakeOptimizeOnce: false
}

export function AnnotationOverlayApp() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const bus = useUiStateBus(UI_STATE_APP_WINDOW_ID)
  const setUiStateKeyRef = useRef(bus.setKey)

  useEffect(() => {
    setUiStateKeyRef.current = bus.setKey
  }, [bus.setKey])

  const tool = bus.state[TOOL_UI_STATE_KEY] === 'pen' ? 'pen' : bus.state[TOOL_UI_STATE_KEY] === 'eraser' ? 'eraser' : 'mouse'
  const penType = bus.state[PEN_TYPE_UI_STATE_KEY] === 'highlighter' ? 'highlighter' : bus.state[PEN_TYPE_UI_STATE_KEY] === 'laser' ? 'laser' : 'writing'
  const penColor = typeof bus.state[PEN_COLOR_UI_STATE_KEY] === 'string' ? (bus.state[PEN_COLOR_UI_STATE_KEY] as string) : '#333333'
  const penThickness = typeof bus.state[PEN_THICKNESS_UI_STATE_KEY] === 'number' ? (bus.state[PEN_THICKNESS_UI_STATE_KEY] as number) : 6
  const eraserThickness = typeof bus.state[ERASER_THICKNESS_UI_STATE_KEY] === 'number' ? (bus.state[ERASER_THICKNESS_UI_STATE_KEY] as number) : 18
  const eraserType = bus.state[ERASER_TYPE_UI_STATE_KEY] === 'stroke' ? 'stroke' : 'pixel'

  const effectiveStroke = useMemo(() => {
    const common = { curve: true as const, strokeCap: 'round', strokeJoin: 'round' }
    if (tool === 'eraser') return { ...common, stroke: '#000000', strokeWidth: eraserThickness, blendMode: 'destination-out' as const }
    if (penType === 'highlighter') return { ...common, stroke: penColor, strokeWidth: penThickness, opacity: 0.28 }
    if (penType === 'laser') return { ...common, stroke: penColor, strokeWidth: Math.max(1, Math.min(60, penThickness)), opacity: 0.9 }
    return { ...common, stroke: penColor, strokeWidth: penThickness, opacity: 1 }
  }, [eraserThickness, penColor, penThickness, penType, tool])

  const toolRef = useRef(tool)
  const penTypeRef = useRef(penType)
  const effectiveStrokeRef = useRef(effectiveStroke)
  const eraserTypeRef = useRef(eraserType)
  const eraserThicknessRef = useRef(eraserThickness)
  const multiTouchRef = useRef(DEFAULT_LEAFER_SETTINGS.multiTouch)
  const inkSmoothingRef = useRef(DEFAULT_LEAFER_SETTINGS.inkSmoothing)
  const nibModeRef = useRef(DEFAULT_LEAFER_SETTINGS.nibMode ?? 'off')
  const postBakeOptimizeRef = useRef(DEFAULT_LEAFER_SETTINGS.postBakeOptimize ?? false)
  const postBakeOptimizeOnceRef = useRef(DEFAULT_LEAFER_SETTINGS.postBakeOptimizeOnce ?? false)
  const apiRef = useRef<
    | null
    | { undo: () => void; redo: () => void; clear: () => void; setPage: (index: number, total: number) => void; reloadNotes?: () => void }
  >(null)
  const lastUndoRevRef = useRef<number | null>(null)
  const lastRedoRevRef = useRef<number | null>(null)
  const lastClearRevRef = useRef<number | null>(null)
  const lastNotesReloadRevRef = useRef<number | null>(null)
  const leaferSettingsRef = useRef<LeaferSettings>(DEFAULT_LEAFER_SETTINGS)

  const [leaferSettings, setLeaferSettings] = useState<LeaferSettings>(DEFAULT_LEAFER_SETTINGS)
  const [frozenBackgroundUrl, setFrozenBackgroundUrl] = useState('')

  const leaferSettingsRevRaw = bus.state[LEAFER_SETTINGS_UI_STATE_KEY]
  const leaferSettingsRev =
    typeof leaferSettingsRevRaw === 'number'
      ? leaferSettingsRevRaw
      : typeof leaferSettingsRevRaw === 'string'
        ? Number(leaferSettingsRevRaw)
        : 0

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const loaded = await getKv<unknown>(LEAFER_SETTINGS_KV_KEY)
        if (cancelled) return
        if (!isLeaferSettings(loaded)) return
        setLeaferSettings(loaded)
      } catch {
        return
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leaferSettingsRev])

  useEffect(() => {
    leaferSettingsRef.current = leaferSettings
  }, [leaferSettings])

  useEffect(() => {
    multiTouchRef.current = leaferSettings.multiTouch
  }, [leaferSettings.multiTouch])

  useEffect(() => {
    inkSmoothingRef.current = leaferSettings.inkSmoothing
  }, [leaferSettings.inkSmoothing])

  useEffect(() => {
    nibModeRef.current = leaferSettings.nibMode ?? 'off'
  }, [leaferSettings.nibMode])

  useEffect(() => {
    postBakeOptimizeRef.current = leaferSettings.postBakeOptimize ?? false
  }, [leaferSettings.postBakeOptimize])

  useEffect(() => {
    postBakeOptimizeOnceRef.current = leaferSettings.postBakeOptimizeOnce ?? false
  }, [leaferSettings.postBakeOptimizeOnce])

  useEffect(() => {
    toolRef.current = tool
  }, [tool])

  useEffect(() => {
    penTypeRef.current = penType
  }, [penType])

  useEffect(() => {
    effectiveStrokeRef.current = effectiveStroke
  }, [effectiveStroke])

  useEffect(() => {
    eraserTypeRef.current = eraserType
  }, [eraserType])

  useEffect(() => {
    eraserThicknessRef.current = eraserThickness
  }, [eraserThickness])

  const appModeRaw = bus.state[APP_MODE_UI_STATE_KEY]
  const appMode =
    appModeRaw === 'whiteboard' ? 'whiteboard' : appModeRaw === 'video-show' ? 'video-show' : appModeRaw === 'pdf' ? 'pdf' : 'toolbar'
  const isWhiteboardLike = appMode === 'whiteboard' || appMode === 'video-show' || appMode === 'pdf'
  const shouldFreezeScreen = appMode === 'toolbar' && tool !== 'mouse' && leaferSettings.freezeScreen
  const rendererEngine = leaferSettings.rendererEngine ?? 'canvas2d'

  useEffect(() => {
    void postCommand('win.setAnnotationInput', { enabled: isWhiteboardLike ? true : tool !== 'mouse' })
  }, [tool, isWhiteboardLike])

  useEffect(() => {
    if (!shouldFreezeScreen) {
      setFrozenBackgroundUrl('')
      return
    }
    const api = window.hyperGlass
    if (!api) return
    let cancelled = false
    ;(async () => {
      try {
        const maxSide = Math.max(512, Math.min(4096, Math.max(Math.floor(globalThis.outerWidth), Math.floor(globalThis.outerHeight))))
        const shot = await api.captureDisplayThumbnail({ maxSide })
        if (cancelled) return
        setFrozenBackgroundUrl(shot.dataUrl)
      } catch {
        return
      }
    })()
    return () => {
      cancelled = true
    }
  }, [shouldFreezeScreen])

  const undoRevRaw = bus.state[UNDO_REV_UI_STATE_KEY]
  const redoRevRaw = bus.state[REDO_REV_UI_STATE_KEY]
  const clearRevRaw = bus.state[CLEAR_PAGE_REV_UI_STATE_KEY]
  const notesReloadRevRaw = bus.state[NOTES_RELOAD_REV_UI_STATE_KEY]
  const undoRev = typeof undoRevRaw === 'number' ? undoRevRaw : typeof undoRevRaw === 'string' ? Number(undoRevRaw) : 0
  const redoRev = typeof redoRevRaw === 'number' ? redoRevRaw : typeof redoRevRaw === 'string' ? Number(redoRevRaw) : 0
  const clearRev = typeof clearRevRaw === 'number' ? clearRevRaw : typeof clearRevRaw === 'string' ? Number(clearRevRaw) : 0
  const notesReloadRev = typeof notesReloadRevRaw === 'number' ? notesReloadRevRaw : typeof notesReloadRevRaw === 'string' ? Number(notesReloadRevRaw) : 0

  useEffect(() => {
    if (!apiRef.current) return
    if (lastUndoRevRef.current === null) {
      lastUndoRevRef.current = undoRev
      return
    }
    if (!undoRev || undoRev === lastUndoRevRef.current) return
    lastUndoRevRef.current = undoRev
    apiRef.current.undo()
  }, [undoRev])

  useEffect(() => {
    if (!apiRef.current) return
    if (lastRedoRevRef.current === null) {
      lastRedoRevRef.current = redoRev
      return
    }
    if (!redoRev || redoRev === lastRedoRevRef.current) return
    lastRedoRevRef.current = redoRev
    apiRef.current.redo()
  }, [redoRev])

  useEffect(() => {
    if (!apiRef.current) return
    if (lastClearRevRef.current === null) {
      lastClearRevRef.current = clearRev
      return
    }
    if (!clearRev || clearRev === lastClearRevRef.current) return
    lastClearRevRef.current = clearRev
    apiRef.current.clear()
  }, [clearRev])

  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    if (lastNotesReloadRevRef.current === null) {
      lastNotesReloadRevRef.current = notesReloadRev
      return
    }
    if (!notesReloadRev || notesReloadRev === lastNotesReloadRevRef.current) return
    lastNotesReloadRevRef.current = notesReloadRev
    api.reloadNotes?.()
  }, [notesReloadRev])

  const notesPageIndexRaw = bus.state[NOTES_PAGE_INDEX_UI_STATE_KEY]
  const notesPageTotalRaw = bus.state[NOTES_PAGE_TOTAL_UI_STATE_KEY]
  const notesPageIndex = typeof notesPageIndexRaw === 'number' ? notesPageIndexRaw : typeof notesPageIndexRaw === 'string' ? Number(notesPageIndexRaw) : 0
  const notesPageTotal = typeof notesPageTotalRaw === 'number' ? notesPageTotalRaw : typeof notesPageTotalRaw === 'string' ? Number(notesPageTotalRaw) : 1
  const lastNotesPageIndexRef = useRef<number | null>(null)
  const lastNotesPageTotalRef = useRef<number | null>(null)

  useEffect(() => {
    if (!apiRef.current) return
    const total = Number.isFinite(notesPageTotal) ? Math.max(1, Math.floor(notesPageTotal)) : 1
    const index = Number.isFinite(notesPageIndex) ? Math.max(0, Math.floor(notesPageIndex)) : 0
    if (lastNotesPageIndexRef.current === null || lastNotesPageTotalRef.current === null) {
      lastNotesPageIndexRef.current = index
      lastNotesPageTotalRef.current = total
      apiRef.current.setPage(index, total)
      return
    }
    if (index === lastNotesPageIndexRef.current && total === lastNotesPageTotalRef.current) return
    lastNotesPageIndexRef.current = index
    lastNotesPageTotalRef.current = total
    apiRef.current.setPage(index, total)
  }, [notesPageIndex, notesPageTotal])

  useEffect(() => {
    const view = containerRef.current
    if (!view) return

    view.replaceChildren()

    const ensureParentLayout = () => {
      const previousPosition = view.style.position
      if (!previousPosition) view.style.position = 'relative'
      return () => {
        view.style.position = previousPosition
      }
    }

    const parseHexColor = (hex: string): { r: number; g: number; b: number } | null => {
      if (!hex.startsWith('#')) return null
      const h = hex.slice(1)
      if (h.length === 3) {
        const r = Number.parseInt(h[0] + h[0], 16)
        const g = Number.parseInt(h[1] + h[1], 16)
        const b = Number.parseInt(h[2] + h[2], 16)
        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
        return { r, g, b }
      }
      if (h.length === 6) {
        const r = Number.parseInt(h.slice(0, 2), 16)
        const g = Number.parseInt(h.slice(2, 4), 16)
        const b = Number.parseInt(h.slice(4, 6), 16)
        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
        return { r, g, b }
      }
      return null
    }

    const colorToRgba = (color: unknown, opacity: number): [number, number, number, number] => {
      if (typeof color !== 'string') return [0, 0, 0, Math.max(0, Math.min(1, opacity))]
      const parsed = parseHexColor(color)
      if (!parsed) return [0, 0, 0, Math.max(0, Math.min(1, opacity))]
      return [parsed.r / 255, parsed.g / 255, parsed.b / 255, Math.max(0, Math.min(1, opacity))]
    }

    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

    const appendInterpolatedPoints = (
      points: number[],
      x: number,
      y: number,
      maxStep: number,
      maxInsert: number
    ): number[] => {
      const appended: number[] = []
      const lastX = points.length >= 2 ? points[points.length - 2] : x
      const lastY = points.length >= 2 ? points[points.length - 1] : y
      const dx = x - lastX
      const dy = y - lastY
      const dist = Math.hypot(dx, dy)
      if (!dist || dist <= maxStep) {
        points.push(x, y)
        appended.push(x, y)
        return appended
      }

      const n = Math.min(maxInsert, Math.max(1, Math.floor(dist / maxStep)))
      for (let i = 1; i <= n; i++) {
        const t = i / (n + 1)
        const ix = lastX + dx * t
        const iy = lastY + dy * t
        points.push(ix, iy)
        appended.push(ix, iy)
      }
      points.push(x, y)
      appended.push(x, y)
      return appended
    }

    const cleanPolyline = (points: number[]): number[] => {
      const out: number[] = []
      for (let i = 0; i + 1 < points.length; i += 2) {
        const x = points[i]
        const y = points[i + 1]
        if (out.length >= 2) {
          const lx = out[out.length - 2]
          const ly = out[out.length - 1]
          if (Math.abs(x - lx) < 1e-6 && Math.abs(y - ly) < 1e-6) continue
        }
        out.push(x, y)
      }
      return out
    }

    const resamplePolyline = (points: number[], step: number): number[] => {
      const src = cleanPolyline(points)
      if (src.length <= 4) return src
      const out: number[] = []
      let prevX = src[0]
      let prevY = src[1]
      out.push(prevX, prevY)
      let acc = 0
      for (let i = 2; i + 1 < src.length; i += 2) {
        const x = src[i]
        const y = src[i + 1]
        let dx = x - prevX
        let dy = y - prevY
        let segLen = Math.hypot(dx, dy)
        if (segLen < 1e-6) continue
        while (acc + segLen >= step) {
          const t = (step - acc) / segLen
          const nx = prevX + dx * t
          const ny = prevY + dy * t
          out.push(nx, ny)
          prevX = nx
          prevY = ny
          dx = x - prevX
          dy = y - prevY
          segLen = Math.hypot(dx, dy)
          acc = 0
          if (segLen < 1e-6) break
        }
        acc += segLen
        prevX = x
        prevY = y
      }
      const lastX = src[src.length - 2]
      const lastY = src[src.length - 1]
      if (out.length < 2 || Math.abs(out[out.length - 2] - lastX) > 1e-6 || Math.abs(out[out.length - 1] - lastY) > 1e-6) {
        out.push(lastX, lastY)
      }
      return out
    }

    const chaikin = (points: number[], iterations: number): number[] => {
      let src = cleanPolyline(points)
      for (let it = 0; it < iterations; it++) {
        if (src.length <= 6) break
        const out: number[] = []
        out.push(src[0], src[1])
        for (let i = 0; i + 3 < src.length; i += 2) {
          const ax = src[i]
          const ay = src[i + 1]
          const bx = src[i + 2]
          const by = src[i + 3]
          const qx = ax * 0.75 + bx * 0.25
          const qy = ay * 0.75 + by * 0.25
          const rx = ax * 0.25 + bx * 0.75
          const ry = ay * 0.25 + by * 0.75
          out.push(qx, qy, rx, ry)
        }
        out.push(src[src.length - 2], src[src.length - 1])
        src = out
      }
      return src
    }

    const bakePolyline = (points: number[], strokeWidth: number): number[] => {
      const step = clamp(strokeWidth * 0.32, 1.2, 3.6)
      const resampled = resamplePolyline(points, step)
      const smoothed = chaikin(resampled, 2)
      return smoothed
    }

    const bakePolylineWithTail = (points: number[], strokeWidth: number, tailPoints: number): number[] => {
      const tailCoords = Math.max(0, Math.floor(tailPoints)) * 2
      if (points.length <= tailCoords + 6) return points
      const tailStart = points.length - tailCoords
      const prefixInput = points.slice(0, tailStart + 2)
      if (prefixInput.length <= 6) return points
      const baked = bakePolyline(prefixInput, strokeWidth)
      if (baked.length <= 2) return points
      return baked.slice(0, -2).concat(points.slice(tailStart))
    }

    type PostBakeSegment = { points: number[]; t0: number; t1: number }
    type PostBakeResult = { kind: 'single'; points: number[] } | { kind: 'split'; segments: PostBakeSegment[] }

    const cleanFinitePolyline = (points: number[]): number[] => {
      const out: number[] = []
      for (let i = 0; i + 1 < points.length; i += 2) {
        const x = points[i]
        const y = points[i + 1]
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        if (out.length >= 2) {
          const lx = out[out.length - 2]
          const ly = out[out.length - 1]
          if (Math.abs(x - lx) < 1e-6 && Math.abs(y - ly) < 1e-6) continue
        }
        out.push(x, y)
      }
      return out
    }

    const median = (nums: number[]): number => {
      if (!nums.length) return 0
      const a = nums.slice().sort((x, y) => x - y)
      const mid = a.length >> 1
      return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) * 0.5
    }

    const postBakeOptimizePolyline = (points: number[], strokeWidth: number): PostBakeResult => {
      const src = cleanFinitePolyline(points)
      if (src.length <= 6) return { kind: 'single', points: src }

      const dists: number[] = []
      for (let i = 2; i + 1 < src.length; i += 2) {
        const ax = src[i - 2]
        const ay = src[i - 1]
        const bx = src[i]
        const by = src[i + 1]
        const d = Math.hypot(bx - ax, by - ay)
        if (d > 1e-6) dists.push(d)
      }
      const med = median(dists)
      const jump = Math.max(30, strokeWidth * 12, med * 10)

      let totalLen = 0
      for (let i = 2; i + 1 < src.length; i += 2) {
        totalLen += Math.hypot(src[i] - src[i - 2], src[i + 1] - src[i - 1])
      }
      totalLen = Math.max(1e-6, totalLen)

      const segmentsRaw: { points: number[]; len: number }[] = []
      let seg: number[] = [src[0], src[1], src[0], src[1]]
      let segLen = 0
      let lenSoFar = 0

      for (let i = 2; i + 1 < src.length; i += 2) {
        const prevX = src[i - 2]
        const prevY = src[i - 1]
        const x = src[i]
        const y = src[i + 1]
        const d = Math.hypot(x - prevX, y - prevY)
        if (d > jump && seg.length >= 6) {
          segmentsRaw.push({ points: seg, len: segLen })
          lenSoFar += segLen
          seg = [x, y, x, y]
          segLen = 0
          continue
        }
        seg.push(x, y)
        segLen += d
      }
      if (seg.length >= 6) segmentsRaw.push({ points: seg, len: segLen })

      const bakedSegments: PostBakeSegment[] = []
      let start = 0
      for (const s of segmentsRaw) {
        if (s.points.length <= 6) continue
        const t0 = start / totalLen
        const t1 = (start + s.len) / totalLen
        start += s.len
        const baked = bakePolyline(s.points, strokeWidth)
        bakedSegments.push({ points: baked, t0: clamp(t0, 0, 1), t1: clamp(t1, 0, 1) })
        if (bakedSegments.length >= 32) break
      }

      if (bakedSegments.length <= 1) return { kind: 'single', points: bakedSegments[0]?.points ?? src }
      return { kind: 'split', segments: bakedSegments }
    }

    type NibSegment = { points: number[]; strokeWidth: number }

    const buildNibWidthAt = (points: number[], times: number[], baseStrokeWidth: number): null | ((t: number) => number) => {
      const pointCount = Math.floor(points.length / 2)
      if (pointCount < 2) return null
      if (!Array.isArray(times) || times.length < pointCount) return null

      const cum = new Array<number>(pointCount).fill(0)
      const segSpeed = new Array<number>(pointCount).fill(0)

      for (let i = 1; i < pointCount; i++) {
        const ax = points[i * 2 - 2]
        const ay = points[i * 2 - 1]
        const bx = points[i * 2]
        const by = points[i * 2 + 1]
        const d = Math.hypot(bx - ax, by - ay)
        cum[i] = cum[i - 1] + d
        const dt = Math.max(1, (times[i] as number) - (times[i - 1] as number))
        segSpeed[i] = d / dt
      }

      const totalLen = cum[pointCount - 1]
      if (!Number.isFinite(totalLen) || totalLen < 1e-6) return null

      const speedSmoothed = new Array<number>(pointCount).fill(0)
      for (let i = 0; i < pointCount; i++) {
        let sum = 0
        let w = 0
        for (let k = -2; k <= 2; k++) {
          const idx = Math.max(0, Math.min(pointCount - 1, i + k))
          const weight = k === 0 ? 3 : Math.abs(k) === 1 ? 2 : 1
          sum += segSpeed[idx] * weight
          w += weight
        }
        speedSmoothed[i] = sum / w
      }

      const tByPoint = new Array<number>(pointCount)
      for (let i = 0; i < pointCount; i++) tByPoint[i] = cum[i] / totalLen

      const smoothstep = (edge0: number, edge1: number, x: number) => {
        const tt = clamp((x - edge0) / (edge1 - edge0), 0, 1)
        return tt * tt * (3 - 2 * tt)
      }

      const speedAt = (t: number) => {
        const tt = clamp(t, 0, 1)
        let lo = 0
        let hi = tByPoint.length - 1
        while (lo + 1 < hi) {
          const mid = (lo + hi) >> 1
          if (tByPoint[mid] <= tt) lo = mid
          else hi = mid
        }
        const t0 = tByPoint[lo]
        const t1 = tByPoint[hi]
        const s0 = speedSmoothed[lo]
        const s1 = speedSmoothed[hi]
        const a = t1 > t0 ? (tt - t0) / (t1 - t0) : 0
        return s0 + (s1 - s0) * a
      }

      return (t: number) => {
        const tt = clamp(t, 0, 1)
        const start = smoothstep(0, 0.12, tt)
        const end = smoothstep(0, 0.12, 1 - tt)
        const taper = Math.min(start, end)
        const taperFactor = 0.55 + 0.45 * taper

        const speed = speedAt(tt)
        const speedRef = 0.55
        const speedFactor = clamp(1.35 - (speed / speedRef) * 0.55, 0.6, 1.35)

        const w = baseStrokeWidth * taperFactor * speedFactor
        return clamp(w, 1, 240)
      }
    }

    const buildNibSegments = (
      points: number[],
      baseStrokeWidth: number,
      mode: 'off' | 'dynamic' | 'static',
      widthAtT?: (t: number) => number
    ): NibSegment[] => {
      if (mode !== 'dynamic') return [{ points, strokeWidth: baseStrokeWidth }]
      if (points.length < 8) return [{ points, strokeWidth: baseStrokeWidth }]

      const lengths: number[] = []
      let totalLen = 0
      for (let i = 2; i + 1 < points.length; i += 2) {
        const ax = points[i - 2]
        const ay = points[i - 1]
        const bx = points[i]
        const by = points[i + 1]
        const d = Math.hypot(bx - ax, by - ay)
        lengths.push(d)
        totalLen += d
      }
      totalLen = Math.max(1e-6, totalLen)

      const smoothstep = (edge0: number, edge1: number, x: number) => {
        const tt = clamp((x - edge0) / (edge1 - edge0), 0, 1)
        return tt * tt * (3 - 2 * tt)
      }

      const fallbackWidthAtT = (t: number) => {
        const start = smoothstep(0, 0.12, t)
        const end = smoothstep(0, 0.12, 1 - t)
        const taper = Math.min(start, end)
        const taperFactor = 0.55 + 0.45 * taper
        return clamp(baseStrokeWidth * taperFactor, 1, 240)
      }

      const pickWidthAtT = widthAtT ?? fallbackWidthAtT

      const targetSegLen = clamp(baseStrokeWidth * 2.2, 18, 46)
      const segments: NibSegment[] = []
      let segStart = 0
      let segAcc = 0
      let acc = 0
      for (let i = 0; i < lengths.length; i++) {
        const d = lengths[i]
        acc += d
        segAcc += d
        if (segAcc < targetSegLen && i < lengths.length - 1) continue

        const startCoordIndex = segStart * 2
        const endCoordIndex = (i + 1) * 2
        const segPoints = points.slice(startCoordIndex, endCoordIndex + 2)
        if (segPoints.length >= 4) {
          const midLen = acc - segAcc * 0.5
          const t = midLen / totalLen
          const sw = pickWidthAtT(t)
          segments.push({ points: segPoints, strokeWidth: sw })
        }

        segStart = i
        segAcc = 0
      }

      if (!segments.length) return [{ points, strokeWidth: baseStrokeWidth }]
      return segments
    }

    const appendCircleTriangles = (verts: number[], cx: number, cy: number, r: number, segments: number) => {
      const step = (Math.PI * 2) / segments
      for (let i = 0; i < segments; i++) {
        const a0 = i * step
        const a1 = (i + 1) * step
        const x0 = cx + Math.cos(a0) * r
        const y0 = cy + Math.sin(a0) * r
        const x1 = cx + Math.cos(a1) * r
        const y1 = cy + Math.sin(a1) * r
        verts.push(cx, cy, x0, y0, x1, y1)
      }
    }

    const buildStrokeTriangles = (points: number[], strokeWidthPx: number, dpr: number, pfh?: boolean) => {
      if (pfh && points.length >= 4) {
        const pfhPoints: number[][] = []
        for (let i = 0; i + 1 < points.length; i += 2) pfhPoints.push([points[i] * dpr, points[i + 1] * dpr])
        const outline = getStroke(pfhPoints, {
          size: strokeWidthPx * dpr,
          thinning: 0.7,
          smoothing: 0.6,
          streamline: 0.5,
          simulatePressure: true
        })
        if (outline.length >= 3) {
          const verts: number[] = []
          const p0 = outline[0] as [number, number]
          for (let i = 1; i + 1 < outline.length; i++) {
            const p1 = outline[i] as [number, number]
            const p2 = outline[i + 1] as [number, number]
            verts.push(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1])
          }
          return verts
        }
      }

      const r = strokeWidthPx * dpr * 0.5
      const verts: number[] = []
      const segments = strokeWidthPx <= 4 ? 10 : strokeWidthPx <= 12 ? 12 : 14

      for (let i = 0; i + 3 < points.length; i += 2) {
        const ax = points[i] * dpr
        const ay = points[i + 1] * dpr
        const bx = points[i + 2] * dpr
        const by = points[i + 3] * dpr
        const dx = bx - ax
        const dy = by - ay
        const len = Math.hypot(dx, dy)
        if (!len || len < 0.001) continue
        const nx = (-dy / len) * r
        const ny = (dx / len) * r
        const a1x = ax + nx
        const a1y = ay + ny
        const a2x = ax - nx
        const a2y = ay - ny
        const b1x = bx + nx
        const b1y = by + ny
        const b2x = bx - nx
        const b2y = by - ny
        verts.push(a1x, a1y, a2x, a2y, b1x, b1y, b1x, b1y, a2x, a2y, b2x, b2y)
      }

      if (points.length >= 2) {
        const sx = points[0] * dpr
        const sy = points[1] * dpr
        appendCircleTriangles(verts, sx, sy, r, segments)
      }
      if (points.length >= 4) {
        const ex = points[points.length - 2] * dpr
        const ey = points[points.length - 1] * dpr
        appendCircleTriangles(verts, ex, ey, r, segments)
      }

      for (let i = 2; i + 3 < points.length; i += 2) {
        const px = points[i] * dpr
        const py = points[i + 1] * dpr
        const ax = points[i - 2] * dpr
        const ay = points[i - 1] * dpr
        const bx = points[i + 2] * dpr
        const by = points[i + 3] * dpr
        const v0x = px - ax
        const v0y = py - ay
        const v1x = bx - px
        const v1y = by - py
        const l0 = Math.hypot(v0x, v0y)
        const l1 = Math.hypot(v1x, v1y)
        if (l0 < 0.001 || l1 < 0.001) continue
        const dot = (v0x * v1x + v0y * v1y) / (l0 * l1)
        if (dot < 0.965) appendCircleTriangles(verts, px, py, r, segments)
      }

      return verts
    }

    const createWebGLRenderer = (canvas: HTMLCanvasElement) => {
      const gl = (canvas.getContext('webgl2', { alpha: true, antialias: true, desynchronized: true } as any) ||
        canvas.getContext('webgl', { alpha: true, antialias: true, desynchronized: true } as any)) as
        | WebGL2RenderingContext
        | WebGLRenderingContext
        | null
      if (!gl) return null

      const isWebGL2 = typeof (gl as WebGL2RenderingContext).createVertexArray === 'function'
      const vsSource = isWebGL2
        ? `#version 300 es
in vec2 a_position;
uniform vec2 u_resolution;
void main() {
  vec2 zeroToOne = a_position / u_resolution;
  vec2 clip = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`
        : `attribute vec2 a_position;
uniform vec2 u_resolution;
void main() {
  vec2 zeroToOne = a_position / u_resolution;
  vec2 clip = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`
      const fsSource = isWebGL2
        ? `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 outColor;
void main() {
  outColor = u_color;
}`
        : `precision mediump float;
uniform vec4 u_color;
void main() {
  gl_FragColor = u_color;
}`

      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type)
        if (!shader) return null
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          try {
            gl.deleteShader(shader)
          } catch {}
          return null
        }
        return shader
      }

      const vs = compile(gl.VERTEX_SHADER, vsSource)
      const fs = compile(gl.FRAGMENT_SHADER, fsSource)
      if (!vs || !fs) return null

      const program = gl.createProgram()
      if (!program) return null
      gl.attachShader(program, vs)
      gl.attachShader(program, fs)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null

      const positionLoc = isWebGL2 ? (gl as WebGL2RenderingContext).getAttribLocation(program, 'a_position') : gl.getAttribLocation(program, 'a_position')
      const resolutionLoc = gl.getUniformLocation(program, 'u_resolution')
      const colorLoc = gl.getUniformLocation(program, 'u_color')
      if (positionLoc < 0 || !resolutionLoc || !colorLoc) return null

      const buffer = gl.createBuffer()
      if (!buffer) return null

      const vao = isWebGL2 ? (gl as WebGL2RenderingContext).createVertexArray() : null

      const bindLayout = () => {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        if (isWebGL2 && vao) (gl as WebGL2RenderingContext).bindVertexArray(vao)
        gl.enableVertexAttribArray(positionLoc)
        gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0)
        if (isWebGL2 && vao) (gl as WebGL2RenderingContext).bindVertexArray(null)
      }

      bindLayout()

      gl.useProgram(program)
      gl.disable(gl.DEPTH_TEST)
      gl.enable(gl.BLEND)
      const glAny = gl as any

      const setBlendStroke = () => {
        if (typeof glAny.blendFuncSeparate === 'function') {
          glAny.blendFuncSeparate(glAny.SRC_ALPHA, glAny.ONE_MINUS_SRC_ALPHA, glAny.ONE, glAny.ONE_MINUS_SRC_ALPHA)
          return
        }
        glAny.blendFunc(glAny.SRC_ALPHA, glAny.ONE_MINUS_SRC_ALPHA)
      }

      const setBlendEraser = () => {
        glAny.blendFunc(glAny.ZERO, glAny.ONE_MINUS_SRC_ALPHA)
      }

      const draw = (
        nodes: Array<{
          role: 'stroke' | 'eraserPixel'
          pfh?: boolean
          strokeWidth: number
          points: number[]
          color: [number, number, number, number]
          fadeStartAt?: number
          fadeDurationMs?: number
        }>
      ) => {
        const dpr = Math.max(1, globalThis.devicePixelRatio || 1)
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.useProgram(program)
        gl.uniform2f(resolutionLoc, canvas.width, canvas.height)
        for (const node of nodes) {
          const verts = buildStrokeTriangles(node.points, node.strokeWidth, dpr, node.role === 'stroke' && !!node.pfh)
          if (!verts.length) continue
          if (node.role === 'eraserPixel') setBlendEraser()
          else setBlendStroke()
          const c = node.role === 'eraserPixel' ? ([0, 0, 0, 1] as [number, number, number, number]) : node.color
          gl.uniform4f(colorLoc, c[0], c[1], c[2], c[3])
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STREAM_DRAW)
          if (isWebGL2 && vao) (gl as WebGL2RenderingContext).bindVertexArray(vao)
          gl.drawArrays(gl.TRIANGLES, 0, verts.length / 2)
          if (isWebGL2 && vao) (gl as WebGL2RenderingContext).bindVertexArray(null)
        }
      }

      return { draw }
    }

    const createWebGPURenderer = async (canvas: HTMLCanvasElement) => {
      const anyNav = globalThis.navigator as any
      const gpu = anyNav?.gpu as any
      if (!gpu) return null

      const ctx = canvas.getContext('webgpu') as any
      if (!ctx) return null

      const adapter = await gpu.requestAdapter()
      if (!adapter) return null
      const device = await adapter.requestDevice()
      const format = gpu.getPreferredCanvasFormat()

      const configure = () => {
        ctx.configure({
          device,
          format,
          alphaMode: 'premultiplied'
        })
      }
      configure()

      const strokeShader = device.createShaderModule({
        code: `
struct Uniforms {
  resolution: vec2f,
  color: vec4f,
}
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSOut {
  @builtin(position) pos: vec4f,
}

@vertex fn vs(@location(0) a_position: vec2f) -> VSOut {
  var out: VSOut;
  let zeroToOne = a_position / u.resolution;
  let clip = zeroToOne * 2.0 - 1.0;
  out.pos = vec4f(clip.x, -clip.y, 0.0, 1.0);
  return out;
}

@fragment fn fs() -> @location(0) vec4f {
  return u.color;
}
`
      })

      const makePipeline = (blend: any) =>
        device.createRenderPipeline({
          layout: 'auto',
          vertex: {
            module: strokeShader,
            entryPoint: 'vs',
            buffers: [
              {
                arrayStride: 8,
                attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }]
              }
            ]
          },
          fragment: {
            module: strokeShader,
            entryPoint: 'fs',
            targets: [
              {
                format,
                blend
              }
            ]
          },
          primitive: { topology: 'triangle-list' }
        })

      const strokeBlend: any = {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
      }
      const eraserBlend: any = {
        color: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' }
      }

      const strokePipeline = makePipeline(strokeBlend)
      const eraserPipeline = makePipeline(eraserBlend)

      const uniformBuffer = device.createBuffer({
        size: 4 * 6,
        usage: (globalThis as any).GPUBufferUsage.UNIFORM | (globalThis as any).GPUBufferUsage.COPY_DST
      })
      const bindGroup = device.createBindGroup({
        layout: strokePipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
      })

      let vertexBuffer: any = null
      let vertexBufferSize = 0

      const ensureVertexBuffer = (byteLength: number) => {
        if (vertexBuffer && vertexBufferSize >= byteLength) return
        if (vertexBuffer) {
          try {
            vertexBuffer.destroy()
          } catch {}
        }
        vertexBufferSize = Math.max(1024, byteLength)
        vertexBuffer = device.createBuffer({
          size: vertexBufferSize,
          usage: (globalThis as any).GPUBufferUsage.VERTEX | (globalThis as any).GPUBufferUsage.COPY_DST
        })
      }

      const draw = (
        nodes: Array<{
          role: 'stroke' | 'eraserPixel'
          pfh?: boolean
          strokeWidth: number
          points: number[]
          color: [number, number, number, number]
          fadeStartAt?: number
          fadeDurationMs?: number
        }>
      ) => {
        const dpr = Math.max(1, globalThis.devicePixelRatio || 1)
        const textureView = ctx.getCurrentTexture().createView()
        const encoder = device.createCommandEncoder()
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: textureView,
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: 'clear',
              storeOp: 'store'
            }
          ]
        })

        const writeUniforms = (color: [number, number, number, number]) => {
          const data = new Float32Array([canvas.width, canvas.height, color[0], color[1], color[2], color[3]])
          device.queue.writeBuffer(uniformBuffer, 0, data.buffer)
        }

        pass.setBindGroup(0, bindGroup)
        for (const node of nodes) {
          const verts = buildStrokeTriangles(node.points, node.strokeWidth, dpr, node.role === 'stroke' && !!node.pfh)
          if (!verts.length) continue
          const bytes = verts.length * 4
          ensureVertexBuffer(bytes)
          if (!vertexBuffer) continue
          device.queue.writeBuffer(vertexBuffer, 0, new Float32Array(verts).buffer)
          const pipeline = node.role === 'eraserPixel' ? eraserPipeline : strokePipeline
          pass.setPipeline(pipeline)
          const c = node.role === 'eraserPixel' ? ([0, 0, 0, 1] as [number, number, number, number]) : node.color
          writeUniforms(c)
          pass.setVertexBuffer(0, vertexBuffer)
          pass.draw(verts.length / 2, 1, 0, 0)
        }

        pass.end()
        device.queue.submit([encoder.finish()])
      }

      return { configure, draw }
    }

    const disposeParentLayout = ensureParentLayout()
    const notesKvKey =
      appMode === 'whiteboard'
        ? 'annotation-notes-whiteboard'
        : appMode === 'video-show'
          ? 'annotation-notes-video-show'
          : appMode === 'pdf'
            ? 'annotation-notes-pdf'
            : 'annotation-notes-toolbar'
    const notesHistoryKvKey = `${notesKvKey}-prev`
    let serializePersistedDoc: null | (() => PersistedAnnotationDocV1) = null
    let persistTimer: number | null = null
    let notesBook: PersistedAnnotationBookV2 = { version: 2, currentPage: 0, pages: [createEmptyDocV1()] }
    let notesPageIndex = 0
    let notesPageTotal = 1

    const ensureBookShape = (nextIndex: number, nextTotal: number) => {
      const total = Number.isFinite(nextTotal) ? Math.max(1, Math.floor(nextTotal)) : 1
      const index = Number.isFinite(nextIndex) ? Math.max(0, Math.floor(nextIndex)) : 0
      if (notesBook.pages.length < total) {
        while (notesBook.pages.length < total) notesBook.pages.push(createEmptyDocV1())
      } else if (notesBook.pages.length > total) {
        notesBook.pages.length = total
      }
      const boundedIndex = Math.max(0, Math.min(total - 1, index))
      notesPageTotal = total
      notesPageIndex = boundedIndex
      notesBook.currentPage = boundedIndex
    }

    const persistNow = () => {
      if (!serializePersistedDoc) return
      try {
        const doc = serializePersistedDoc()
        ensureBookShape(notesPageIndex, notesPageTotal)
        notesBook.pages[notesPageIndex] = doc
        notesBook.currentPage = notesPageIndex
        putKv(notesKvKey, notesBook).catch(() => undefined)
      } catch {}
    }

    const schedulePersist = () => {
      if (!serializePersistedDoc) return
      if (persistTimer !== null) window.clearTimeout(persistTimer)
      persistTimer = window.setTimeout(() => {
        persistTimer = null
        persistNow()
      }, 320)
    }

    const consumePostBakeOptimizeOnce = () => {
      if (!postBakeOptimizeOnceRef.current) return
      postBakeOptimizeOnceRef.current = false
      const current = leaferSettingsRef.current
      const next: LeaferSettings = { ...current, postBakeOptimizeOnce: false }
      leaferSettingsRef.current = next
      setLeaferSettings(next)
      void (async () => {
        try {
          await putKv(LEAFER_SETTINGS_KV_KEY, next)
        } catch {
          return
        }
        try {
          await putUiStateKey(UI_STATE_APP_WINDOW_ID, LEAFER_SETTINGS_UI_STATE_KEY, Date.now())
        } catch {
          return
        }
      })()
    }

    if (rendererEngine === 'canvas2d') {
      const rect = view.getBoundingClientRect()
      const contextSettings = { desynchronized: true, alpha: true } as any
      const leafer = new Leafer(
        {
          view,
          width: Math.max(1, Math.floor(rect.width)),
          height: Math.max(1, Math.floor(rect.height)),
          contextSettings
        } as any
      )
      try {
        const c = view.querySelector('canvas') as HTMLCanvasElement | null
        if (c) c.style.background = 'transparent'
      } catch {}

      type CanvasNode = Line | Polygon
      type Action =
        | { kind: 'add'; nodes: CanvasNode[] }
        | { kind: 'remove'; nodes: CanvasNode[] }
        | { kind: 'update'; nodes: CanvasNode[]; beforePoints: number[][]; afterPoints: number[][] }
      const live = new Set<CanvasNode>()
      const order: CanvasNode[] = []
      const history = { undo: [] as Action[], redo: [] as Action[] }
      const laserFade = new Map<CanvasNode, { startAt: number; durationMs: number; basePoints: number[]; cumLen: number[]; totalLen: number }>()
      let laserFadeScheduled = false

      const buildCumLen = (points: number[]) => {
        const n = Math.floor(points.length / 2)
        if (n <= 1) return { cumLen: [0], totalLen: 0 }
        const cumLen = new Array<number>(n)
        cumLen[0] = 0
        let totalLen = 0
        let lastX = points[0]
        let lastY = points[1]
        for (let i = 1; i < n; i++) {
          const x = points[i * 2]
          const y = points[i * 2 + 1]
          totalLen += Math.hypot(x - lastX, y - lastY)
          cumLen[i] = totalLen
          lastX = x
          lastY = y
        }
        return { cumLen, totalLen }
      }

      const findPairIndexByLen = (cumLen: number[], targetLen: number) => {
        let lo = 0
        let hi = cumLen.length - 1
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (cumLen[mid] < targetLen) lo = mid + 1
          else hi = mid
        }
        return lo
      }

      const ensureLaserFadeTick = () => {
        if (laserFadeScheduled) return
        if (!laserFade.size) return
        laserFadeScheduled = true
        requestAnimationFrame(() => {
          laserFadeScheduled = false
          if (!laserFade.size) return
          const now = performance.now()
          const expired: CanvasNode[] = []
          for (const [node, f] of laserFade) {
            const t = (now - f.startAt) / f.durationMs
            if (t >= 1) {
              expired.push(node)
              continue
            }
            if (t <= 0) continue
            if (f.totalLen <= 0.001) continue
            const targetLen = f.totalLen * t
            const maxStart = Math.max(0, f.cumLen.length - 2)
            const startPair = Math.min(maxStart, findPairIndexByLen(f.cumLen, targetLen))
            const sliced = f.basePoints.slice(startPair * 2)
            if (sliced.length < 4) {
              expired.push(node)
              continue
            }
            ;(node as any).points = sliced
            const meta = getMeta(node)
            if (meta) {
              meta.points = sliced
              recomputeBounds(meta, sliced)
            }
          }
          if (expired.length) removeNodes(expired)
          try {
            ;(leafer as any).forceRender?.()
          } catch {}
          ensureLaserFadeTick()
        })
      }

      const startLaserFade = (nodes: CanvasNode[]) => {
        const now = performance.now()
        for (const node of nodes) {
          const points = (node as any).points as number[] | undefined
          if (!points) continue
          const basePoints = points.slice()
          const { cumLen, totalLen } = buildCumLen(basePoints)
          laserFade.set(node, { startAt: now + 200, durationMs: 1200, basePoints, cumLen, totalLen })
        }
        ensureLaserFadeTick()
      }

      const getMeta = (node: CanvasNode): LineMeta | undefined => (node as any).__lanstartMeta as LineMeta | undefined
      const setMeta = (node: CanvasNode, meta: LineMeta): void => {
        ;(node as any).__lanstartMeta = meta
      }

      const serializeColorFromNode = (node: any): { color?: string; opacity?: number; pfh?: boolean } => {
        if (node instanceof Polygon) {
          const fill = typeof node.fill === 'string' ? node.fill : undefined
          const opacity = typeof node.opacity === 'number' && Number.isFinite(node.opacity) ? node.opacity : undefined
          return { color: fill, opacity, pfh: true }
        }
        const stroke = typeof node.stroke === 'string' ? node.stroke : undefined
        const opacity = typeof node.opacity === 'number' && Number.isFinite(node.opacity) ? node.opacity : undefined
        return { color: stroke, opacity, pfh: false }
      }

      const applyMetaPointsToNode = (node: CanvasNode, meta: LineMeta, points: number[]) => {
        meta.points = points
        recomputeBounds(meta, points)
        if (node instanceof Polygon) {
          const fill = typeof (node as any).fill === 'string' ? (node as any).fill : '#000000'
          const opacity = typeof (node as any).opacity === 'number' && Number.isFinite((node as any).opacity) ? (node as any).opacity : 1
          const outline = getStroke(pointsToPerfectFreehandInput(points), {
            size: meta.strokeWidth,
            thinning: 0.7,
            smoothing: 0.6,
            streamline: 0.5,
            simulatePressure: true
          })
          if (outline.length >= 3) {
            const polyPoints: number[] = []
            for (const p of outline as unknown as [number, number][]) polyPoints.push(p[0], p[1])
            ;(node as any).points = polyPoints
            ;(node as any).fill = fill
            ;(node as any).opacity = opacity
          } else {
            ;(node as any).points = points
          }
          return
        }
        ;(node as any).points = points
      }

      serializePersistedDoc = () => {
        const nodes: PersistedAnnotationNodeV1[] = []
        for (const node of live) {
          const meta = getMeta(node)
          if (!meta) continue
          if (meta.transient) continue
          if (!Array.isArray(meta.points) || meta.points.length < 4) continue
          const { color, opacity, pfh } = serializeColorFromNode(node as any)
          nodes.push({
            role: meta.role,
            groupId: typeof meta.groupId === 'number' && Number.isFinite(meta.groupId) ? meta.groupId : undefined,
            strokeWidth: meta.strokeWidth,
            points: meta.points.slice(),
            color,
            opacity,
            pfh
          })
        }
        return { version: 1, nodes }
      }

      const addNodes = (nodes: CanvasNode[]) => {
        for (const node of nodes) {
          leafer.add(node)
          live.add(node)
          order.push(node)
        }
      }

      const removeNodes = (nodes: CanvasNode[]) => {
        const set = new Set(nodes)
        for (const node of nodes) {
          try {
            ;(node as any).remove?.()
          } catch {}
          live.delete(node)
          laserFade.delete(node)
        }
        for (let i = order.length - 1; i >= 0; i--) {
          if (set.has(order[i])) order.splice(i, 1)
        }
      }

      const record = (action: Action) => {
        history.undo.push(action)
        history.redo.length = 0
        schedulePersist()
      }

      const undo = () => {
        const action = history.undo.pop()
        if (!action) return
        if (action.kind === 'add') removeNodes(action.nodes)
        else if (action.kind === 'remove') addNodes(action.nodes)
        else {
          for (let i = 0; i < action.nodes.length; i++) {
            const node = action.nodes[i]
            const meta = getMeta(node)
            const points = action.beforePoints[i]
            if (!meta || !points) continue
            applyMetaPointsToNode(node, meta, points.slice())
          }
          try {
            ;(leafer as any).forceRender?.()
          } catch {}
        }
        history.redo.push(action)
        schedulePersist()
      }

      const redo = () => {
        const action = history.redo.pop()
        if (!action) return
        if (action.kind === 'add') addNodes(action.nodes)
        else if (action.kind === 'remove') removeNodes(action.nodes)
        else {
          for (let i = 0; i < action.nodes.length; i++) {
            const node = action.nodes[i]
            const meta = getMeta(node)
            const points = action.afterPoints[i]
            if (!meta || !points) continue
            applyMetaPointsToNode(node, meta, points.slice())
          }
          try {
            ;(leafer as any).forceRender?.()
          } catch {}
        }
        history.undo.push(action)
        schedulePersist()
      }

      const clear = () => {
        if (!live.size) return
        const nodes = Array.from(live)
        removeNodes(nodes)
        record({ kind: 'remove', nodes })
      }

      let nextGroupId = 1
      let hydrated = false

      const loadDoc = (doc: PersistedAnnotationDocV1) => {
        if (live.size) removeNodes(Array.from(live))
        history.undo.length = 0
        history.redo.length = 0

        const add: CanvasNode[] = []
        let maxGroupId = 0
        for (const n of doc.nodes) {
          if (!Array.isArray(n.points) || n.points.length < 4) continue
          const p0x = n.points[0] ?? 0
          const p0y = n.points[1] ?? 0
          const meta: LineMeta = { role: n.role, groupId: n.groupId, strokeWidth: n.strokeWidth, points: n.points.slice(), minX: p0x, minY: p0y, maxX: p0x, maxY: p0y }
          recomputeBounds(meta, meta.points)
          if (typeof meta.groupId === 'number' && Number.isFinite(meta.groupId)) maxGroupId = Math.max(maxGroupId, meta.groupId)

          if (n.role === 'eraserPixel') {
            const line = new Line({ points: meta.points, stroke: '#000000', strokeWidth: meta.strokeWidth, blendMode: 'destination-out' as any, opacity: 1 } as any)
            setMeta(line, meta)
            add.push(line)
            continue
          }

          const color = typeof n.color === 'string' ? n.color : '#000000'
          const opacity = typeof n.opacity === 'number' && Number.isFinite(n.opacity) ? Math.max(0, Math.min(1, n.opacity)) : 1
          if (n.pfh) {
            const outline = getStroke(pointsToPerfectFreehandInput(meta.points), {
              size: meta.strokeWidth,
              thinning: 0.7,
              smoothing: 0.6,
              streamline: 0.5,
              simulatePressure: true
            })
            if (outline.length >= 3) {
              const polyPoints: number[] = []
              for (const p of outline as unknown as [number, number][]) polyPoints.push(p[0], p[1])
              const poly = new Polygon({ points: polyPoints, fill: color, opacity } as any)
              setMeta(poly as any, meta)
              add.push(poly)
            } else {
              const line = new Line({ points: meta.points, stroke: color, strokeWidth: meta.strokeWidth, opacity } as any)
              setMeta(line, meta)
              add.push(line)
            }
            continue
          }

          const line = new Line({ points: meta.points, stroke: color, strokeWidth: meta.strokeWidth, opacity } as any)
          setMeta(line, meta)
          add.push(line)
        }
        if (add.length) addNodes(add)
        nextGroupId = Math.max(1, maxGroupId + 1)
      }

      const setPage = (index: number, total: number) => {
        const boundedIndex = Math.max(0, Math.min(Math.max(1, Math.floor(total)) - 1, Math.floor(index)))
        const boundedTotal = Math.max(1, Math.floor(total))
        if (boundedIndex === notesPageIndex && boundedTotal === notesPageTotal) return
        persistNow()
        ensureBookShape(boundedIndex, boundedTotal)
        loadDoc(notesBook.pages[notesPageIndex] ?? createEmptyDocV1())
        putKv(notesKvKey, notesBook).catch(() => undefined)
        try {
          ;(leafer as any).forceRender?.()
        } catch {}
      }

      apiRef.current = { undo, redo, clear, setPage, reloadNotes: () => void hydrate() }
      lastUndoRevRef.current = undoRev
      lastRedoRevRef.current = redoRev
      lastClearRevRef.current = clearRev

      const hydrate = async () => {
        try {
          if (!rotatedNotesKvKeys.has(notesKvKey)) {
            rotatedNotesKvKeys.add(notesKvKey)

            let prev: PersistedAnnotationBookV2 | null = null
            try {
              const loaded = await getKv<unknown>(notesKvKey)
              if (isPersistedAnnotationBookV2(loaded)) prev = loaded
              else if (isPersistedAnnotationDocV1(loaded)) prev = { version: 2, currentPage: 0, pages: [loaded] }
            } catch {}

            if (prev) putKv(notesHistoryKvKey, prev).catch(() => undefined)

            notesBook = { version: 2, currentPage: 0, pages: [createEmptyDocV1()] }
            ensureBookShape(0, 1)
            loadDoc(notesBook.pages[notesPageIndex] ?? createEmptyDocV1())
            putKv(notesKvKey, notesBook).catch(() => undefined)
            void putUiStateKey(UI_STATE_APP_WINDOW_ID, NOTES_PAGE_TOTAL_UI_STATE_KEY, notesPageTotal)
            void putUiStateKey(UI_STATE_APP_WINDOW_ID, NOTES_PAGE_INDEX_UI_STATE_KEY, notesPageIndex)
            return
          }

          const loaded = await getKv<unknown>(notesKvKey)
          if (isPersistedAnnotationBookV2(loaded)) {
            notesBook = loaded
          } else if (isPersistedAnnotationDocV1(loaded)) {
            notesBook = { version: 2, currentPage: 0, pages: [loaded] }
          } else {
            ensureBookShape(0, 1)
            loadDoc(notesBook.pages[notesPageIndex] ?? createEmptyDocV1())
            return
          }

          const initialTotal = Math.max(1, notesBook.pages.length)
          const initialIndex = Number.isFinite(notesBook.currentPage) ? notesBook.currentPage : 0
          ensureBookShape(initialIndex, initialTotal)
          loadDoc(notesBook.pages[notesPageIndex] ?? createEmptyDocV1())
          putKv(notesKvKey, notesBook).catch(() => undefined)
          void putUiStateKey(UI_STATE_APP_WINDOW_ID, NOTES_PAGE_TOTAL_UI_STATE_KEY, notesPageTotal)
          void putUiStateKey(UI_STATE_APP_WINDOW_ID, NOTES_PAGE_INDEX_UI_STATE_KEY, notesPageIndex)
        } catch {
          return
        } finally {
          hydrated = true
          try {
            ;(leafer as any).forceRender?.()
          } catch {}
        }
      }
      void hydrate()
      apiRef.current = { undo, redo, clear, setPage, reloadNotes: () => void hydrate() }

      const sessions = new Map<
        number,
        {
          groupId: number
          line: null | Line
          glowLine: null | Line
          laser: boolean
          bakedLines: Line[]
          points: number[]
          rawPoints: number[]
          rawTimes: number[]
          erasing: boolean
          erased: CanvasNode[]
          erasedSet: Set<CanvasNode>
          erasedGroupIds: Set<number>
          strokeWidth: number
          stroke: any
          nibDynamic: boolean
          smoothX: number
          smoothY: number
          hasSmooth: boolean
          lastTime: number
          baking: boolean
          lastBakeAt: number
          lastBakeLen: number
        }
      >()

      let camX = 0
      let camY = 0
      let camScale = 1
      let camRot = 0

      let lastVideoShowViewKey = ''
      const publishVideoShowView = () => {
        if (appMode !== 'video-show') return
        const payload: VideoShowViewTransform = { x: camX, y: camY, scale: camScale, rot: camRot }
        const k = `${Math.round(camX * 1000)},${Math.round(camY * 1000)},${Math.round(camScale * 10000)},${Math.round(camRot * 100000)}`
        if (k === lastVideoShowViewKey) return
        lastVideoShowViewKey = k
        setUiStateKeyRef.current(VIDEO_SHOW_VIEW_UI_STATE_KEY, payload).catch(() => undefined)
      }

      const applyCamera = () => {
        ;(leafer as any).x = camX
        ;(leafer as any).y = camY
        ;(leafer as any).scaleX = camScale
        ;(leafer as any).scaleY = camScale
        ;(leafer as any).rotation = (camRot * 180) / Math.PI
        publishVideoShowView()
        try {
          ;(leafer as any).forceRender?.()
        } catch {}
      }

      const getClientPoint = (e: PointerEvent) => {
        const r = view.getBoundingClientRect()
        const cx = e.clientX - r.left
        const cy = e.clientY - r.top
        return { cx, cy }
      }

      const clientToWorld = (cx: number, cy: number) => {
        const dx = cx - camX
        const dy = cy - camY
        const s = Math.max(0.0001, camScale)
        const cos = Math.cos(camRot)
        const sin = Math.sin(camRot)
        const x = (dx * cos + dy * sin) / s
        const y = (-dx * sin + dy * cos) / s
        return { x, y }
      }

      const getPoint = (e: PointerEvent) => {
        const { cx, cy } = getClientPoint(e)
        return clientToWorld(cx, cy)
      }

      type Selection = {
        nodes: CanvasNode[]
        bounds: { minX: number; minY: number; maxX: number; maxY: number }
      }

      let selection: Selection | null = null
      let selectionOverlayKind: 'mouse' | 'touch' = 'mouse'
      let selectionBox: Line | null = null
      let selectionCurve: Line | null = null
      let lassoPreview: Line | null = null

      const removeOverlayNode = (node: any) => {
        if (!node) return
        try {
          node.remove?.()
        } catch {}
      }

      const clearSelectionOverlays = () => {
        removeOverlayNode(selectionBox)
        removeOverlayNode(selectionCurve)
        selectionBox = null
        selectionCurve = null
      }

      const clearLassoPreview = () => {
        removeOverlayNode(lassoPreview)
        lassoPreview = null
      }

      const computeBounds = (nodes: CanvasNode[]): Selection['bounds'] | null => {
        let minX = Number.POSITIVE_INFINITY
        let minY = Number.POSITIVE_INFINITY
        let maxX = Number.NEGATIVE_INFINITY
        let maxY = Number.NEGATIVE_INFINITY
        for (const node of nodes) {
          const meta = getMeta(node)
          if (!meta) continue
          minX = Math.min(minX, meta.minX)
          minY = Math.min(minY, meta.minY)
          maxX = Math.max(maxX, meta.maxX)
          maxY = Math.max(maxY, meta.maxY)
        }
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null
        return { minX, minY, maxX, maxY }
      }

      const boundsCenter = (b: Selection['bounds']) => ({ x: (b.minX + b.maxX) * 0.5, y: (b.minY + b.maxY) * 0.5 })

      const computeConvexHull = (points: number[]) => {
        const pts: { x: number; y: number }[] = []
        for (let i = 0; i + 1 < points.length; i += 2) pts.push({ x: points[i], y: points[i + 1] })
        if (pts.length <= 2) return pts
        pts.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
        const cross = (o: any, a: any, b: any) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
        const lower: any[] = []
        for (const p of pts) {
          while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
          lower.push(p)
        }
        const upper: any[] = []
        for (let i = pts.length - 1; i >= 0; i--) {
          const p = pts[i]
          while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
          upper.push(p)
        }
        upper.pop()
        lower.pop()
        return lower.concat(upper)
      }

      const updateSelectionOverlays = () => {
        clearSelectionOverlays()
        if (!selection) return
        const b = selection.bounds
        const strokeWidth = 1 / Math.max(0.2, camScale)
        const pad = 6 / Math.max(0.2, camScale)

        if (selectionOverlayKind === 'mouse') {
          const rectPoints = [b.minX - pad, b.minY - pad, b.maxX + pad, b.minY - pad, b.maxX + pad, b.maxY + pad, b.minX - pad, b.maxY + pad, b.minX - pad, b.minY - pad]
          selectionBox = new Line(
            {
              points: rectPoints,
              stroke: '#3b82f6',
              strokeWidth,
              dashPattern: [6 / Math.max(0.2, camScale), 4 / Math.max(0.2, camScale)],
              closed: true,
              opacity: 0.95,
              hittable: false
            } as any
          )
          leafer.add(selectionBox)
        }

        const all: number[] = []
        for (const n of selection.nodes) {
          const m = getMeta(n)
          if (!m) continue
          const step = Math.max(2, Math.floor(m.points.length / 240) * 2)
          for (let i = 0; i + 1 < m.points.length; i += step) {
            all.push(m.points[i], m.points[i + 1])
          }
        }
        const hull = computeConvexHull(all)
        if (selectionOverlayKind === 'touch' && hull.length >= 3) {
          const hullPoints: number[] = []
          for (const p of hull) hullPoints.push(p.x, p.y)
          hullPoints.push(hull[0].x, hull[0].y)
          selectionCurve = new Line(
            {
              points: hullPoints,
              stroke: '#3b82f6',
              strokeWidth,
              closed: true,
              opacity: 0.9,
              hittable: false
            } as any
          )
          leafer.add(selectionCurve)
        }
        try {
          ;(leafer as any).forceRender?.()
        } catch {}
      }

      const setSelection = (nodes: CanvasNode[] | null, kind: 'mouse' | 'touch' = 'mouse') => {
        selection = null
        selectionOverlayKind = kind
        clearSelectionOverlays()
        if (!nodes || !nodes.length) return
        const b = computeBounds(nodes)
        if (!b) return
        selection = { nodes, bounds: b }
        updateSelectionOverlays()
      }

      const distancePointToSegmentSq = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
        const vx = bx - ax
        const vy = by - ay
        const wx = px - ax
        const wy = py - ay
        const c1 = vx * wx + vy * wy
        if (c1 <= 0) return wx * wx + wy * wy
        const c2 = vx * vx + vy * vy
        if (c2 <= c1) {
          const dx = px - bx
          const dy = py - by
          return dx * dx + dy * dy
        }
        const t = c1 / c2
        const qx = ax + t * vx
        const qy = ay + t * vy
        const dx = px - qx
        const dy = py - qy
        return dx * dx + dy * dy
      }

      const hitDistanceToPolylineSq = (points: number[], x: number, y: number) => {
        let best = Number.POSITIVE_INFINITY
        for (let i = 0; i + 3 < points.length; i += 2) {
          const d = distancePointToSegmentSq(x, y, points[i], points[i + 1], points[i + 2], points[i + 3])
          if (d < best) best = d
        }
        return best
      }

      const pickNodesAtPoint = (x: number, y: number) => {
        const r = 10 / Math.max(0.2, camScale)
        const rSq = r * r
        for (let i = order.length - 1; i >= 0; i--) {
          const node = order[i]
          const meta = getMeta(node)
          if (!meta || meta.transient) continue
          const pad = r + meta.strokeWidth * 0.6
          if (x < meta.minX - pad || x > meta.maxX + pad || y < meta.minY - pad || y > meta.maxY + pad) continue
          const dSq = hitDistanceToPolylineSq(meta.points, x, y)
          if (dSq <= rSq + (meta.strokeWidth * 0.6) * (meta.strokeWidth * 0.6)) {
            const gid = meta.groupId
            if (gid === undefined) return [node]
            const group: CanvasNode[] = []
            for (const other of order) {
              const om = getMeta(other)
              if (!om || om.transient) continue
              if (om.groupId !== gid) continue
              group.push(other)
            }
            return group.length ? group : [node]
          }
        }
        return []
      }

      const pointInPolygon = (poly: number[], x: number, y: number) => {
        let inside = false
        for (let i = 0, j = poly.length - 2; i + 1 < poly.length; j = i, i += 2) {
          const xi = poly[i]
          const yi = poly[i + 1]
          const xj = poly[j]
          const yj = poly[j + 1]
          const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi
          if (intersect) inside = !inside
        }
        return inside
      }

      const pickNodesInLasso = (lasso: number[]) => {
        const out: CanvasNode[] = []
        if (lasso.length < 6) return out
        for (const node of order) {
          const meta = getMeta(node)
          if (!meta || meta.transient) continue
          const cx = (meta.minX + meta.maxX) * 0.5
          const cy = (meta.minY + meta.maxY) * 0.5
          if (!pointInPolygon(lasso, cx, cy)) continue
          out.push(node)
        }
        if (!out.length) return out
        const byGroup = new Map<number, CanvasNode[]>()
        const singles: CanvasNode[] = []
        for (const node of out) {
          const meta = getMeta(node)
          const gid = meta?.groupId
          if (gid === undefined) singles.push(node)
          else {
            const list = byGroup.get(gid) ?? []
            list.push(node)
            byGroup.set(gid, list)
          }
        }
        const merged: CanvasNode[] = [...singles]
        for (const [gid] of byGroup) {
          for (const node of order) {
            const meta = getMeta(node)
            if (!meta || meta.transient) continue
            if (meta.groupId === gid) merged.push(node)
          }
        }
        return merged
      }

      type MouseToolOp =
        | { kind: 'pan'; pointerId: number; startCx: number; startCy: number; startX: number; startY: number }
        | { kind: 'lasso'; pointerId: number; points: number[] }
        | { kind: 'transform'; pointerId: number; mode: 'move' | 'scale' | 'rotate'; startX: number; startY: number; centerX: number; centerY: number; before: number[][]; baseAngle: number; baseDist: number }
        | {
            kind: 'pinch'
            target: 'camera'
            ids: [number, number]
            startDist: number
            startScale: number
            startAngle: number
            startRot: number
            anchorWorldX: number
            anchorWorldY: number
          }
        | { kind: 'pinch'; target: 'selection'; ids: [number, number]; startDist: number; startAngle: number; startMidX: number; startMidY: number; before: number[][] }
        | { kind: 'none' }
      let mouseToolOp: MouseToolOp = { kind: 'none' }
      const touchPoints = new Map<number, { cx: number; cy: number }>()

      const isPointInBounds = (b: Selection['bounds'], x: number, y: number, pad: number) => x >= b.minX - pad && x <= b.maxX + pad && y >= b.minY - pad && y <= b.maxY + pad

      const syncSelectionBounds = () => {
        if (!selection) return
        const b = computeBounds(selection.nodes)
        if (!b) {
          setSelection(null, selectionOverlayKind)
          return
        }
        selection.bounds = b
      }

      const translatePoints = (points: number[], dx: number, dy: number) => {
        const out = points.slice()
        for (let i = 0; i + 1 < out.length; i += 2) {
          out[i] += dx
          out[i + 1] += dy
        }
        return out
      }

      const scalePoints = (points: number[], s: number, cx: number, cy: number) => {
        const out = points.slice()
        for (let i = 0; i + 1 < out.length; i += 2) {
          out[i] = (out[i] - cx) * s + cx
          out[i + 1] = (out[i + 1] - cy) * s + cy
        }
        return out
      }

      const rotatePoints = (points: number[], a: number, cx: number, cy: number) => {
        const out = points.slice()
        const cos = Math.cos(a)
        const sin = Math.sin(a)
        for (let i = 0; i + 1 < out.length; i += 2) {
          const x = out[i] - cx
          const y = out[i + 1] - cy
          out[i] = x * cos - y * sin + cx
          out[i + 1] = x * sin + y * cos + cy
        }
        return out
      }

      const applyMetaPointsFromList = (nodes: CanvasNode[], nextPoints: number[][]) => {
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i]
          const meta = getMeta(node)
          const pts = nextPoints[i]
          if (!meta || !pts) continue
          applyMetaPointsToNode(node, meta, pts)
        }
        syncSelectionBounds()
        updateSelectionOverlays()
        try {
          ;(leafer as any).forceRender?.()
        } catch {}
      }

      const beginSelectionTransform = (pointerId: number, mode: 'move' | 'scale' | 'rotate', x: number, y: number) => {
        if (!selection) return false
        const c = boundsCenter(selection.bounds)
        const before: number[][] = []
        for (const node of selection.nodes) {
          const meta = getMeta(node)
          before.push(meta?.points ? meta.points.slice() : [])
        }
        const baseAngle = Math.atan2(y - c.y, x - c.x)
        const baseDist = Math.max(1e-6, Math.hypot(x - c.x, y - c.y))
        mouseToolOp = { kind: 'transform', pointerId, mode, startX: x, startY: y, centerX: c.x, centerY: c.y, before, baseAngle, baseDist }
        return true
      }

      const finishSelectionTransform = () => {
        if (mouseToolOp.kind !== 'transform') return
        if (!selection) {
          mouseToolOp = { kind: 'none' }
          return
        }
        const nodes = selection.nodes.slice()
        const beforePoints = mouseToolOp.before.map((p) => p.slice())
        const afterPoints: number[][] = []
        for (const node of nodes) {
          const meta = getMeta(node)
          afterPoints.push(meta?.points ? meta.points.slice() : [])
        }
        record({ kind: 'update', nodes, beforePoints, afterPoints })
        mouseToolOp = { kind: 'none' }
      }

      const updateLassoPreview = (points: number[]) => {
        const strokeWidth = 1 / Math.max(0.2, camScale)
        if (!lassoPreview) {
          const init = points.length >= 4 ? points.slice() : points.length >= 2 ? [points[0], points[1], points[0], points[1]] : [0, 0, 0, 0]
          lassoPreview = new Line({ points: init, stroke: '#3b82f6', strokeWidth, opacity: 0.7, hittable: false } as any)
          leafer.add(lassoPreview)
          return
        }
        ;(lassoPreview as any).strokeWidth = strokeWidth
        ;(lassoPreview as any).points = points.length >= 4 ? points : points.length >= 2 ? [points[0], points[1], points[0], points[1]] : [0, 0, 0, 0]
      }

      const startPinch = (ids: [number, number]) => {
        const p1 = touchPoints.get(ids[0])
        const p2 = touchPoints.get(ids[1])
        if (!p1 || !p2) return
        clearLassoPreview()
        if (mouseToolOp.kind === 'lasso') mouseToolOp = { kind: 'none' }

        const cx = (p1.cx + p2.cx) * 0.5
        const cy = (p1.cy + p2.cy) * 0.5
        const w1 = clientToWorld(p1.cx, p1.cy)
        const w2 = clientToWorld(p2.cx, p2.cy)
        const mid = clientToWorld(cx, cy)
        const dist = Math.max(1e-6, Math.hypot(p2.cx - p1.cx, p2.cy - p1.cy))
        const ang = Math.atan2(w2.y - w1.y, w2.x - w1.x)
        const clientAng = Math.atan2(p2.cy - p1.cy, p2.cx - p1.cx)

        if (selection) {
          const pad = 10 / Math.max(0.2, camScale)
          if (isPointInBounds(selection.bounds, w1.x, w1.y, pad) && isPointInBounds(selection.bounds, w2.x, w2.y, pad)) {
            selectionOverlayKind = 'touch'
            updateSelectionOverlays()
            const before: number[][] = []
            for (const node of selection.nodes) {
              const meta = getMeta(node)
              before.push(meta?.points ? meta.points.slice() : [])
            }
            mouseToolOp = { kind: 'pinch', target: 'selection', ids, startDist: dist, startAngle: ang, startMidX: mid.x, startMidY: mid.y, before }
            return
          }
        }

        mouseToolOp = {
          kind: 'pinch',
          target: 'camera',
          ids,
          startDist: dist,
          startScale: camScale,
          startAngle: clientAng,
          startRot: camRot,
          anchorWorldX: mid.x,
          anchorWorldY: mid.y
        }
      }

      const updatePinch = () => {
        if (mouseToolOp.kind !== 'pinch') return
        const [id1, id2] = mouseToolOp.ids
        const p1 = touchPoints.get(id1)
        const p2 = touchPoints.get(id2)
        if (!p1 || !p2) return
        const cx = (p1.cx + p2.cx) * 0.5
        const cy = (p1.cy + p2.cy) * 0.5
        const dist = Math.max(1e-6, Math.hypot(p2.cx - p1.cx, p2.cy - p1.cy))
        const factor = dist / mouseToolOp.startDist

        if (mouseToolOp.target === 'camera') {
          const nextScale = clamp(mouseToolOp.startScale * factor, 0.2, 6)
          const nextRot = appMode === 'video-show' ? mouseToolOp.startRot + (Math.atan2(p2.cy - p1.cy, p2.cx - p1.cx) - mouseToolOp.startAngle) : mouseToolOp.startRot
          camScale = nextScale
          camRot = nextRot
          const cos = Math.cos(camRot)
          const sin = Math.sin(camRot)
          camX = cx - camScale * (mouseToolOp.anchorWorldX * cos - mouseToolOp.anchorWorldY * sin)
          camY = cy - camScale * (mouseToolOp.anchorWorldX * sin + mouseToolOp.anchorWorldY * cos)
          applyCamera()
          updateSelectionOverlays()
          try {
            ;(leafer as any).forceRender?.()
          } catch {}
          return
        }

        if (!selection) return
        const w1 = clientToWorld(p1.cx, p1.cy)
        const w2 = clientToWorld(p2.cx, p2.cy)
        const mid = clientToWorld(cx, cy)
        const ang = Math.atan2(w2.y - w1.y, w2.x - w1.x)
        const dAng = ang - mouseToolOp.startAngle
        const dx = mid.x - mouseToolOp.startMidX
        const dy = mid.y - mouseToolOp.startMidY
        const cos = Math.cos(dAng)
        const sin = Math.sin(dAng)
        const s = clamp(factor, 0.1, 20)

        const next: number[][] = []
        for (const pts of mouseToolOp.before) {
          const out = pts.slice()
          for (let i = 0; i + 1 < out.length; i += 2) {
            const rx = out[i] - mouseToolOp.startMidX
            const ry = out[i + 1] - mouseToolOp.startMidY
            const nx = (rx * cos - ry * sin) * s + mouseToolOp.startMidX + dx
            const ny = (rx * sin + ry * cos) * s + mouseToolOp.startMidY + dy
            out[i] = nx
            out[i + 1] = ny
          }
          next.push(out)
        }
        applyMetaPointsFromList(selection.nodes, next)
      }

      const applySmoothing = (session: { smoothX: number; smoothY: number; hasSmooth: boolean; lastTime: number }, x: number, y: number) => {
        const now = performance.now()
        const dt = Math.max(1, now - (session.lastTime || now))
        session.lastTime = now
        if (!inkSmoothingRef.current) return { x, y, dt, now }
        if (!session.hasSmooth) {
          session.hasSmooth = true
          session.smoothX = x
          session.smoothY = y
          return { x, y, dt, now }
        }
        const dx = x - session.smoothX
        const dy = y - session.smoothY
        const speed = Math.hypot(dx, dy) / dt
        const a = clamp(0.22 + speed * 0.28, 0.22, 0.78)
        const nx = session.smoothX + dx * a
        const ny = session.smoothY + dy * a
        session.smoothX = nx
        session.smoothY = ny
        return { x: nx, y: ny, dt, now }
      }

      const BAKE_TAIL_POINTS = 8
      const BAKE_MIN_NEW_COORDS = 24
      const BAKE_MIN_INTERVAL_MS = 56

      const maybeScheduleBake = (pointerId: number) => {
        const session = sessions.get(pointerId)
        if (!session) return
        if (!inkSmoothingRef.current) return
        if (!session.line) return
        const now = performance.now()
        const newCoords = session.rawPoints.length - session.lastBakeLen
        if (newCoords < BAKE_MIN_NEW_COORDS && now - session.lastBakeAt < BAKE_MIN_INTERVAL_MS) return
        if (session.baking) return
        session.lastBakeAt = now
        session.lastBakeLen = session.rawPoints.length
        session.baking = true
        requestAnimationFrame(() => {
          session.baking = false
          const current = sessions.get(pointerId)
          if (!current || current !== session) return
          if (!inkSmoothingRef.current) return
          if (!current.line) return
          const baked = bakePolylineWithTail(current.rawPoints, current.strokeWidth, BAKE_TAIL_POINTS)
          if (baked === current.rawPoints) return
          current.points = baked

          if (!current.nibDynamic) {
            const m = getMeta(current.line)
            if (!m) return
            m.points = baked
            recomputeBounds(m, baked)
            ;(current.line as any).points = baked
            if (current.glowLine) {
              const gm = getMeta(current.glowLine)
              if (gm) {
                gm.points = baked
                recomputeBounds(gm, baked)
              }
              ;(current.glowLine as any).points = baked
            }
            return
          }

          const tailCoords = BAKE_TAIL_POINTS * 2
          const prefixLen = Math.max(0, baked.length - tailCoords)
          const prefix = baked.slice(0, prefixLen)
          const tail = baked.slice(Math.max(0, prefixLen - 2))

          const tailMeta = getMeta(current.line)
          if (tailMeta) {
            tailMeta.points = tail
            recomputeBounds(tailMeta, tail)
          }
          ;(current.line as any).points = tail

          const widthAtT = buildNibWidthAt(current.rawPoints, current.rawTimes, current.strokeWidth) ?? undefined
          const segments = buildNibSegments(prefix, current.strokeWidth, 'dynamic', widthAtT)
          const nextLines: Line[] = []
          for (let i = 0; i < segments.length; i++) {
            const seg = segments[i]
            const existing = current.bakedLines[i]
            if (existing) {
              const em = getMeta(existing)
              if (em) {
                em.strokeWidth = seg.strokeWidth
                em.points = seg.points
                recomputeBounds(em, seg.points)
              }
              ;(existing as any).points = seg.points
              ;(existing as any).strokeWidth = seg.strokeWidth
              nextLines.push(existing)
              continue
            }
            const line = new Line({
              points: seg.points,
              ...current.stroke,
              strokeWidth: seg.strokeWidth
            } as any)
            const p0x = seg.points[0] ?? 0
            const p0y = seg.points[1] ?? 0
            setMeta(line, { role: 'stroke', groupId: current.groupId, strokeWidth: seg.strokeWidth, points: seg.points, minX: p0x, minY: p0y, maxX: p0x, maxY: p0y })
            const meta = getMeta(line)
            if (meta) recomputeBounds(meta, seg.points)
            addNodes([line])
            nextLines.push(line)
          }

          if (current.bakedLines.length > nextLines.length) {
            removeNodes(current.bakedLines.slice(nextLines.length))
          }
          current.bakedLines = nextLines
        })
      }

      const onPointerDown = (e: PointerEvent) => {
        if (!hydrated) return
        if (toolRef.current === 'mouse') {
          view.setPointerCapture(e.pointerId)
          if (e.pointerType === 'touch') {
            const { cx, cy } = getClientPoint(e)
            touchPoints.set(e.pointerId, { cx, cy })
            if (touchPoints.size === 2) {
              const ids = Array.from(touchPoints.keys()).slice(0, 2) as [number, number]
              startPinch(ids)
              return
            }
            if (appMode === 'video-show') {
              mouseToolOp = { kind: 'pan', pointerId: e.pointerId, startCx: cx, startCy: cy, startX: camX, startY: camY }
              return
            }
            const { x, y } = clientToWorld(cx, cy)
            mouseToolOp = { kind: 'lasso', pointerId: e.pointerId, points: [x, y, x, y] }
            updateLassoPreview(mouseToolOp.points)
            return
          }

          if ((e as any).button === 2) {
            const { cx, cy } = getClientPoint(e)
            mouseToolOp = { kind: 'pan', pointerId: e.pointerId, startCx: cx, startCy: cy, startX: camX, startY: camY }
            return
          }

          if ((e as any).button === 0) {
            const { cx, cy } = getClientPoint(e)
            if (appMode === 'video-show') {
              mouseToolOp = { kind: 'pan', pointerId: e.pointerId, startCx: cx, startCy: cy, startX: camX, startY: camY }
              return
            }
            const { x, y } = clientToWorld(cx, cy)
            const pad = 10 / Math.max(0.2, camScale)
            if (selection && isPointInBounds(selection.bounds, x, y, pad)) {
              const mode: 'move' | 'scale' | 'rotate' = e.altKey ? 'rotate' : e.shiftKey ? 'scale' : 'move'
              beginSelectionTransform(e.pointerId, mode, x, y)
              return
            }
            const picked = pickNodesAtPoint(x, y)
            if (!picked.length) setSelection(null, 'mouse')
            else setSelection(picked, 'mouse')
            return
          }
          return
        }
        if (!multiTouchRef.current && sessions.size > 0) return
        view.setPointerCapture(e.pointerId)
        const { x, y } = getPoint(e)
        const laser = toolRef.current === 'pen' && penTypeRef.current === 'laser'
        const session = {
          groupId: nextGroupId++,
          line: null as null | Line,
          glowLine: null as null | Line,
          laser,
          bakedLines: [] as Line[],
          points: [] as number[],
          rawPoints: [] as number[],
          rawTimes: [] as number[],
          erasing: toolRef.current === 'eraser' && eraserTypeRef.current === 'stroke',
          erased: [] as CanvasNode[],
          erasedSet: new Set<CanvasNode>(),
          erasedGroupIds: new Set<number>(),
          strokeWidth: 6,
          stroke: null as any,
          nibDynamic: false,
          smoothX: x,
          smoothY: y,
          hasSmooth: false,
          lastTime: performance.now(),
          baking: false,
          lastBakeAt: 0,
          lastBakeLen: 0
        }
        const p0 = applySmoothing(session, x, y)
        session.rawPoints = [p0.x, p0.y, p0.x, p0.y]
        session.rawTimes = [p0.now, p0.now]
        session.points = session.rawPoints.slice()
        sessions.set(e.pointerId, session)

        if (session.erasing) {
          const radius = eraserThicknessRef.current * 0.5
          for (const node of Array.from(live)) {
            const meta = getMeta(node)
            if (!meta || meta.role !== 'stroke') continue
            const gid = meta.groupId
            if (gid !== undefined) {
              if (session.erasedGroupIds.has(gid)) continue
              if (!hitsLineAtPoint(meta, x, y, radius)) continue
              session.erasedGroupIds.add(gid)
              const groupNodes: CanvasNode[] = []
              for (const other of Array.from(live)) {
                const om = getMeta(other)
                if (!om || om.role !== 'stroke') continue
                if (om.groupId !== gid) continue
                if (session.erasedSet.has(other)) continue
                session.erasedSet.add(other)
                session.erased.push(other)
                groupNodes.push(other)
              }
              removeNodes(groupNodes)
              continue
            }
            if (session.erasedSet.has(node)) continue
            if (!hitsLineAtPoint(meta, x, y, radius)) continue
            session.erasedSet.add(node)
            session.erased.push(node)
            removeNodes([node])
          }
          return
        }

        const role: LineRole = toolRef.current === 'eraser' ? 'eraserPixel' : 'stroke'
        const stroke = effectiveStrokeRef.current as any
        const strokeWidth = typeof stroke?.strokeWidth === 'number' ? stroke.strokeWidth : toolRef.current === 'eraser' ? eraserThicknessRef.current : 6
        session.strokeWidth = strokeWidth
        session.stroke = stroke
        session.nibDynamic = nibModeRef.current === 'dynamic' && toolRef.current === 'pen' && penTypeRef.current === 'writing'
        if (laser && role === 'stroke') {
          const glowExtra = clamp(strokeWidth * 0.7, 4, 22)
          const glowStroke = { ...stroke, stroke: '#ffffff', strokeWidth: strokeWidth + glowExtra, opacity: 0.28 }
          session.glowLine = new Line({ points: session.points, ...glowStroke } as any)
          session.line = new Line({ points: session.points, ...stroke } as any)
          setMeta(session.glowLine, { role, transient: true, groupId: session.groupId, strokeWidth: strokeWidth + glowExtra, points: session.points, minX: p0.x, minY: p0.y, maxX: p0.x, maxY: p0.y })
          setMeta(session.line, { role, transient: true, groupId: session.groupId, strokeWidth, points: session.points, minX: p0.x, minY: p0.y, maxX: p0.x, maxY: p0.y })
          addNodes([session.glowLine, session.line])
        } else {
          session.line = new Line({
            points: session.points,
            ...stroke
          } as any)
          setMeta(session.line, { role, groupId: session.groupId, strokeWidth, points: session.points, minX: p0.x, minY: p0.y, maxX: p0.x, maxY: p0.y })
          addNodes([session.line])
        }
      }

      const onPointerMove = (e: PointerEvent) => {
        if (toolRef.current === 'mouse') {
          if (e.pointerType === 'touch') {
            const { cx, cy } = getClientPoint(e)
            touchPoints.set(e.pointerId, { cx, cy })
            if (mouseToolOp.kind === 'pinch') {
              updatePinch()
              return
            }
            if (touchPoints.size === 2) {
              const ids = Array.from(touchPoints.keys()).slice(0, 2) as [number, number]
              startPinch(ids)
              return
            }
          }

          if (mouseToolOp.kind === 'pan' && mouseToolOp.pointerId === e.pointerId) {
            const { cx, cy } = getClientPoint(e)
            camX = mouseToolOp.startX + (cx - mouseToolOp.startCx)
            camY = mouseToolOp.startY + (cy - mouseToolOp.startCy)
            applyCamera()
            updateSelectionOverlays()
            clearLassoPreview()
            return
          }

          if (mouseToolOp.kind === 'lasso' && mouseToolOp.pointerId === e.pointerId) {
            const { x, y } = getPoint(e)
            mouseToolOp.points.push(x, y)
            updateLassoPreview(mouseToolOp.points)
            try {
              ;(leafer as any).forceRender?.()
            } catch {}
            return
          }

          if (mouseToolOp.kind === 'transform' && mouseToolOp.pointerId === e.pointerId && selection) {
            const { x, y } = getPoint(e)
            const nodes = selection.nodes
            const next: number[][] = []
            if (mouseToolOp.mode === 'move') {
              const dx = x - mouseToolOp.startX
              const dy = y - mouseToolOp.startY
              for (const pts of mouseToolOp.before) next.push(translatePoints(pts, dx, dy))
            } else if (mouseToolOp.mode === 'scale') {
              const dist = Math.max(1e-6, Math.hypot(x - mouseToolOp.centerX, y - mouseToolOp.centerY))
              const s = clamp(dist / mouseToolOp.baseDist, 0.1, 20)
              for (const pts of mouseToolOp.before) next.push(scalePoints(pts, s, mouseToolOp.centerX, mouseToolOp.centerY))
            } else {
              const ang = Math.atan2(y - mouseToolOp.centerY, x - mouseToolOp.centerX)
              const da = ang - mouseToolOp.baseAngle
              for (const pts of mouseToolOp.before) next.push(rotatePoints(pts, da, mouseToolOp.centerX, mouseToolOp.centerY))
            }
            applyMetaPointsFromList(nodes, next)
            return
          }
          return
        }
        const session = sessions.get(e.pointerId)
        if (!session) return
        const evs = typeof (e as any).getCoalescedEvents === 'function' ? (e as any).getCoalescedEvents() : [e]
        let didAppend = false
        let didErase = false

        for (const ev of evs as PointerEvent[]) {
          const { x, y } = getPoint(ev)
          const lastX = session.points[session.points.length - 2]
          const lastY = session.points[session.points.length - 1]
          const p = applySmoothing(session, x, y)
          const dx = p.x - lastX
          const dy = p.y - lastY
          const dist = Math.hypot(dx, dy)
          const minMove = clamp(session.strokeWidth * 0.04, 0.15, 0.45)
          if (dist < minMove) continue
          const speed = dist / Math.max(1, p.dt)
          const baseStep = clamp(session.strokeWidth * 0.34, 0.7, 3.2)
          const step = clamp(baseStep / (1 + speed * 0.08), 0.35, baseStep)
          const cap = clamp(Math.floor(10 + speed * 8), 10, 42)
          const appendedRaw = appendInterpolatedPoints(session.rawPoints, p.x, p.y, step, cap)
          const appended = appendInterpolatedPoints(session.points, p.x, p.y, step, cap)
          didAppend = true

          const appendedPairs = Math.floor(appendedRaw.length / 2)
          if (appendedPairs > 0) {
            const prevT = session.rawTimes.length ? session.rawTimes[session.rawTimes.length - 1] : p.now
            for (let i = 1; i <= appendedPairs; i++) {
              session.rawTimes.push(prevT + (p.dt * i) / appendedPairs)
            }
          }

          if (session.erasing) {
            didErase = true
            const radius = eraserThicknessRef.current * 0.5
            for (const node of Array.from(live)) {
              const meta = getMeta(node)
              if (!meta || meta.role !== 'stroke') continue
              const gid = meta.groupId
              if (gid !== undefined) {
                if (session.erasedGroupIds.has(gid)) continue
                if (!hitsLineAtPoint(meta, x, y, radius)) continue
                session.erasedGroupIds.add(gid)
                const groupNodes: CanvasNode[] = []
                for (const other of Array.from(live)) {
                  const om = getMeta(other)
                  if (!om || om.role !== 'stroke') continue
                  if (om.groupId !== gid) continue
                  if (session.erasedSet.has(other)) continue
                  session.erasedSet.add(other)
                  session.erased.push(other)
                  groupNodes.push(other)
                }
                removeNodes(groupNodes)
                continue
              }
              if (session.erasedSet.has(node)) continue
              if (!hitsLineAtPoint(meta, x, y, radius)) continue
              session.erasedSet.add(node)
              session.erased.push(node)
              removeNodes([node])
            }
            continue
          }

          if (!session.line) continue
          if (!session.nibDynamic) {
            const meta = getMeta(session.line)
            if (meta) {
              for (let i = 0; i + 1 < appended.length; i += 2) updateBounds(meta, appended[i], appended[i + 1])
            }
            if (session.glowLine) {
              const gm = getMeta(session.glowLine)
              if (gm) for (let i = 0; i + 1 < appended.length; i += 2) updateBounds(gm, appended[i], appended[i + 1])
            }
          }
        }

        if (didErase) return
        if (!didAppend) return
        if (!session.line) return

        if (!session.nibDynamic) {
          ;(session.line as any).points = session.points
          if (session.glowLine) {
            ;(session.glowLine as any).points = session.points
          }
          maybeScheduleBake(e.pointerId)
          return
        }

        const meta = getMeta(session.line)
        const tailCoords = BAKE_TAIL_POINTS * 2
        const tailStart = session.bakedLines.length ? Math.max(0, session.points.length - tailCoords - 2) : 0
        const tail = session.points.slice(tailStart)
        if (meta) {
          meta.points = tail
          recomputeBounds(meta, tail)
        }
        ;(session.line as any).points = tail
        maybeScheduleBake(e.pointerId)
      }

      const finish = (e: PointerEvent) => {
        const session = sessions.get(e.pointerId)
        if (!session) return
        sessions.delete(e.pointerId)
        const activeLine = session.line
        const erased = session.erased
        try {
          view.releasePointerCapture(e.pointerId)
        } catch {}

        if (erased.length) record({ kind: 'remove', nodes: erased })
        else if (activeLine) {
          if (session.laser) {
            const nodes: CanvasNode[] = []
            if (session.glowLine) nodes.push(session.glowLine)
            nodes.push(activeLine)
            startLaserFade(nodes)
            return
          }
          if (session.nibDynamic) {
            const full = inkSmoothingRef.current ? bakePolyline(session.rawPoints, session.strokeWidth) : session.rawPoints
            const widthAtT = buildNibWidthAt(session.rawPoints, session.rawTimes, session.strokeWidth) ?? undefined
            const shouldOptimize = inkSmoothingRef.current && (postBakeOptimizeRef.current || postBakeOptimizeOnceRef.current)
            const parts =
              shouldOptimize ? postBakeOptimizePolyline(full, session.strokeWidth) : ({ kind: 'single', points: full } as PostBakeResult)
            removeNodes([activeLine, ...session.bakedLines])

            const next: Line[] = []
            const groups = parts.kind === 'split' ? parts.segments : [{ points: parts.points, t0: 0, t1: 1 } as PostBakeSegment]
            for (const g of groups) {
              const localWidthAtT = widthAtT ? (t: number) => widthAtT(g.t0 + (g.t1 - g.t0) * t) : undefined
              const segments = buildNibSegments(g.points, session.strokeWidth, 'dynamic', localWidthAtT)
              for (const seg of segments) {
                const line = new Line({
                  points: seg.points,
                  ...session.stroke,
                  strokeWidth: seg.strokeWidth
                } as any)
                const p0x = seg.points[0] ?? 0
                const p0y = seg.points[1] ?? 0
                setMeta(line, {
                  role: 'stroke',
                  groupId: session.groupId,
                  strokeWidth: seg.strokeWidth,
                  points: seg.points,
                  minX: p0x,
                  minY: p0y,
                  maxX: p0x,
                  maxY: p0y
                })
                const meta = getMeta(line)
                if (meta) recomputeBounds(meta, seg.points)
                addNodes([line])
                next.push(line)
              }
            }
            record({ kind: 'add', nodes: next })
            if (postBakeOptimizeOnceRef.current && shouldOptimize) consumePostBakeOptimizeOnce()
            return
          }

          if (inkSmoothingRef.current) {
            const meta = getMeta(activeLine)
            const sw = meta?.strokeWidth ?? session.strokeWidth
            const baked = bakePolyline(session.points, sw)
            const shouldOptimize = meta?.role === 'stroke' && (postBakeOptimizeRef.current || postBakeOptimizeOnceRef.current)
            const shouldPerfectFreehand =
              meta?.role === 'stroke' &&
              toolRef.current === 'pen' &&
              penTypeRef.current === 'writing' &&
              (postBakeOptimizeOnceRef.current ?? false) &&
              !(postBakeOptimizeRef.current ?? false)
            if (shouldOptimize) {
              const post = postBakeOptimizePolyline(baked, sw)
              if (post.kind === 'split') {
                removeNodes([activeLine])
                const next: CanvasNode[] = []
                for (const s of post.segments) {
                  if (s.points.length <= 6) continue
                  const p0x = s.points[0] ?? 0
                  const p0y = s.points[1] ?? 0
                  const meta: LineMeta = { role: 'stroke', groupId: session.groupId, strokeWidth: sw, points: s.points, minX: p0x, minY: p0y, maxX: p0x, maxY: p0y }
                  recomputeBounds(meta, s.points)
                  const opacity = typeof (session.stroke as any)?.opacity === 'number' ? (session.stroke as any).opacity : 1
                  const fill = typeof (session.stroke as any)?.stroke === 'string' ? (session.stroke as any).stroke : '#000000'
                  if (shouldPerfectFreehand) {
                    const outline = getStroke(pointsToPerfectFreehandInput(s.points), {
                      size: sw,
                      thinning: 0.7,
                      smoothing: 0.6,
                      streamline: 0.5,
                      simulatePressure: true
                    })
                    if (outline.length >= 3) {
                      const polyPoints: number[] = []
                      for (const p of outline as unknown as [number, number][]) polyPoints.push(p[0], p[1])
                      const poly = new Polygon({ points: polyPoints, fill, opacity } as any)
                      setMeta(poly as any, meta)
                      addNodes([poly])
                      next.push(poly)
                    } else {
                      const line = new Line({ points: s.points, ...session.stroke, strokeWidth: sw } as any)
                      setMeta(line, meta)
                      addNodes([line])
                      next.push(line)
                    }
                  } else {
                    const line = new Line({ points: s.points, ...session.stroke, strokeWidth: sw } as any)
                    setMeta(line, meta)
                    addNodes([line])
                    next.push(line)
                  }
                }
                if (next.length) record({ kind: 'add', nodes: next })
                if (postBakeOptimizeOnceRef.current) consumePostBakeOptimizeOnce()
                return
              }
              if (shouldPerfectFreehand) {
                removeNodes([activeLine])
                const outline = getStroke(pointsToPerfectFreehandInput(post.points), {
                  size: sw,
                  thinning: 0.7,
                  smoothing: 0.6,
                  streamline: 0.5,
                  simulatePressure: true
                })
                if (outline.length >= 3) {
                  const polyPoints: number[] = []
                  for (const p of outline as unknown as [number, number][]) polyPoints.push(p[0], p[1])
                  const opacity = typeof (session.stroke as any)?.opacity === 'number' ? (session.stroke as any).opacity : 1
                  const fill = typeof (session.stroke as any)?.stroke === 'string' ? (session.stroke as any).stroke : '#000000'
                  const poly = new Polygon({ points: polyPoints, fill, opacity } as any)
                  const p0x = post.points[0] ?? 0
                  const p0y = post.points[1] ?? 0
                  const nextMeta: LineMeta = { role: 'stroke', groupId: session.groupId, strokeWidth: sw, points: post.points, minX: p0x, minY: p0y, maxX: p0x, maxY: p0y }
                  recomputeBounds(nextMeta, post.points)
                  setMeta(poly as any, nextMeta)
                  addNodes([poly])
                  record({ kind: 'add', nodes: [poly] })
                  if (postBakeOptimizeOnceRef.current) consumePostBakeOptimizeOnce()
                  return
                }
                const line = new Line({ points: post.points, ...session.stroke, strokeWidth: sw } as any)
                const p0x = post.points[0] ?? 0
                const p0y = post.points[1] ?? 0
                const nextMeta: LineMeta = { role: 'stroke', groupId: session.groupId, strokeWidth: sw, points: post.points, minX: p0x, minY: p0y, maxX: p0x, maxY: p0y }
                recomputeBounds(nextMeta, post.points)
                setMeta(line, nextMeta)
                addNodes([line])
                record({ kind: 'add', nodes: [line] })
                if (postBakeOptimizeOnceRef.current) consumePostBakeOptimizeOnce()
                return
              }
              if (meta) {
                meta.points = post.points
                recomputeBounds(meta, post.points)
              }
              ;(activeLine as any).points = post.points
              if (postBakeOptimizeOnceRef.current) consumePostBakeOptimizeOnce()
            } else {
              if (shouldPerfectFreehand) {
                removeNodes([activeLine])
                const outline = getStroke(pointsToPerfectFreehandInput(baked), {
                  size: sw,
                  thinning: 0.7,
                  smoothing: 0.6,
                  streamline: 0.5,
                  simulatePressure: true
                })
                if (outline.length >= 3) {
                  const polyPoints: number[] = []
                  for (const p of outline as unknown as [number, number][]) polyPoints.push(p[0], p[1])
                  const opacity = typeof (session.stroke as any)?.opacity === 'number' ? (session.stroke as any).opacity : 1
                  const fill = typeof (session.stroke as any)?.stroke === 'string' ? (session.stroke as any).stroke : '#000000'
                  const poly = new Polygon({ points: polyPoints, fill, opacity } as any)
                  const p0x = baked[0] ?? 0
                  const p0y = baked[1] ?? 0
                  const nextMeta: LineMeta = { role: 'stroke', groupId: session.groupId, strokeWidth: sw, points: baked, minX: p0x, minY: p0y, maxX: p0x, maxY: p0y }
                  recomputeBounds(nextMeta, baked)
                  setMeta(poly as any, nextMeta)
                  addNodes([poly])
                  record({ kind: 'add', nodes: [poly] })
                  if (postBakeOptimizeOnceRef.current) consumePostBakeOptimizeOnce()
                  return
                }
                const line = new Line({ points: baked, ...session.stroke, strokeWidth: sw } as any)
                const p0x = baked[0] ?? 0
                const p0y = baked[1] ?? 0
                const nextMeta: LineMeta = { role: 'stroke', groupId: session.groupId, strokeWidth: sw, points: baked, minX: p0x, minY: p0y, maxX: p0x, maxY: p0y }
                recomputeBounds(nextMeta, baked)
                setMeta(line, nextMeta)
                addNodes([line])
                record({ kind: 'add', nodes: [line] })
                if (postBakeOptimizeOnceRef.current) consumePostBakeOptimizeOnce()
                return
              }
              if (meta) {
                meta.points = baked
                recomputeBounds(meta, baked)
              }
              ;(activeLine as any).points = baked
            }
          }
          record({ kind: 'add', nodes: [activeLine] })
        }
      }

      const onPointerUp = (e: PointerEvent) => {
        if (sessions.has(e.pointerId)) {
          finish(e)
          return
        }
        if (mouseToolOp.kind === 'transform' && mouseToolOp.pointerId === e.pointerId) {
          try {
            view.releasePointerCapture(e.pointerId)
          } catch {}
          finishSelectionTransform()
          return
        }
        if (mouseToolOp.kind === 'pan' && mouseToolOp.pointerId === e.pointerId) {
          try {
            view.releasePointerCapture(e.pointerId)
          } catch {}
          mouseToolOp = { kind: 'none' }
          return
        }
        if (mouseToolOp.kind === 'lasso' && mouseToolOp.pointerId === e.pointerId) {
          try {
            view.releasePointerCapture(e.pointerId)
          } catch {}
          if (e.pointerType === 'touch') touchPoints.delete(e.pointerId)
          const pts = mouseToolOp.points.slice()
          mouseToolOp = { kind: 'none' }
          clearLassoPreview()
          if (pts.length >= 6) {
            const closed = pts.slice()
            closed.push(closed[0], closed[1])
            const picked = pickNodesInLasso(closed)
            if (picked.length) setSelection(picked, 'touch')
            else setSelection(null, 'touch')
          } else {
            setSelection(null, 'touch')
          }
          return
        }
        if (e.pointerType === 'touch') {
          touchPoints.delete(e.pointerId)
          if (mouseToolOp.kind === 'pinch') {
            if (!touchPoints.has(mouseToolOp.ids[0]) || !touchPoints.has(mouseToolOp.ids[1])) {
              try {
                view.releasePointerCapture(e.pointerId)
              } catch {}
              if (mouseToolOp.target === 'selection' && selection) {
                const nodes = selection.nodes.slice()
                const beforePoints = mouseToolOp.before.map((p) => p.slice())
                const afterPoints: number[][] = []
                for (const node of nodes) {
                  const meta = getMeta(node)
                  afterPoints.push(meta?.points ? meta.points.slice() : [])
                }
                record({ kind: 'update', nodes, beforePoints, afterPoints })
              }
              mouseToolOp = { kind: 'none' }
            }
          }
        }
      }

      const onPointerCancel = (e: PointerEvent) => {
        if (sessions.has(e.pointerId)) {
          finish(e)
          return
        }
        if (e.pointerType === 'touch') touchPoints.delete(e.pointerId)
        clearLassoPreview()
        if (mouseToolOp.kind === 'transform') finishSelectionTransform()
        else if (mouseToolOp.kind === 'pinch' && mouseToolOp.target === 'selection' && selection) {
          const nodes = selection.nodes.slice()
          const beforePoints = mouseToolOp.before.map((p) => p.slice())
          const afterPoints: number[][] = []
          for (const node of nodes) {
            const meta = getMeta(node)
            afterPoints.push(meta?.points ? meta.points.slice() : [])
          }
          record({ kind: 'update', nodes, beforePoints, afterPoints })
          mouseToolOp = { kind: 'none' }
        }
        else mouseToolOp = { kind: 'none' }
        try {
          view.releasePointerCapture(e.pointerId)
        } catch {}
      }

      const onWheel = (e: WheelEvent) => {
        if (!hydrated) return
        if (toolRef.current !== 'mouse') return
        e.preventDefault()
        const r = view.getBoundingClientRect()
        const cx = e.clientX - r.left
        const cy = e.clientY - r.top
        const w = clientToWorld(cx, cy)
        if (appMode === 'video-show' && e.altKey) {
          camRot = camRot + (e.deltaY > 0 ? -1 : 1) * 0.06
        } else {
          const factor = e.deltaY > 0 ? 0.9 : 1.1
          camScale = clamp(camScale * factor, 0.2, 6)
        }
        const cos = Math.cos(camRot)
        const sin = Math.sin(camRot)
        camX = cx - camScale * (w.x * cos - w.y * sin)
        camY = cy - camScale * (w.x * sin + w.y * cos)
        applyCamera()
        updateSelectionOverlays()
        clearLassoPreview()
      }

      const onContextMenu = (e: MouseEvent) => {
        if (toolRef.current !== 'mouse') return
        e.preventDefault()
      }

      const ro = new ResizeObserver(() => {
        const r = view.getBoundingClientRect()
        ;(leafer as any).resize?.(Math.max(1, Math.floor(r.width)), Math.max(1, Math.floor(r.height)))
      })
      ro.observe(view)

      view.addEventListener('pointerdown', onPointerDown)
      view.addEventListener('pointermove', onPointerMove)
      view.addEventListener('pointerup', onPointerUp)
      view.addEventListener('pointercancel', onPointerCancel)
      view.addEventListener('wheel', onWheel, { passive: false } as any)
      view.addEventListener('contextmenu', onContextMenu)

      return () => {
        if (persistTimer !== null) window.clearTimeout(persistTimer)
        persistNow()
        ro.disconnect()
        view.removeEventListener('pointerdown', onPointerDown)
        view.removeEventListener('pointermove', onPointerMove)
        view.removeEventListener('pointerup', onPointerUp)
        view.removeEventListener('pointercancel', onPointerCancel)
        view.removeEventListener('wheel', onWheel as any)
        view.removeEventListener('contextmenu', onContextMenu as any)
        apiRef.current = null
        try {
          view.replaceChildren()
        } catch {}
        disposeParentLayout()
        ;(leafer as any).destroy?.()
      }
    }

    const useSvg = rendererEngine === 'svg'
    const svgNS = 'http://www.w3.org/2000/svg'
    const svg = useSvg ? document.createElementNS(svgNS, 'svg') : null
    const svgLayer = useSvg ? document.createElementNS(svgNS, 'g') : null
    const overlaySvg = useSvg ? svg : document.createElementNS(svgNS, 'svg')
    const overlayLayer = document.createElementNS(svgNS, 'g')
    const canvas = useSvg ? null : document.createElement('canvas')

    if (canvas) {
      canvas.style.position = 'absolute'
      canvas.style.left = '0'
      canvas.style.top = '0'
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      canvas.style.display = 'block'
      view.appendChild(canvas)
    }

    if (svg && svgLayer) {
      svg.style.position = 'absolute'
      svg.style.left = '0'
      svg.style.top = '0'
      svg.style.width = '100%'
      svg.style.height = '100%'
      svg.style.display = 'block'
      ;(svg.style as any).pointerEvents = 'none'
      svg.setAttribute('preserveAspectRatio', 'none')
      svg.appendChild(svgLayer)
      svg.appendChild(overlayLayer)
      view.appendChild(svg)
    }

    if (overlaySvg && !useSvg) {
      overlaySvg.style.position = 'absolute'
      overlaySvg.style.left = '0'
      overlaySvg.style.top = '0'
      overlaySvg.style.width = '100%'
      overlaySvg.style.height = '100%'
      overlaySvg.style.display = 'block'
      ;(overlaySvg.style as any).pointerEvents = 'none'
      overlaySvg.setAttribute('preserveAspectRatio', 'none')
      overlaySvg.appendChild(overlayLayer)
      view.appendChild(overlaySvg)
    }

    const resizeSurface = () => {
      const r = view.getBoundingClientRect()
      const cssW = Math.max(1, Math.floor(r.width))
      const cssH = Math.max(1, Math.floor(r.height))
      if (overlaySvg) overlaySvg.setAttribute('viewBox', `0 0 ${cssW} ${cssH}`)
      if (canvas) {
        const dpr = Math.max(1, globalThis.devicePixelRatio || 1)
        canvas.width = Math.max(1, Math.floor(cssW * dpr))
        canvas.height = Math.max(1, Math.floor(cssH * dpr))
      }
    }
    resizeSurface()

    type RenderNode = {
      role: 'stroke' | 'eraserPixel'
      pfh: boolean
      strokeWidth: number
      points: number[]
      meta: LineMeta
      color: [number, number, number, number]
      fadeStartAt?: number
      fadeDurationMs?: number
    }

    type Action =
      | { kind: 'add'; nodes: RenderNode[] }
      | { kind: 'remove'; nodes: RenderNode[] }
      | { kind: 'update'; nodes: RenderNode[]; beforePoints: number[][]; afterPoints: number[][] }
    const live = new Set<RenderNode>()
    const order: RenderNode[] = []
    const history = { undo: [] as Action[], redo: [] as Action[] }
    const fading = new Map<RenderNode, { startAt: number; durationMs: number; basePoints: number[]; cumLen: number[]; totalLen: number }>()
    let fadeScheduled = false

    const nodeToSvgPath = useSvg ? new Map<RenderNode, SVGPathElement>() : null
    const svgDirty = useSvg ? new Set<RenderNode>() : null

    let nextGroupId = 1
    let hydrated = false
    let camX = 0
    let camY = 0
    let camScale = 1
    let camRot = 0

    let lastVideoShowViewKey = ''
    const publishVideoShowView = () => {
      if (appMode !== 'video-show') return
      const payload: VideoShowViewTransform = { x: camX, y: camY, scale: camScale, rot: camRot }
      const k = `${Math.round(camX * 1000)},${Math.round(camY * 1000)},${Math.round(camScale * 10000)},${Math.round(camRot * 100000)}`
      if (k === lastVideoShowViewKey) return
      lastVideoShowViewKey = k
      setUiStateKeyRef.current(VIDEO_SHOW_VIEW_UI_STATE_KEY, payload).catch(() => undefined)
    }

    const rgbaFromHex = (hex: string, opacity: number): [number, number, number, number] => {
      const parsed = parseHexColor(hex)
      if (!parsed) return [0, 0, 0, Math.max(0, Math.min(1, opacity))]
      return [parsed.r / 255, parsed.g / 255, parsed.b / 255, Math.max(0, Math.min(1, opacity))]
    }

    serializePersistedDoc = () => {
      const nodes: PersistedAnnotationNodeV1[] = []
      for (const n of order) {
        if (!live.has(n)) continue
        if (n.meta.transient) continue
        if (!Array.isArray(n.points) || n.points.length < 4) continue
        const r = Math.round(n.color[0] * 255)
        const g = Math.round(n.color[1] * 255)
        const b = Math.round(n.color[2] * 255)
        const a = Math.max(0, Math.min(1, n.color[3]))
        const color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
        nodes.push({
          role: n.role,
          groupId: typeof n.meta.groupId === 'number' && Number.isFinite(n.meta.groupId) ? n.meta.groupId : undefined,
          strokeWidth: n.strokeWidth,
          points: n.points.slice(),
          color,
          opacity: a,
          pfh: n.pfh
        })
      }
      return { version: 1, nodes }
    }

    const loadDoc = (doc: PersistedAnnotationDocV1) => {
      if (live.size) removeNodes(Array.from(live))
      history.undo.length = 0
      history.redo.length = 0

      let maxGroupId = 0
      const add: RenderNode[] = []
      for (const n of doc.nodes) {
        if (!Array.isArray(n.points) || n.points.length < 4) continue
        const p0x = n.points[0] ?? 0
        const p0y = n.points[1] ?? 0
        const meta: LineMeta = { role: n.role, groupId: n.groupId, strokeWidth: n.strokeWidth, points: n.points.slice(), minX: p0x, minY: p0y, maxX: p0x, maxY: p0y }
        recomputeBounds(meta, meta.points)
        if (typeof meta.groupId === 'number' && Number.isFinite(meta.groupId)) maxGroupId = Math.max(maxGroupId, meta.groupId)
        const opacity = typeof n.opacity === 'number' && Number.isFinite(n.opacity) ? n.opacity : 1
        const color = n.role === 'eraserPixel' ? ([0, 0, 0, 1] as [number, number, number, number]) : rgbaFromHex(typeof n.color === 'string' ? n.color : '#000000', opacity)
        add.push({ role: n.role, pfh: !!n.pfh, strokeWidth: n.strokeWidth, points: meta.points.slice(), meta, color })
      }
      if (add.length) addNodes(add)
      nextGroupId = Math.max(1, maxGroupId + 1)
      requestRender()
    }

    const setPage = (index: number, total: number) => {
      const boundedIndex = Math.max(0, Math.min(Math.max(1, Math.floor(total)) - 1, Math.floor(index)))
      const boundedTotal = Math.max(1, Math.floor(total))
      if (boundedIndex === notesPageIndex && boundedTotal === notesPageTotal) return
      persistNow()
      ensureBookShape(boundedIndex, boundedTotal)
      loadDoc(notesBook.pages[notesPageIndex] ?? createEmptyDocV1())
      putKv(notesKvKey, notesBook).catch(() => undefined)
    }

    const hydrate = async () => {
      try {
        if (!rotatedNotesKvKeys.has(notesKvKey)) {
          rotatedNotesKvKeys.add(notesKvKey)

          let prev: PersistedAnnotationBookV2 | null = null
          try {
            const loaded = await getKv<unknown>(notesKvKey)
            if (isPersistedAnnotationBookV2(loaded)) prev = loaded
            else if (isPersistedAnnotationDocV1(loaded)) prev = { version: 2, currentPage: 0, pages: [loaded] }
          } catch {}

          if (prev) putKv(notesHistoryKvKey, prev).catch(() => undefined)

          notesBook = { version: 2, currentPage: 0, pages: [createEmptyDocV1()] }
          ensureBookShape(0, 1)
          loadDoc(notesBook.pages[notesPageIndex] ?? createEmptyDocV1())
          putKv(notesKvKey, notesBook).catch(() => undefined)
          void putUiStateKey(UI_STATE_APP_WINDOW_ID, NOTES_PAGE_TOTAL_UI_STATE_KEY, notesPageTotal)
          void putUiStateKey(UI_STATE_APP_WINDOW_ID, NOTES_PAGE_INDEX_UI_STATE_KEY, notesPageIndex)
          return
        }

        const loaded = await getKv<unknown>(notesKvKey)
        if (isPersistedAnnotationBookV2(loaded)) {
          notesBook = loaded
        } else if (isPersistedAnnotationDocV1(loaded)) {
          notesBook = { version: 2, currentPage: 0, pages: [loaded] }
        } else {
          ensureBookShape(0, 1)
          loadDoc(notesBook.pages[notesPageIndex] ?? createEmptyDocV1())
          return
        }

        const initialTotal = Math.max(1, notesBook.pages.length)
        const initialIndex = Number.isFinite(notesBook.currentPage) ? notesBook.currentPage : 0
        ensureBookShape(initialIndex, initialTotal)
        loadDoc(notesBook.pages[notesPageIndex] ?? createEmptyDocV1())
        putKv(notesKvKey, notesBook).catch(() => undefined)
        void putUiStateKey(UI_STATE_APP_WINDOW_ID, NOTES_PAGE_TOTAL_UI_STATE_KEY, notesPageTotal)
        void putUiStateKey(UI_STATE_APP_WINDOW_ID, NOTES_PAGE_INDEX_UI_STATE_KEY, notesPageIndex)
      } catch {
        return
      } finally {
        hydrated = true
        requestRender()
      }
    }

    void hydrate()

    const buildCumLen = (points: number[]) => {
      const n = Math.floor(points.length / 2)
      if (n <= 1) return { cumLen: [0], totalLen: 0 }
      const cumLen = new Array<number>(n)
      cumLen[0] = 0
      let totalLen = 0
      let lastX = points[0]
      let lastY = points[1]
      for (let i = 1; i < n; i++) {
        const x = points[i * 2]
        const y = points[i * 2 + 1]
        totalLen += Math.hypot(x - lastX, y - lastY)
        cumLen[i] = totalLen
        lastX = x
        lastY = y
      }
      return { cumLen, totalLen }
    }

    const findPairIndexByLen = (cumLen: number[], targetLen: number) => {
      let lo = 0
      let hi = cumLen.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (cumLen[mid] < targetLen) lo = mid + 1
        else hi = mid
      }
      return lo
    }

    const ensureFadeTick = () => {
      if (fadeScheduled) return
      if (!fading.size) return
      fadeScheduled = true
      requestAnimationFrame(() => {
        fadeScheduled = false
        if (cancelled) return
        if (!fading.size) return
        const now = performance.now()
        const expired: RenderNode[] = []
        for (const [n, f] of fading) {
          const t = (now - f.startAt) / f.durationMs
          if (t >= 1) {
            fading.delete(n)
            expired.push(n)
            continue
          }
          if (t <= 0) continue
          if (f.totalLen <= 0.001) continue
          const targetLen = f.totalLen * t
          const maxStart = Math.max(0, f.cumLen.length - 2)
          const startPair = Math.min(maxStart, findPairIndexByLen(f.cumLen, targetLen))
          const sliced = f.basePoints.slice(startPair * 2)
          if (sliced.length < 4) {
            fading.delete(n)
            expired.push(n)
            continue
          }
          n.points = sliced
          n.meta.points = sliced
          recomputeBounds(n.meta, sliced)
          svgDirty?.add(n)
        }
        if (expired.length) removeNodes(expired)
        requestRender()
        ensureFadeTick()
      })
    }

    const startLaserFade = (nodes: RenderNode[]) => {
      const now = performance.now()
      for (const n of nodes) {
        const basePoints = n.points.slice()
        const { cumLen, totalLen } = buildCumLen(basePoints)
        fading.set(n, { startAt: now + 200, durationMs: 1200, basePoints, cumLen, totalLen })
        svgDirty?.add(n)
      }
      requestRender()
      ensureFadeTick()
    }

    const pointsToSvgPathD = (points: number[]): string => {
      if (points.length < 4) return ''
      const parts: string[] = []
      parts.push('M', String(points[0]), String(points[1]))
      for (let i = 2; i + 1 < points.length; i += 2) parts.push('L', String(points[i]), String(points[i + 1]))
      return parts.join(' ')
    }

    const outlineToSvgPathD = (outline: [number, number][]): string => {
      if (!outline.length) return ''
      const parts: string[] = []
      parts.push('M', String(outline[0][0]), String(outline[0][1]))
      for (let i = 1; i < outline.length; i++) parts.push('L', String(outline[i][0]), String(outline[i][1]))
      parts.push('Z')
      return parts.join(' ')
    }

    const syncSvgNode = (node: RenderNode) => {
      if (!nodeToSvgPath || !svgLayer) return
      if (node.role !== 'stroke') return
      const path = nodeToSvgPath.get(node)
      if (!path) return
      const r = Math.round(node.color[0] * 255)
      const g = Math.round(node.color[1] * 255)
      const b = Math.round(node.color[2] * 255)
      const a = Math.max(0, Math.min(1, node.color[3]))
      if (node.pfh) {
        const outline = getStroke(pointsToPerfectFreehandInput(node.points), {
          size: node.strokeWidth,
          thinning: 0.7,
          smoothing: 0.6,
          streamline: 0.5,
          simulatePressure: true
        })
        path.setAttribute('fill', `rgb(${r} ${g} ${b})`)
        path.setAttribute('fill-opacity', String(a))
        path.setAttribute('stroke', 'none')
        path.removeAttribute('stroke-opacity')
        path.removeAttribute('stroke-width')
        path.removeAttribute('stroke-linecap')
        path.removeAttribute('stroke-linejoin')
        path.setAttribute('d', outlineToSvgPathD(outline as [number, number][]))
        return
      }
      path.setAttribute('fill', 'none')
      path.removeAttribute('fill-opacity')
      path.setAttribute('stroke', `rgb(${r} ${g} ${b})`)
      path.setAttribute('stroke-opacity', String(a))
      path.setAttribute('stroke-width', String(Math.max(0.1, node.strokeWidth)))
      path.setAttribute('stroke-linecap', 'round')
      path.setAttribute('stroke-linejoin', 'round')
      path.setAttribute('d', pointsToSvgPathD(node.points))
    }

    const addNodes = (nodes: RenderNode[]) => {
      for (const n of nodes) {
        if (live.has(n)) continue
        live.add(n)
        order.push(n)
        if (nodeToSvgPath && svgLayer && n.role === 'stroke') {
          const path = document.createElementNS(svgNS, 'path')
          nodeToSvgPath.set(n, path)
          svgLayer.appendChild(path)
          syncSvgNode(n)
          svgDirty?.add?.(n)
        }
      }
    }

    const removeNodes = (nodes: RenderNode[]) => {
      const set = new Set(nodes)
      for (const n of set) live.delete(n)
      if (!set.size) return
      for (const n of set) fading.delete(n)
      for (let i = order.length - 1; i >= 0; i--) {
        if (set.has(order[i])) order.splice(i, 1)
      }
      if (nodeToSvgPath) {
        for (const n of set) {
          const el = nodeToSvgPath.get(n)
          if (!el) continue
          nodeToSvgPath.delete(n)
          try {
            el.remove()
          } catch {}
        }
      }
    }

    const record = (action: Action) => {
      history.undo.push(action)
      history.redo.length = 0
      schedulePersist()
    }

    const undo = () => {
      const action = history.undo.pop()
      if (!action) return
      if (action.kind === 'add') removeNodes(action.nodes)
      else if (action.kind === 'remove') addNodes(action.nodes)
      else {
        for (let i = 0; i < action.nodes.length; i++) {
          const n = action.nodes[i]
          if (!live.has(n)) continue
          const pts = action.beforePoints[i] ?? []
          n.points = pts
          n.meta.points = pts
          recomputeBounds(n.meta, pts)
          markSvgDirty(n)
        }
        if (selection) {
          const b = computeBounds(selection.nodes)
          if (b) selection.bounds = b
          updateSelectionOverlays()
        }
      }
      history.redo.push(action)
      requestRender()
      schedulePersist()
    }

    const redo = () => {
      const action = history.redo.pop()
      if (!action) return
      if (action.kind === 'add') addNodes(action.nodes)
      else if (action.kind === 'remove') removeNodes(action.nodes)
      else {
        for (let i = 0; i < action.nodes.length; i++) {
          const n = action.nodes[i]
          if (!live.has(n)) continue
          const pts = action.afterPoints[i] ?? []
          n.points = pts
          n.meta.points = pts
          recomputeBounds(n.meta, pts)
          markSvgDirty(n)
        }
        if (selection) {
          const b = computeBounds(selection.nodes)
          if (b) selection.bounds = b
          updateSelectionOverlays()
        }
      }
      history.undo.push(action)
      requestRender()
      schedulePersist()
    }

    const clear = () => {
      if (!live.size) return
      const nodes = Array.from(live)
      removeNodes(nodes)
      record({ kind: 'remove', nodes })
      requestRender()
    }

    apiRef.current = { undo, redo, clear, setPage, reloadNotes: () => void hydrate() }
    lastUndoRevRef.current = undoRev
    lastRedoRevRef.current = redoRev
    lastClearRevRef.current = clearRev

    const sessions = new Map<
      number,
      {
        groupId: number
        node: null | RenderNode
        glowNode: null | RenderNode
        laser: boolean
        bakedNodes: RenderNode[]
        points: number[]
        rawPoints: number[]
        rawTimes: number[]
        erasingStroke: boolean
        erased: RenderNode[]
        erasedSet: Set<RenderNode>
        erasedGroupIds: Set<number>
        strokeWidth: number
        color: [number, number, number, number]
        nibDynamic: boolean
        smoothX: number
        smoothY: number
        hasSmooth: boolean
        lastTime: number
        baking: boolean
        lastBakeAt: number
        lastBakeLen: number
      }
    >()

    const getClientPoint = (e: PointerEvent) => {
      const r = view.getBoundingClientRect()
      const cx = e.clientX - r.left
      const cy = e.clientY - r.top
      return { cx, cy }
    }

    const clientToWorld = (cx: number, cy: number) => {
      const dx = cx - camX
      const dy = cy - camY
      const s = Math.max(0.0001, camScale)
      const cos = Math.cos(camRot)
      const sin = Math.sin(camRot)
      const x = (dx * cos + dy * sin) / s
      const y = (-dx * sin + dy * cos) / s
      return { x, y }
    }

    const getPoint = (e: PointerEvent) => {
      const { cx, cy } = getClientPoint(e)
      return clientToWorld(cx, cy)
    }

    const applySmoothing = (session: { smoothX: number; smoothY: number; hasSmooth: boolean; lastTime: number }, x: number, y: number) => {
      const now = performance.now()
      const dt = Math.max(1, now - (session.lastTime || now))
      session.lastTime = now
      if (!inkSmoothingRef.current) return { x, y, dt, now }
      if (!session.hasSmooth) {
        session.hasSmooth = true
        session.smoothX = x
        session.smoothY = y
        return { x, y, dt, now }
      }
      const dx = x - session.smoothX
      const dy = y - session.smoothY
      const speed = Math.hypot(dx, dy) / dt
      const a = clamp(0.22 + speed * 0.28, 0.22, 0.78)
      const nx = session.smoothX + dx * a
      const ny = session.smoothY + dy * a
      session.smoothX = nx
      session.smoothY = ny
      return { x: nx, y: ny, dt, now }
    }

    const BAKE_TAIL_POINTS = 8
    const BAKE_MIN_NEW_COORDS = 24
    const BAKE_MIN_INTERVAL_MS = 56

    const maybeScheduleBake = (pointerId: number) => {
      const session = sessions.get(pointerId)
      if (!session) return
      if (!inkSmoothingRef.current) return
      if (!session.node) return
      const now = performance.now()
      const newCoords = session.rawPoints.length - session.lastBakeLen
      if (newCoords < BAKE_MIN_NEW_COORDS && now - session.lastBakeAt < BAKE_MIN_INTERVAL_MS) return
      if (session.baking) return
      session.lastBakeAt = now
      session.lastBakeLen = session.rawPoints.length
      session.baking = true
      requestAnimationFrame(() => {
        session.baking = false
        const current = sessions.get(pointerId)
        if (!current || current !== session) return
        if (!inkSmoothingRef.current) return
        const node = current.node
        if (!node) return
        const baked = bakePolylineWithTail(current.rawPoints, current.strokeWidth, BAKE_TAIL_POINTS)
        if (baked === current.rawPoints) return
        current.points = baked

        if (!current.nibDynamic) {
          node.points = baked
          node.meta.points = baked
          recomputeBounds(node.meta, baked)
          svgDirty?.add(node)
          if (current.glowNode) {
            current.glowNode.points = baked
            current.glowNode.meta.points = baked
            recomputeBounds(current.glowNode.meta, baked)
            svgDirty?.add(current.glowNode)
          }
          requestRender()
          return
        }

        const tailCoords = BAKE_TAIL_POINTS * 2
        const prefixLen = Math.max(0, baked.length - tailCoords)
        const prefix = baked.slice(0, prefixLen)
        const tail = baked.slice(Math.max(0, prefixLen - 2))

        node.points = tail
        node.meta.points = tail
        recomputeBounds(node.meta, tail)
        svgDirty?.add(node)

        const widthAtT = buildNibWidthAt(current.rawPoints, current.rawTimes, current.strokeWidth) ?? undefined
        const segments = buildNibSegments(prefix, current.strokeWidth, 'dynamic', widthAtT)
        const nextNodes: RenderNode[] = []
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i]
          const existing = current.bakedNodes[i]
          if (existing) {
            existing.strokeWidth = seg.strokeWidth
            existing.points = seg.points
            existing.meta.strokeWidth = seg.strokeWidth
            existing.meta.points = seg.points
            existing.meta.groupId = current.groupId
            recomputeBounds(existing.meta, seg.points)
            svgDirty?.add(existing)
            nextNodes.push(existing)
            continue
          }
          const p0x = seg.points[0] ?? 0
          const p0y = seg.points[1] ?? 0
          const meta: LineMeta = { role: 'stroke', groupId: current.groupId, strokeWidth: seg.strokeWidth, points: seg.points, minX: p0x, minY: p0y, maxX: p0x, maxY: p0y }
          recomputeBounds(meta, seg.points)
          const n: RenderNode = { role: 'stroke', pfh: false, strokeWidth: seg.strokeWidth, points: seg.points, meta, color: current.color }
          addNodes([n])
          svgDirty?.add(n)
          nextNodes.push(n)
        }

        if (current.bakedNodes.length > nextNodes.length) {
          removeNodes(current.bakedNodes.slice(nextNodes.length))
        }
        current.bakedNodes = nextNodes

        removeNodes([node])
        addNodes([node])
        svgDirty?.add(node)
        requestRender()
      })
    }

    let cancelled = false
    type DrawNode = Pick<RenderNode, 'role' | 'pfh' | 'strokeWidth' | 'points' | 'color' | 'fadeStartAt' | 'fadeDurationMs'>
    let webgpu: null | { configure: () => void; draw: (nodes: DrawNode[]) => void } = null
    const webgl = canvas ? createWebGLRenderer(canvas) : null

    const init = async () => {
      if (canvas && rendererEngine === 'webgpu') {
        try {
          const r = await createWebGPURenderer(canvas)
          if (cancelled) return
          webgpu = r
        } catch {
          webgpu = null
        }
      }
      requestRender()
    }

    let scheduled = false
    const requestRender = () => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        if (cancelled) return
        if (useSvg) {
          if (svgDirty && svgDirty.size) {
            for (const n of svgDirty) syncSvgNode(n)
            svgDirty.clear()
          }
          return
        }
        const needsCamera = camX !== 0 || camY !== 0 || camScale !== 1 || camRot !== 0
        const nodes: DrawNode[] = order.slice()
        const screenNodes: DrawNode[] | null = needsCamera
          ? nodes.map((n) => {
              const pts = n.points
              const out = new Array<number>(pts.length)
              const cos = Math.cos(camRot)
              const sin = Math.sin(camRot)
              for (let i = 0; i + 1 < pts.length; i += 2) {
                out[i] = (pts[i] * cos - pts[i + 1] * sin) * camScale + camX
                out[i + 1] = (pts[i] * sin + pts[i + 1] * cos) * camScale + camY
              }
              return { ...n, strokeWidth: n.strokeWidth * camScale, points: out }
            })
          : null
        if (webgpu) {
          try {
            webgpu.draw(screenNodes ?? nodes)
            return
          } catch {
            webgpu = null
          }
        }
        if (webgl) {
          try {
            webgl.draw(screenNodes ?? nodes)
          } catch {}
        }
      })
    }
    void init()

    const markSvgDirty = (n: RenderNode) => {
      if (!svgDirty) return
      svgDirty.add(n)
    }

    type Selection = { nodes: RenderNode[]; bounds: { minX: number; minY: number; maxX: number; maxY: number } }
    let selection: null | Selection = null
    let selectionOverlayKind: 'mouse' | 'touch' = 'mouse'
    let selectionBoxEl: null | SVGPathElement = null
    let selectionCurveEl: null | SVGPathElement = null
    let lassoEl: null | SVGPathElement = null

    const clearSelectionOverlays = () => {
      if (selectionBoxEl) {
        try {
          selectionBoxEl.remove()
        } catch {}
        selectionBoxEl = null
      }
      if (selectionCurveEl) {
        try {
          selectionCurveEl.remove()
        } catch {}
        selectionCurveEl = null
      }
    }

    const clearLassoPreview = () => {
      if (lassoEl) {
        try {
          lassoEl.remove()
        } catch {}
        lassoEl = null
      }
    }

    const updateLassoPreview = (points: number[]) => {
      const strokeWidth = 1 / Math.max(0.2, camScale)
      if (!lassoEl) {
        lassoEl = document.createElementNS(svgNS, 'path')
        lassoEl.setAttribute('fill', 'none')
        lassoEl.setAttribute('stroke', '#3b82f6')
        lassoEl.setAttribute('stroke-opacity', '0.7')
        lassoEl.setAttribute('stroke-linecap', 'round')
        lassoEl.setAttribute('stroke-linejoin', 'round')
        overlayLayer.appendChild(lassoEl)
      }
      lassoEl.setAttribute('stroke-width', String(strokeWidth))
      const pathPoints = points.length >= 4 ? points : points.length >= 2 ? [points[0], points[1], points[0], points[1]] : [0, 0, 0, 0]
      lassoEl.setAttribute('d', pointsToSvgPathD(pathPoints))
    }

    const computeBounds = (nodes: RenderNode[]) => {
      let minX = Number.POSITIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      for (const node of nodes) {
        const meta = node.meta
        if (!meta || meta.transient) continue
        minX = Math.min(minX, meta.minX)
        minY = Math.min(minY, meta.minY)
        maxX = Math.max(maxX, meta.maxX)
        maxY = Math.max(maxY, meta.maxY)
      }
      if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null
      return { minX, minY, maxX, maxY }
    }

    const computeConvexHull = (points: number[]) => {
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i + 1 < points.length; i += 2) pts.push({ x: points[i], y: points[i + 1] })
      if (pts.length <= 2) return pts
      pts.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
      const cross = (o: any, a: any, b: any) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
      const lower: any[] = []
      for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
        lower.push(p)
      }
      const upper: any[] = []
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i]
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
        upper.push(p)
      }
      upper.pop()
      lower.pop()
      return lower.concat(upper)
    }

    const updateSelectionOverlays = () => {
      clearSelectionOverlays()
      if (!selection) return
      const b = selection.bounds
      const strokeWidth = 1 / Math.max(0.2, camScale)
      const pad = 6 / Math.max(0.2, camScale)

      if (selectionOverlayKind === 'mouse') {
        const rectPoints = [b.minX - pad, b.minY - pad, b.maxX + pad, b.minY - pad, b.maxX + pad, b.maxY + pad, b.minX - pad, b.maxY + pad, b.minX - pad, b.minY - pad]
        selectionBoxEl = document.createElementNS(svgNS, 'path')
        selectionBoxEl.setAttribute('fill', 'none')
        selectionBoxEl.setAttribute('stroke', '#3b82f6')
        selectionBoxEl.setAttribute('stroke-opacity', '0.95')
        selectionBoxEl.setAttribute('stroke-width', String(strokeWidth))
        selectionBoxEl.setAttribute('stroke-dasharray', `${6 / Math.max(0.2, camScale)} ${4 / Math.max(0.2, camScale)}`)
        selectionBoxEl.setAttribute('d', pointsToSvgPathD(rectPoints))
        overlayLayer.appendChild(selectionBoxEl)
      }

      const all: number[] = []
      for (const n of selection.nodes) {
        const m = n.meta
        if (!m || m.transient) continue
        const step = Math.max(2, Math.floor(m.points.length / 240) * 2)
        for (let i = 0; i + 1 < m.points.length; i += step) all.push(m.points[i], m.points[i + 1])
      }
      const hull = computeConvexHull(all)
      if (selectionOverlayKind === 'touch' && hull.length >= 3) {
        const hullPoints: number[] = []
        for (const p of hull) hullPoints.push(p.x, p.y)
        hullPoints.push(hull[0].x, hull[0].y)
        selectionCurveEl = document.createElementNS(svgNS, 'path')
        selectionCurveEl.setAttribute('fill', 'none')
        selectionCurveEl.setAttribute('stroke', '#3b82f6')
        selectionCurveEl.setAttribute('stroke-opacity', '0.9')
        selectionCurveEl.setAttribute('stroke-width', String(strokeWidth))
        selectionCurveEl.setAttribute('d', pointsToSvgPathD(hullPoints))
        overlayLayer.appendChild(selectionCurveEl)
      }
    }

    const setSelection = (nodes: RenderNode[] | null, kind: 'mouse' | 'touch' = 'mouse') => {
      selection = null
      selectionOverlayKind = kind
      clearSelectionOverlays()
      if (!nodes || !nodes.length) return
      const b = computeBounds(nodes)
      if (!b) return
      selection = { nodes, bounds: b }
      updateSelectionOverlays()
    }

    const distancePointToSegmentSq = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
      const vx = bx - ax
      const vy = by - ay
      const wx = px - ax
      const wy = py - ay
      const c1 = vx * wx + vy * wy
      if (c1 <= 0) return wx * wx + wy * wy
      const c2 = vx * vx + vy * vy
      if (c2 <= c1) {
        const dx = px - bx
        const dy = py - by
        return dx * dx + dy * dy
      }
      const t = c1 / c2
      const qx = ax + t * vx
      const qy = ay + t * vy
      const dx = px - qx
      const dy = py - qy
      return dx * dx + dy * dy
    }

    const hitDistanceToPolylineSq = (points: number[], x: number, y: number) => {
      let best = Number.POSITIVE_INFINITY
      for (let i = 0; i + 3 < points.length; i += 2) {
        const d = distancePointToSegmentSq(x, y, points[i], points[i + 1], points[i + 2], points[i + 3])
        if (d < best) best = d
      }
      return best
    }

    const pickNodesAtPoint = (x: number, y: number) => {
      const r = 10 / Math.max(0.2, camScale)
      const rSq = r * r
      for (let i = order.length - 1; i >= 0; i--) {
        const node = order[i]
        const meta = node.meta
        if (!meta || meta.transient) continue
        const pad = r + meta.strokeWidth * 0.6
        if (x < meta.minX - pad || x > meta.maxX + pad || y < meta.minY - pad || y > meta.maxY + pad) continue
        const dSq = hitDistanceToPolylineSq(meta.points, x, y)
        if (dSq <= rSq + (meta.strokeWidth * 0.6) * (meta.strokeWidth * 0.6)) {
          const gid = meta.groupId
          if (gid === undefined) return [node]
          const group: RenderNode[] = []
          for (const other of order) {
            const om = other.meta
            if (!om || om.transient) continue
            if (om.groupId !== gid) continue
            group.push(other)
          }
          return group.length ? group : [node]
        }
      }
      return []
    }

    const pointInPolygon = (poly: number[], x: number, y: number) => {
      let inside = false
      for (let i = 0, j = poly.length - 2; i + 1 < poly.length; j = i, i += 2) {
        const xi = poly[i]
        const yi = poly[i + 1]
        const xj = poly[j]
        const yj = poly[j + 1]
        const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi
        if (intersect) inside = !inside
      }
      return inside
    }

    const pickNodesInLasso = (lasso: number[]) => {
      const out: RenderNode[] = []
      if (lasso.length < 6) return out
      for (const node of order) {
        const meta = node.meta
        if (!meta || meta.transient) continue
        const cx = (meta.minX + meta.maxX) * 0.5
        const cy = (meta.minY + meta.maxY) * 0.5
        if (!pointInPolygon(lasso, cx, cy)) continue
        out.push(node)
      }
      if (!out.length) return out
      const byGroup = new Map<number, RenderNode[]>()
      const singles: RenderNode[] = []
      for (const node of out) {
        const meta = node.meta
        const gid = meta?.groupId
        if (gid === undefined) singles.push(node)
        else {
          const list = byGroup.get(gid) ?? []
          list.push(node)
          byGroup.set(gid, list)
        }
      }
      const merged: RenderNode[] = [...singles]
      for (const [gid] of byGroup) {
        for (const node of order) {
          const meta = node.meta
          if (!meta || meta.transient) continue
          if (meta.groupId === gid) merged.push(node)
        }
      }
      return merged
    }

    type MouseToolOp =
      | { kind: 'pan'; pointerId: number; startCx: number; startCy: number; startX: number; startY: number }
      | { kind: 'lasso'; pointerId: number; points: number[] }
      | { kind: 'transform'; pointerId: number; mode: 'move' | 'scale' | 'rotate'; startX: number; startY: number; centerX: number; centerY: number; before: number[][]; baseAngle: number; baseDist: number }
      | {
          kind: 'pinch'
          target: 'camera'
          ids: [number, number]
          startDist: number
          startScale: number
          startAngle: number
          startRot: number
          anchorWorldX: number
          anchorWorldY: number
        }
      | { kind: 'pinch'; target: 'selection'; ids: [number, number]; startDist: number; startAngle: number; startMidX: number; startMidY: number; before: number[][] }
      | { kind: 'none' }
    let mouseToolOp: MouseToolOp = { kind: 'none' }
    const touchPoints = new Map<number, { cx: number; cy: number }>()

    const isPointInBounds = (b: Selection['bounds'], x: number, y: number, pad: number) => x >= b.minX - pad && x <= b.maxX + pad && y >= b.minY - pad && y <= b.maxY + pad

    const applyCamera = () => {
      const cos = Math.cos(camRot) * camScale
      const sin = Math.sin(camRot) * camScale
      const t = `matrix(${cos} ${sin} ${-sin} ${cos} ${camX} ${camY})`
      if (svgLayer) svgLayer.setAttribute('transform', t)
      overlayLayer.setAttribute('transform', t)
      publishVideoShowView()
      updateSelectionOverlays()
      if (mouseToolOp.kind === 'lasso') updateLassoPreview(mouseToolOp.points)
      requestRender()
    }

    const translatePoints = (points: number[], dx: number, dy: number) => {
      const out = points.slice()
      for (let i = 0; i + 1 < out.length; i += 2) {
        out[i] += dx
        out[i + 1] += dy
      }
      return out
    }

    const scalePoints = (points: number[], s: number, cx: number, cy: number) => {
      const out = points.slice()
      for (let i = 0; i + 1 < out.length; i += 2) {
        out[i] = (out[i] - cx) * s + cx
        out[i + 1] = (out[i + 1] - cy) * s + cy
      }
      return out
    }

    const rotatePoints = (points: number[], ang: number, cx: number, cy: number) => {
      const cos = Math.cos(ang)
      const sin = Math.sin(ang)
      const out = points.slice()
      for (let i = 0; i + 1 < out.length; i += 2) {
        const rx = out[i] - cx
        const ry = out[i + 1] - cy
        out[i] = rx * cos - ry * sin + cx
        out[i + 1] = rx * sin + ry * cos + cy
      }
      return out
    }

    const applyNodesPointsFromList = (nodes: RenderNode[], list: number[][]) => {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]
        const pts = list[i] ?? []
        n.points = pts
        n.meta.points = pts
        recomputeBounds(n.meta, pts)
        markSvgDirty(n)
      }
      if (selection) {
        const b = computeBounds(selection.nodes)
        if (b) selection.bounds = b
        updateSelectionOverlays()
      }
      requestRender()
    }

    const beginSelectionTransform = (pointerId: number, mode: 'move' | 'scale' | 'rotate', x: number, y: number) => {
      if (!selection) return
      const b = selection.bounds
      const centerX = (b.minX + b.maxX) * 0.5
      const centerY = (b.minY + b.maxY) * 0.5
      const before = selection.nodes.map((n) => n.points.slice())
      const baseAngle = Math.atan2(y - centerY, x - centerX)
      const baseDist = Math.max(1e-6, Math.hypot(x - centerX, y - centerY))
      mouseToolOp = { kind: 'transform', pointerId, mode, startX: x, startY: y, centerX, centerY, before, baseAngle, baseDist }
    }

    const finishSelectionTransform = () => {
      if (mouseToolOp.kind !== 'transform') return
      if (!selection) {
        mouseToolOp = { kind: 'none' }
        return
      }
      const nodes = selection.nodes.slice()
      const beforePoints = mouseToolOp.before.map((p) => p.slice())
      const afterPoints = nodes.map((n) => n.points.slice())
      record({ kind: 'update', nodes, beforePoints, afterPoints })
      mouseToolOp = { kind: 'none' }
    }

    const startPinch = (ids: [number, number]) => {
      const p1 = touchPoints.get(ids[0])
      const p2 = touchPoints.get(ids[1])
      if (!p1 || !p2) return
      clearLassoPreview()
      if (mouseToolOp.kind === 'lasso') mouseToolOp = { kind: 'none' }

      const cx = (p1.cx + p2.cx) * 0.5
      const cy = (p1.cy + p2.cy) * 0.5
      const w1 = clientToWorld(p1.cx, p1.cy)
      const w2 = clientToWorld(p2.cx, p2.cy)
      const mid = clientToWorld(cx, cy)
      const dist = Math.max(1e-6, Math.hypot(p2.cx - p1.cx, p2.cy - p1.cy))
      const ang = Math.atan2(w2.y - w1.y, w2.x - w1.x)
      const clientAng = Math.atan2(p2.cy - p1.cy, p2.cx - p1.cx)

      if (selection) {
        const pad = 10 / Math.max(0.2, camScale)
        if (isPointInBounds(selection.bounds, w1.x, w1.y, pad) && isPointInBounds(selection.bounds, w2.x, w2.y, pad)) {
          selectionOverlayKind = 'touch'
          updateSelectionOverlays()
          const before = selection.nodes.map((n) => n.points.slice())
          mouseToolOp = { kind: 'pinch', target: 'selection', ids, startDist: dist, startAngle: ang, startMidX: mid.x, startMidY: mid.y, before }
          return
        }
      }

      mouseToolOp = {
        kind: 'pinch',
        target: 'camera',
        ids,
        startDist: dist,
        startScale: camScale,
        startAngle: clientAng,
        startRot: camRot,
        anchorWorldX: mid.x,
        anchorWorldY: mid.y
      }
    }

    const updatePinch = () => {
      if (mouseToolOp.kind !== 'pinch') return
      const [id1, id2] = mouseToolOp.ids
      const p1 = touchPoints.get(id1)
      const p2 = touchPoints.get(id2)
      if (!p1 || !p2) return
      const cx = (p1.cx + p2.cx) * 0.5
      const cy = (p1.cy + p2.cy) * 0.5
      const dist = Math.max(1e-6, Math.hypot(p2.cx - p1.cx, p2.cy - p1.cy))
      const factor = dist / mouseToolOp.startDist

      if (mouseToolOp.target === 'camera') {
        const nextScale = clamp(mouseToolOp.startScale * factor, 0.2, 6)
        const nextRot = appMode === 'video-show' ? mouseToolOp.startRot + (Math.atan2(p2.cy - p1.cy, p2.cx - p1.cx) - mouseToolOp.startAngle) : mouseToolOp.startRot
        camScale = nextScale
        camRot = nextRot
        const cos = Math.cos(camRot)
        const sin = Math.sin(camRot)
        camX = cx - camScale * (mouseToolOp.anchorWorldX * cos - mouseToolOp.anchorWorldY * sin)
        camY = cy - camScale * (mouseToolOp.anchorWorldX * sin + mouseToolOp.anchorWorldY * cos)
        applyCamera()
        return
      }

      if (!selection) return
      const w1 = clientToWorld(p1.cx, p1.cy)
      const w2 = clientToWorld(p2.cx, p2.cy)
      const mid = clientToWorld(cx, cy)
      const ang = Math.atan2(w2.y - w1.y, w2.x - w1.x)
      const dAng = ang - mouseToolOp.startAngle
      const dx = mid.x - mouseToolOp.startMidX
      const dy = mid.y - mouseToolOp.startMidY
      const cos = Math.cos(dAng)
      const sin = Math.sin(dAng)
      const s = clamp(factor, 0.1, 20)

      const next: number[][] = []
      for (const pts of mouseToolOp.before) {
        const out = pts.slice()
        for (let i = 0; i + 1 < out.length; i += 2) {
          const rx = out[i] - mouseToolOp.startMidX
          const ry = out[i + 1] - mouseToolOp.startMidY
          const nx = (rx * cos - ry * sin) * s + mouseToolOp.startMidX + dx
          const ny = (rx * sin + ry * cos) * s + mouseToolOp.startMidY + dy
          out[i] = nx
          out[i + 1] = ny
        }
        next.push(out)
      }
      applyNodesPointsFromList(selection.nodes, next)
    }

    applyCamera()

    const onPointerDown = (e: PointerEvent) => {
      if (!hydrated) return
      if (toolRef.current === 'mouse') {
        view.setPointerCapture(e.pointerId)
        if (e.pointerType === 'touch') {
          const { cx, cy } = getClientPoint(e)
          touchPoints.set(e.pointerId, { cx, cy })
          if (touchPoints.size === 2) {
            const ids = Array.from(touchPoints.keys()).slice(0, 2) as [number, number]
            startPinch(ids)
            return
          }
          if (appMode === 'video-show') {
            mouseToolOp = { kind: 'pan', pointerId: e.pointerId, startCx: cx, startCy: cy, startX: camX, startY: camY }
            return
          }
          const { x, y } = clientToWorld(cx, cy)
          mouseToolOp = { kind: 'lasso', pointerId: e.pointerId, points: [x, y, x, y] }
          updateLassoPreview(mouseToolOp.points)
          return
        }

        if ((e as any).button === 2) {
          const { cx, cy } = getClientPoint(e)
          mouseToolOp = { kind: 'pan', pointerId: e.pointerId, startCx: cx, startCy: cy, startX: camX, startY: camY }
          return
        }

        if ((e as any).button === 0) {
          const { cx, cy } = getClientPoint(e)
          if (appMode === 'video-show') {
            mouseToolOp = { kind: 'pan', pointerId: e.pointerId, startCx: cx, startCy: cy, startX: camX, startY: camY }
            return
          }
          const { x, y } = clientToWorld(cx, cy)
          const pad = 10 / Math.max(0.2, camScale)
          if (selection && isPointInBounds(selection.bounds, x, y, pad)) {
            const mode: 'move' | 'scale' | 'rotate' = e.altKey ? 'rotate' : e.shiftKey ? 'scale' : 'move'
            beginSelectionTransform(e.pointerId, mode, x, y)
            return
          }
          const picked = pickNodesAtPoint(x, y)
          if (!picked.length) setSelection(null, 'mouse')
          else setSelection(picked, 'mouse')
          return
        }

        return
      }
      if (!multiTouchRef.current && sessions.size > 0) return
      view.setPointerCapture(e.pointerId)
      const { x, y } = getPoint(e)
      const session = {
        groupId: nextGroupId++,
        node: null as null | RenderNode,
        glowNode: null as null | RenderNode,
        laser: toolRef.current === 'pen' && penTypeRef.current === 'laser',
        bakedNodes: [] as RenderNode[],
        points: [] as number[],
        rawPoints: [] as number[],
        rawTimes: [] as number[],
        erasingStroke: toolRef.current === 'eraser' && (useSvg || eraserTypeRef.current === 'stroke'),
        erased: [] as RenderNode[],
        erasedSet: new Set<RenderNode>(),
        erasedGroupIds: new Set<number>(),
        strokeWidth: 6,
        color: [0, 0, 0, 1] as [number, number, number, number],
        nibDynamic: false,
        smoothX: x,
        smoothY: y,
        hasSmooth: false,
        lastTime: performance.now(),
        baking: false,
        lastBakeAt: 0,
        lastBakeLen: 0
      }
      const p0 = applySmoothing(session, x, y)
      session.rawPoints = [p0.x, p0.y, p0.x, p0.y]
      session.rawTimes = [p0.now, p0.now]
      session.points = session.rawPoints.slice()
      sessions.set(e.pointerId, session)

      if (session.erasingStroke) {
        const radius = eraserThicknessRef.current * 0.5
        for (const node of Array.from(live)) {
          if (node.role !== 'stroke') continue
          const gid = node.meta.groupId
          if (gid !== undefined) {
            if (session.erasedGroupIds.has(gid)) continue
            if (!hitsLineAtPoint(node.meta, x, y, radius)) continue
            session.erasedGroupIds.add(gid)
            const groupNodes: RenderNode[] = []
            for (const other of Array.from(live)) {
              if (other.role !== 'stroke') continue
              if (other.meta.groupId !== gid) continue
              if (session.erasedSet.has(other)) continue
              session.erasedSet.add(other)
              session.erased.push(other)
              groupNodes.push(other)
            }
            removeNodes(groupNodes)
            continue
          }
          if (session.erasedSet.has(node)) continue
          if (!hitsLineAtPoint(node.meta, x, y, radius)) continue
          session.erasedSet.add(node)
          session.erased.push(node)
          removeNodes([node])
        }
        requestRender()
        return
      }

      const role: 'stroke' | 'eraserPixel' = toolRef.current === 'eraser' ? 'eraserPixel' : 'stroke'
      const stroke = effectiveStrokeRef.current as any
      const strokeWidth = typeof stroke?.strokeWidth === 'number' ? stroke.strokeWidth : toolRef.current === 'eraser' ? eraserThicknessRef.current : 6
      session.strokeWidth = strokeWidth
      const opacity = typeof stroke?.opacity === 'number' ? stroke.opacity : 1
      const rgba = role === 'stroke' ? colorToRgba(stroke?.stroke ?? '#000000', opacity) : ([0, 0, 0, 1] as [number, number, number, number])
      session.color = rgba
      session.nibDynamic = nibModeRef.current === 'dynamic' && toolRef.current === 'pen' && penTypeRef.current === 'writing'
      const pfh = role === 'stroke' && !session.nibDynamic && toolRef.current === 'pen' && penTypeRef.current === 'writing' && (postBakeOptimizeOnceRef.current ?? false) && !(postBakeOptimizeRef.current ?? false)
      if (session.laser && role === 'stroke') {
        const glowExtra = clamp(strokeWidth * 0.7, 4, 22)
        const glowWidth = strokeWidth + glowExtra
        const glowMeta: LineMeta = { role, transient: true, groupId: session.groupId, strokeWidth: glowWidth, points: session.points, minX: p0.x, minY: p0.y, maxX: p0.x, maxY: p0.y }
        const glow: RenderNode = { role, pfh: false, strokeWidth: glowWidth, points: session.points, meta: glowMeta, color: [1, 1, 1, 0.22] }
        const meta: LineMeta = { role, transient: true, groupId: session.groupId, strokeWidth, points: session.points, minX: p0.x, minY: p0.y, maxX: p0.x, maxY: p0.y }
        const node: RenderNode = { role, pfh, strokeWidth, points: session.points, meta, color: rgba }
        session.glowNode = glow
        session.node = node
        addNodes([glow, node])
        markSvgDirty(glow)
        markSvgDirty(node)
      } else {
        const meta: LineMeta = { role, groupId: session.groupId, strokeWidth, points: session.points, minX: p0.x, minY: p0.y, maxX: p0.x, maxY: p0.y }
        const node: RenderNode = { role, pfh, strokeWidth, points: session.points, meta, color: rgba }
        session.node = node
        addNodes([node])
        markSvgDirty(node)
      }
      requestRender()
    }

    const onPointerMove = (e: PointerEvent) => {
      if (toolRef.current === 'mouse') {
        if (e.pointerType === 'touch') {
          const { cx, cy } = getClientPoint(e)
          touchPoints.set(e.pointerId, { cx, cy })
          if (mouseToolOp.kind === 'pinch') {
            updatePinch()
            return
          }
          if (touchPoints.size === 2) {
            const ids = Array.from(touchPoints.keys()).slice(0, 2) as [number, number]
            startPinch(ids)
            return
          }
        }

        if (mouseToolOp.kind === 'pan' && mouseToolOp.pointerId === e.pointerId) {
          const { cx, cy } = getClientPoint(e)
          camX = mouseToolOp.startX + (cx - mouseToolOp.startCx)
          camY = mouseToolOp.startY + (cy - mouseToolOp.startCy)
          applyCamera()
          clearLassoPreview()
          return
        }

        if (mouseToolOp.kind === 'lasso' && mouseToolOp.pointerId === e.pointerId) {
          const { x, y } = getPoint(e)
          mouseToolOp.points.push(x, y)
          updateLassoPreview(mouseToolOp.points)
          return
        }

        if (mouseToolOp.kind === 'transform' && mouseToolOp.pointerId === e.pointerId && selection) {
          const op = mouseToolOp
          const { x, y } = getPoint(e)
          if (op.mode === 'move') {
            const dx = x - op.startX
            const dy = y - op.startY
            const next = op.before.map((pts) => translatePoints(pts, dx, dy))
            applyNodesPointsFromList(selection.nodes, next)
            return
          }

          if (op.mode === 'scale') {
            const dist = Math.max(1e-6, Math.hypot(x - op.centerX, y - op.centerY))
            const s = clamp(dist / op.baseDist, 0.1, 20)
            const next = op.before.map((pts) => scalePoints(pts, s, op.centerX, op.centerY))
            applyNodesPointsFromList(selection.nodes, next)
            return
          }

          const ang = Math.atan2(y - op.centerY, x - op.centerX)
          const dAng = ang - op.baseAngle
          const next = op.before.map((pts) => rotatePoints(pts, dAng, op.centerX, op.centerY))
          applyNodesPointsFromList(selection.nodes, next)
          return
        }

        return
      }
      const session = sessions.get(e.pointerId)
      if (!session) return
      const evs = typeof (e as any).getCoalescedEvents === 'function' ? (e as any).getCoalescedEvents() : [e]
      let didAppend = false
      let didErase = false

      for (const ev of evs as PointerEvent[]) {
        const { x, y } = getPoint(ev)
        const lastX = session.points[session.points.length - 2]
        const lastY = session.points[session.points.length - 1]
        const p = applySmoothing(session, x, y)
        const dx = p.x - lastX
        const dy = p.y - lastY
        const dist = Math.hypot(dx, dy)
        const minMove = clamp(session.strokeWidth * 0.04, 0.15, 0.45)
        if (dist < minMove) continue
        const speed = dist / Math.max(1, p.dt)
        const baseStep = clamp(session.strokeWidth * 0.34, 0.7, 3.2)
        const step = clamp(baseStep / (1 + speed * 0.08), 0.35, baseStep)
        const cap = clamp(Math.floor(10 + speed * 8), 10, 42)
        const appendedRaw = appendInterpolatedPoints(session.rawPoints, p.x, p.y, step, cap)
        const appended = appendInterpolatedPoints(session.points, p.x, p.y, step, cap)
        didAppend = true

        const appendedPairs = Math.floor(appendedRaw.length / 2)
        if (appendedPairs > 0) {
          const prevT = session.rawTimes.length ? session.rawTimes[session.rawTimes.length - 1] : p.now
          for (let i = 1; i <= appendedPairs; i++) {
            session.rawTimes.push(prevT + (p.dt * i) / appendedPairs)
          }
        }

        if (session.erasingStroke) {
          didErase = true
          const radius = eraserThicknessRef.current * 0.5
          for (const node of Array.from(live)) {
            if (node.role !== 'stroke') continue
            const gid = node.meta.groupId
            if (gid !== undefined) {
              if (session.erasedGroupIds.has(gid)) continue
              if (!hitsLineAtPoint(node.meta, x, y, radius)) continue
              session.erasedGroupIds.add(gid)
              const groupNodes: RenderNode[] = []
              for (const other of Array.from(live)) {
                if (other.role !== 'stroke') continue
                if (other.meta.groupId !== gid) continue
                if (session.erasedSet.has(other)) continue
                session.erasedSet.add(other)
                session.erased.push(other)
                groupNodes.push(other)
              }
              removeNodes(groupNodes)
              continue
            }
            if (session.erasedSet.has(node)) continue
            if (!hitsLineAtPoint(node.meta, x, y, radius)) continue
            session.erasedSet.add(node)
            session.erased.push(node)
            removeNodes([node])
          }
          continue
        }

        if (!session.node) continue
        if (!session.nibDynamic) {
          for (let i = 0; i + 1 < appended.length; i += 2) updateBounds(session.node.meta, appended[i], appended[i + 1])
          markSvgDirty(session.node)
          if (session.glowNode) {
            for (let i = 0; i + 1 < appended.length; i += 2) updateBounds(session.glowNode.meta, appended[i], appended[i + 1])
            markSvgDirty(session.glowNode)
          }
          continue
        }
      }

      if (didErase) {
        requestRender()
        return
      }
      if (!didAppend) return
      if (!session.node) return

      if (!session.nibDynamic) {
        requestRender()
        maybeScheduleBake(e.pointerId)
        return
      }

      const tailCoords = BAKE_TAIL_POINTS * 2
      const tailStart = session.bakedNodes.length ? Math.max(0, session.points.length - tailCoords - 2) : 0
      const tail = session.points.slice(tailStart)
      session.node.points = tail
      session.node.meta.points = tail
      recomputeBounds(session.node.meta, tail)
      markSvgDirty(session.node)
      requestRender()
      maybeScheduleBake(e.pointerId)
    }

    const finish = (e: PointerEvent) => {
      const session = sessions.get(e.pointerId)
      if (!session) return
      sessions.delete(e.pointerId)
      const active = session.node
      const erased = session.erased
      try {
        view.releasePointerCapture(e.pointerId)
      } catch {}
      if (erased.length) record({ kind: 'remove', nodes: erased })
      else if (active) {
        if (session.laser) {
          if (inkSmoothingRef.current) {
            const baked = bakePolyline(session.points, active.strokeWidth)
            active.points = baked
            active.meta.points = baked
            recomputeBounds(active.meta, baked)
            markSvgDirty(active)
            if (session.glowNode) {
              session.glowNode.points = baked
              session.glowNode.meta.points = baked
              recomputeBounds(session.glowNode.meta, baked)
              markSvgDirty(session.glowNode)
            }
            requestRender()
          }
          const nodes = session.glowNode ? [session.glowNode, active] : [active]
          startLaserFade(nodes)
          return
        }
        if (active.pfh) {
          if (inkSmoothingRef.current) {
            const baked = bakePolyline(session.points, active.strokeWidth)
            active.points = baked
            active.meta.points = baked
            recomputeBounds(active.meta, baked)
            markSvgDirty(active)
            requestRender()
          }
          record({ kind: 'add', nodes: [active] })
          if (postBakeOptimizeOnceRef.current) consumePostBakeOptimizeOnce()
          return
        }
        if (session.nibDynamic) {
          const full = inkSmoothingRef.current ? bakePolyline(session.rawPoints, session.strokeWidth) : session.rawPoints
          const widthAtT = buildNibWidthAt(session.rawPoints, session.rawTimes, session.strokeWidth) ?? undefined
            const shouldOptimize = inkSmoothingRef.current && (postBakeOptimizeRef.current || postBakeOptimizeOnceRef.current)
          const parts =
              shouldOptimize ? postBakeOptimizePolyline(full, session.strokeWidth) : ({ kind: 'single', points: full } as PostBakeResult)
          removeNodes([active, ...session.bakedNodes])

          const next: RenderNode[] = []
          const groups = parts.kind === 'split' ? parts.segments : [{ points: parts.points, t0: 0, t1: 1 } as PostBakeSegment]
          for (const g of groups) {
            const localWidthAtT = widthAtT ? (t: number) => widthAtT(g.t0 + (g.t1 - g.t0) * t) : undefined
            const segments = buildNibSegments(g.points, session.strokeWidth, 'dynamic', localWidthAtT)
            for (const seg of segments) {
              const p0x = seg.points[0] ?? 0
              const p0y = seg.points[1] ?? 0
              const meta: LineMeta = { role: 'stroke', groupId: session.groupId, strokeWidth: seg.strokeWidth, points: seg.points, minX: p0x, minY: p0y, maxX: p0x, maxY: p0y }
              recomputeBounds(meta, seg.points)
              const n: RenderNode = { role: 'stroke', pfh: false, strokeWidth: seg.strokeWidth, points: seg.points, meta, color: session.color }
              addNodes([n])
              next.push(n)
              markSvgDirty(n)
            }
          }
          record({ kind: 'add', nodes: next })
          if (postBakeOptimizeOnceRef.current && shouldOptimize) consumePostBakeOptimizeOnce()
          requestRender()
          return
        }

        if (inkSmoothingRef.current) {
          const baked = bakePolyline(session.points, active.strokeWidth)
          const shouldOptimize = active.meta.role === 'stroke' && (postBakeOptimizeRef.current || postBakeOptimizeOnceRef.current)
          if (shouldOptimize) {
            const post = postBakeOptimizePolyline(baked, active.strokeWidth)
            if (post.kind === 'split') {
              removeNodes([active])
              const next: RenderNode[] = []
              for (const s of post.segments) {
                if (s.points.length <= 6) continue
                const p0x = s.points[0] ?? 0
                const p0y = s.points[1] ?? 0
                const meta: LineMeta = { role: 'stroke', groupId: session.groupId, strokeWidth: active.strokeWidth, points: s.points, minX: p0x, minY: p0y, maxX: p0x, maxY: p0y }
                recomputeBounds(meta, s.points)
                const n: RenderNode = { role: 'stroke', pfh: active.pfh, strokeWidth: active.strokeWidth, points: s.points, meta, color: session.color }
                addNodes([n])
                next.push(n)
                markSvgDirty(n)
              }
              if (next.length) record({ kind: 'add', nodes: next })
              if (postBakeOptimizeOnceRef.current) consumePostBakeOptimizeOnce()
              requestRender()
              return
            }
            active.points = post.points
            active.meta.points = post.points
            recomputeBounds(active.meta, post.points)
            markSvgDirty(active)
            if (postBakeOptimizeOnceRef.current) consumePostBakeOptimizeOnce()
            requestRender()
          } else {
            active.points = baked
            active.meta.points = baked
            recomputeBounds(active.meta, baked)
            markSvgDirty(active)
            requestRender()
          }
        }
        record({ kind: 'add', nodes: [active] })
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      if (sessions.has(e.pointerId)) {
        finish(e)
        return
      }
      if (mouseToolOp.kind === 'pan' && mouseToolOp.pointerId === e.pointerId) {
        try {
          view.releasePointerCapture(e.pointerId)
        } catch {}
        mouseToolOp = { kind: 'none' }
        return
      }
      if (mouseToolOp.kind === 'transform' && mouseToolOp.pointerId === e.pointerId) {
        try {
          view.releasePointerCapture(e.pointerId)
        } catch {}
        finishSelectionTransform()
        return
      }
      if (mouseToolOp.kind === 'lasso' && mouseToolOp.pointerId === e.pointerId) {
        try {
          view.releasePointerCapture(e.pointerId)
        } catch {}
        if (e.pointerType === 'touch') touchPoints.delete(e.pointerId)
        const pts = mouseToolOp.points.slice()
        mouseToolOp = { kind: 'none' }
        clearLassoPreview()
        if (pts.length >= 6) {
          const closed = pts.slice()
          closed.push(closed[0], closed[1])
          const picked = pickNodesInLasso(closed)
          if (picked.length) setSelection(picked, 'touch')
          else setSelection(null, 'touch')
        } else {
          setSelection(null, 'touch')
        }
        return
      }
      if (e.pointerType === 'touch') {
        touchPoints.delete(e.pointerId)
        if (mouseToolOp.kind === 'pinch') {
          if (!touchPoints.has(mouseToolOp.ids[0]) || !touchPoints.has(mouseToolOp.ids[1])) {
            try {
              view.releasePointerCapture(e.pointerId)
            } catch {}
            if (mouseToolOp.target === 'selection' && selection) {
              const nodes = selection.nodes.slice()
              const beforePoints = mouseToolOp.before.map((p) => p.slice())
              const afterPoints = nodes.map((n) => n.points.slice())
              record({ kind: 'update', nodes, beforePoints, afterPoints })
            }
            mouseToolOp = { kind: 'none' }
          }
        }
      }
      try {
        view.releasePointerCapture(e.pointerId)
      } catch {}
    }

    const onPointerCancel = (e: PointerEvent) => {
      if (sessions.has(e.pointerId)) {
        finish(e)
        return
      }
      if (e.pointerType === 'touch') touchPoints.delete(e.pointerId)
      clearLassoPreview()
      if (mouseToolOp.kind === 'transform') finishSelectionTransform()
      else if (mouseToolOp.kind === 'pinch' && mouseToolOp.target === 'selection' && selection) {
        const nodes = selection.nodes.slice()
        const beforePoints = mouseToolOp.before.map((p) => p.slice())
        const afterPoints = nodes.map((n) => n.points.slice())
        record({ kind: 'update', nodes, beforePoints, afterPoints })
        mouseToolOp = { kind: 'none' }
      } else mouseToolOp = { kind: 'none' }
      try {
        view.releasePointerCapture(e.pointerId)
      } catch {}
    }

    const onWheel = (e: WheelEvent) => {
      if (!hydrated) return
      if (toolRef.current !== 'mouse') return
      e.preventDefault()
      const r = view.getBoundingClientRect()
      const cx = e.clientX - r.left
      const cy = e.clientY - r.top
      const w = clientToWorld(cx, cy)
      if (appMode === 'video-show' && e.altKey) {
        camRot = camRot + (e.deltaY > 0 ? -1 : 1) * 0.06
      } else {
        const factor = e.deltaY > 0 ? 0.9 : 1.1
        camScale = clamp(camScale * factor, 0.2, 6)
      }
      const cos = Math.cos(camRot)
      const sin = Math.sin(camRot)
      camX = cx - camScale * (w.x * cos - w.y * sin)
      camY = cy - camScale * (w.x * sin + w.y * cos)
      applyCamera()
      clearLassoPreview()
    }

    const onContextMenu = (e: MouseEvent) => {
      if (toolRef.current !== 'mouse') return
      e.preventDefault()
    }

    const ro = new ResizeObserver(() => {
      resizeSurface()
      try {
        webgpu?.configure?.()
      } catch {}
      requestRender()
    })
    ro.observe(view)

    view.addEventListener('pointerdown', onPointerDown)
    view.addEventListener('pointermove', onPointerMove)
    view.addEventListener('pointerup', onPointerUp)
    view.addEventListener('pointercancel', onPointerCancel)
    view.addEventListener('wheel', onWheel, { passive: false } as any)
    view.addEventListener('contextmenu', onContextMenu)

    return () => {
      cancelled = true
      if (persistTimer !== null) window.clearTimeout(persistTimer)
      persistNow()
      ro.disconnect()
      view.removeEventListener('pointerdown', onPointerDown)
      view.removeEventListener('pointermove', onPointerMove)
      view.removeEventListener('pointerup', onPointerUp)
      view.removeEventListener('pointercancel', onPointerCancel)
      view.removeEventListener('wheel', onWheel as any)
      view.removeEventListener('contextmenu', onContextMenu as any)
      apiRef.current = null
      try {
        view.replaceChildren()
      } catch {}
      disposeParentLayout()
    }
  }, [rendererEngine, appMode])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100vw',
        height: '100vh',
        backgroundImage: frozenBackgroundUrl ? `url(${frozenBackgroundUrl})` : 'none',
        backgroundSize: frozenBackgroundUrl ? '100% 100%' : undefined,
        backgroundRepeat: frozenBackgroundUrl ? 'no-repeat' : undefined,
        backgroundPosition: frozenBackgroundUrl ? 'center' : undefined,
        backgroundColor: frozenBackgroundUrl ? '#000000' : 'transparent',
        opacity: isWhiteboardLike ? 1 : tool === 'mouse' && !leaferSettings.showInkWhenPassthrough ? 0 : 1,
        touchAction: 'none'
      }}
    />
  )
}
