import type { ForegroundWindowSample, ProcessSample } from '../../../task_windows_watcher/types'
import type {
  CapabilityError,
  CapabilityKeyName,
  CapabilityMethodName,
  CapabilityRequest,
  CapabilityRequestMap,
  CapabilityResponse,
  WallpaperThumbnailResult
} from '../protocol'
import { closeHandle, openProcessHandle } from './ffi/kernel32'
import { enumProcessIds, readProcessMemoryBytes } from './ffi/psapi'
import { isUserAnAdmin } from './ffi/shell32'
import {
  bringWindowToTop,
  getForegroundWindowHandle,
  getWallpaperPath,
  getWindowProcessId,
  getWindowRect,
  getWindowText,
  sendVirtualKeys,
  setWindowTopmost
} from './ffi/user32'

const globalScope = self as unknown as Worker

const VK_BY_KEY: Record<CapabilityKeyName, number> = {
  escape: 0x1b,
  left: 0x25,
  right: 0x27
}

const decoder = new TextDecoder()

function normalizeError(error: unknown): CapabilityError {
  if (error && typeof error === 'object') {
    const code = String((error as any).code ?? 'capability_failed')
    const message = String((error as any).message ?? 'capability_failed')
    const details = (error as any).details
    return details === undefined ? { code, message } : { code, message, details }
  }
  return { code: 'capability_failed', message: String(error) }
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let token = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        token += '"'
        i += 1
      } else {
        inQuote = !inQuote
      }
      continue
    }
    if (ch === ',' && !inQuote) {
      out.push(token)
      token = ''
      continue
    }
    token += ch
  }
  out.push(token)
  return out.map((item) => item.trim())
}

function readCommandStdout(cmd: string[]): string {
  try {
    const result = Bun.spawnSync({
      cmd,
      stdout: 'pipe',
      stderr: 'pipe'
    })
    const exitCode = Number(result.exitCode ?? (result.success ? 0 : 1))
    if (exitCode !== 0) return ''
    const bytes = (result.stdout ?? new Uint8Array(0)) as Uint8Array
    return decoder.decode(bytes)
  } catch {
    return ''
  }
}

function getProcessNameMap(): Map<number, string> {
  const map = new Map<number, string>()
  const output = readCommandStdout(['tasklist', '/FO', 'CSV', '/NH'])
  if (!output.trim()) return map

  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    const cols = parseCsvLine(line)
    if (cols.length < 2) continue
    const name = cols[0] ?? ''
    const pid = Number(cols[1])
    if (!name || !Number.isFinite(pid) || pid <= 0) continue
    map.set(Math.floor(pid), name.replace(/\.exe$/i, ''))
  }

  return map
}

function handleToString(handle: number | bigint | string): string {
  if (typeof handle === 'string') return handle
  if (typeof handle === 'bigint') return handle.toString()
  if (!Number.isFinite(handle) || handle <= 0) return ''
  return Math.trunc(handle).toString()
}

function pathExtname(path: string): string {
  const idx = path.lastIndexOf('.')
  if (idx < 0) return ''
  return path.slice(idx).toLowerCase()
}

function inferMimeFromPath(path: string): string {
  const ext = pathExtname(path)
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.bmp') return 'image/bmp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  return 'application/octet-stream'
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0
}

function parsePngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24) return undefined
  if (
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    return undefined
  }
  const width = readU32BE(bytes, 16) >>> 0
  const height = readU32BE(bytes, 20) >>> 0
  if (!width || !height) return undefined
  return { width, height }
}

function parseGifSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 10) return undefined
  if (
    bytes[0] !== 0x47 ||
    bytes[1] !== 0x49 ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x38 ||
    (bytes[4] !== 0x37 && bytes[4] !== 0x39) ||
    bytes[5] !== 0x61
  ) {
    return undefined
  }
  const width = readU16LE(bytes, 6)
  const height = readU16LE(bytes, 8)
  if (!width || !height) return undefined
  return { width, height }
}

function parseBmpSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 26) return undefined
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) return undefined
  const width = readU32LE(bytes, 18)
  const height = readU32LE(bytes, 22)
  if (!width || !height) return undefined
  return { width, height }
}

function parseJpegSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 4) return undefined
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }

    let marker = bytes[offset + 1]
    offset += 2

    while (marker === 0xff && offset < bytes.length) {
      marker = bytes[offset]
      offset += 1
    }

    if (marker === 0xd8 || marker === 0xd9) continue
    if (marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 1 >= bytes.length) break

    const segmentLength = readU16BE(bytes, offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break

    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    if (isSof) {
      if (offset + 7 >= bytes.length) break
      const height = readU16BE(bytes, offset + 3)
      const width = readU16BE(bytes, offset + 5)
      if (width && height) return { width, height }
      break
    }

    offset += segmentLength
  }

  return undefined
}

function parseWebpSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 30) return undefined
  const riff = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0)
  const webp = String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0)
  if (riff !== 'RIFF' || webp !== 'WEBP') return undefined

  const chunk = String.fromCharCode(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0)
  if (chunk === 'VP8X') {
    const width = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16))
    const height = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16))
    if (width > 0 && height > 0) return { width, height }
  }

  return undefined
}

function parseImageSize(bytes: Uint8Array): { width: number; height: number } {
  const parsers = [parsePngSize, parseJpegSize, parseBmpSize, parseGifSize, parseWebpSize]
  for (const parser of parsers) {
    const parsed = parser(bytes)
    if (parsed && parsed.width > 0 && parsed.height > 0) return parsed
  }
  return { width: 1, height: 1 }
}

async function readWallpaperThumbnail(maxSide?: number): Promise<WallpaperThumbnailResult> {
  const path = getWallpaperPath()
  if (!path) throw { code: 'wallpaper_not_found', message: 'wallpaper_not_found' }

  const file = Bun.file(path)
  const exists = await file.exists()
  if (!exists) throw { code: 'wallpaper_not_found', message: 'wallpaper_not_found' }

  const bytes = await file.bytes()
  const raw = parseImageSize(bytes)
  const boundedMaxSide = Number.isFinite(maxSide ?? NaN) ? Math.max(32, Math.floor(maxSide as number)) : undefined

  const width = raw.width
  const height = raw.height
  if (boundedMaxSide && Math.max(width, height) > boundedMaxSide) {
    // Keep contract compatibility while preserving original content bytes.
  }

  return {
    dataUrl: `data:${inferMimeFromPath(path)};base64,${Buffer.from(bytes).toString('base64')}`,
    width,
    height,
    wallpaper: {
      path,
      size: { width, height }
    }
  }
}

async function getProcessesSnapshot(): Promise<ProcessSample[]> {
  const names = getProcessNameMap()
  const pids = enumProcessIds()
  const out: ProcessSample[] = []

  for (const pid of pids) {
    if (!Number.isFinite(pid) || pid <= 0) continue

    const handle = openProcessHandle(pid)
    let memoryBytes: number | undefined
    if (handle) {
      try {
        memoryBytes = readProcessMemoryBytes(handle)
      } finally {
        closeHandle(handle)
      }
    }

    const name = names.get(pid) ?? `pid-${pid}`
    out.push({
      pid,
      name,
      memoryBytes: Number.isFinite(memoryBytes ?? NaN) ? memoryBytes : undefined
    })
  }

  return out
}

async function getForegroundWindowSample(): Promise<ForegroundWindowSample | undefined> {
  const handle = getForegroundWindowHandle()
  if (!handle) return undefined

  const pid = getWindowProcessId(handle)
  const title = getWindowText(handle)
  const bounds = getWindowRect(handle)
  const names = pid ? getProcessNameMap() : undefined

  return {
    pid,
    processName: pid ? names?.get(pid) : undefined,
    title,
    handle: handleToString(handle),
    bounds
  }
}

async function setTopmostWindows(handles: string[]): Promise<void> {
  const uniq = new Set<string>()
  for (const handle of handles) {
    const normalized = String(handle ?? '').trim()
    if (!normalized || uniq.has(normalized)) continue
    uniq.add(normalized)
    setWindowTopmost(normalized)
    bringWindowToTop(normalized)
  }
}

async function sendKeys(keys: CapabilityKeyName[]): Promise<void> {
  const vk = keys.map((key) => VK_BY_KEY[key]).filter((code) => Number.isFinite(code))
  if (!vk.length) return
  sendVirtualKeys(vk)
}

async function dispatchCapabilityMethod<M extends CapabilityMethodName>(
  method: M,
  params: CapabilityRequestMap[M]['params']
): Promise<CapabilityRequestMap[M]['result']> {
  if (method === 'cap.health') {
    return {
      platform: process.platform,
      pid: process.pid,
      workerTs: Date.now()
    } as CapabilityRequestMap[M]['result']
  }

  if (method === 'cap.process.getProcesses') {
    return (await getProcessesSnapshot()) as CapabilityRequestMap[M]['result']
  }

  if (method === 'cap.window.getForegroundWindow') {
    return (await getForegroundWindowSample()) as CapabilityRequestMap[M]['result']
  }

  if (method === 'cap.window.forceTopmostWindows') {
    const handles = Array.isArray((params as any)?.handles) ? ((params as any).handles as string[]) : []
    await setTopmostWindows(handles)
    return null as CapabilityRequestMap[M]['result']
  }

  if (method === 'cap.input.sendKeys') {
    const keys = Array.isArray((params as any)?.keys) ? ((params as any).keys as CapabilityKeyName[]) : []
    await sendKeys(keys)
    return null as CapabilityRequestMap[M]['result']
  }

  if (method === 'cap.privilege.isAdmin') {
    return isUserAnAdmin() as CapabilityRequestMap[M]['result']
  }

  if (method === 'cap.wallpaper.captureThumbnail') {
    const maxSideRaw = Number((params as any)?.maxSide)
    const maxSide = Number.isFinite(maxSideRaw) ? Math.max(32, Math.floor(maxSideRaw)) : undefined
    return (await readWallpaperThumbnail(maxSide)) as CapabilityRequestMap[M]['result']
  }

  throw { code: 'unknown_capability_method', message: `unknown_capability_method:${String(method)}` }
}

function postResponse(response: CapabilityResponse): void {
  globalScope.postMessage(response)
}

globalScope.onmessage = (event: MessageEvent<CapabilityRequest>) => {
  const msg = event.data
  if (!msg || typeof msg !== 'object') return
  const id = Number((msg as any).id)
  const method = String((msg as any).method ?? '') as CapabilityMethodName
  if (!Number.isFinite(id) || !method) return

  void (async () => {
    try {
      const result = await dispatchCapabilityMethod(method, (msg as any).params)
      postResponse({ id, ok: true, result })
    } catch (error) {
      postResponse({ id, ok: false, error: normalizeError(error) })
    }
  })()
}

addEventListener('unhandledrejection', (event) => {
  try {
    event.preventDefault()
  } catch {}
})
