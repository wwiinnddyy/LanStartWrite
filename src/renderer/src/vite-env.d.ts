/// <reference types="vite/client" />

declare global {
  const __APP_VERSION__: string
  interface Window {
    hyperGlass?: {
      captureDisplayThumbnail: (options?: { maxSide?: number }) => Promise<{
        dataUrl: string
        width: number
        height: number
        display: { id: number; scaleFactor: number; bounds: Electron.Rectangle; size: Electron.Size }
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
      setZoomLevel: (level: number) => void
      getZoomLevel: () => number
    }
  }
}

export {}
