import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { LeavelDb } from '../LeavelDB'
import { getValue, putValue } from '../LeavelDB'
import { VIDEO_SHOW_PAGES_KV_KEY, WHITEBOARD_CANVAS_PAGES_KV_KEY } from '../status/keys'
import { buildCunoxManifestXml, parseCunoxManifestXml, type CunoxManifestV1, type CunoxPageType, type CunoxResource, type CunoxScene, type CunoxSceneKind } from './manifest'
import { decodeInkmlAndExcToDoc, encodeDocToInkmlAndExc, type PersistedAnnotationBookV2, type PersistedAnnotationDocV1, type PersistedAnnotationNodeV1 } from './inkml'

type WhiteboardCanvasPageV1 = { bgColor?: string; bgImageUrl?: string; bgImageOpacity?: number }
type WhiteboardCanvasBookV1 = { version: 1; pages: WhiteboardCanvasPageV1[] }

type VideoShowPageV1 = { name?: string; imageUrl?: string; createdAt?: number }
type VideoShowPageBookV1 = { version: 1; pages: VideoShowPageV1[] }

export type CunoxExportOptions = {
  outDir: string
  overwrite?: boolean
  include?: Partial<Record<CunoxSceneKind, boolean>>
}

export type CunoxImportOptions = {
  dir: string
  mode?: 'replace'
}

const NOTES_WHITEBOARD_KEY = 'annotation-notes-whiteboard'
const NOTES_PPT_KEY = 'annotation-notes-ppt'
const NOTES_VIDEO_SHOW_KEY = 'annotation-notes-video-show'

function nowMs(): number {
  return Date.now()
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
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
  if (!isFiniteNumber(b.currentPage)) return false
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

function emptyDoc(): PersistedAnnotationDocV1 {
  return { version: 1, nodes: [] }
}

function emptyBook(total: number): PersistedAnnotationBookV2 {
  const pages: PersistedAnnotationDocV1[] = []
  for (let i = 0; i < Math.max(1, Math.floor(total)); i++) pages.push(emptyDoc())
  return { version: 2, currentPage: 0, pages }
}

async function safeGetDb<T>(db: LeavelDb, key: string): Promise<T | null> {
  try {
    return await getValue<T>(db, key)
  } catch {
    return null
  }
}

function parseDataUrl(url: string): { mime: string; bytes: Uint8Array } | null {
  const s = String(url ?? '')
  if (!s.startsWith('data:')) return null
  const comma = s.indexOf(',')
  if (comma < 0) return null
  const head = s.slice(5, comma)
  const body = s.slice(comma + 1)
  const parts = head.split(';').filter(Boolean)
  const mime = parts[0] ? String(parts[0]) : 'application/octet-stream'
  const isBase64 = parts.includes('base64')
  try {
    if (isBase64) {
      const buf = Buffer.from(body, 'base64')
      return { mime, bytes: new Uint8Array(buf) }
    }
    const decoded = decodeURIComponent(body)
    const buf = Buffer.from(decoded, 'utf8')
    return { mime, bytes: new Uint8Array(buf) }
  } catch {
    return null
  }
}

function bufferToDataUrl(mime: string, buf: Uint8Array): string {
  const b64 = Buffer.from(buf).toString('base64')
  return `data:${mime};base64,${b64}`
}

function sha256Hex(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex')
}

function extFromMime(mime: string): string {
  const m = String(mime ?? '').toLowerCase()
  if (m === 'image/png') return '.png'
  if (m === 'image/jpeg') return '.jpg'
  if (m === 'image/jpg') return '.jpg'
  if (m === 'image/webp') return '.webp'
  if (m === 'image/bmp') return '.bmp'
  if (m === 'image/gif') return '.gif'
  if (m === 'video/mp4') return '.mp4'
  if (m === 'application/pdf') return '.pdf'
  if (m === 'text/html') return '.html'
  if (m === 'application/vnd.ms-powerpoint') return '.ppt'
  if (m === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return '.pptx'
  return '.bin'
}

function guessMimeFromPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.bmp') return 'image/bmp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.html' || ext === '.htm') return 'text/html'
  if (ext === '.ppt') return 'application/vnd.ms-powerpoint'
  if (ext === '.pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  return 'application/octet-stream'
}

async function readBytesFromFilePath(filePath: string): Promise<Uint8Array> {
  const buf = await readFile(filePath)
  return new Uint8Array(buf)
}

async function writeBytes(filePath: string, bytes: Uint8Array): Promise<void> {
  await mkdir(join(filePath, '..'), { recursive: true })
  await writeFile(filePath, bytes)
}

async function addResource(args: {
  outDir: string
  sceneDir: string
  resources: CunoxResource[]
  input: { kind: 'dataUrl'; url: string } | { kind: 'filePath'; filePath: string } | { kind: 'externalUrl'; url: string; mime: string }
}): Promise<string | null> {
  if (args.input.kind === 'externalUrl') {
    const id = `r_${args.resources.length + 1}`
    args.resources.push({ id, href: args.input.url, mime: args.input.mime, external: true })
    return id
  }

  if (args.input.kind === 'dataUrl') {
    const parsed = parseDataUrl(args.input.url)
    if (!parsed) return null
    const sha = sha256Hex(parsed.bytes)
    const ext = extFromMime(parsed.mime)
    const href = `${args.sceneDir}/resource/${sha}${ext}`
    const absPath = join(args.outDir, href)
    await mkdir(join(absPath, '..'), { recursive: true })
    await writeFile(absPath, Buffer.from(parsed.bytes))
    const id = `r_${sha.slice(0, 16)}`
    args.resources.push({ id, href, mime: parsed.mime, sha256: sha, size: parsed.bytes.length })
    return id
  }

  const filePath = args.input.filePath
  const bytes = await readBytesFromFilePath(filePath)
  const sha = sha256Hex(bytes)
  const mime = guessMimeFromPath(filePath)
  const ext = extname(filePath) || extFromMime(mime)
  const href = `${args.sceneDir}/resource/${sha}${ext}`
  const absPath = join(args.outDir, href)
  await mkdir(join(absPath, '..'), { recursive: true })
  await writeFile(absPath, Buffer.from(bytes))
  const id = `r_${sha.slice(0, 16)}`
  args.resources.push({ id, href, mime, sha256: sha, size: bytes.length })
  return id
}

function docToOplogLines(doc: PersistedAnnotationDocV1): string[] {
  const out: string[] = []
  const nodes = Array.isArray(doc?.nodes) ? doc.nodes : []
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i] as PersistedAnnotationNodeV1 | undefined
    if (!n) continue
    const opId = `op_${i}`
    const t = i
    if (n.role === 'stroke' || n.role === 'eraserPixel') {
      out.push(
        JSON.stringify({
          opId,
          actorId: 'imported',
          actorSeq: i,
          t,
          type: 'addTrace',
          payload: {
            role: n.role,
            strokeWidth: n.strokeWidth,
            color: n.color ?? null,
            opacity: n.opacity ?? null,
            pfh: n.pfh ?? null,
            groupId: n.groupId ?? null,
            points: Array.isArray(n.points) ? n.points : []
          }
        })
      )
    }
  }
  return out
}

async function ensureCleanOutDir(outDir: string, overwrite: boolean | undefined): Promise<void> {
  const existed = await stat(outDir).then(() => true).catch(() => false)
  if (existed && overwrite) await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
}

async function writeText(outPath: string, text: string): Promise<void> {
  await mkdir(join(outPath, '..'), { recursive: true })
  await writeFile(outPath, text, 'utf8')
}

async function exportSceneBoard(args: { db: LeavelDb; outDir: string; resources: CunoxResource[] }): Promise<CunoxScene> {
  const notes = await safeGetDb<unknown>(args.db, NOTES_WHITEBOARD_KEY)
  const book = isPersistedAnnotationBookV2(notes) ? notes : emptyBook(1)

  const canvasRaw = await safeGetDb<unknown>(args.db, WHITEBOARD_CANVAS_PAGES_KV_KEY)
  const canvasBook = isWhiteboardCanvasBookV1(canvasRaw) ? canvasRaw : ({ version: 1, pages: [] } satisfies WhiteboardCanvasBookV1)

  const sceneDir = 'board'
  const pages: CunoxScene['pages'] = []

  const total = Math.max(1, book.pages.length)
  for (let i = 0; i < total; i++) {
    const pageId = `board-${i}`
    const doc = book.pages[i] ?? emptyDoc()
    const { inkml, inkmlexc } = encodeDocToInkmlAndExc(doc)

    const inkmlRel = `${sceneDir}/ink/${pageId}.inkml`
    const inkmlexcRel = `${sceneDir}/ink/${pageId}.inkmlexc`
    const oplogRel = `${sceneDir}/ink/${pageId}.oplog.jsonl`

    await writeText(join(args.outDir, inkmlRel), inkml)
    await writeText(join(args.outDir, inkmlexcRel), inkmlexc)
    await writeText(join(args.outDir, oplogRel), docToOplogLines(doc).join('\n') + '\n')

    const meta: Record<string, string> = {}
    const bg = canvasBook.pages[i]
    if (bg && typeof bg.bgColor === 'string' && bg.bgColor) meta.bgColor = bg.bgColor
    if (bg && typeof bg.bgImageOpacity === 'number' && Number.isFinite(bg.bgImageOpacity)) meta.bgImageOpacity = String(bg.bgImageOpacity)

    let baseResourceId: string | undefined
    if (bg && typeof bg.bgImageUrl === 'string' && bg.bgImageUrl) {
      const u = bg.bgImageUrl
      if (u.startsWith('data:')) {
        baseResourceId = (await addResource({ outDir: args.outDir, sceneDir, resources: args.resources, input: { kind: 'dataUrl', url: u } })) ?? undefined
      } else if (u.startsWith('file://')) {
        try {
          const filePath = fileURLToPath(u)
          baseResourceId =
            (await addResource({ outDir: args.outDir, sceneDir, resources: args.resources, input: { kind: 'filePath', filePath } })) ?? undefined
        } catch {}
      } else if (/^[a-zA-Z]+:\/\//.test(u)) {
        baseResourceId = (await addResource({ outDir: args.outDir, sceneDir, resources: args.resources, input: { kind: 'externalUrl', url: u, mime: 'application/octet-stream' } })) ?? undefined
      } else {
        baseResourceId =
          (await addResource({ outDir: args.outDir, sceneDir, resources: args.resources, input: { kind: 'filePath', filePath: u } })) ?? undefined
      }
    }

    pages.push({
      id: pageId,
      type: 'screen',
      baseResourceId,
      ink: { inkml: inkmlRel, inkmlexc: inkmlexcRel, oplog: oplogRel },
      meta: Object.keys(meta).length ? meta : undefined
    })
  }

  return { id: 'board', kind: 'board', pages }
}

async function exportScenePpt(args: { db: LeavelDb; outDir: string }): Promise<CunoxScene | null> {
  const notes = await safeGetDb<unknown>(args.db, NOTES_PPT_KEY)
  if (!isPersistedAnnotationBookV2(notes)) return null
  const book = notes
  const sceneDir = 'ppt'
  const pages: CunoxScene['pages'] = []

  for (let i = 0; i < Math.max(1, book.pages.length); i++) {
    const pageId = `ppt-${i}`
    const doc = book.pages[i] ?? emptyDoc()
    const { inkml, inkmlexc } = encodeDocToInkmlAndExc(doc)
    const inkmlRel = `${sceneDir}/ink/${pageId}.inkml`
    const inkmlexcRel = `${sceneDir}/ink/${pageId}.inkmlexc`
    const oplogRel = `${sceneDir}/ink/${pageId}.oplog.jsonl`
    await writeText(join(args.outDir, inkmlRel), inkml)
    await writeText(join(args.outDir, inkmlexcRel), inkmlexc)
    await writeText(join(args.outDir, oplogRel), docToOplogLines(doc).join('\n') + '\n')
    pages.push({ id: pageId, type: 'infinite', ink: { inkml: inkmlRel, inkmlexc: inkmlexcRel, oplog: oplogRel } })
  }

  return { id: 'ppt', kind: 'ppt', pages }
}

async function exportSceneVideoBooth(args: { db: LeavelDb; outDir: string; resources: CunoxResource[] }): Promise<CunoxScene | null> {
  const pagesRaw = await safeGetDb<unknown>(args.db, VIDEO_SHOW_PAGES_KV_KEY)
  if (!isVideoShowPageBookV1(pagesRaw)) return null

  const notesRaw = await safeGetDb<unknown>(args.db, NOTES_VIDEO_SHOW_KEY)
  const notesBook = isPersistedAnnotationBookV2(notesRaw) ? notesRaw : emptyBook(pagesRaw.pages.length)

  const sceneDir = 'video_booth'
  const pages: CunoxScene['pages'] = []

  for (let i = 0; i < pagesRaw.pages.length; i++) {
    const p = pagesRaw.pages[i] ?? {}
    const pageId = `video-${i}`

    let baseResourceId: string | undefined
    const imageUrl = typeof p.imageUrl === 'string' ? p.imageUrl : ''
    if (imageUrl) {
      if (imageUrl.startsWith('data:')) {
        baseResourceId = (await addResource({ outDir: args.outDir, sceneDir, resources: args.resources, input: { kind: 'dataUrl', url: imageUrl } })) ?? undefined
      } else if (imageUrl.startsWith('file://')) {
        try {
          const filePath = fileURLToPath(imageUrl)
          baseResourceId =
            (await addResource({ outDir: args.outDir, sceneDir, resources: args.resources, input: { kind: 'filePath', filePath } })) ?? undefined
        } catch {}
      } else if (/^[a-zA-Z]+:\/\//.test(imageUrl)) {
        baseResourceId = (await addResource({ outDir: args.outDir, sceneDir, resources: args.resources, input: { kind: 'externalUrl', url: imageUrl, mime: 'application/octet-stream' } })) ?? undefined
      } else {
        baseResourceId =
          (await addResource({ outDir: args.outDir, sceneDir, resources: args.resources, input: { kind: 'filePath', filePath: imageUrl } })) ?? undefined
      }
    }

    const doc = notesBook.pages[i] ?? emptyDoc()
    const { inkml, inkmlexc } = encodeDocToInkmlAndExc(doc)
    const inkmlRel = `${sceneDir}/ink/${pageId}.inkml`
    const inkmlexcRel = `${sceneDir}/ink/${pageId}.inkmlexc`
    const oplogRel = `${sceneDir}/ink/${pageId}.oplog.jsonl`
    await writeText(join(args.outDir, inkmlRel), inkml)
    await writeText(join(args.outDir, inkmlexcRel), inkmlexc)
    await writeText(join(args.outDir, oplogRel), docToOplogLines(doc).join('\n') + '\n')

    pages.push({
      id: pageId,
      type: 'image',
      title: typeof p.name === 'string' && p.name ? p.name : undefined,
      createdAt: typeof p.createdAt === 'number' && Number.isFinite(p.createdAt) ? p.createdAt : undefined,
      baseResourceId,
      ink: { inkml: inkmlRel, inkmlexc: inkmlexcRel, oplog: oplogRel }
    })
  }

  return { id: 'video_booth', kind: 'video_booth', pages }
}

export async function exportDbToCunoxDir(db: LeavelDb, options: CunoxExportOptions): Promise<{ outDir: string; manifest: CunoxManifestV1 }> {
  await ensureCleanOutDir(options.outDir, options.overwrite)
  const resources: CunoxResource[] = []
  const scenes: CunoxScene[] = []

  const include = options.include ?? {}
  const shouldInclude = (k: CunoxSceneKind) => include[k] !== false

  if (shouldInclude('board')) scenes.push(await exportSceneBoard({ db, outDir: options.outDir, resources }))
  if (shouldInclude('ppt')) {
    const ppt = await exportScenePpt({ db, outDir: options.outDir })
    if (ppt) scenes.push(ppt)
  }
  if (shouldInclude('video_booth')) {
    const vb = await exportSceneVideoBooth({ db, outDir: options.outDir, resources })
    if (vb) scenes.push(vb)
  }
  if (shouldInclude('screen')) scenes.push({ id: 'screen', kind: 'screen', pages: [] })

  const manifest: CunoxManifestV1 = { formatVersion: 1, createdAt: nowMs(), resources, scenes }
  const xml = buildCunoxManifestXml(manifest)
  await writeText(join(options.outDir, 'cunox.ucixml'), xml)

  return { outDir: options.outDir, manifest }
}

export async function parseCunoxDir(dir: string): Promise<{ dir: string; manifest: CunoxManifestV1 }> {
  const xml = await readFile(join(dir, 'cunox.ucixml'), 'utf8')
  const manifest = parseCunoxManifestXml(xml)
  return { dir, manifest }
}

async function loadResourceBytes(args: { dir: string; manifest: CunoxManifestV1; resourceId: string }): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const r = args.manifest.resources.find((x) => x.id === args.resourceId)
  if (!r) return null
  if (r.external) return null
  const absPath = join(args.dir, r.href)
  const bytes = new Uint8Array(await readFile(absPath))
  return { mime: r.mime, bytes }
}

export async function importCunoxDirToDb(db: LeavelDb, options: CunoxImportOptions): Promise<{ ok: true }> {
  const { dir, manifest } = await parseCunoxDir(options.dir)
  const mode = options.mode ?? 'replace'
  if (mode !== 'replace') throw new Error('CUNOX_UNSUPPORTED_IMPORT_MODE')

  for (const scene of manifest.scenes) {
    if (scene.kind === 'board') {
      const pages: PersistedAnnotationDocV1[] = []
      const canvasPages: WhiteboardCanvasPageV1[] = []

      for (const p of scene.pages) {
        const inkmlRel = p.ink?.inkml
        const excRel = p.ink?.inkmlexc
        if (inkmlRel && excRel) {
          const inkml = await readFile(join(dir, inkmlRel), 'utf8')
          const inkmlexc = await readFile(join(dir, excRel), 'utf8')
          pages.push(decodeInkmlAndExcToDoc({ inkml, inkmlexc }))
        } else {
          pages.push(emptyDoc())
        }

        const bgColor = typeof p.meta?.bgColor === 'string' ? p.meta.bgColor : undefined
        const bgImageOpacity = p.meta?.bgImageOpacity != null ? Number(p.meta.bgImageOpacity) : undefined

        let bgImageUrl: string | undefined
        if (p.baseResourceId) {
          const loaded = await loadResourceBytes({ dir, manifest, resourceId: p.baseResourceId })
          if (loaded) bgImageUrl = bufferToDataUrl(loaded.mime, loaded.bytes)
        }

        canvasPages.push({
          ...(bgColor ? { bgColor } : {}),
          ...(bgImageUrl ? { bgImageUrl } : {}),
          ...(typeof bgImageOpacity === 'number' && Number.isFinite(bgImageOpacity) ? { bgImageOpacity } : {})
        })
      }

      const book: PersistedAnnotationBookV2 = { version: 2, currentPage: 0, pages }
      await putValue(db, NOTES_WHITEBOARD_KEY, book)
      await putValue(db, WHITEBOARD_CANVAS_PAGES_KV_KEY, { version: 1, pages: canvasPages } satisfies WhiteboardCanvasBookV1)
    }

    if (scene.kind === 'ppt') {
      const pages: PersistedAnnotationDocV1[] = []
      for (const p of scene.pages) {
        const inkmlRel = p.ink?.inkml
        const excRel = p.ink?.inkmlexc
        if (inkmlRel && excRel) {
          const inkml = await readFile(join(dir, inkmlRel), 'utf8')
          const inkmlexc = await readFile(join(dir, excRel), 'utf8')
          pages.push(decodeInkmlAndExcToDoc({ inkml, inkmlexc }))
        } else {
          pages.push(emptyDoc())
        }
      }
      const book: PersistedAnnotationBookV2 = { version: 2, currentPage: 0, pages }
      await putValue(db, NOTES_PPT_KEY, book)
    }

    if (scene.kind === 'video_booth') {
      const pages: PersistedAnnotationDocV1[] = []
      const videoPages: VideoShowPageV1[] = []
      for (const p of scene.pages) {
        const inkmlRel = p.ink?.inkml
        const excRel = p.ink?.inkmlexc
        if (inkmlRel && excRel) {
          const inkml = await readFile(join(dir, inkmlRel), 'utf8')
          const inkmlexc = await readFile(join(dir, excRel), 'utf8')
          pages.push(decodeInkmlAndExcToDoc({ inkml, inkmlexc }))
        } else {
          pages.push(emptyDoc())
        }

        let imageUrl: string | undefined
        if (p.baseResourceId) {
          const loaded = await loadResourceBytes({ dir, manifest, resourceId: p.baseResourceId })
          if (loaded) imageUrl = bufferToDataUrl(loaded.mime, loaded.bytes)
        }

        videoPages.push({
          ...(p.title ? { name: p.title } : {}),
          ...(imageUrl ? { imageUrl } : {}),
          ...(typeof p.createdAt === 'number' ? { createdAt: p.createdAt } : {})
        })
      }

      await putValue(db, NOTES_VIDEO_SHOW_KEY, { version: 2, currentPage: 0, pages } satisfies PersistedAnnotationBookV2)
      await putValue(db, VIDEO_SHOW_PAGES_KV_KEY, { version: 1, pages: videoPages } satisfies VideoShowPageBookV1)
    }
  }

  return { ok: true }
}
