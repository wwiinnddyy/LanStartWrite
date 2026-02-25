import { FFIType, dlopen, ptr } from 'bun:ffi'

const kernel32Psapi = dlopen('kernel32.dll', {
  K32EnumProcesses: {
    args: [FFIType.ptr, FFIType.u32, FFIType.ptr],
    returns: FFIType.bool
  }
})

const psapi = dlopen('psapi.dll', {
  GetProcessMemoryInfo: {
    args: [FFIType.u64, FFIType.ptr, FFIType.u32],
    returns: FFIType.bool
  }
})

const PTR_SIZE = process.arch === 'x64' ? 8 : 4
const PROCESS_MEMORY_COUNTERS_EX_SIZE = PTR_SIZE === 8 ? 80 : 44
const WORKING_SET_SIZE_OFFSET = 8

function readSizeT(view: DataView, offset: number): number {
  if (PTR_SIZE === 8) {
    const raw = view.getBigUint64(offset, true)
    const value = Number(raw)
    return Number.isFinite(value) ? value : 0
  }
  return view.getUint32(offset, true)
}

export function enumProcessIds(maxCount = 4096): number[] {
  let slots = Math.max(512, Math.floor(maxCount))
  for (let attempt = 0; attempt < 3; attempt++) {
    const pidBuffer = new Uint32Array(slots)
    const bytesNeeded = new Uint32Array(1)
    const ok = Boolean(kernel32Psapi.symbols.K32EnumProcesses(ptr(pidBuffer), pidBuffer.byteLength, ptr(bytesNeeded)))
    if (!ok) return []

    const count = Math.max(0, Math.floor(Number(bytesNeeded[0]) / Uint32Array.BYTES_PER_ELEMENT))
    if (count < slots) {
      const out: number[] = []
      for (let i = 0; i < count; i++) {
        const pid = Number(pidBuffer[i])
        if (Number.isFinite(pid) && pid > 0) out.push(pid)
      }
      return out
    }

    slots *= 2
  }

  return []
}

export function readProcessMemoryBytes(processHandle: number): number | undefined {
  const handle = Number(processHandle)
  if (!Number.isFinite(handle) || handle === 0) return undefined

  const counters = new Uint8Array(PROCESS_MEMORY_COUNTERS_EX_SIZE)
  const view = new DataView(counters.buffer)
  view.setUint32(0, PROCESS_MEMORY_COUNTERS_EX_SIZE, true)
  const ok = Boolean(psapi.symbols.GetProcessMemoryInfo(handle, ptr(counters), PROCESS_MEMORY_COUNTERS_EX_SIZE))
  if (!ok) return undefined

  const workingSet = readSizeT(view, WORKING_SET_SIZE_OFFSET)
  if (!Number.isFinite(workingSet) || workingSet < 0) return undefined
  return workingSet
}
