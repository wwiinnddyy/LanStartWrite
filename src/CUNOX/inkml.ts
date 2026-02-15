export type PersistedAnnotationNodeV1 = {
  role: 'stroke' | 'eraserPixel'
  groupId?: number
  strokeWidth: number
  points: number[]
  color?: string
  opacity?: number
  pfh?: boolean
}

export type PersistedAnnotationDocV1 = { version: 1; nodes: PersistedAnnotationNodeV1[] }
export type PersistedAnnotationBookV2 = { version: 2; currentPage: number; pages: PersistedAnnotationDocV1[] }

export type InkmlexcV1 = {
  version: 1
  traces: Array<{
    id: string
    role: 'stroke' | 'eraserPixel'
    strokeWidth: number
    color?: string
    opacity?: number
    pfh?: boolean
    groupId?: number
  }>
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function sanitizePoints(points: number[]): number[] {
  const out: number[] = []
  for (const n of points) if (isFiniteNumber(n)) out.push(n)
  if (out.length % 2 === 1) out.length -= 1
  return out
}

function escapeXmlText(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function pointsToInkmlTrace(points: number[]): string {
  const pts = sanitizePoints(points)
  const pairs: string[] = []
  for (let i = 0; i + 1 < pts.length; i += 2) pairs.push(`${pts[i]} ${pts[i + 1]}`)
  return pairs.join(', ')
}

export function encodeDocToInkmlAndExc(doc: PersistedAnnotationDocV1): { inkml: string; inkmlexc: string } {
  const traces: string[] = []
  const exc: InkmlexcV1 = { version: 1, traces: [] }

  const nodes = Array.isArray(doc?.nodes) ? doc.nodes : []
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (!n || (n.role !== 'stroke' && n.role !== 'eraserPixel')) continue
    const id = `t${i}`
    const traceBody = pointsToInkmlTrace(Array.isArray(n.points) ? n.points : [])
    traces.push(`<trace id="${escapeXmlText(id)}">${escapeXmlText(traceBody)}</trace>`)
    exc.traces.push({
      id,
      role: n.role,
      strokeWidth: typeof n.strokeWidth === 'number' && Number.isFinite(n.strokeWidth) ? n.strokeWidth : 1,
      color: typeof n.color === 'string' ? n.color : undefined,
      opacity: typeof n.opacity === 'number' && Number.isFinite(n.opacity) ? n.opacity : undefined,
      pfh: typeof n.pfh === 'boolean' ? n.pfh : undefined,
      groupId: typeof n.groupId === 'number' && Number.isFinite(n.groupId) ? n.groupId : undefined
    })
  }

  const inkml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<ink xmlns="http://www.w3.org/2003/InkML">\n` +
    `${traces.map((t) => `  ${t}`).join('\n')}\n` +
    `</ink>\n`

  return { inkml, inkmlexc: JSON.stringify(exc) }
}

function parseInkmlTraces(inkml: string): Map<string, number[]> {
  const map = new Map<string, number[]>()
  const s = String(inkml ?? '')
  const re = /<trace\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/trace>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const id = m[1] ?? ''
    const body = m[2] ?? ''
    const pairs = body
      .replaceAll('\r', ' ')
      .replaceAll('\n', ' ')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    const pts: number[] = []
    for (const pair of pairs) {
      const parts = pair.split(/\s+/).filter(Boolean)
      if (parts.length < 2) continue
      const x = Number(parts[0])
      const y = Number(parts[1])
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      pts.push(x, y)
    }
    map.set(id, pts)
  }
  return map
}

export function decodeInkmlAndExcToDoc(args: { inkml: string; inkmlexc: string }): PersistedAnnotationDocV1 {
  const tracePoints = parseInkmlTraces(args.inkml)
  let exc: InkmlexcV1 | null = null
  try {
    const parsed = JSON.parse(String(args.inkmlexc ?? ''))
    if (parsed && typeof parsed === 'object' && parsed.version === 1 && Array.isArray((parsed as any).traces)) exc = parsed as InkmlexcV1
  } catch {
    exc = null
  }

  const nodes: PersistedAnnotationNodeV1[] = []
  for (const t of exc?.traces ?? []) {
    const id = typeof t?.id === 'string' ? t.id : ''
    const role = t?.role === 'stroke' || t?.role === 'eraserPixel' ? t.role : 'stroke'
    const strokeWidth = typeof t?.strokeWidth === 'number' && Number.isFinite(t.strokeWidth) ? t.strokeWidth : 1
    const points = tracePoints.get(id) ?? []
    nodes.push({
      role,
      groupId: typeof t?.groupId === 'number' && Number.isFinite(t.groupId) ? t.groupId : undefined,
      strokeWidth,
      points: points.slice(),
      color: typeof t?.color === 'string' ? t.color : undefined,
      opacity: typeof t?.opacity === 'number' && Number.isFinite(t.opacity) ? t.opacity : undefined,
      pfh: typeof t?.pfh === 'boolean' ? t.pfh : undefined
    })
  }

  return { version: 1, nodes }
}

