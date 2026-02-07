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
  PEN_COLOR_UI_STATE_KEY,
  PEN_THICKNESS_UI_STATE_KEY,
  PEN_TYPE_UI_STATE_KEY,
  REDO_REV_UI_STATE_KEY,
  TOOL_UI_STATE_KEY,
  UNDO_REV_UI_STATE_KEY,
  UI_STATE_APP_WINDOW_ID,
  getKv,
  putKv,
  putUiStateKey,
  isLeaferSettings,
  postCommand,
  type LeaferSettings,
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
  const apiRef = useRef<null | { undo: () => void; redo: () => void; clear: () => void }>(null)
  const lastUndoRevRef = useRef<number | null>(null)
  const lastRedoRevRef = useRef<number | null>(null)
  const lastClearRevRef = useRef<number | null>(null)
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

  useEffect(() => {
    void postCommand('win.setAnnotationInput', { enabled: tool !== 'mouse' })
  }, [tool])

  const appModeRaw = bus.state[APP_MODE_UI_STATE_KEY]
  const appMode = appModeRaw === 'whiteboard' ? 'whiteboard' : 'toolbar'
  const shouldFreezeScreen = appMode === 'toolbar' && tool !== 'mouse' && leaferSettings.freezeScreen
  const rendererEngine = leaferSettings.rendererEngine ?? 'canvas2d'

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
  const undoRev = typeof undoRevRaw === 'number' ? undoRevRaw : typeof undoRevRaw === 'string' ? Number(undoRevRaw) : 0
  const redoRev = typeof redoRevRaw === 'number' ? redoRevRaw : typeof redoRevRaw === 'string' ? Number(redoRevRaw) : 0
  const clearRev = typeof clearRevRaw === 'number' ? clearRevRaw : typeof clearRevRaw === 'string' ? Number(clearRevRaw) : 0

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

      const draw = (nodes: Array<{ role: 'stroke' | 'eraserPixel'; pfh?: boolean; strokeWidth: number; points: number[]; color: [number, number, number, number] }>) => {
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

      const draw = (nodes: Array<{ role: 'stroke' | 'eraserPixel'; pfh?: boolean; strokeWidth: number; points: number[]; color: [number, number, number, number] }>) => {
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
      const contextSettings = { desynchronized: true } as any
      const leafer = new Leafer(
        {
          view,
          width: Math.max(1, Math.floor(rect.width)),
          height: Math.max(1, Math.floor(rect.height)),
          contextSettings
        } as any
      )

      type CanvasNode = Line | Polygon
      type Action = { kind: 'add' | 'remove'; nodes: CanvasNode[] }
      const live = new Set<CanvasNode>()
      const history = { undo: [] as Action[], redo: [] as Action[] }

      const getMeta = (node: CanvasNode): LineMeta | undefined => (node as any).__lanstartMeta as LineMeta | undefined
      const setMeta = (node: CanvasNode, meta: LineMeta): void => {
        ;(node as any).__lanstartMeta = meta
      }

      const addNodes = (nodes: CanvasNode[]) => {
        for (const node of nodes) {
          leafer.add(node)
          live.add(node)
        }
      }

      const removeNodes = (nodes: CanvasNode[]) => {
        for (const node of nodes) {
          try {
            ;(node as any).remove?.()
          } catch {}
          live.delete(node)
        }
      }

      const record = (action: Action) => {
        history.undo.push(action)
        history.redo.length = 0
      }

      const undo = () => {
        const action = history.undo.pop()
        if (!action) return
        if (action.kind === 'add') removeNodes(action.nodes)
        else addNodes(action.nodes)
        history.redo.push(action)
      }

      const redo = () => {
        const action = history.redo.pop()
        if (!action) return
        if (action.kind === 'add') addNodes(action.nodes)
        else removeNodes(action.nodes)
        history.undo.push(action)
      }

      const clear = () => {
        if (!live.size) return
        const nodes = Array.from(live)
        removeNodes(nodes)
        record({ kind: 'remove', nodes })
      }

      apiRef.current = { undo, redo, clear }

      let nextGroupId = 1

      const sessions = new Map<
        number,
        {
          groupId: number
          line: null | Line
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

      const getPoint = (e: PointerEvent) => {
        const r = view.getBoundingClientRect()
        const x = e.clientX - r.left
        const y = e.clientY - r.top
        return { x, y }
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
        if (toolRef.current === 'mouse') return
        if (!multiTouchRef.current && sessions.size > 0) return
        view.setPointerCapture(e.pointerId)
        const { x, y } = getPoint(e)
        const session = {
          groupId: nextGroupId++,
          line: null as null | Line,
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
        session.line = new Line({
          points: session.points,
          ...stroke
        } as any)
        setMeta(session.line, { role, groupId: session.groupId, strokeWidth, points: session.points, minX: p0.x, minY: p0.y, maxX: p0.x, maxY: p0.y })
        addNodes([session.line])
      }

      const onPointerMove = (e: PointerEvent) => {
        const session = sessions.get(e.pointerId)
        if (!session) return
        const { x, y } = getPoint(e)
        const lastX = session.points[session.points.length - 2]
        const lastY = session.points[session.points.length - 1]
        const dx = x - lastX
        const dy = y - lastY
        if (dx * dx + dy * dy < 0.6 * 0.6) return
        const p = applySmoothing(session, x, y)
        const maxStep = clamp(session.strokeWidth * 0.45, 1.6, 4.8)
        const appendedRaw = appendInterpolatedPoints(session.rawPoints, p.x, p.y, maxStep, 6)
        const appended = appendInterpolatedPoints(session.points, p.x, p.y, maxStep, 6)

        const appendedPairs = Math.floor(appendedRaw.length / 2)
        if (appendedPairs > 0) {
          const prevT = session.rawTimes.length ? session.rawTimes[session.rawTimes.length - 1] : p.now
          for (let i = 1; i <= appendedPairs; i++) {
            session.rawTimes.push(prevT + (p.dt * i) / appendedPairs)
          }
        }

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

        if (!session.line) return
        const meta = getMeta(session.line)
        if (!session.nibDynamic) {
          if (meta) {
            for (let i = 0; i + 1 < appended.length; i += 2) updateBounds(meta, appended[i], appended[i + 1])
          }
          ;(session.line as any).points = session.points
          maybeScheduleBake(e.pointerId)
          return
        }

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

      const onPointerUp = (e: PointerEvent) => finish(e)
      const onPointerCancel = (e: PointerEvent) => finish(e)

      const ro = new ResizeObserver(() => {
        const r = view.getBoundingClientRect()
        ;(leafer as any).resize?.(Math.max(1, Math.floor(r.width)), Math.max(1, Math.floor(r.height)))
      })
      ro.observe(view)

      view.addEventListener('pointerdown', onPointerDown)
      view.addEventListener('pointermove', onPointerMove)
      view.addEventListener('pointerup', onPointerUp)
      view.addEventListener('pointercancel', onPointerCancel)

      return () => {
        ro.disconnect()
        view.removeEventListener('pointerdown', onPointerDown)
        view.removeEventListener('pointermove', onPointerMove)
        view.removeEventListener('pointerup', onPointerUp)
        view.removeEventListener('pointercancel', onPointerCancel)
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
      view.appendChild(svg)
    }

    const resizeSurface = () => {
      const r = view.getBoundingClientRect()
      const cssW = Math.max(1, Math.floor(r.width))
      const cssH = Math.max(1, Math.floor(r.height))
      if (svg) svg.setAttribute('viewBox', `0 0 ${cssW} ${cssH}`)
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
    }

    type Action = { kind: 'add' | 'remove'; nodes: RenderNode[] }
    const live = new Set<RenderNode>()
    const order: RenderNode[] = []
    const history = { undo: [] as Action[], redo: [] as Action[] }

    const nodeToSvgPath = useSvg ? new Map<RenderNode, SVGPathElement>() : null
    const svgDirty = useSvg ? new Set<RenderNode>() : null

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
    }

    const undo = () => {
      const action = history.undo.pop()
      if (!action) return
      if (action.kind === 'add') removeNodes(action.nodes)
      else addNodes(action.nodes)
      history.redo.push(action)
      requestRender()
    }

    const redo = () => {
      const action = history.redo.pop()
      if (!action) return
      if (action.kind === 'add') addNodes(action.nodes)
      else removeNodes(action.nodes)
      history.undo.push(action)
      requestRender()
    }

    const clear = () => {
      if (!live.size) return
      const nodes = Array.from(live)
      removeNodes(nodes)
      record({ kind: 'remove', nodes })
      requestRender()
    }

    apiRef.current = { undo, redo, clear }
    lastUndoRevRef.current = undoRev
    lastRedoRevRef.current = redoRev
    lastClearRevRef.current = clearRev

    const sessions = new Map<
      number,
      {
        groupId: number
        node: null | RenderNode
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

    const getPoint = (e: PointerEvent) => {
      const r = view.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      return { x, y }
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
    let webgpu: null | { configure: () => void; draw: (nodes: RenderNode[]) => void } = null
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
    void init()

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
        const nodes = order.slice()
        if (webgpu) {
          try {
            webgpu.draw(nodes)
            return
          } catch {
            webgpu = null
          }
        }
        if (webgl) {
          try {
            webgl.draw(nodes)
          } catch {}
        }
      })
    }

    const markSvgDirty = (n: RenderNode) => {
      if (!svgDirty) return
      svgDirty.add(n)
    }

    let nextGroupId = 1

    const onPointerDown = (e: PointerEvent) => {
      if (toolRef.current === 'mouse') return
      if (!multiTouchRef.current && sessions.size > 0) return
      view.setPointerCapture(e.pointerId)
      const { x, y } = getPoint(e)
      const session = {
        groupId: nextGroupId++,
        node: null as null | RenderNode,
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
      const meta: LineMeta = { role, groupId: session.groupId, strokeWidth, points: session.points, minX: p0.x, minY: p0.y, maxX: p0.x, maxY: p0.y }
      const node: RenderNode = { role, pfh, strokeWidth, points: session.points, meta, color: rgba }
      session.node = node
      addNodes([node])
      markSvgDirty(node)
      requestRender()
    }

    const onPointerMove = (e: PointerEvent) => {
      const session = sessions.get(e.pointerId)
      if (!session) return
      const { x, y } = getPoint(e)
      const lastX = session.points[session.points.length - 2]
      const lastY = session.points[session.points.length - 1]
      const dx = x - lastX
      const dy = y - lastY
      if (dx * dx + dy * dy < 0.6 * 0.6) return
      const p = applySmoothing(session, x, y)
      const maxStep = clamp(session.strokeWidth * 0.45, 1.6, 4.8)
      const appendedRaw = appendInterpolatedPoints(session.rawPoints, p.x, p.y, maxStep, 6)
      const appended = appendInterpolatedPoints(session.points, p.x, p.y, maxStep, 6)

      const appendedPairs = Math.floor(appendedRaw.length / 2)
      if (appendedPairs > 0) {
        const prevT = session.rawTimes.length ? session.rawTimes[session.rawTimes.length - 1] : p.now
        for (let i = 1; i <= appendedPairs; i++) {
          session.rawTimes.push(prevT + (p.dt * i) / appendedPairs)
        }
      }

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

      if (!session.node) return
      if (!session.nibDynamic) {
        for (let i = 0; i + 1 < appended.length; i += 2) updateBounds(session.node.meta, appended[i], appended[i + 1])
        markSvgDirty(session.node)
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

    const onPointerUp = (e: PointerEvent) => finish(e)
    const onPointerCancel = (e: PointerEvent) => finish(e)

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

    return () => {
      cancelled = true
      ro.disconnect()
      view.removeEventListener('pointerdown', onPointerDown)
      view.removeEventListener('pointermove', onPointerMove)
      view.removeEventListener('pointerup', onPointerUp)
      view.removeEventListener('pointercancel', onPointerCancel)
      apiRef.current = null
      try {
        view.replaceChildren()
      } catch {}
      disposeParentLayout()
    }
  }, [rendererEngine])

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
        opacity: tool === 'mouse' && !leaferSettings.showInkWhenPassthrough ? 0 : 1,
        touchAction: 'none'
      }}
    />
  )
}
