import { Database as BunSqliteDatabase } from 'bun:sqlite'

type SqliteDb = BunSqliteDatabase

export type LeavelDb = { raw: SqliteDb; close: () => Promise<void> }

function parseJsonValue<T>(raw: unknown): T {
  const text = typeof raw === 'string' ? raw : String(raw ?? '')
  return JSON.parse(text) as T
}

function levelNotFoundError(): Error & { code: string; notFound: boolean } {
  const err = new Error('NotFound')
  ;(err as any).code = 'LEVEL_NOT_FOUND'
  ;(err as any).notFound = true
  return err as Error & { code: string; notFound: boolean }
}

export function openLeavelDb(dbPath: string): LeavelDb {
  const db = new BunSqliteDatabase(dbPath, { create: true })
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `)

  return {
    raw: db,
    close: async () => {
      db.close()
    }
  }
}

export async function getValue<T = unknown>(db: LeavelDb, key: string): Promise<T> {
  const row = db.raw.query('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) throw levelNotFoundError()
  return parseJsonValue<T>(row.value)
}

export async function getValueOrUndefined<T = unknown>(db: LeavelDb, key: string): Promise<T | undefined> {
  const row = db.raw.query('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) return undefined
  return parseJsonValue<T>(row.value)
}

export async function putValue<T = unknown>(db: LeavelDb, key: string, value: T): Promise<void> {
  const encoded = JSON.stringify(value)
  db.raw.query('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, encoded)
}

export async function deleteValue(db: LeavelDb, key: string): Promise<void> {
  db.raw.query('DELETE FROM kv WHERE key = ?').run(key)
}

export async function listEntriesByPrefix<T = unknown>(
  db: LeavelDb,
  prefix: string,
  options?: { limit?: number }
): Promise<Array<{ key: string; value: T }>> {
  const limit = Math.max(1, Math.min(50_000, Math.floor(options?.limit ?? 1000)))
  const lt = `${prefix}\uffff`
  const rows = db.raw
    .query('SELECT key, value FROM kv WHERE key >= ? AND key < ? ORDER BY key ASC LIMIT ?')
    .all(prefix, lt, limit) as Array<{ key: string; value: string }>

  return rows.map((row) => ({ key: row.key, value: parseJsonValue<T>(row.value) }))
}

export async function listKeysByPrefix(db: LeavelDb, prefix: string, options?: { limit?: number }): Promise<string[]> {
  const limit = Math.max(1, Math.min(50_000, Math.floor(options?.limit ?? 1000)))
  const lt = `${prefix}\uffff`
  const rows = db.raw
    .query('SELECT key FROM kv WHERE key >= ? AND key < ? ORDER BY key ASC LIMIT ?')
    .all(prefix, lt, limit) as Array<{ key: string }>

  return rows.map((row) => row.key)
}

export async function deleteByPrefix(db: LeavelDb, prefix: string, options?: { limit?: number }): Promise<number> {
  const limit = Math.max(1, Math.min(500_000, Math.floor(options?.limit ?? 100_000)))
  const keys = await listKeysByPrefix(db, prefix, { limit })
  if (!keys.length) return 0

  const del = db.raw.query('DELETE FROM kv WHERE key = ?')
  db.raw.exec('BEGIN')
  try {
    for (const key of keys) del.run(key)
    db.raw.exec('COMMIT')
  } catch (e) {
    db.raw.exec('ROLLBACK')
    throw e
  }
  return keys.length
}
