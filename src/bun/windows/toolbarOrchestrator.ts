import { Screen } from 'electrobun/bun'
import { WindowRegistry } from './registry'
import { TOOLBAR_SUBWINDOW_KINDS } from './routes'
import type { ManagedWindowRecord, MainControlMessage, Rect, WindowRole } from './types'

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

export type ToolbarLayoutEvent = 'toolbar-move' | 'toolbar-resize' | 'toolbar-bounds-reported'

type Placement = 'top' | 'bottom'
type DisplayLike = { workArea: Rect; bounds: Rect; isPrimary: boolean }

type SubwindowState = {
  kind: string
  placement: Placement
  effectivePlacement: Placement
  width: number
  height: number
}

type NoticeState = {
  placement: Placement
  effectivePlacement: Placement
  width: number
  height: number
}

const TOOLBAR_KEY = 'floating-toolbar'
const HANDLE_KEY = 'floating-toolbar-handle'
const NOTICE_KEY = 'toolbar-notice'
const TOOLBAR_HANDLE_WIDTH = 34
const TOOLBAR_HANDLE_GAP = 8

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function intersectionArea(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
}

function getDisplays(): DisplayLike[] {
  try {
    const all = Screen.getAllDisplays() as DisplayLike[]
    if (Array.isArray(all) && all.length > 0) return all
  } catch {}
  try {
    return [Screen.getPrimaryDisplay() as DisplayLike]
  } catch {
    return [
      {
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
        isPrimary: true
      }
    ]
  }
}

function getDisplayByBounds(bounds: Rect): DisplayLike {
  const displays = getDisplays()
  let best = displays.find((d) => d.isPrimary) ?? displays[0]!
  let score = -1
  for (const d of displays) {
    const s = intersectionArea(bounds, d.workArea)
    if (s > score) {
      score = s
      best = d
    }
  }
  return best
}

export class ToolbarOrchestrator {
  private readonly subwindows = new Map<string, SubwindowState>()
  private noticeState: NoticeState = {
    placement: 'bottom',
    effectivePlacement: 'bottom',
    width: 360,
    height: 132
  }
  private noticeVisible = false
  private syncingToolbar = false
  private syncingHandle = false

  constructor(
    private readonly registry: WindowRegistry,
    private readonly createWindow: CreateWindowFn,
    private readonly onToolbarLayoutEvent: (event: ToolbarLayoutEvent) => void
  ) {}

  ensurePrimaryWindows(options?: { show?: boolean; focus?: boolean }): void {
    const toolbar = this.ensureToolbarWindow()
    const shouldShow = options?.show ?? true
    const handle = shouldShow ? this.ensureHandleWindow() : this.registry.get(HANDLE_KEY)
    if (shouldShow) {
      this.registry.show(toolbar, undefined, { focus: Boolean(options?.focus) })
      if (handle) this.registry.show(handle)
    }
    this.repositionAll()
  }

  showPrimaryWindows(options?: { focus?: boolean }): void {
    const toolbar = this.ensureToolbarWindow()
    const handle = this.ensureHandleWindow()
    this.registry.show(toolbar, undefined, { focus: Boolean(options?.focus) })
    this.registry.show(handle)
    this.repositionAll()
  }

  getToolbarBounds(): Rect | undefined {
    const toolbar = this.registry.get(TOOLBAR_KEY)
    if (!toolbar) return undefined
    return this.registry.getFrame(toolbar)
  }

  getToolbarHandleWidth(): number {
    return TOOLBAR_HANDLE_WIDTH
  }

  getToolbarHandleGap(): number {
    return TOOLBAR_HANDLE_GAP
  }

  hideAllSubwindows(): void {
    for (const kind of this.subwindows.keys()) this.hideSubwindow(kind)
    this.noticeVisible = false
    this.hideNoticeWindow()
  }

  handleMainMessage(message: MainControlMessage): boolean {
    const type = String(message.type ?? '')
    if (!type) return false

    if (type === 'SET_TOOLBAR_BOUNDS') {
      const width = Number(message.width)
      const height = Number(message.height)
      if (!Number.isFinite(width) || !Number.isFinite(height)) return true
      this.setToolbarBounds(width, height)
      return true
    }

    if (type === 'TOGGLE_SUBWINDOW') {
      const kind = String(message.kind ?? '').trim()
      const placementRaw = String(message.placement ?? '').trim()
      const placement: Placement | undefined =
        placementRaw === 'top' ? 'top' : placementRaw === 'bottom' ? 'bottom' : undefined
      if (!kind || !placement) return true
      this.toggleSubwindow(kind, placement)
      return true
    }

    if (type === 'SET_SUBWINDOW_HEIGHT') {
      const kind = String(message.kind ?? '').trim()
      const height = Number(message.height)
      if (!kind || !Number.isFinite(height)) return true
      const state = this.ensureSubwindowState(kind)
      state.height = clamp(height, 60, 1200)
      this.repositionAll()
      return true
    }

    if (type === 'SET_SUBWINDOW_BOUNDS') {
      const kind = String(message.kind ?? '').trim()
      const width = Number(message.width)
      const height = Number(message.height)
      if (!kind || !Number.isFinite(width) || !Number.isFinite(height)) return true
      if (kind === 'notice') {
        this.noticeState.width = clamp(width, 120, 1200)
        this.noticeState.height = clamp(height, 60, 900)
      } else {
        const state = this.ensureSubwindowState(kind)
        state.width = clamp(width, 120, 1400)
        state.height = clamp(height, 60, 1200)
      }
      this.repositionAll()
      return true
    }

    if (type === 'SET_NOTICE_VISIBLE') {
      this.noticeVisible = Boolean(message.visible)
      if (this.noticeVisible) this.showNoticeWindow()
      else this.hideNoticeWindow()
      return true
    }

    return false
  }

  reapplyTopmost(): void {
    const toolbar = this.registry.get(TOOLBAR_KEY)
    const handle = this.registry.get(HANDLE_KEY)
    if (toolbar) {
      try {
        toolbar.win.setAlwaysOnTop(true)
      } catch {}
    }
    if (handle) {
      try {
        handle.win.setAlwaysOnTop(true)
      } catch {}
    }
    for (const [kind] of this.subwindows.entries()) {
      const record = this.registry.get(`toolbar-subwindow:${kind}`)
      if (record) {
        try {
          record.win.setAlwaysOnTop(true)
        } catch {}
      }
    }
    if (this.noticeVisible) {
      const notice = this.registry.get(NOTICE_KEY)
      if (notice) {
        try {
          notice.win.setAlwaysOnTop(true)
        } catch {}
      }
    }
  }

  forceReposition(): void {
    this.repositionAll()
  }

  moveToolbarTo(position: { x: number; y: number }, options?: { focus?: boolean; show?: boolean }): void {
    const toolbar = this.ensureToolbarWindow()
    const handle = this.ensureHandleWindow()
    const current = this.registry.getFrame(toolbar)
    const next: Rect = {
      x: Math.round(position.x),
      y: Math.round(position.y),
      width: current.width,
      height: current.height
    }
    this.syncingToolbar = true
    this.registry.setFrame(toolbar, next)
    const shouldShow = options?.show ?? toolbar.virtualVisible
    if (shouldShow) this.registry.show(toolbar, next, { focus: Boolean(options?.focus) })
    if (shouldShow && !handle.virtualVisible) this.registry.show(handle)
    this.syncingToolbar = false
    this.repositionHandleToToolbar()
    this.repositionSubwindows()
    this.onToolbarLayoutEvent('toolbar-move')
  }

  private ensureToolbarWindow(): ManagedWindowRecord {
    const existing = this.registry.get(TOOLBAR_KEY)
    if (existing) return existing
    const display = getDisplays().find((d) => d.isPrimary) ?? getDisplays()[0]!
    const width = 360
    const height = 160
    const bounds: Rect = {
      x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
      y: Math.round(display.workArea.y + (display.workArea.height - height) / 2),
      width,
      height
    }
    const record = this.createWindow({
      key: TOOLBAR_KEY,
      windowId: 'floating-toolbar',
      role: 'toolbar',
      title: 'Floating Toolbar',
      bounds,
      transparent: true,
      alwaysOnTop: true,
      titleBarStyle: 'hidden',
      styleMask: { Resizable: false }
    })

    record.win.on('move', () => {
      if (this.syncingToolbar) return
      this.repositionHandleToToolbar()
      this.repositionSubwindows()
      this.onToolbarLayoutEvent('toolbar-move')
    })
    record.win.on('resize', () => {
      this.repositionHandleToToolbar()
      this.repositionSubwindows()
      this.onToolbarLayoutEvent('toolbar-resize')
    })

    return record
  }

  private ensureHandleWindow(): ManagedWindowRecord {
    const existing = this.registry.get(HANDLE_KEY)
    if (existing) return existing
    const toolbar = this.ensureToolbarWindow()
    const b = this.registry.getFrame(toolbar)
    const bounds: Rect = {
      x: b.x + b.width + TOOLBAR_HANDLE_GAP,
      y: b.y,
      width: TOOLBAR_HANDLE_WIDTH,
      height: b.height
    }
    const record = this.createWindow({
      key: HANDLE_KEY,
      windowId: 'floating-toolbar-handle',
      role: 'toolbar-handle',
      title: 'Floating Toolbar Handle',
      bounds,
      transparent: true,
      alwaysOnTop: true,
      titleBarStyle: 'hidden',
      styleMask: { Resizable: false }
    })

    record.win.on('move', () => {
      if (this.syncingHandle) return
      this.alignToolbarToHandle()
      this.repositionSubwindows()
      this.onToolbarLayoutEvent('toolbar-move')
    })
    return record
  }

  private setToolbarBounds(widthInput: number, heightInput: number): void {
    const toolbar = this.ensureToolbarWindow()
    const current = this.registry.getFrame(toolbar)
    const width = clamp(widthInput, 1, 1400)
    const height = clamp(heightInput, 1, 1000)
    
    if (current.width === width && current.height === height) return
    
    this.syncingToolbar = true
    const next = { ...current, width, height }
    this.registry.setFrame(toolbar, next)
    if (toolbar.virtualVisible) this.registry.show(toolbar, next)
    this.syncingToolbar = false
    this.repositionHandleToToolbar()
    this.repositionSubwindows()
    this.onToolbarLayoutEvent('toolbar-bounds-reported')
  }

  private ensureSubwindowState(kind: string): SubwindowState {
    const existing = this.subwindows.get(kind)
    if (existing) return existing
    const next: SubwindowState = {
      kind,
      placement: 'bottom',
      effectivePlacement: 'bottom',
      width: 360,
      height: 220
    }
    this.subwindows.set(kind, next)
    return next
  }

  private ensureSubwindow(kind: string): ManagedWindowRecord {
    const key = `toolbar-subwindow:${kind}`
    const existing = this.registry.get(key)
    if (existing) return existing
    const state = this.ensureSubwindowState(kind)
    const toolbar = this.ensureToolbarWindow()
    state.effectivePlacement = state.placement
    const bounds = this.computeSubwindowBounds(state, this.registry.getFrame(toolbar))
    return this.createWindow({
      key,
      windowId: 'toolbar-subwindow',
      kind,
      role: 'toolbar-subwindow',
      title: `Toolbar Subwindow ${kind}`,
      bounds,
      transparent: true,
      alwaysOnTop: true,
      titleBarStyle: 'hidden',
      styleMask: { Resizable: true }
    })
  }

  private toggleSubwindow(kind: string, placement: Placement): void {
    const state = this.ensureSubwindowState(kind)
    state.placement = placement
    const target = this.ensureSubwindow(kind)
    if (target.virtualVisible) {
      this.registry.hide(target)
      return
    }
    for (const k of this.subwindows.keys()) {
      if (k === kind) continue
      this.hideSubwindow(k)
    }
    this.noticeVisible = false
    this.hideNoticeWindow()
    state.effectivePlacement = placement
    const toolbar = this.ensureToolbarWindow()
    const bounds = this.computeSubwindowBounds(state, this.registry.getFrame(toolbar))
    this.registry.show(target, bounds)
  }

  private hideSubwindow(kind: string): void {
    const record = this.registry.get(`toolbar-subwindow:${kind}`)
    if (record) this.registry.hide(record)
  }

  private ensureNoticeWindow(): ManagedWindowRecord {
    const existing = this.registry.get(NOTICE_KEY)
    if (existing) return existing
    const toolbar = this.ensureToolbarWindow()
    this.noticeState.placement = 'bottom'
    this.noticeState.effectivePlacement = this.noticeState.placement
    const bounds = this.computeNoticeBounds(this.noticeState, this.registry.getFrame(toolbar))
    return this.createWindow({
      key: NOTICE_KEY,
      windowId: 'toolbar-notice',
      role: 'toolbar-notice',
      title: 'Toolbar Notice',
      bounds,
      transparent: true,
      alwaysOnTop: true,
      titleBarStyle: 'hidden',
      styleMask: { Resizable: false }
    })
  }

  private showNoticeWindow(): void {
    const notice = this.ensureNoticeWindow()
    const toolbar = this.ensureToolbarWindow()
    this.noticeState.placement = 'bottom'
    this.noticeState.effectivePlacement = this.noticeState.placement
    const bounds = this.computeNoticeBounds(this.noticeState, this.registry.getFrame(toolbar))
    this.registry.show(notice, bounds)
  }

  private hideNoticeWindow(): void {
    const notice = this.registry.get(NOTICE_KEY)
    if (notice) this.registry.hide(notice)
  }

  private repositionAll(): void {
    this.repositionHandleToToolbar()
    this.repositionSubwindows()
  }

  private repositionHandleToToolbar(): void {
    const toolbar = this.registry.get(TOOLBAR_KEY)
    const handle = this.registry.get(HANDLE_KEY)
    if (!toolbar || !handle) return
    const b = this.registry.getFrame(toolbar)
    const next: Rect = {
      x: b.x + b.width + TOOLBAR_HANDLE_GAP,
      y: b.y,
      width: TOOLBAR_HANDLE_WIDTH,
      height: b.height
    }
    this.syncingHandle = true
    this.registry.setFrame(handle, next)
    if (handle.virtualVisible) this.registry.show(handle, next)
    this.syncingHandle = false
  }

  private alignToolbarToHandle(): void {
    const toolbar = this.registry.get(TOOLBAR_KEY)
    const handle = this.registry.get(HANDLE_KEY)
    if (!toolbar || !handle) return
    const hb = this.registry.getFrame(handle)
    const tb = this.registry.getFrame(toolbar)
    const next: Rect = {
      x: hb.x - tb.width - TOOLBAR_HANDLE_GAP,
      y: hb.y,
      width: tb.width,
      height: hb.height
    }
    this.syncingToolbar = true
    this.registry.setFrame(toolbar, next)
    if (toolbar.virtualVisible) this.registry.show(toolbar, next)
    this.syncingToolbar = false
  }

  private repositionSubwindows(): void {
    const toolbar = this.registry.get(TOOLBAR_KEY)
    if (!toolbar) return
    const toolbarBounds = this.registry.getFrame(toolbar)

    for (const [kind, state] of this.subwindows.entries()) {
      const record = this.registry.get(`toolbar-subwindow:${kind}`)
      if (!record) continue
      const bounds = this.computeSubwindowBounds(state, toolbarBounds)
      this.registry.setFrame(record, bounds)
      if (record.virtualVisible) this.registry.show(record, bounds)
    }

    if (this.noticeVisible) {
      const notice = this.registry.get(NOTICE_KEY)
      if (notice) {
        const bounds = this.computeNoticeBounds(this.noticeState, toolbarBounds)
        this.registry.setFrame(notice, bounds)
        if (notice.virtualVisible) this.registry.show(notice, bounds)
      }
    }
  }

  private computeSubwindowBounds(state: SubwindowState, toolbarBounds: Rect): Rect {
    const display = getDisplayByBounds(toolbarBounds)
    const width = clamp(state.width, 60, Math.max(60, display.workArea.width - 20))
    const height = clamp(state.height, 60, Math.max(60, display.workArea.height - 20))

    const xMax = display.workArea.x + display.workArea.width - width
    let x = clamp(toolbarBounds.x, display.workArea.x, xMax)

    const computeY = (placement: Placement) =>
      placement === 'bottom'
        ? toolbarBounds.y + toolbarBounds.height + TOOLBAR_HANDLE_GAP
        : toolbarBounds.y - height - TOOLBAR_HANDLE_GAP

    const yMax = display.workArea.y + display.workArea.height - height
    let y = computeY(state.effectivePlacement)
    if (y < display.workArea.y || y > yMax) {
      state.effectivePlacement = state.effectivePlacement === 'bottom' ? 'top' : 'bottom'
      y = computeY(state.effectivePlacement)
    }
    y = clamp(y, display.workArea.y, yMax)

    return { x, y, width, height }
  }

  private computeNoticeBounds(state: NoticeState, toolbarBounds: Rect): Rect {
    const display = getDisplayByBounds(toolbarBounds)
    const width = clamp(state.width, 60, Math.max(60, display.workArea.width - 20))
    const height = clamp(state.height, 60, Math.max(60, display.workArea.height - 20))

    const xMax = display.workArea.x + display.workArea.width - width
    let x = clamp(toolbarBounds.x, display.workArea.x, xMax)

    const computeY = (placement: Placement) =>
      placement === 'bottom'
        ? toolbarBounds.y + toolbarBounds.height + TOOLBAR_HANDLE_GAP
        : toolbarBounds.y - height - TOOLBAR_HANDLE_GAP

    const yMax = display.workArea.y + display.workArea.height - height
    let y = computeY(state.effectivePlacement)
    if (y < display.workArea.y || y > yMax) {
      state.effectivePlacement = state.effectivePlacement === 'bottom' ? 'top' : 'bottom'
      y = computeY(state.effectivePlacement)
    }
    y = clamp(y, display.workArea.y, yMax)

    return { x, y, width, height }
  }
}

export function isKnownToolbarSubwindowKind(kind: string): boolean {
  return (TOOLBAR_SUBWINDOW_KINDS as readonly string[]).includes(kind)
}
