import { contextBridge, desktopCapturer, ipcRenderer, screen } from 'electron'

type CaptureOptions = { maxSide?: number }

function computeThumbnailSize(input: { width: number; height: number }, maxSide: number) {
  const maxInputSide = Math.max(input.width, input.height)
  if (maxInputSide <= maxSide) return { width: input.width, height: input.height }
  const scale = maxSide / maxInputSide
  return { width: Math.max(1, Math.round(input.width * scale)), height: Math.max(1, Math.round(input.height * scale)) }
}

contextBridge.exposeInMainWorld('hyperGlass', {
  captureDisplayThumbnail: async (options: CaptureOptions = {}) => {
    const bounds = {
      x: Math.round(globalThis.screenX),
      y: Math.round(globalThis.screenY),
      width: Math.round(globalThis.outerWidth),
      height: Math.round(globalThis.outerHeight)
    }
    const display = screen.getDisplayMatching(bounds)
    const maxSide = typeof options.maxSide === 'number' ? Math.max(32, Math.floor(options.maxSide)) : 320
    const thumbSize = computeThumbnailSize(display.size, maxSide)

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbSize.width, height: thumbSize.height },
      fetchWindowIcons: false
    })

    let source = sources[0]
    const displayId = String(display.id)
    for (const s of sources) {
      const sid = String((s as any).display_id ?? (s as any).displayId ?? '')
      if (sid && sid === displayId) {
        source = s
        break
      }
    }

    if (!source) throw new Error('no_screen_source')
    const img = source.thumbnail
    return {
      dataUrl: img.toDataURL(),
      width: img.getSize().width,
      height: img.getSize().height,
      display: {
        id: display.id,
        scaleFactor: display.scaleFactor,
        bounds: display.bounds,
        size: display.size
      }
    }
  },
  captureWallpaperThumbnail: async (options: CaptureOptions = {}) => {
    const maxSide = typeof options.maxSide === 'number' ? Math.max(32, Math.floor(options.maxSide)) : 320
    return await ipcRenderer.invoke('hyperGlass:captureWallpaperThumbnail', { maxSide })
  }
})

contextBridge.exposeInMainWorld('lanstart', {
  postCommand: (command: string, payload?: unknown) => ipcRenderer.invoke('lanstart:postCommand', { command, payload }),
  getEvents: (since: number) => ipcRenderer.invoke('lanstart:getEvents', { since }),
  getKv: (key: string) => ipcRenderer.invoke('lanstart:getKv', { key }),
  putKv: (key: string, value: unknown) => ipcRenderer.invoke('lanstart:putKv', { key, value }),
  getUiState: (windowId: string) => ipcRenderer.invoke('lanstart:getUiState', { windowId }),
  putUiStateKey: (windowId: string, key: string, value: unknown) =>
    ipcRenderer.invoke('lanstart:putUiStateKey', { windowId, key, value }),
  deleteUiStateKey: (windowId: string, key: string) => ipcRenderer.invoke('lanstart:deleteUiStateKey', { windowId, key }),
  apiRequest: (input: { method: string; path: string; body?: unknown }) => ipcRenderer.invoke('lanstart:apiRequest', input),
  setZoomLevel: (level: number) => require('electron').webFrame.setZoomLevel(level),
  getZoomLevel: () => require('electron').webFrame.getZoomLevel()
})
