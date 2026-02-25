/// <reference types="vite/client" />

declare global {
  interface Window {
    hyperGlass?: {
      captureDisplayThumbnail: (options?: { maxSide?: number }) => Promise<{
        dataUrl: string
        width: number
        height: number
        display: {
          id: number
          scaleFactor: number
          bounds: { x: number; y: number; width: number; height: number }
          size: { width: number; height: number }
        }
      }>
      captureWallpaperThumbnail?: (options?: { maxSide?: number }) => Promise<{
        dataUrl: string
        width: number
        height: number
        wallpaper: { path: string; size: { width: number; height: number } }
      }>
    }
    lanstart?: {
      postCommand: (command: string, payload?: unknown) => Promise<null>
      getEvents: (since: number) => Promise<{ items: Array<{ id: number; type: string; payload?: unknown; ts: number }>; latest: number }>
      getKv: (key: string) => Promise<unknown>
      putKv: (key: string, value: unknown) => Promise<null>
      getUiState: (windowId: string) => Promise<Record<string, unknown>>
      putUiStateKey: (windowId: string, key: string, value: unknown) => Promise<null>
      deleteUiStateKey: (windowId: string, key: string) => Promise<null>
      apiRequest: (input: { method: string; path: string; body?: unknown }) => Promise<{ status: number; body: unknown }>
      clipboardWriteText: (text: string) => Promise<null>
      getToolbarNoticeKind?: () => Promise<string>
      setToolbarNoticeVisible?: (input: { visible: boolean; kind?: string }) => Promise<null>
      setToolbarNoticeBounds?: (input: { width: number; height: number }) => Promise<null>
      restartBackendAll?: () => Promise<null>
      setZoomLevel: (level: number) => void
      getZoomLevel: () => number
    }
  }
}

export {}
