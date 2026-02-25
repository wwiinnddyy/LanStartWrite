import { FFIType, dlopen } from 'bun:ffi'

const kernel32 = dlopen('kernel32.dll', {
  OpenProcess: {
    args: [FFIType.u32, FFIType.bool, FFIType.u32],
    returns: FFIType.u64
  },
  CloseHandle: {
    args: [FFIType.u64],
    returns: FFIType.bool
  }
})

export const PROCESS_VM_READ = 0x0010
export const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
export const PROCESS_QUERY_INFORMATION = 0x0400

export function openProcessHandle(pid: number): number | undefined {
  const pidInt = Number.isFinite(pid) ? Math.floor(pid) : 0
  if (pidInt <= 0) return undefined

  const desiredAccess = PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_QUERY_INFORMATION | PROCESS_VM_READ
  const handle = Number(kernel32.symbols.OpenProcess(desiredAccess, false, pidInt))
  if (!Number.isFinite(handle) || handle === 0) return undefined
  return handle
}

export function closeHandle(handle: number | bigint): void {
  const value = typeof handle === 'bigint' ? Number(handle) : Number(handle)
  if (!Number.isFinite(value) || value === 0) return
  try {
    kernel32.symbols.CloseHandle(value)
  } catch {}
}
