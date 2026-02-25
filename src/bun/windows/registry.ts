import type { BrowserWindow } from 'electrobun/bun'
import type { ManagedWindowRecord, Rect, WindowDescriptor } from './types'

const PARK_X = -32_000
const PARK_Y = -32_000

function toRect(input: Partial<Rect>, fallback: Rect): Rect {
  const width = Number(input.width)
  const height = Number(input.height)
  const x = Number(input.x)
  const y = Number(input.y)
  return {
    x: Number.isFinite(x) ? Math.round(x) : fallback.x,
    y: Number.isFinite(y) ? Math.round(y) : fallback.y,
    width: Number.isFinite(width) ? Math.max(1, Math.round(width)) : fallback.width,
    height: Number.isFinite(height) ? Math.max(1, Math.round(height)) : fallback.height
  }
}

function parkedBoundsFor(bounds: Rect): Rect {
  return { x: PARK_X, y: PARK_Y, width: bounds.width, height: bounds.height }
}

export class WindowRegistry {
  private readonly records = new Map<string, ManagedWindowRecord>()
  constructor(
    private readonly hooks?: {
      onShow?: (record: ManagedWindowRecord) => void
      onHide?: (record: ManagedWindowRecord) => void
      onFrameChanged?: (record: ManagedWindowRecord, frame: Rect) => void
    }
  ) {}

  list(): ManagedWindowRecord[] {
    return Array.from(this.records.values())
  }

  get(key: string): ManagedWindowRecord | undefined {
    return this.records.get(key)
  }

  getByWindowId(windowId: string, kind?: string): ManagedWindowRecord | undefined {
    const kindValue = typeof kind === 'string' ? kind : undefined
    for (const record of this.records.values()) {
      if (record.descriptor.windowId !== windowId) continue
      if ((record.descriptor.kind ?? undefined) !== (kindValue ?? undefined)) continue
      return record
    }
    return undefined
  }

  upsert(descriptor: WindowDescriptor, win: BrowserWindow): ManagedWindowRecord {
    const current = this.records.get(descriptor.key)
    const defaultFrame = toRect(descriptor.defaultBounds, descriptor.defaultBounds)
    const next: ManagedWindowRecord = current
      ? {
          ...current,
          descriptor,
          win,
          lastVisibleBounds: toRect(current.lastVisibleBounds, defaultFrame),
          parkedBounds: parkedBoundsFor(toRect(current.lastVisibleBounds, defaultFrame))
        }
      : {
          descriptor,
          win,
          virtualVisible: false,
          // Electrobun may report (0,0) before first show; trust descriptor defaults for initial placement.
          lastVisibleBounds: defaultFrame,
          parkedBounds: parkedBoundsFor(defaultFrame),
          maximized: false
        }
    this.records.set(descriptor.key, next)
    if (!current) this.safeSetFrame(win, next.parkedBounds)
    return next
  }

  remove(key: string): void {
    this.records.delete(key)
  }

  show(record: ManagedWindowRecord, frame?: Partial<Rect>, options?: { focus?: boolean }): void {
    const base = toRect(frame ?? {}, record.lastVisibleBounds)
    this.safeSetFrame(record.win, base)
    this.safeSetAlwaysOnTop(record.win, Boolean(record.descriptor.alwaysOnTop))
    this.safeMoveTop(record.win)
    // Only focus if explicitly requested; otherwise show inactive to avoid stealing focus
    if (options?.focus) {
      this.safeFocus(record.win)
    } else {
      this.safeShowInactive(record.win)
    }
    record.virtualVisible = true
    record.lastVisibleBounds = base
    record.parkedBounds = parkedBoundsFor(base)
    this.hooks?.onShow?.(record)
    this.hooks?.onFrameChanged?.(record, base)
  }

  hide(record: ManagedWindowRecord): void {
    const current = this.safeGetFrame(record.win, record.lastVisibleBounds)
    record.lastVisibleBounds = current
    record.parkedBounds = parkedBoundsFor(current)
    this.safeSetFrame(record.win, record.parkedBounds)
    record.virtualVisible = false
    this.hooks?.onHide?.(record)
  }

  setFrame(record: ManagedWindowRecord, frame: Partial<Rect>): void {
    const base = toRect(frame, record.lastVisibleBounds)
    this.safeSetFrame(record.win, base)
    if (record.virtualVisible) record.lastVisibleBounds = base
    else record.parkedBounds = parkedBoundsFor(base)
    this.hooks?.onFrameChanged?.(record, base)
  }

  getFrame(record: ManagedWindowRecord): Rect {
    return this.safeGetFrame(record.win, record.lastVisibleBounds)
  }

  closeAll(): void {
    for (const record of this.records.values()) {
      try {
        record.win.close()
      } catch {}
    }
    this.records.clear()
  }

  private safeGetFrame(win: BrowserWindow, fallback: Rect): Rect {
    try {
      const frame = win.getFrame()
      return toRect(frame, fallback)
    } catch {
      return fallback
    }
  }

  private safeSetFrame(win: BrowserWindow, frame: Rect): void {
    try {
      win.setFrame(frame.x, frame.y, frame.width, frame.height)
    } catch {}
  }

  private safeSetAlwaysOnTop(win: BrowserWindow, value: boolean): void {
    try {
      win.setAlwaysOnTop(value)
    } catch {}
  }

  private safeFocus(win: BrowserWindow): void {
    try {
      win.focus()
    } catch {}
  }

  private safeShowInactive(win: BrowserWindow): void {
    try {
      ;(win as any).showInactive?.()
    } catch {
      // Fallback to regular show if showInactive is not available
      try {
        win.focus()
      } catch {}
    }
  }

  private safeMoveTop(win: BrowserWindow): void {
    try {
      ;(win as any).moveTop?.()
    } catch {}
  }
}
