import { XMLBuilder, XMLParser } from 'fast-xml-parser'

export type CunoxSceneKind = 'board' | 'ppt' | 'screen' | 'video_booth'
export type CunoxPageType = 'screen' | 'infinite' | 'doc' | 'pdf' | 'html' | 'image'

export type CunoxResource = {
  id: string
  href: string
  mime: string
  sha256?: string
  size?: number
  external?: boolean
}

export type CunoxInkRef = {
  inkml: string
  inkmlexc?: string
  oplog?: string
}

export type CunoxPage = {
  id: string
  type: CunoxPageType
  title?: string
  createdAt?: number
  baseResourceId?: string
  ink?: CunoxInkRef
  meta?: Record<string, string>
}

export type CunoxScene = {
  id: string
  kind: CunoxSceneKind
  pages: CunoxPage[]
}

export type CunoxManifestV1 = {
  formatVersion: 1
  createdAt: number
  resources: CunoxResource[]
  scenes: CunoxScene[]
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' })
const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true
})

function coerceString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function coerceNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

function isSceneKind(v: unknown): v is CunoxSceneKind {
  return v === 'board' || v === 'ppt' || v === 'screen' || v === 'video_booth'
}

function isPageType(v: unknown): v is CunoxPageType {
  return v === 'screen' || v === 'infinite' || v === 'doc' || v === 'pdf' || v === 'html' || v === 'image'
}

export function parseCunoxManifestXml(xml: string): CunoxManifestV1 {
  const parsed = parser.parse(xml)
  const root = parsed?.cunox
  if (!root || typeof root !== 'object') throw new Error('CUNOX_BAD_MANIFEST')
  const formatVersion = coerceNumber((root as any).formatVersion)
  if (formatVersion !== 1) throw new Error('CUNOX_UNSUPPORTED_VERSION')
  const createdAt = coerceNumber((root as any).createdAt)

  const resourcesRaw = (root as any).resources?.resource
  const scenesRaw = (root as any).scenes?.scene

  const resources: CunoxResource[] = []
  for (const r of asArray<any>(resourcesRaw)) {
    const id = coerceString(r?.id)
    const href = coerceString(r?.href)
    const mime = coerceString(r?.mime)
    if (!id || !href || !mime) continue
    const sha256 = coerceString(r?.sha256) || undefined
    const size = r?.size != null ? coerceNumber(r?.size) : undefined
    const external = r?.external === true || r?.external === 'true' ? true : undefined
    resources.push({ id, href, mime, sha256, size, external })
  }

  const scenes: CunoxScene[] = []
  for (const s of asArray<any>(scenesRaw)) {
    const id = coerceString(s?.id)
    const kind = coerceString(s?.kind)
    if (!id || !isSceneKind(kind)) continue

    const pages: CunoxPage[] = []
    for (const p of asArray<any>(s?.page)) {
      const pageId = coerceString(p?.id)
      const type = coerceString(p?.type)
      if (!pageId || !isPageType(type)) continue
      const title = coerceString(p?.title) || undefined
      const createdAtPage = p?.createdAt != null ? coerceNumber(p?.createdAt) : undefined
      const baseResourceId = coerceString(p?.baseResourceId) || undefined

      const inkml = coerceString(p?.inkml) || undefined
      const inkmlexc = coerceString(p?.inkmlexc) || undefined
      const oplog = coerceString(p?.oplog) || undefined
      const ink: CunoxInkRef | undefined = inkml ? { inkml, inkmlexc: inkmlexc || undefined, oplog: oplog || undefined } : undefined

      const meta: Record<string, string> = {}
      for (const m of asArray<any>(p?.meta?.entry)) {
        const k = coerceString(m?.key)
        const v = coerceString(m?.value)
        if (!k) continue
        meta[k] = v
      }
      pages.push({ id: pageId, type, title, createdAt: createdAtPage, baseResourceId, ink, meta: Object.keys(meta).length ? meta : undefined })
    }

    scenes.push({ id, kind, pages })
  }

  return { formatVersion: 1, createdAt, resources, scenes }
}

export function buildCunoxManifestXml(manifest: CunoxManifestV1): string {
  const cunox: any = {
    formatVersion: String(manifest.formatVersion),
    createdAt: String(manifest.createdAt),
    resources: {
      resource: manifest.resources.map((r) => ({
        id: r.id,
        href: r.href,
        mime: r.mime,
        ...(r.sha256 ? { sha256: r.sha256 } : {}),
        ...(typeof r.size === 'number' ? { size: String(r.size) } : {}),
        ...(r.external ? { external: 'true' } : {})
      }))
    },
    scenes: {
      scene: manifest.scenes.map((s) => ({
        id: s.id,
        kind: s.kind,
        page: s.pages.map((p) => ({
          id: p.id,
          type: p.type,
          ...(p.title ? { title: p.title } : {}),
          ...(typeof p.createdAt === 'number' ? { createdAt: String(p.createdAt) } : {}),
          ...(p.baseResourceId ? { baseResourceId: p.baseResourceId } : {}),
          ...(p.ink?.inkml ? { inkml: p.ink.inkml } : {}),
          ...(p.ink?.inkmlexc ? { inkmlexc: p.ink.inkmlexc } : {}),
          ...(p.ink?.oplog ? { oplog: p.ink.oplog } : {}),
          ...(p.meta
            ? {
                meta: {
                  entry: Object.entries(p.meta).map(([key, value]) => ({ key, value }))
                }
              }
            : {})
        }))
      }))
    }
  }

  return builder.build({ cunox })
}

