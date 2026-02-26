import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useDragControls, motion } from '../../Framer_Motion'
import { FloatingToolbarApp, FloatingToolbarHandleApp } from '../../toolbar'
import { ClockMenu, EraserSubmenu, EventsMenu, FeaturePanelMenu, PenSubmenu, SettingsMenu } from '../../toolbar-subwindows'
import { AnnotationOverlayApp, PaintBoardBackgroundApp } from '../../paint_board'
import { MultiPageControlHandleWindow, MultiPageControlWindow, PageThumbnailsMenuWindow } from '../../mut_page'
import { useHyperGlassRealtimeBlur } from '../../hyper_glass'
import { SettingsWindow } from '../../settings'
import { VideoShowBackgroundApp } from '../../video_show'
import {
  UI_STATE_APP_WINDOW_ID,
  WEB_ACTIVE_SUBWINDOW_UI_STATE_KEY,
  WEB_PAGE_THUMBNAILS_VISIBLE_UI_STATE_KEY,
  WEB_SETTINGS_VISIBLE_UI_STATE_KEY,
  WEB_SUBWINDOW_PLACEMENT_UI_STATE_KEY,
  VIDEO_SHOW_MERGE_LAYERS_UI_STATE_KEY,
  postCommand,
  useAppMode,
  useUiStateBus
} from '../../status'
import './web-workspace.css'

type SubwindowKind = 'events' | 'clock' | 'feature-panel' | 'notes' | 'settings' | 'pen' | 'eraser'
type SubwindowPlacement = 'top' | 'bottom'

type DockPrefs = { x: number; y: number }
type RectState = { x: number; y: number; width: number; height: number }
type SizeState = { width: number; height: number }

const TOOLBAR_DOCK_KEY = 'web-toolbar-dock'
const TOOLBAR_PANEL_LEGACY_KEY = 'web-panel:toolbar'
const SUBWINDOW_GAP = 10
const SUBWINDOW_SCREEN_MARGIN = 8

function parseDockPrefs(raw: string | null, defaults: DockPrefs): DockPrefs {
  if (!raw) return defaults
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const x = Number(parsed?.x)
    const y = Number(parsed?.y)
    return {
      x: Number.isFinite(x) ? x : defaults.x,
      y: Number.isFinite(y) ? y : defaults.y
    }
  } catch {
    return defaults
  }
}

function readToolbarDockPrefs(defaults: DockPrefs): DockPrefs {
  try {
    const existing = window.localStorage.getItem(TOOLBAR_DOCK_KEY)
    if (existing) return parseDockPrefs(existing, defaults)

    const legacy = window.localStorage.getItem(TOOLBAR_PANEL_LEGACY_KEY)
    const migrated = parseDockPrefs(legacy, defaults)
    window.localStorage.setItem(TOOLBAR_DOCK_KEY, JSON.stringify(migrated))
    return migrated
  } catch {
    return defaults
  }
}

function writeToolbarDockPrefs(next: DockPrefs): void {
  try {
    window.localStorage.setItem(TOOLBAR_DOCK_KEY, JSON.stringify(next))
  } catch {}
}

function isSubwindowKind(v: unknown): v is SubwindowKind {
  return v === 'events' || v === 'clock' || v === 'feature-panel' || v === 'notes' || v === 'settings' || v === 'pen' || v === 'eraser'
}

function coercePlacement(v: unknown): SubwindowPlacement {
  return v === 'top' ? 'top' : 'bottom'
}

function coerceBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1'
}

function renderSubwindow(kind: SubwindowKind): React.ReactNode {
  if (kind === 'events') return <EventsMenu kind="events" />
  if (kind === 'clock') return <ClockMenu kind="clock" />
  if (kind === 'feature-panel') return <FeaturePanelMenu kind="feature-panel" />
  if (kind === 'notes') return <FeaturePanelMenu kind="notes" />
  if (kind === 'settings') return <SettingsMenu kind="settings" />
  if (kind === 'pen') return <PenSubmenu kind="pen" />
  return <EraserSubmenu kind="eraser" />
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  if (max < min) return min
  return Math.min(max, Math.max(min, v))
}

function useViewportSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return size
}

function WebToolbarDock(props: { onRectChange?: (rect: RectState) => void }) {
  const defaults = useMemo<DockPrefs>(() => ({ x: 16, y: 16 }), [])
  const [prefs, setPrefs] = useState<DockPrefs>(() => readToolbarDockPrefs(defaults))
  const dragControls = useDragControls()
  const dockRef = useRef<HTMLElement | null>(null)

  const reportRect = useCallback(() => {
    const node = dockRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    props.onRectChange?.({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    })
  }, [props.onRectChange])

  useEffect(() => {
    writeToolbarDockPrefs(prefs)
  }, [prefs])

  useLayoutEffect(() => {
    reportRect()
  }, [prefs.x, prefs.y, reportRect])

  useEffect(() => {
    const node = dockRef.current
    if (!node) return
    const onResize = () => reportRect()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null
    observer?.observe(node)
    window.addEventListener('resize', onResize)
    onResize()
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [reportRect])

  return (
    <motion.section
      ref={dockRef}
      className="webToolbarDock"
      drag
      dragListener={false}
      dragControls={dragControls}
      dragMomentum={false}
      style={{ x: prefs.x, y: prefs.y }}
      onDrag={reportRect}
      onDragEnd={(_e, info) => {
        setPrefs((prev) => ({ x: prev.x + info.offset.x, y: prev.y + info.offset.y }))
        window.requestAnimationFrame(reportRect)
      }}
    >
      <div className="webToolbarDockMain">
        <FloatingToolbarApp />
      </div>
      <div className="webToolbarDockHandle">
        <FloatingToolbarHandleApp
          onDragHandlePointerDown={(e) => {
            dragControls.start(e)
          }}
        />
      </div>
    </motion.section>
  )
}

function WebWorkspace() {
  const { appMode } = useAppMode()
  const bus = useUiStateBus(UI_STATE_APP_WINDOW_ID)
  const viewport = useViewportSize()
  const [toolbarRect, setToolbarRect] = useState<RectState>({ x: 16, y: 16, width: 420, height: 64 })
  const subwindowRef = useRef<HTMLElement | null>(null)
  const [subwindowSize, setSubwindowSize] = useState<SizeState>({ width: 420, height: 320 })

  const effectiveMode = appMode === 'video-show' ? 'video-show' : 'whiteboard'

  const activeSubwindow = isSubwindowKind(bus.state[WEB_ACTIVE_SUBWINDOW_UI_STATE_KEY]) ? bus.state[WEB_ACTIVE_SUBWINDOW_UI_STATE_KEY] : null
  const subwindowPlacement = coercePlacement(bus.state[WEB_SUBWINDOW_PLACEMENT_UI_STATE_KEY])
  const pageThumbnailsVisible = coerceBool(bus.state[WEB_PAGE_THUMBNAILS_VISIBLE_UI_STATE_KEY])
  const settingsVisible = coerceBool(bus.state[WEB_SETTINGS_VISIBLE_UI_STATE_KEY])
  const videoMergeLayersRaw = bus.state[VIDEO_SHOW_MERGE_LAYERS_UI_STATE_KEY]
  const videoMergeLayers = typeof videoMergeLayersRaw === 'boolean' ? videoMergeLayersRaw : true

  useLayoutEffect(() => {
    if (!activeSubwindow) return
    const node = subwindowRef.current
    if (!node) return
    const update = () => {
      const rect = node.getBoundingClientRect()
      setSubwindowSize({
        width: Math.max(1, Math.ceil(rect.width)),
        height: Math.max(1, Math.ceil(rect.height))
      })
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [activeSubwindow])

  const effectiveSubwindowPlacement = useMemo<SubwindowPlacement>(() => {
    if (!activeSubwindow) return subwindowPlacement
    const topSpace = toolbarRect.y - SUBWINDOW_GAP - SUBWINDOW_SCREEN_MARGIN
    const bottomSpace = viewport.height - (toolbarRect.y + toolbarRect.height + SUBWINDOW_GAP) - SUBWINDOW_SCREEN_MARGIN
    const needHeight = subwindowSize.height
    if (subwindowPlacement === 'top') {
      if (topSpace >= needHeight) return 'top'
      if (bottomSpace >= needHeight) return 'bottom'
      return topSpace >= bottomSpace ? 'top' : 'bottom'
    }
    if (bottomSpace >= needHeight) return 'bottom'
    if (topSpace >= needHeight) return 'top'
    return bottomSpace >= topSpace ? 'bottom' : 'top'
  }, [activeSubwindow, subwindowPlacement, subwindowSize.height, toolbarRect.height, toolbarRect.y, viewport.height])

  const subwindowStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!activeSubwindow) return undefined
    const maxLeft = Math.max(SUBWINDOW_SCREEN_MARGIN, viewport.width - subwindowSize.width - SUBWINDOW_SCREEN_MARGIN)
    const left = clamp(toolbarRect.x, SUBWINDOW_SCREEN_MARGIN, maxLeft)
    const desiredTop =
      effectiveSubwindowPlacement === 'top'
        ? toolbarRect.y - subwindowSize.height - SUBWINDOW_GAP
        : toolbarRect.y + toolbarRect.height + SUBWINDOW_GAP
    const maxTop = Math.max(SUBWINDOW_SCREEN_MARGIN, viewport.height - subwindowSize.height - SUBWINDOW_SCREEN_MARGIN)
    const top = clamp(desiredTop, SUBWINDOW_SCREEN_MARGIN, maxTop)
    return {
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`
    }
  }, [
    activeSubwindow,
    effectiveSubwindowPlacement,
    subwindowSize.height,
    subwindowSize.width,
    toolbarRect.height,
    toolbarRect.x,
    toolbarRect.y,
    viewport.height,
    viewport.width
  ])

  return (
    <div className="webWorkspaceRoot">
      <div className="webWorkspaceStage">
        {effectiveMode === 'video-show' ? (
          <>
            <VideoShowBackgroundApp />
            {!videoMergeLayers ? (
              <div className="webWorkspaceAnnotationLayer">
                <AnnotationOverlayApp forcedAppMode="video-show" />
              </div>
            ) : null}
          </>
        ) : (
          <>
            <PaintBoardBackgroundApp />
            <div className="webWorkspaceAnnotationLayer">
              <AnnotationOverlayApp forcedAppMode="whiteboard" />
            </div>
          </>
        )}
      </div>

      <div className="webWorkspaceOverlay">
        <WebToolbarDock onRectChange={setToolbarRect} />

        <section className="webPageDock">
          <MultiPageControlWindow />
          <MultiPageControlHandleWindow />
        </section>

        {activeSubwindow ? (
          <section
            ref={subwindowRef}
            className={effectiveSubwindowPlacement === 'top' ? 'webSubwindowDock webSubwindowDock--top' : 'webSubwindowDock webSubwindowDock--bottom'}
            style={subwindowStyle}
          >
            <button
              type="button"
              className="webSubwindowClose"
              title="Close"
              onClick={() => {
                postCommand('toggle-subwindow', { kind: activeSubwindow, placement: subwindowPlacement }).catch(() => undefined)
              }}
            >
              x
            </button>
            {renderSubwindow(activeSubwindow)}
          </section>
        ) : null}

        {pageThumbnailsVisible ? (
          <section className="webFloatAnchor webFloatAnchor--thumbnails">
            <button
              type="button"
              className="webAnchorClose"
              title="Close"
              onClick={() => {
                postCommand('app.togglePageThumbnailsMenu').catch(() => undefined)
              }}
            >
              x
            </button>
            <PageThumbnailsMenuWindow />
          </section>
        ) : null}

        {settingsVisible ? (
          <section className="webFloatAnchor webFloatAnchor--settings">
            <button
              type="button"
              className="webAnchorClose"
              title="Close"
              onClick={() => {
                postCommand('app.closeSettingsWindow').catch(() => undefined)
              }}
            >
              x
            </button>
            <SettingsWindow />
          </section>
        ) : null}
      </div>
    </div>
  )
}

function WithAppearance(props: { children: React.ReactNode }) {
  useHyperGlassRealtimeBlur({ root: document.documentElement })
  return <>{props.children}</>
}

export default function App() {
  return (
    <WithAppearance>
      <WebWorkspace />
    </WithAppearance>
  )
}
