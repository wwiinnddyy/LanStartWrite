import type { BrowserWindow } from 'electrobun/bun'

export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export type WindowRole =
  | 'toolbar'
  | 'toolbar-handle'
  | 'toolbar-subwindow'
  | 'toolbar-notice'
  | 'watcher'
  | 'settings'
  | 'child'
  | 'paint-board'
  | 'annotation-overlay'
  | 'screen-annotation-overlay'
  | 'mut-page'
  | 'mut-page-handle'
  | 'mut-page-thumbnails'
  | 'lanstart-bar'
  | 'unknown'

export type WindowDescriptor = {
  key: string
  windowId: string
  kind?: string
  role: WindowRole
  defaultBounds: Rect
  alwaysOnTop?: boolean
}

export type ManagedWindowRecord = {
  descriptor: WindowDescriptor
  win: BrowserWindow
  virtualVisible: boolean
  lastVisibleBounds: Rect
  parkedBounds: Rect
  maximized?: boolean
  lastNormalBounds?: Rect
}

export type MainControlMessage = {
  type: string
  [key: string]: unknown
}

