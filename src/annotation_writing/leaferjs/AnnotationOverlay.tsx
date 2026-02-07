import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Leafer, Line } from 'leafer-ui'
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
  isLeaferSettings,
  postCommand,
  type LeaferSettings,
  useUiStateBus
} from '../../status'

type LineRole = 'stroke' | 'eraserPixel'

type LineMeta = {
  role: LineRole
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

const DEFAULT_LEAFER_SETTINGS: LeaferSettings = {
  multiTouch: false,
  inkSmoothing: true,
  showInkWhenPassthrough: true,
  freezeScreen: false,
  rendererEngine: 'canvas2d'
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
  const effectiveStrokeRef = useRef(effectiveStroke)
  const eraserTypeRef = useRef(eraserType)
  const eraserThicknessRef = useRef(eraserThickness)
  const multiTouchRef = useRef(DEFAULT_LEAFER_SETTINGS.multiTouch)
  const inkSmoothingRef = useRef(DEFAULT_LEAFER_SETTINGS.inkSmoothing)
  const apiRef = useRef<null | { undo: () => void; redo: () => void; clear: () => void }>(null)
  const lastUndoRevRef = useRef<number | null>(null)
  const lastRedoRevRef = useRef<number | null>(null)
  const lastClearRevRef = useRef<number | null>(null)

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
    multiTouchRef.current = leaferSettings.multiTouch
  }, [leaferSettings.multiTouch])

  useEffect(() => {
    inkSmoothingRef.current = leaferSettings.inkSmoothing
  }, [leaferSettings.inkSmoothing])

  useEffect(() => {
    toolRef.current = tool
  }, [tool])

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

    const buildStrokeTriangles = (points: number[], strokeWidthPx: number, dpr: number) => {
      const r = (strokeWidthPx * dpr) * 0.5
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

      const draw = (nodes: Array<{ role: 'stroke' | 'eraserPixel'; strokeWidth: number; points: number[]; color: [number, number, number, number] }>) => {
        const dpr = Math.max(1, globalThis.devicePixelRatio || 1)
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.useProgram(program)
        gl.uniform2f(resolutionLoc, canvas.width, canvas.height)
        for (const node of nodes) {
          const verts = buildStrokeTriangles(node.points, node.strokeWidth, dpr)
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

      const draw = (nodes: Array<{ role: 'stroke' | 'eraserPixel'; strokeWidth: number; points: number[]; color: [number, number, number, number] }>) => {
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
          const verts = buildStrokeTriangles(node.points, node.strokeWidth, dpr)
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

      type Action = { kind: 'add' | 'remove'; nodes: Line[] }
      const live = new Set<Line>()
      const history = { undo: [] as Action[], redo: [] as Action[] }

      const getMeta = (line: Line): LineMeta | undefined => (line as any).__lanstartMeta as LineMeta | undefined
      const setMeta = (line: Line, meta: LineMeta): void => {
        ;(line as any).__lanstartMeta = meta
      }

      const addNodes = (nodes: Line[]) => {
        for (const node of nodes) {
          leafer.add(node)
          live.add(node)
        }
      }

      const removeNodes = (nodes: Line[]) => {
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

      const sessions = new Map<
        number,
        {
          line: null | Line
          points: number[]
          erasing: boolean
          erased: Line[]
          erasedSet: Set<Line>
          strokeWidth: number
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
        if (!inkSmoothingRef.current) return { x, y }
        if (!session.hasSmooth) {
          session.hasSmooth = true
          session.smoothX = x
          session.smoothY = y
          return { x, y }
        }
        const dx = x - session.smoothX
        const dy = y - session.smoothY
        const speed = Math.hypot(dx, dy) / dt
        const a = clamp(0.22 + speed * 0.28, 0.22, 0.78)
        const nx = session.smoothX + dx * a
        const ny = session.smoothY + dy * a
        session.smoothX = nx
        session.smoothY = ny
        return { x: nx, y: ny }
      }

      const BAKE_TAIL_POINTS = 8
      const BAKE_MIN_NEW_COORDS = 24
      const BAKE_MIN_INTERVAL_MS = 56

      const maybeScheduleBake = (pointerId: number) => {
        const session = sessions.get(pointerId)
        if (!session) return
        if (!inkSmoothingRef.current) return
        if (!session.line) return
        const meta = getMeta(session.line)
        if (!meta) return
        const now = performance.now()
        const newCoords = session.points.length - session.lastBakeLen
        if (newCoords < BAKE_MIN_NEW_COORDS && now - session.lastBakeAt < BAKE_MIN_INTERVAL_MS) return
        if (session.baking) return
        session.lastBakeAt = now
        session.lastBakeLen = session.points.length
        session.baking = true
        requestAnimationFrame(() => {
          session.baking = false
          const current = sessions.get(pointerId)
          if (!current || current !== session) return
          if (!inkSmoothingRef.current) return
          if (!current.line) return
          const m = getMeta(current.line)
          if (!m) return
          const baked = bakePolylineWithTail(current.points, m.strokeWidth, BAKE_TAIL_POINTS)
          if (baked === current.points) return
          current.points = baked
          m.points = baked
          recomputeBounds(m, baked)
          ;(current.line as any).points = baked
        })
      }

      const onPointerDown = (e: PointerEvent) => {
        if (toolRef.current === 'mouse') return
        if (!multiTouchRef.current && sessions.size > 0) return
        view.setPointerCapture(e.pointerId)
        const { x, y } = getPoint(e)
        const session = {
          line: null as null | Line,
          points: [] as number[],
          erasing: toolRef.current === 'eraser' && eraserTypeRef.current === 'stroke',
          erased: [] as Line[],
          erasedSet: new Set<Line>(),
          strokeWidth: 6,
          smoothX: x,
          smoothY: y,
          hasSmooth: false,
          lastTime: performance.now(),
          baking: false,
          lastBakeAt: 0,
          lastBakeLen: 0
        }
        const p0 = applySmoothing(session, x, y)
        session.points = [p0.x, p0.y, p0.x, p0.y]
        sessions.set(e.pointerId, session)

        if (session.erasing) {
          const radius = eraserThicknessRef.current * 0.5
          for (const node of Array.from(live)) {
            const meta = getMeta(node)
            if (!meta || meta.role !== 'stroke') continue
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
        session.line = new Line({
          points: session.points,
          ...stroke
        } as any)
        setMeta(session.line, { role, strokeWidth, points: session.points, minX: p0.x, minY: p0.y, maxX: p0.x, maxY: p0.y })
        leafer.add(session.line)
        live.add(session.line)
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
        const appended = appendInterpolatedPoints(session.points, p.x, p.y, maxStep, 6)

        if (session.erasing) {
          const radius = eraserThicknessRef.current * 0.5
          for (const node of Array.from(live)) {
            const meta = getMeta(node)
            if (!meta || meta.role !== 'stroke') continue
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
        if (meta) {
          for (let i = 0; i + 1 < appended.length; i += 2) updateBounds(meta, appended[i], appended[i + 1])
        }
        ;(session.line as any).points = session.points
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
          if (inkSmoothingRef.current) {
            const meta = getMeta(activeLine)
            const sw = meta?.strokeWidth ?? session.strokeWidth
            const baked = bakePolyline(session.points, sw)
            if (meta) {
              meta.points = baked
              recomputeBounds(meta, baked)
            }
            ;(activeLine as any).points = baked
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

    const canvas = document.createElement('canvas')
    canvas.style.position = 'absolute'
    canvas.style.left = '0'
    canvas.style.top = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    view.appendChild(canvas)

    const resizeCanvas = () => {
      const r = view.getBoundingClientRect()
      const dpr = Math.max(1, globalThis.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.floor(r.width * dpr))
      canvas.height = Math.max(1, Math.floor(r.height * dpr))
    }
    resizeCanvas()

    type RenderNode = {
      role: 'stroke' | 'eraserPixel'
      strokeWidth: number
      points: number[]
      meta: LineMeta
      color: [number, number, number, number]
    }

    type Action = { kind: 'add' | 'remove'; nodes: RenderNode[] }
    const live = new Set<RenderNode>()
    const order: RenderNode[] = []
    const history = { undo: [] as Action[], redo: [] as Action[] }

    const addNodes = (nodes: RenderNode[]) => {
      for (const n of nodes) {
        if (live.has(n)) continue
        live.add(n)
        order.push(n)
      }
    }

    const removeNodes = (nodes: RenderNode[]) => {
      const set = new Set(nodes)
      for (const n of set) live.delete(n)
      if (!set.size) return
      for (let i = order.length - 1; i >= 0; i--) {
        if (set.has(order[i])) order.splice(i, 1)
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
        node: null | RenderNode
        points: number[]
        erasingStroke: boolean
        erased: RenderNode[]
        erasedSet: Set<RenderNode>
        strokeWidth: number
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
      if (!inkSmoothingRef.current) return { x, y }
      if (!session.hasSmooth) {
        session.hasSmooth = true
        session.smoothX = x
        session.smoothY = y
        return { x, y }
      }
      const dx = x - session.smoothX
      const dy = y - session.smoothY
      const speed = Math.hypot(dx, dy) / dt
      const a = clamp(0.22 + speed * 0.28, 0.22, 0.78)
      const nx = session.smoothX + dx * a
      const ny = session.smoothY + dy * a
      session.smoothX = nx
      session.smoothY = ny
      return { x: nx, y: ny }
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
      const newCoords = session.points.length - session.lastBakeLen
      if (newCoords < BAKE_MIN_NEW_COORDS && now - session.lastBakeAt < BAKE_MIN_INTERVAL_MS) return
      if (session.baking) return
      session.lastBakeAt = now
      session.lastBakeLen = session.points.length
      session.baking = true
      requestAnimationFrame(() => {
        session.baking = false
        const current = sessions.get(pointerId)
        if (!current || current !== session) return
        if (!inkSmoothingRef.current) return
        const node = current.node
        if (!node) return
        const baked = bakePolylineWithTail(current.points, node.strokeWidth, BAKE_TAIL_POINTS)
        if (baked === current.points) return
        current.points = baked
        node.points = baked
        node.meta.points = baked
        recomputeBounds(node.meta, baked)
        requestRender()
      })
    }

    let cancelled = false
    let webgpu: null | { configure: () => void; draw: (nodes: RenderNode[]) => void } = null
    const webgl = createWebGLRenderer(canvas)

    const init = async () => {
      if (rendererEngine === 'webgpu') {
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

    const onPointerDown = (e: PointerEvent) => {
      if (toolRef.current === 'mouse') return
      if (!multiTouchRef.current && sessions.size > 0) return
      view.setPointerCapture(e.pointerId)
      const { x, y } = getPoint(e)
      const session = {
        node: null as null | RenderNode,
        points: [] as number[],
        erasingStroke: toolRef.current === 'eraser' && eraserTypeRef.current === 'stroke',
        erased: [] as RenderNode[],
        erasedSet: new Set<RenderNode>(),
        strokeWidth: 6,
        smoothX: x,
        smoothY: y,
        hasSmooth: false,
        lastTime: performance.now(),
        baking: false,
        lastBakeAt: 0,
        lastBakeLen: 0
      }
      const p0 = applySmoothing(session, x, y)
      session.points = [p0.x, p0.y, p0.x, p0.y]
      sessions.set(e.pointerId, session)

      if (session.erasingStroke) {
        const radius = eraserThicknessRef.current * 0.5
        for (const node of Array.from(live)) {
          if (node.role !== 'stroke') continue
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
      const meta: LineMeta = { role, strokeWidth, points: session.points, minX: p0.x, minY: p0.y, maxX: p0.x, maxY: p0.y }
      const node: RenderNode = { role, strokeWidth, points: session.points, meta, color: rgba }
      session.node = node
      addNodes([node])
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
      const appended = appendInterpolatedPoints(session.points, p.x, p.y, maxStep, 6)

      if (session.erasingStroke) {
        const radius = eraserThicknessRef.current * 0.5
        for (const node of Array.from(live)) {
          if (node.role !== 'stroke') continue
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
      for (let i = 0; i + 1 < appended.length; i += 2) updateBounds(session.node.meta, appended[i], appended[i + 1])
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
        if (inkSmoothingRef.current) {
          const baked = bakePolyline(session.points, active.strokeWidth)
          active.points = baked
          active.meta.points = baked
          recomputeBounds(active.meta, baked)
          requestRender()
        }
        record({ kind: 'add', nodes: [active] })
      }
    }

    const onPointerUp = (e: PointerEvent) => finish(e)
    const onPointerCancel = (e: PointerEvent) => finish(e)

    const ro = new ResizeObserver(() => {
      resizeCanvas()
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
