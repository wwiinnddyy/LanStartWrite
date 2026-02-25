import type { ForegroundWindowSample, ProcessSample } from '../../task_windows_watcher/types'

export type CapabilityKeyName = 'left' | 'right' | 'escape'

export type WallpaperThumbnailResult = {
  dataUrl: string
  width: number
  height: number
  wallpaper: {
    path: string
    size: { width: number; height: number }
  }
}

export type CapabilityRequestMap = {
  'cap.health': {
    params: null
    result: { platform: string; pid: number; workerTs: number }
  }
  'cap.process.getProcesses': {
    params: { includeCpuTimeMs?: boolean } | null
    result: ProcessSample[]
  }
  'cap.window.getForegroundWindow': {
    params: null
    result: ForegroundWindowSample | undefined
  }
  'cap.window.forceTopmostWindows': {
    params: { handles: string[] }
    result: null
  }
  'cap.input.sendKeys': {
    params: { keys: CapabilityKeyName[] }
    result: null
  }
  'cap.privilege.isAdmin': {
    params: null
    result: boolean
  }
  'cap.wallpaper.captureThumbnail': {
    params: { maxSide?: number } | null
    result: WallpaperThumbnailResult
  }
}

export type CapabilityMethodName = keyof CapabilityRequestMap

export type CapabilityRequest<M extends CapabilityMethodName = CapabilityMethodName> = {
  id: number
  method: M
  params: CapabilityRequestMap[M]['params']
}

export type CapabilityError = {
  code: string
  message: string
  details?: unknown
}

export type CapabilityResponseSuccess = {
  id: number
  ok: true
  result: unknown
}

export type CapabilityResponseFailure = {
  id: number
  ok: false
  error: CapabilityError
}

export type CapabilityResponse = CapabilityResponseSuccess | CapabilityResponseFailure
