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
  bounds: Rect
  workArea: Rect
  isPrimary: boolean
}

type MutPageHooks = {
  onNeedAlignToolbarWithMutPageOnce?: () => void
}

const MUT_PAGE_HANDLE_WIDTH = 34
const MUT_PAGE_HANDLE_GAP = 8

function isFiniteNumber(v: unknown): v is number {
  return Number.isFinite(v)
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

function intersectionArea(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  const w = Math.max(0, x2 - x1)
  const h = Math.max(0, y2 - y1)
  return w * h
}

function getDisplayByBounds(bounds: Rect): DisplayLike {
  const displays = getDisplays()
  let best = displays.find((d) => d.isPrimary) ?? displays[0]!
  let bestScore = -1
  for (const display of displays) {
    const score = intersectionArea(bounds, display.workArea)
    if (score > bestScore) {
      bestScore = score
      best = display
    }
  }
  return best
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

export class MutPageOrchestrator {
  private mutPageUiBounds = { width: 420, height: 96 }
  private mutPageAnchorBounds: Rect | undefined
  private desiredFromPpt = false
  private desiredFromMode = false
  private thumbnailsVisible = false
  private pptHideTimer: ReturnType<typeof setTimeout> | undefined
  private pptLastShownAt = 0
  private didAlignToolbarWithPpt = false

  constructor(
    private readonly registry: WindowRegistry,
    private readonly createWindow: CreateWindowFn,
    private readonly getToolbarBounds: () => Rect | undefined,
    private readonly hooks?: MutPageHooks
  ) {}

  dispose(): void {
    if (this.pptHideTimer) {
      clearTimeout(this.pptHideTimer)
      this.pptHideTimer = undefined
    }
  }

  setModeVisible(visible: boolean): void {
    this.desiredFromMode = Boolean(visible)
    this.applyVisibility()
  }

  getMutPageBounds(): Rect | undefined {
    const record = this.registry.get('mut-page')
    if (!record) return undefined
    return this.registry.getFrame(record)
  }

  getMutPageHandleWidth(): number {
    return MUT_PAGE_HANDLE_WIDTH
  }

  getMutPageHandleGap(): number {
    return MUT_PAGE_HANDLE_GAP
  }

  handleMainMessage(message: MainControlMessage): boolean {
    const type = String(message.type ?? '')
    if (!type) return false

    if (type === 'SET_MUT_PAGE_VISIBLE') {
      const source = String(message.source ?? '')
      const visible = Boolean(message.visible)
      if (source === 'ppt') {
        this.handlePptVisible(visible)
      } else {
        this.desiredFromPpt = visible
        if (!visible) this.didAlignToolbarWithPpt = false
        this.applyVisibility()
      }
      return true
    }

    if (type === 'SET_MUT_PAGE_ANCHOR') {
      const source = String(message.source ?? '')
      const b = message.bounds as any
      const hasBounds = b && isFiniteNumber(b.x) && isFiniteNumber(b.y) && isFiniteNumber(b.width) && isFiniteNumber(b.height)

      if (source === 'ppt') {
        if (hasBounds) {
          this.mutPageAnchorBounds = {
            x: Math.round(b.x),
            y: Math.round(b.y),
            width: Math.max(1, Math.round(b.width)),
            height: Math.max(1, Math.round(b.height))
          }
          this.pptLastShownAt = Date.now()
          this.desiredFromPpt = true
          this.clearPptHideTimer()
          this.requestAlignToolbarWithMutPageOnce()
          this.applyVisibility()
        } else {
          this.mutPageAnchorBounds = undefined
          this.schedulePptHide(1200)
        }
        this.reposition()
        return true
      }

      if (hasBounds) {
        this.mutPageAnchorBounds = {
          x: Math.round(b.x),
          y: Math.round(b.y),
          width: Math.max(1, Math.round(b.width)),
          height: Math.max(1, Math.round(b.height))
        }
      } else {
        this.mutPageAnchorBounds = undefined
      }
      this.reposition()
      return true
    }

    if (type === 'SET_MUT_PAGE_BOUNDS') {
      const width = Number(message.width)
      const height = Number(message.height)
      if (Number.isFinite(width) && Number.isFinite(height)) {
        this.mutPageUiBounds = {
          width: clamp(width, 140, 2200),
          height: clamp(height, 40, 900)
        }
      }
      this.reposition()
      return true
    }

    if (type === 'TOGGLE_MUT_PAGE_THUMBNAILS_MENU') {
      this.thumbnailsVisible = !this.thumbnailsVisible
      if (this.thumbnailsVisible) this.showThumbnailsWindow()
      else this.hideWindow('mut-page-thumbnails-menu')
      return true
    }

    return false
  }

  reposition(): void {
    const mut = this.registry.get('mut-page') ?? this.ensureMutPageWindow()
    const handle = this.registry.get('mut-page-handle') ?? this.ensureMutPageHandleWindow()
    const bounds = this.computeMutPageBounds()
    this.registry.setFrame(mut, bounds)
    if (mut.virtualVisible) this.registry.show(mut, bounds)

    const handleBounds: Rect = {
      x: bounds.x + bounds.width + MUT_PAGE_HANDLE_GAP,
      y: bounds.y,
      width: MUT_PAGE_HANDLE_WIDTH,
      height: bounds.height
    }
    this.registry.setFrame(handle, handleBounds)
    if (handle.virtualVisible) this.registry.show(handle, handleBounds)

    if (this.thumbnailsVisible) this.repositionThumbnailsWindow(bounds)
  }

  private handlePptVisible(visible: boolean): void {
    if (visible) {
      this.pptLastShownAt = Date.now()
      this.desiredFromPpt = true
      this.clearPptHideTimer()
      this.requestAlignToolbarWithMutPageOnce()
      this.applyVisibility()
      return
    }

    if (this.mutPageAnchorBounds) return
    this.schedulePptHide(900)
  }

  private requestAlignToolbarWithMutPageOnce(): void {
    if (this.didAlignToolbarWithPpt) return
    this.didAlignToolbarWithPpt = true
    setTimeout(() => {
      try {
        this.hooks?.onNeedAlignToolbarWithMutPageOnce?.()
      } catch {}
    }, 0)
  }

  private schedulePptHide(delayMs: number): void {
    this.clearPptHideTimer()
    this.pptHideTimer = setTimeout(() => {
      this.pptHideTimer = undefined
      if (Date.now() - this.pptLastShownAt < delayMs) return
      this.desiredFromPpt = false
      this.didAlignToolbarWithPpt = false
      this.applyVisibility()
    }, delayMs)
  }

  private clearPptHideTimer(): void {
    if (!this.pptHideTimer) return
    clearTimeout(this.pptHideTimer)
    this.pptHideTimer = undefined
  }

  private applyVisibility(): void {
    const visible = this.desiredFromMode || this.desiredFromPpt
    const mut = this.registry.get('mut-page') ?? this.ensureMutPageWindow()
    const handle = this.registry.get('mut-page-handle') ?? this.ensureMutPageHandleWindow()

    if (visible) {
      this.reposition()
      this.registry.show(mut)
      this.registry.show(handle)
      return
    }

    this.registry.hide(mut)
    this.registry.hide(handle)
    this.thumbnailsVisible = false
    this.hideWindow('mut-page-thumbnails-menu')
  }

  private ensureMutPageWindow(): ManagedWindowRecord {
    const existing = this.registry.get('mut-page')
    if (existing) return existing
    const bounds = this.computeMutPageBounds()
    return this.createWindow({
      key: 'mut-page',
      windowId: 'mut-page',
      role: 'mut-page',
      title: 'Multi Page',
      bounds,
      transparent: true,
      alwaysOnTop: true,
      titleBarStyle: 'hidden',
      styleMask: { Resizable: false }
    })
  }

  private ensureMutPageHandleWindow(): ManagedWindowRecord {
    const existing = this.registry.get('mut-page-handle')
    if (existing) return existing
    const owner = this.computeMutPageBounds()
    const bounds: Rect = {
      x: owner.x + owner.width + MUT_PAGE_HANDLE_GAP,
      y: owner.y,
      width: MUT_PAGE_HANDLE_WIDTH,
      height: owner.height
    }
    return this.createWindow({
      key: 'mut-page-handle',
      windowId: 'mut-page-handle',
      role: 'mut-page-handle',
      title: 'Multi Page Handle',
      bounds,
      transparent: true,
      alwaysOnTop: true,
      titleBarStyle: 'hidden',
      styleMask: { Resizable: false }
    })
  }

  private ensureThumbnailsWindow(): ManagedWindowRecord {
    const existing = this.registry.get('mut-page-thumbnails-menu')
    if (existing) return existing
    const mutBounds = this.computeMutPageBounds()
    const bounds: Rect = { x: mutBounds.x - 80, y: mutBounds.y - 360, width: 520, height: 320 }
    return this.createWindow({
      key: 'mut-page-thumbnails-menu',
      windowId: 'mut-page-thumbnails-menu',
      role: 'mut-page-thumbnails',
      title: 'Mut Page Thumbnails',
      bounds,
      transparent: true,
      alwaysOnTop: true,
      titleBarStyle: 'hidden',
      styleMask: { Resizable: true }
    })
  }

  private showThumbnailsWindow(): void {
    if (!(this.desiredFromMode || this.desiredFromPpt)) {
      this.thumbnailsVisible = false
      return
    }
    const w = this.ensureThumbnailsWindow()
    this.repositionThumbnailsWindow(this.computeMutPageBounds())
    this.registry.show(w)
  }

  private repositionThumbnailsWindow(mutBounds: Rect): void {
    const t = this.ensureThumbnailsWindow()
    const display = getDisplayByBounds(mutBounds)
    const width = 520
    const height = 340
    const x = clamp(
      mutBounds.x + Math.round((mutBounds.width - width) / 2),
      display.workArea.x,
      display.workArea.x + display.workArea.width - width
    )
    const y = clamp(mutBounds.y - height - 10, display.workArea.y, display.workArea.y + display.workArea.height - height)
    this.registry.setFrame(t, { x, y, width, height })
    if (t.virtualVisible) this.registry.show(t, { x, y, width, height })
  }

  private hideWindow(key: string): void {
    const record = this.registry.get(key)
    if (record) this.registry.hide(record)
  }

  private computeMutPageBounds(): Rect {
    const ownerBounds = this.mutPageAnchorBounds ?? this.getToolbarBounds() ?? getDisplays().find((d) => d.isPrimary)?.bounds ?? getDisplays()[0]!.bounds
    const display = getDisplayByBounds(ownerBounds)
    const useFullBounds = this.desiredFromPpt || Boolean(this.mutPageAnchorBounds) || this.desiredFromMode
    const area = useFullBounds ? display.bounds : display.workArea

    const widthLimit = Math.max(140, area.width - 20)
    const heightLimit = Math.max(40, area.height - 20)
    const width = clamp(this.mutPageUiBounds.width, 140, widthLimit)
    const height = clamp(this.mutPageUiBounds.height, 40, heightLimit)
    const margin = 14

    const x = clamp(area.x + margin, area.x, area.x + area.width - width)
    const y = clamp(area.y + area.height - height - margin, area.y, area.y + area.height - height)
    return { x, y, width, height }
  }
}
