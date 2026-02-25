export type AppManagedWindowKind = 'child' | 'watcher' | 'settings'

export type AppWindowsManagerDeps = {
  preloadPath: string
  rendererHtmlPath: string
  getDevServerUrl: () => string | undefined
  getAppearance: () => 'light' | 'dark'
  getUiZoomLevel: () => number
  getNativeMicaEnabled: () => boolean
  getLegacyWindowImplementation: () => boolean
  getMergeRendererPipelineEnabled: () => boolean
  surfaceBackgroundColor: (appearance: 'light' | 'dark') => string
  applyWindowsBackdrop: (win: unknown) => void
  wireWindowDebug: (win: unknown, name: string) => void
  wireWindowStatus: (win: unknown, windowId: string) => void
  adjustWindowForDPI: (win: unknown, baseWidth: number, baseHeight: number) => void
  sendToBackend: (message: unknown) => void
  ensureTaskWatcherStarted: (intervalMs?: number) => void
}

export class AppWindowsManager {
  constructor(_deps: AppWindowsManagerDeps) {}

  handleBackendControlMessage(_message: unknown): boolean {
    return false
  }

  setWindowBounds(
    _kind: AppManagedWindowKind,
    _input: { x?: number; y?: number; width?: number; height?: number }
  ): void {
    return
  }

  getOrCreate(_kind: AppManagedWindowKind): never {
    throw new Error('electron_main_removed')
  }

  hideAll(): void {
    return
  }

  destroyAll(): void {
    return
  }
}

export function startWindowTopmostPolling(_opts: {
  intervalMs?: number
  getTargets: () => unknown[]
  tick: (targets: unknown[]) => void | Promise<void>
}): { stop: () => void } {
  return {
    stop() {
      return
    }
  }
}
