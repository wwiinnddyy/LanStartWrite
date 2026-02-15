import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getValue, openLeavelDb, putValue } from '../../LeavelDB'
import { VIDEO_SHOW_PAGES_KV_KEY, WHITEBOARD_CANVAS_PAGES_KV_KEY } from '../../status/keys'
import { exportDbToCunoxDir, importCunoxDirToDb } from '..'

const NOTES_WHITEBOARD_KEY = 'annotation-notes-whiteboard'
const NOTES_PPT_KEY = 'annotation-notes-ppt'
const NOTES_VIDEO_SHOW_KEY = 'annotation-notes-video-show'

const ONE_BY_ONE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/TxLr0sAAAAASUVORK5CYII='

describe('cunox directory format', () => {
  it('exports from db and imports back with same semantics', async () => {
    const base = await mkdtemp(join(tmpdir(), 'cunox-test-'))
    const dbDir1 = join(base, 'db1')
    const dbDir2 = join(base, 'db2')
    const outDir = join(base, 'book.cunox')

    const db1 = openLeavelDb(dbDir1)
    const db2 = openLeavelDb(dbDir2)
    try {
      await putValue(db1, NOTES_WHITEBOARD_KEY, {
        version: 2,
        currentPage: 0,
        pages: [
          {
            version: 1,
            nodes: [
              { role: 'stroke', strokeWidth: 3, points: [1, 2, 3, 4], color: '#ff0000', opacity: 0.5, pfh: true, groupId: 7 },
              { role: 'eraserPixel', strokeWidth: 10, points: [10, 20, 30, 40] }
            ]
          }
        ]
      })
      await putValue(db1, WHITEBOARD_CANVAS_PAGES_KV_KEY, { version: 1, pages: [{ bgColor: '#ffffff', bgImageUrl: ONE_BY_ONE_PNG, bgImageOpacity: 0.25 }] })

      await putValue(db1, NOTES_PPT_KEY, { version: 2, currentPage: 0, pages: [{ version: 1, nodes: [{ role: 'stroke', strokeWidth: 5, points: [9, 8, 7, 6], color: '#00ff00' }] }] })

      await putValue(db1, VIDEO_SHOW_PAGES_KV_KEY, {
        version: 1,
        pages: [{ name: 'p1', imageUrl: ONE_BY_ONE_PNG, createdAt: 123 }]
      })
      await putValue(db1, NOTES_VIDEO_SHOW_KEY, { version: 2, currentPage: 0, pages: [{ version: 1, nodes: [{ role: 'stroke', strokeWidth: 2, points: [0, 0, 1, 1] }] }] })

      await exportDbToCunoxDir(db1, { outDir, overwrite: true })
      await importCunoxDirToDb(db2, { dir: outDir, mode: 'replace' })

      const wb = await getValue<any>(db2, NOTES_WHITEBOARD_KEY)
      expect(wb?.version).toBe(2)
      expect(wb?.pages?.[0]?.version).toBe(1)
      expect(wb?.pages?.[0]?.nodes?.length).toBe(2)
      expect(wb?.pages?.[0]?.nodes?.[0]?.role).toBe('stroke')
      expect(wb?.pages?.[0]?.nodes?.[0]?.color).toBe('#ff0000')
      expect(wb?.pages?.[0]?.nodes?.[1]?.role).toBe('eraserPixel')

      const canvas = await getValue<any>(db2, WHITEBOARD_CANVAS_PAGES_KV_KEY)
      expect(canvas?.version).toBe(1)
      expect(canvas?.pages?.[0]?.bgColor).toBe('#ffffff')
      expect(String(canvas?.pages?.[0]?.bgImageUrl ?? '')).toBe(ONE_BY_ONE_PNG)
      expect(canvas?.pages?.[0]?.bgImageOpacity).toBeCloseTo(0.25)

      const ppt = await getValue<any>(db2, NOTES_PPT_KEY)
      expect(ppt?.pages?.[0]?.nodes?.[0]?.color).toBe('#00ff00')

      const vbPages = await getValue<any>(db2, VIDEO_SHOW_PAGES_KV_KEY)
      expect(vbPages?.version).toBe(1)
      expect(vbPages?.pages?.[0]?.name).toBe('p1')
      expect(String(vbPages?.pages?.[0]?.imageUrl ?? '')).toBe(ONE_BY_ONE_PNG)
      expect(vbPages?.pages?.[0]?.createdAt).toBe(123)

      const vbNotes = await getValue<any>(db2, NOTES_VIDEO_SHOW_KEY)
      expect(vbNotes?.pages?.[0]?.nodes?.[0]?.role).toBe('stroke')
    } finally {
      await db1.close().catch(() => undefined)
      await db2.close().catch(() => undefined)
      await rm(base, { recursive: true, force: true })
    }
  })

  it('parses manifest deterministically', async () => {
    const base = await mkdtemp(join(tmpdir(), 'cunox-test-'))
    const dbDir = join(base, 'db')
    const outDir = join(base, `${randomUUID()}.cunox`)

    const db = openLeavelDb(dbDir)
    try {
      await putValue(db, NOTES_WHITEBOARD_KEY, { version: 2, currentPage: 0, pages: [{ version: 1, nodes: [] }] })
      const res = await exportDbToCunoxDir(db, { outDir, overwrite: true, include: { board: true, ppt: false, video_booth: false, screen: false } })
      expect(res.manifest.formatVersion).toBe(1)
      expect(res.manifest.scenes.some((s) => s.kind === 'board')).toBe(true)
    } finally {
      await db.close().catch(() => undefined)
      await rm(base, { recursive: true, force: true })
    }
  })
})

