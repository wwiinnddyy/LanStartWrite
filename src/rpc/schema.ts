export type BackendEventItem = {
  id: number
  type: string
  payload?: unknown
  ts: number
}

export type BackendRpcMethods = {
  apiRequest: {
    params: { method: string; path: string; body?: unknown }
    result: { status: number; body: unknown }
  }
  postCommand: {
    params: { command: string; payload?: unknown }
    result: null
  }
  getEvents: {
    params: { since: number }
    result: { items: BackendEventItem[]; latest: number }
  }
  getKv: {
    params: { key: string }
    result: unknown
  }
  putKv: {
    params: { key: string; value: unknown }
    result: null
  }
  getUiState: {
    params: { windowId: string }
    result: Record<string, unknown>
  }
  putUiStateKey: {
    params: { windowId: string; key: string; value: unknown }
    result: null
  }
  deleteUiStateKey: {
    params: { windowId: string; key: string }
    result: null
  }
  clipboardWriteText: {
    params: { text: string }
    result: null
  }
  getToolbarNoticeKind: {
    params: Record<string, never>
    result: string
  }
  setToolbarNoticeVisible: {
    params: { visible: boolean; kind?: string }
    result: null
  }
  setToolbarNoticeBounds: {
    params: { width: number; height: number }
    result: null
  }
  restartBackendAll: {
    params: Record<string, never>
    result: null
  }
  captureWallpaperThumbnail: {
    params: { maxSide?: number }
    result: {
      dataUrl: string
      width: number
      height: number
      wallpaper: {
        path: string
        size: { width: number; height: number }
      }
    }
  }
  shutdown: {
    params: Record<string, never>
    result: null
  }
}

export type BackendRpcMethodName = keyof BackendRpcMethods

export type BackendRpcRequest = {
  type: 'RPC_REQUEST'
  id: number
  method: BackendRpcMethodName | (string & {})
  params?: unknown
}

export type BackendRpcResponse =
  | { type: 'RPC_RESPONSE'; id: number; ok: true; result: unknown }
  | { type: 'RPC_RESPONSE'; id: number; ok: false; error: string }

export type BackendRpcWsEvent = { type: 'EVENT'; event: BackendEventItem }

export type BackendRpcWsMessage = BackendRpcRequest | BackendRpcResponse | BackendRpcWsEvent

