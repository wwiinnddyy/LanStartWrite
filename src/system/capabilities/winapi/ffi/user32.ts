import { FFIType, dlopen, ptr } from 'bun:ffi'

const user32 = dlopen('user32.dll', {
  GetForegroundWindow: {
    args: [],
    returns: FFIType.u64
  },
  GetWindowTextW: {
    args: [FFIType.u64, FFIType.ptr, FFIType.i32],
    returns: FFIType.i32
  },
  GetWindowThreadProcessId: {
    args: [FFIType.u64, FFIType.ptr],
    returns: FFIType.u32
  },
  GetWindowRect: {
    args: [FFIType.u64, FFIType.ptr],
    returns: FFIType.bool
  },
  SetWindowPos: {
    args: [FFIType.u64, FFIType.i64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u32],
    returns: FFIType.bool
  },
  BringWindowToTop: {
    args: [FFIType.u64],
    returns: FFIType.bool
  },
  SendInput: {
    args: [FFIType.u32, FFIType.ptr, FFIType.i32],
    returns: FFIType.u32
  },
  SystemParametersInfoW: {
    args: [FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32],
    returns: FFIType.bool
  }
})

const SPI_GETDESKWALLPAPER = 0x0073

const SWP_NOSIZE = 0x0001
const SWP_NOMOVE = 0x0002
const SWP_NOACTIVATE = 0x0010
const SWP_NOOWNERZORDER = 0x0200
const TOPMOST_FLAGS = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOOWNERZORDER
const HWND_TOPMOST = -1

const PTR_SIZE = process.arch === 'x64' ? 8 : 4
const INPUT_SIZE = PTR_SIZE === 8 ? 40 : 28
const INPUT_UNION_OFFSET = PTR_SIZE === 8 ? 8 : 4
const KEYBDINFO_EXTRA_OFFSET = PTR_SIZE === 8 ? 16 : 12
const KEYEVENTF_KEYUP = 0x0002
const INPUT_KEYBOARD = 1

type HandleValue = string | number | bigint

function asHandlePointer(value: HandleValue): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0
  if (typeof value === 'bigint') return Number(value)
  const trimmed = value.trim()
  if (!trimmed) return 0
  try {
    if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) return Number(BigInt(trimmed))
    return Number(BigInt(trimmed))
  } catch {
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
  }
}

function decodeWideString(buffer: Uint16Array): string {
  let end = buffer.length
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0) {
      end = i
      break
    }
  }
  if (end <= 0) return ''
  return String.fromCharCode(...buffer.subarray(0, end))
}

function readSizeT(view: DataView, offset: number): number {
  if (PTR_SIZE === 8) {
    const raw = view.getBigUint64(offset, true)
    const value = Number(raw)
    return Number.isFinite(value) ? value : 0
  }
  return view.getUint32(offset, true)
}

function writeSizeT(view: DataView, offset: number, value: number): void {
  if (PTR_SIZE === 8) {
    view.setBigUint64(offset, BigInt(Math.max(0, Math.floor(value))), true)
    return
  }
  view.setUint32(offset, Math.max(0, Math.floor(value)), true)
}

export function getForegroundWindowHandle(): number | undefined {
  const handle = user32.symbols.GetForegroundWindow()
  const pointer = asHandlePointer(handle)
  if (!pointer) return undefined
  return pointer
}

export function getWindowText(handle: HandleValue): string {
  const hwnd = asHandlePointer(handle)
  if (!hwnd) return ''
  const buffer = new Uint16Array(1024)
  const length = Number(user32.symbols.GetWindowTextW(hwnd, ptr(buffer), buffer.length))
  if (!Number.isFinite(length) || length <= 0) return ''
  return String.fromCharCode(...buffer.subarray(0, Math.min(buffer.length, Math.floor(length))))
}

export function getWindowProcessId(handle: HandleValue): number | undefined {
  const hwnd = asHandlePointer(handle)
  if (!hwnd) return undefined
  const pid = new Uint32Array(1)
  user32.symbols.GetWindowThreadProcessId(hwnd, ptr(pid))
  const value = Number(pid[0])
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

export function getWindowRect(handle: HandleValue):
  | { x: number; y: number; width: number; height: number }
  | undefined {
  const hwnd = asHandlePointer(handle)
  if (!hwnd) return undefined
  const rect = new Int32Array(4)
  const ok = Boolean(user32.symbols.GetWindowRect(hwnd, ptr(rect)))
  if (!ok) return undefined
  const left = Number(rect[0])
  const top = Number(rect[1])
  const right = Number(rect[2])
  const bottom = Number(rect[3])
  const width = Math.max(0, right - left)
  const height = Math.max(0, bottom - top)
  return { x: left, y: top, width, height }
}

export function setWindowTopmost(handle: HandleValue): boolean {
  const hwnd = asHandlePointer(handle)
  if (!hwnd) return false
  return Boolean(user32.symbols.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, TOPMOST_FLAGS))
}

export function bringWindowToTop(handle: HandleValue): boolean {
  const hwnd = asHandlePointer(handle)
  if (!hwnd) return false
  return Boolean(user32.symbols.BringWindowToTop(hwnd))
}

function writeKeyboardInput(view: DataView, baseOffset: number, virtualKey: number, keyUp: boolean): void {
  view.setUint32(baseOffset, INPUT_KEYBOARD, true)
  const keyboardOffset = baseOffset + INPUT_UNION_OFFSET
  view.setUint16(keyboardOffset, Math.max(0, Math.floor(virtualKey)) & 0xffff, true)
  view.setUint16(keyboardOffset + 2, 0, true)
  view.setUint32(keyboardOffset + 4, keyUp ? KEYEVENTF_KEYUP : 0, true)
  view.setUint32(keyboardOffset + 8, 0, true)
  writeSizeT(view, keyboardOffset + KEYBDINFO_EXTRA_OFFSET, 0)
}

export function sendVirtualKeys(virtualKeys: number[]): boolean {
  const keys = Array.isArray(virtualKeys) ? virtualKeys.filter((v) => Number.isFinite(v) && v > 0) : []
  if (!keys.length) return true

  const inputCount = keys.length * 2
  const bytes = new Uint8Array(inputCount * INPUT_SIZE)
  const view = new DataView(bytes.buffer)

  let cursor = 0
  for (const key of keys) {
    writeKeyboardInput(view, cursor, key, false)
    cursor += INPUT_SIZE
    writeKeyboardInput(view, cursor, key, true)
    cursor += INPUT_SIZE
  }

  const sent = Number(user32.symbols.SendInput(inputCount, ptr(bytes), INPUT_SIZE))
  return Number.isFinite(sent) && sent >= inputCount
}

export function getWallpaperPath(): string | undefined {
  const buffer = new Uint16Array(260)
  const ok = Boolean(user32.symbols.SystemParametersInfoW(SPI_GETDESKWALLPAPER, buffer.length, ptr(buffer), 0))
  if (!ok) return undefined
  const value = decodeWideString(buffer).trim()
  return value || undefined
}
