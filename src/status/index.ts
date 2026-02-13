import { useEffect, useRef, useState } from 'react'
import {
  APP_MODE_KV_KEY,
  APP_MODE_UI_STATE_KEY,
  APPEARANCE_KV_KEY,
  APPEARANCE_UI_STATE_KEY,
  ACTIVE_APP_UI_STATE_KEY,
  CLEAR_PAGE_REV_UI_STATE_KEY,
  EFFECTIVE_WRITING_BACKEND_UI_STATE_KEY,
  ERASER_THICKNESS_UI_STATE_KEY,
  ERASER_SETTINGS_KV_KEY,
  ERASER_TYPE_UI_STATE_KEY,
  LEAFER_SETTINGS_KV_KEY,
  LEAFER_SETTINGS_UI_STATE_KEY,
  NOTES_PAGE_INDEX_UI_STATE_KEY,
  NOTES_PAGE_TOTAL_UI_STATE_KEY,
  NOTES_RELOAD_REV_UI_STATE_KEY,
  NOTICE_KIND_UI_STATE_KEY,
  PDF_FILE_URL_KV_KEY,
  PDF_FILE_URL_UI_STATE_KEY,
  PEN_COLOR_UI_STATE_KEY,
  PEN_SETTINGS_KV_KEY,
  PEN_THICKNESS_UI_STATE_KEY,
  PEN_TYPE_UI_STATE_KEY,
  PPT_FULLSCREEN_UI_STATE_KEY,
  REDO_REV_UI_STATE_KEY,
  PPT_PAGE_INDEX_UI_STATE_KEY,
  PPT_PAGE_TOTAL_UI_STATE_KEY,
  PPT_SLIDE_NAME_UI_STATE_KEY,
  TOOL_UI_STATE_KEY,
  TOOLBAR_STATE_KEY,
  TOOLBAR_STATE_UI_STATE_KEY,
  UI_STATE_APP_WINDOW_ID,
  UNDO_REV_UI_STATE_KEY,
  WHITEBOARD_BG_COLOR_KV_KEY,
  WHITEBOARD_BG_COLOR_UI_STATE_KEY,
  WHITEBOARD_BG_IMAGE_URL_KV_KEY,
  WHITEBOARD_BG_IMAGE_URL_UI_STATE_KEY,
  WHITEBOARD_BG_IMAGE_OPACITY_KV_KEY,
  WHITEBOARD_BG_IMAGE_OPACITY_UI_STATE_KEY,
  WHITEBOARD_CANVAS_PAGES_KV_KEY,
  VIDEO_SHOW_CAPTURE_REV_UI_STATE_KEY,
  VIDEO_SHOW_DEVICE_ID_UI_STATE_KEY,
  VIDEO_SHOW_LIVE_THUMB_UI_STATE_KEY,
  VIDEO_SHOW_MERGE_LAYERS_KV_KEY,
  VIDEO_SHOW_MERGE_LAYERS_UI_STATE_KEY,
  OFFICE_PPT_MODE_KV_KEY,
  OFFICE_PPT_MODE_UI_STATE_KEY,
  SYSTEM_UIA_TOPMOST_KV_KEY,
  SYSTEM_UIA_TOPMOST_UI_STATE_KEY,
  SYSTEM_MERGE_RENDERER_PIPELINE_KV_KEY,
  ADMIN_STATUS_UI_STATE_KEY,
  VIDEO_SHOW_PAGES_KV_KEY,
  VIDEO_SHOW_QUALITY_UI_STATE_KEY,
  VIDEO_SHOW_QUALITY_PRESETS_UI_STATE_KEY,
  VIDEO_SHOW_SOURCE_UI_STATE_KEY,
  VIDEO_SHOW_VIEW_UI_STATE_KEY,
  VIDEO_SHOW_WEBRTC_SESSION_ID_UI_STATE_KEY,
  VIDEO_SHOW_WEBRTC_STATUS_UI_STATE_KEY,
  WRITING_FRAMEWORK_KV_KEY,
  WRITING_FRAMEWORK_UI_STATE_KEY,
  isAppearance,
  isActiveApp,
  isAppMode,
  isEraserSettings,
  isEffectiveWritingBackend,
  isFileOrDataUrl,
  isHexColor,
  isLeaferSettings,
  isPenSettings,
  isWritingFramework,
  type AppMode,
  type ActiveApp,
  type Appearance,
  type EraserType,
  type EraserSettings,
  type EffectiveWritingBackend,
  type LeaferNibMode,
  type LeaferRendererEngine,
  type LeaferSettings,
  type PenType,
  type PenSettings,
  type OfficePptMode,
  type VideoShowSource,
  type VideoShowViewTransform,
  type WritingFramework
} from './keys'

export {
  APP_MODE_KV_KEY,
  APP_MODE_UI_STATE_KEY,
  APPEARANCE_KV_KEY,
  APPEARANCE_UI_STATE_KEY,
  ACTIVE_APP_UI_STATE_KEY,
  CLEAR_PAGE_REV_UI_STATE_KEY,
  EFFECTIVE_WRITING_BACKEND_UI_STATE_KEY,
  ERASER_THICKNESS_UI_STATE_KEY,
  ERASER_SETTINGS_KV_KEY,
  ERASER_TYPE_UI_STATE_KEY,
  LEAFER_SETTINGS_KV_KEY,
  LEAFER_SETTINGS_UI_STATE_KEY,
  NOTES_PAGE_INDEX_UI_STATE_KEY,
  NOTES_PAGE_TOTAL_UI_STATE_KEY,
  NOTES_RELOAD_REV_UI_STATE_KEY,
  NOTICE_KIND_UI_STATE_KEY,
  PDF_FILE_URL_KV_KEY,
  PDF_FILE_URL_UI_STATE_KEY,
  PEN_COLOR_UI_STATE_KEY,
  PEN_SETTINGS_KV_KEY,
  PEN_THICKNESS_UI_STATE_KEY,
  PEN_TYPE_UI_STATE_KEY,
  PPT_FULLSCREEN_UI_STATE_KEY,
  REDO_REV_UI_STATE_KEY,
  PPT_PAGE_INDEX_UI_STATE_KEY,
  PPT_PAGE_TOTAL_UI_STATE_KEY,
  PPT_SLIDE_NAME_UI_STATE_KEY,
  TOOL_UI_STATE_KEY,
  TOOLBAR_STATE_KEY,
  TOOLBAR_STATE_UI_STATE_KEY,
  UI_STATE_APP_WINDOW_ID,
  UNDO_REV_UI_STATE_KEY,
  WHITEBOARD_BG_COLOR_KV_KEY,
  WHITEBOARD_BG_COLOR_UI_STATE_KEY,
  WHITEBOARD_BG_IMAGE_URL_KV_KEY,
  WHITEBOARD_BG_IMAGE_URL_UI_STATE_KEY,
  WHITEBOARD_BG_IMAGE_OPACITY_KV_KEY,
  WHITEBOARD_BG_IMAGE_OPACITY_UI_STATE_KEY,
  WHITEBOARD_CANVAS_PAGES_KV_KEY,
  VIDEO_SHOW_CAPTURE_REV_UI_STATE_KEY,
  VIDEO_SHOW_DEVICE_ID_UI_STATE_KEY,
  VIDEO_SHOW_LIVE_THUMB_UI_STATE_KEY,
  VIDEO_SHOW_MERGE_LAYERS_KV_KEY,
  VIDEO_SHOW_MERGE_LAYERS_UI_STATE_KEY,
  OFFICE_PPT_MODE_KV_KEY,
  OFFICE_PPT_MODE_UI_STATE_KEY,
  SYSTEM_UIA_TOPMOST_KV_KEY,
  SYSTEM_UIA_TOPMOST_UI_STATE_KEY,
  SYSTEM_MERGE_RENDERER_PIPELINE_KV_KEY,
  ADMIN_STATUS_UI_STATE_KEY,
  VIDEO_SHOW_PAGES_KV_KEY,
  VIDEO_SHOW_QUALITY_UI_STATE_KEY,
  VIDEO_SHOW_QUALITY_PRESETS_UI_STATE_KEY,
  VIDEO_SHOW_SOURCE_UI_STATE_KEY,
  VIDEO_SHOW_VIEW_UI_STATE_KEY,
  VIDEO_SHOW_WEBRTC_SESSION_ID_UI_STATE_KEY,
  VIDEO_SHOW_WEBRTC_STATUS_UI_STATE_KEY,
  WRITING_FRAMEWORK_KV_KEY,
  WRITING_FRAMEWORK_UI_STATE_KEY,
  isAppearance,
  isActiveApp,
  isAppMode,
  isEraserSettings,
  isEffectiveWritingBackend,
  isFileOrDataUrl,
  isHexColor,
  isLeaferSettings,
  isPenSettings,
  isWritingFramework,
  type AppMode,
  type ActiveApp,
  type Appearance,
  type EraserType,
  type EraserSettings,
  type EffectiveWritingBackend,
  type LeaferNibMode,
  type LeaferRendererEngine,
  type LeaferSettings,
  type PenType,
  type PenSettings,
  type OfficePptMode,
  type VideoShowSource,
  type VideoShowViewTransform,
  type WritingFramework
} from './keys'

export type BackendEventItem = {
  id: number
  type: string
  payload?: unknown
  ts: number
}

function getFallbackLanstart() {
  const w = window as any
  if (w.__lanstartFallback) return w.__lanstartFallback as NonNullable<Window['lanstart']>

  const kv = new Map<string, unknown>()
  const uiState = new Map<string, Record<string, unknown>>()

  const api: NonNullable<Window['lanstart']> = {
    postCommand: async () => null,
    getEvents: async (since: number) => ({ items: [], latest: since }),
    getKv: async (key: string) => {
      if (kv.has(key)) return kv.get(key)
      throw new Error('kv_not_found')
    },
    putKv: async (key: string, value: unknown) => {
      kv.set(key, value)
      return null
    },
    getUiState: async (windowId: string) => uiState.get(windowId) ?? {},
    putUiStateKey: async (windowId: string, key: string, value: unknown) => {
      const prev = uiState.get(windowId) ?? {}
      uiState.set(windowId, { ...prev, [key]: value })
      return null
    },
    deleteUiStateKey: async (windowId: string, key: string) => {
      const prev = uiState.get(windowId) ?? {}
      if (!(key in prev)) return null
      const next = { ...prev } as any
      delete next[key]
      uiState.set(windowId, next)
      return null
    },
    apiRequest: async () => ({ status: 503, body: { ok: false, error: 'lanstart_unavailable' } }),
    clipboardWriteText: async () => null,
    setZoomLevel: () => undefined,
    getZoomLevel: () => 0
  }

  w.__lanstartFallback = api
  return api
}

function requireLanstart() {
  const api = window.lanstart
  return api ?? getFallbackLanstart()
}

export async function postCommand(command: string, payload?: unknown): Promise<void> {
  await requireLanstart().postCommand(command, payload)
}

export async function getEvents(since: number): Promise<{ items: BackendEventItem[]; latest: number }> {
  return await requireLanstart().getEvents(since)
}

export async function getKv<T>(key: string): Promise<T> {
  return (await requireLanstart().getKv(key)) as T
}

export async function putKv<T>(key: string, value: T): Promise<void> {
  await requireLanstart().putKv(key, value)
}

export async function selectImageFile(): Promise<{ fileUrl?: string }> {
  const res = (await requireLanstart().apiRequest({ method: 'POST', path: '/dialog/select-image-file' })) as any
  const body = res?.body as any
  const fileUrl = typeof body?.fileUrl === 'string' ? body.fileUrl : undefined
  return { fileUrl }
}

export async function selectPdfFile(): Promise<{ fileUrl?: string }> {
  const res = (await requireLanstart().apiRequest({ method: 'POST', path: '/dialog/select-pdf-file' })) as any
  const body = res?.body as any
  const fileUrl = typeof body?.fileUrl === 'string' ? body.fileUrl : undefined
  return { fileUrl }
}

export async function getUiState(windowId: string): Promise<Record<string, unknown>> {
  return await requireLanstart().getUiState(windowId)
}

export async function putUiStateKey(windowId: string, key: string, value: unknown): Promise<void> {
  await requireLanstart().putUiStateKey(windowId, key, value)
}

export async function deleteUiStateKey(windowId: string, key: string): Promise<void> {
  await requireLanstart().deleteUiStateKey(windowId, key)
}

export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  options?: {
    validate?: (value: unknown) => value is T
    mapLoad?: (value: T) => T
    mapSave?: (value: T) => unknown
  }
) {
  const [value, setValue] = useState<T>(defaultValue)
  const didHydrate = useRef(false)

  useEffect(() => {
    let cancelled = false
    const validate = options?.validate
    const mapLoad = options?.mapLoad

    const run = async () => {
      try {
        const loaded = await getKv<unknown>(key)
        if (cancelled) return
        if (loaded === undefined) return
        if (validate && !validate(loaded)) return
        const next = mapLoad ? mapLoad(loaded as T) : (loaded as T)
        setValue(next)
      } catch {
        return
      } finally {
        if (!cancelled) didHydrate.current = true
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [key, options?.validate])

  useEffect(() => {
    if (!didHydrate.current) return
    const mapSave = options?.mapSave

    const id = window.setTimeout(() => {
      const next = mapSave ? mapSave(value) : value
      putKv(key, next as any).catch(() => undefined)
    }, 250)

    return () => window.clearTimeout(id)
  }, [key, value])

  return [value, setValue] as const
}

function coerceString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function useUiStateBus(windowId: string, options?: { intervalMs?: number }) {
  const intervalMs = options?.intervalMs ?? 600
  const latestRef = useRef(0)
  const [state, setState] = useState<Record<string, unknown>>({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const initial = await getUiState(windowId)
        if (cancelled) return
        setState(initial)
      } catch {
        return
      }
    })()
    return () => {
      cancelled = true
    }
  }, [windowId])

  useEffect(() => {
    let cancelled = false

    const tick = async () => {
      try {
        const res = await getEvents(latestRef.current)
        if (cancelled) return
        latestRef.current = res.latest
        if (!res.items.length) return

        const nextPatches: Array<(prev: Record<string, unknown>) => Record<string, unknown>> = []

        for (const item of res.items) {
          if (item.type !== 'UI_STATE_PUT' && item.type !== 'UI_STATE_DEL') continue
          const payload = (item.payload ?? {}) as any
          if (coerceString(payload.windowId) !== windowId) continue
          const key = coerceString(payload.key)
          if (!key) continue

          if (item.type === 'UI_STATE_PUT') {
            const value = payload.value as unknown
            nextPatches.push((prev) => ({ ...prev, [key]: value }))
          } else {
            nextPatches.push((prev) => {
              if (!(key in prev)) return prev
              const { [key]: _drop, ...rest } = prev
              return rest
            })
          }
        }

        if (!nextPatches.length) return
        setState((prev) => nextPatches.reduce((acc, patch) => patch(acc), prev))
      } catch {
        return
      }
    }

    const id = window.setInterval(tick, intervalMs)
    tick()
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [intervalMs, windowId])

  const setKey = async (key: string, value: unknown) => {
    await putUiStateKey(windowId, key, value)
    setState((prev) => ({ ...prev, [key]: value }))
  }

  const deleteKey = async (key: string) => {
    await deleteUiStateKey(windowId, key)
    setState((prev) => {
      if (!(key in prev)) return prev
      const { [key]: _drop, ...rest } = prev
      return rest
    })
  }

  const refresh = async () => {
    const latest = await getUiState(windowId)
    setState(latest)
  }

  return { state, setKey, deleteKey, refresh }
}

export function useAppAppearance() {
  const [appearance, setAppearanceState] = usePersistedState<Appearance>(APPEARANCE_KV_KEY, 'light', {
    validate: isAppearance
  })
  const bus = useUiStateBus(UI_STATE_APP_WINDOW_ID)

  const busAppearanceRaw = bus.state[APPEARANCE_UI_STATE_KEY]
  const busAppearance: Appearance | undefined = isAppearance(busAppearanceRaw) ? busAppearanceRaw : undefined

  useEffect(() => {
    if (!busAppearance) return
    if (busAppearance === appearance) return
    setAppearanceState(busAppearance)
  }, [appearance, busAppearance, setAppearanceState])

  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-appearance', appearance)
    } catch {}
  }, [appearance])

  const setAppearance = (next: Appearance) => {
    if (next === appearance) return
    setAppearanceState(next)
    bus.setKey(APPEARANCE_UI_STATE_KEY, next).catch(() => undefined)
    postCommand('set-appearance', { appearance: next }).catch(() => undefined)
  }

  return { appearance, setAppearance }
}

export function useAppMode() {
  const [appMode, setAppModeState] = usePersistedState<AppMode>(APP_MODE_KV_KEY, 'toolbar', {
    validate: isAppMode,
    mapLoad: (v) => (v === 'pdf' ? 'toolbar' : v),
    mapSave: (v) => (v === 'pdf' ? 'toolbar' : v)
  })
  const bus = useUiStateBus(UI_STATE_APP_WINDOW_ID)

  const busModeRaw = bus.state[APP_MODE_UI_STATE_KEY]
  const busMode: AppMode | undefined = isAppMode(busModeRaw) ? busModeRaw : undefined

  useEffect(() => {
    if (!busMode) return
    if (busMode === appMode) return
    setAppModeState(busMode)
  }, [appMode, busMode, setAppModeState])

  const setAppMode = (next: AppMode) => {
    if (next === appMode) return
    setAppModeState(next)
    bus.setKey(APP_MODE_UI_STATE_KEY, next).catch(() => undefined)
    postCommand('settings.setAppMode', { mode: next }).catch(() => undefined)
  }

  return { appMode, setAppMode }
}
