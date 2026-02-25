import { Screen } from 'electrobun/bun'
import type { ManagedWindowRecord, MainControlMessage, Rect, WindowRole } from './types'
import { WindowRegistry } from './registry'

type CreateWindowInput = {
  key: string
  windowId: string
  kind?: string
  role: WindowRole
  title: string
  bounds: Rect
  alwaysOnTop?: boolean
  transparent?: boolean
  styleMask?: Record<string, boolean>
  titleBarStyle?: 'hidden' | 'hiddenInset' | 'default'
  frame?: boolean
  skipTaskbar?: boolean
  resizable?: boolean
  backgroundColor?: string
  focusable?: boolean
}

export type CreateWindowFn = (input: CreateWindowInput) => ManagedWindowRecord

type DisplayLike = {
  id: number
  bounds: Rect
  workArea: Rect
  isPrimary: boolean
}

const WINDOW_ID_CHILD = 'child'
const WINDOW_ID_WATCHER = 'watcher'
const WINDOW_ID_SETTINGS = 'settings-window'

function isFiniteNumber(v: unknown): v is number {
  return Number.isFinite(v)
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function area(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height)
}

function intersectionArea(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  return area({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 })
}

function getDisplays(): DisplayLike[] {
  try {
    const all = Screen.getAllDisplays()
    if (Array.isArray(all) && all.length > 0) return all as DisplayLike[]
  } catch {}
  try {
    return [Screen.getPrimaryDisplay() as DisplayLike]
  } catch {
    return [{ id: 0, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 }, isPrimary: true }]
  }
}

function getDisplayByCursor(): DisplayLike {
  const displays = getDisplays()
  let p = { x: displays[0]?.workArea.x ?? 0, y: displays[0]?.workArea.y ?? 0 }
  try {
    p = Screen.getCursorScreenPoint()
  } catch {}
  for (const display of displays) {
    const b = display.workArea
    if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) return display
  }
  return displays.find((d) => d.isPrimary) ?? displays[0]!
}

function getDisplayByBounds(bounds: Rect): DisplayLike {
  const displays = getDisplays()
  let best = displays[0]!
  let bestArea = -1
  for (const display of displays) {
    const overlap = intersectionArea(bounds, display.workArea)
    if (overlap > bestArea) {
      bestArea = overlap
      best = display
    }
  }
  return best
}

export class AppWindowsManager {
  constructor(
    private readonly registry: WindowRegistry,
    private readonly createWindow: CreateWindowFn
  ) {}

  handleMainMessage(message: MainControlMessage): boolean {
    const type = String(message.type ?? '')
    if (!type) return false

    if (type === 'CREATE_WINDOW') {
      this.openChildWindow()
      return true
    }

    if (type === 'OPEN_WATCHER_WINDOW') {
      this.openWatcherWindow()
      return true
    }

    if (type === 'OPEN_SETTINGS_WINDOW') {
      this.openSettingsWindow()
      return true
    }

    if (type === 'MINIMIZE_SETTINGS_WINDOW') {
      const settings = this.registry.get('settings-window')
      if (settings) this.registry.hide(settings)
      return true
    }

    if (type === 'CLOSE_SETTINGS_WINDOW') {
      const settings = this.registry.get('settings-window')
      if (settings) this.registry.hide(settings)
      return true
    }

    if (type === 'CONTROL_APP_WINDOW') {
      const windowId = String(message.windowId ?? '').trim()
      const action = String(message.action ?? '').trim()
      if (!windowId || !action) return true
      this.controlAppWindow(windowId, action)
      return true
    }

    if (type === 'SET_APP_WINDOW_BOUNDS') {
      const windowId = String(message.windowId ?? '').trim()
      if (!windowId) return true
      this.setAppWindowBounds(windowId, message)
      return true
    }

    return false
  }

  private controlAppWindow(windowId: string, action: string): void {
    const record = this.getRecordByWindowId(windowId)
    if (!record) return

    if (action === 'minimize') {
      this.registry.hide(record)
      return
    }

    if (action === 'close') {
      this.registry.hide(record)
      return
    }

    if (action === 'toggleMaximize') {
      const current = this.registry.getFrame(record)
      if (!record.maximized) {
        record.lastNormalBounds = current
        const display = getDisplayByBounds(current)
        this.registry.setFrame(record, display.workArea)
        this.registry.show(record, display.workArea, { focus: true })
        record.maximized = true
      } else {
        const restore = record.lastNormalBounds ?? current
        this.registry.setFrame(record, restore)
        this.registry.show(record, restore, { focus: true })
        record.maximized = false
      }
      return
    }
  }

  private setAppWindowBounds(windowId: string, message: MainControlMessage): void {
    const record = this.getRecordByWindowId(windowId)
    if (!record) return
    const current = this.registry.getFrame(record)
    const next: Rect = {
      x: isFiniteNumber(message.x) ? Math.round(Number(message.x)) : current.x,
      y: isFiniteNumber(message.y) ? Math.round(Number(message.y)) : current.y,
      width: isFiniteNumber(message.width) ? clampInt(Number(message.width), 100, 3000) : current.width,
      height: isFiniteNumber(message.height) ? clampInt(Number(message.height), 100, 2200) : current.height
    }
    this.registry.setFrame(record, next)
    if (record.virtualVisible) this.registry.show(record, next)
  }

  openChildWindow(): ManagedWindowRecord {
    const existing = this.registry.get('child')
    if (existing) {
      this.registry.show(existing)
      return existing
    }
    const display = getDisplayByCursor()
    const work = display.workArea
    const width = clampInt(work.width * 0.35, 320, 460)
    const height = clampInt(work.height * 0.28, 220, 320)
    const bounds: Rect = {
      x: Math.round(work.x + (work.width - width) / 2),
      y: Math.round(work.y + (work.height - height) / 2),
      width,
      height
    }
    const record = this.createWindow({
      key: 'child',
      windowId: WINDOW_ID_CHILD,
      role: 'child',
      title: '数据库',
      bounds,
      transparent: true,
      alwaysOnTop: false,
      titleBarStyle: 'hidden',
      styleMask: { Resizable: true }
    })
    this.registry.show(record, bounds, { focus: true })
    return record
  }

  openWatcherWindow(): ManagedWindowRecord {
    const existing = this.registry.get('watcher')
    if (existing) {
      this.registry.show(existing)
      return existing
    }
    const display = getDisplayByCursor()
    const work = display.workArea
    const width = clampInt(work.width * 0.72, 720, 1200)
    const height = clampInt(work.height * 0.78, 520, 900)
    const bounds: Rect = {
      x: Math.round(work.x + (work.width - width) / 2),
      y: Math.round(work.y + (work.height - height) / 2),
      width,
      height
    }
    const record = this.createWindow({
      key: 'watcher',
      windowId: WINDOW_ID_WATCHER,
      role: 'watcher',
      title: '系统监视器',
      bounds,
      transparent: true,
      alwaysOnTop: false,
      titleBarStyle: 'hidden',
      styleMask: { Resizable: true }
    })
    this.registry.show(record, bounds, { focus: true })
    return record
  }

  openSettingsWindow(): ManagedWindowRecord {
    const existing = this.registry.get('settings-window')
    if (existing) {
      this.registry.show(existing)
      return existing
    }
    const display = getDisplayByCursor()
    const work = display.workArea
    const width = clampInt(work.width * 0.68, 560, 1100)
    const height = clampInt(work.height * 0.76, 420, 820)
    const bounds: Rect = {
      x: Math.round(work.x + (work.width - width) / 2),
      y: Math.round(work.y + (work.height - height) / 2),
      width,
      height
    }
    const record = this.createWindow({
      key: 'settings-window',
      windowId: WINDOW_ID_SETTINGS,
      role: 'settings',
      title: '设置',
      bounds,
      transparent: true,
      alwaysOnTop: false,
      titleBarStyle: 'hidden',
      styleMask: { Resizable: true }
    })
    this.registry.show(record, bounds, { focus: true })
    return record
  }

  private getRecordByWindowId(windowId: string): ManagedWindowRecord | undefined {
    if (windowId === WINDOW_ID_CHILD) return this.registry.get('child')
    if (windowId === WINDOW_ID_WATCHER) return this.registry.get('watcher')
    if (windowId === WINDOW_ID_SETTINGS) return this.registry.get('settings-window')
    return this.registry.getByWindowId(windowId)
  }
}
