import React, { useEffect, useMemo, useState } from 'react'
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

type PanelPrefs = { x: number; y: number; collapsed: boolean }
type DockPrefs = { x: number; y: number }

const panelPrefsKey = (id: string) => `web-panel:${id}`
const TOOLBAR_DOCK_KEY = 'web-toolbar-dock'
const TOOLBAR_PANEL_LEGACY_KEY = panelPrefsKey('toolbar')

function readPanelPrefs(id: string, defaults: PanelPrefs): PanelPrefs {
  try {
    const raw = window.localStorage.getItem(panelPrefsKey(id))
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<PanelPrefs>
    const x = Number(parsed?.x)
    const y = Number(parsed?.y)
    const collapsed = Boolean(parsed?.collapsed)
    return {
      x: Number.isFinite(x) ? x : defaults.x,
      y: Number.isFinite(y) ? y : defaults.y,
      collapsed
    }
  } catch {
    return defaults
  }
}

function writePanelPrefs(id: string, prefs: PanelPrefs): void {
  try {
    window.localStorage.setItem(panelPrefsKey(id), JSON.stringify(prefs))
  } catch {}
}

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

function WebToolbarDock() {
  const defaults = useMemo<DockPrefs>(() => ({ x: 16, y: 16 }), [])
  const [prefs, setPrefs] = useState<DockPrefs>(() => readToolbarDockPrefs(defaults))
  const dragControls = useDragControls()

  useEffect(() => {
    writeToolbarDockPrefs(prefs)
  }, [prefs])

  return (
    <motion.section
      className="webToolbarDock"
      drag
      dragListener={false}
      dragControls={dragControls}
      dragMomentum={false}
      style={{ x: prefs.x, y: prefs.y }}
      onDragEnd={(_e, info) => {
        setPrefs((prev) => ({ x: prev.x + info.offset.x, y: prev.y + info.offset.y }))
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

function FloatingPanel(props: {
  id: string
  title: string
  className?: string
  defaultCollapsed?: boolean
  defaultOffset?: { x: number; y: number }
  onClose?: () => void
  children: React.ReactNode
}) {
  const defaults = useMemo<PanelPrefs>(
    () => ({ x: props.defaultOffset?.x ?? 0, y: props.defaultOffset?.y ?? 0, collapsed: Boolean(props.defaultCollapsed) }),
    [props.defaultCollapsed, props.defaultOffset?.x, props.defaultOffset?.y]
  )
  const [prefs, setPrefs] = useState<PanelPrefs>(() => readPanelPrefs(props.id, defaults))
  const dragControls = useDragControls()

  useEffect(() => {
    writePanelPrefs(props.id, prefs)
  }, [prefs, props.id])

  useEffect(() => {
    setPrefs((prev) => (prev === defaults ? prev : { ...prev, collapsed: prev.collapsed ?? defaults.collapsed }))
  }, [defaults])

  return (
    <motion.section
      className={props.className ? `webPanel ${props.className}` : 'webPanel'}
      drag
      dragListener={false}
      dragControls={dragControls}
      dragMomentum={false}
      style={{ x: prefs.x, y: prefs.y }}
      onDragEnd={(_e, info) => {
        setPrefs((prev) => ({ ...prev, x: prev.x + info.offset.x, y: prev.y + info.offset.y }))
      }}
    >
      <div
        className="webPanelHeader"
        onPointerDown={(e) => {
          dragControls.start(e)
        }}
      >
        <span className="webPanelTitle">{props.title}</span>
        <div className="webPanelActions" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="webPanelButton"
            title={prefs.collapsed ? 'Expand' : 'Collapse'}
            onClick={() => setPrefs((prev) => ({ ...prev, collapsed: !prev.collapsed }))}
          >
            {prefs.collapsed ? '+' : '-'}
          </button>
          {props.onClose ? (
            <button type="button" className="webPanelButton webPanelButton--danger" title="Close" onClick={props.onClose}>
              x
            </button>
          ) : null}
        </div>
      </div>
      {!prefs.collapsed ? <div className="webPanelBody">{props.children}</div> : null}
    </motion.section>
  )
}

function WebWorkspace() {
  const { appMode } = useAppMode()
  const bus = useUiStateBus(UI_STATE_APP_WINDOW_ID)

  const effectiveMode = appMode === 'video-show' ? 'video-show' : 'whiteboard'

  const activeSubwindow = isSubwindowKind(bus.state[WEB_ACTIVE_SUBWINDOW_UI_STATE_KEY]) ? bus.state[WEB_ACTIVE_SUBWINDOW_UI_STATE_KEY] : null
  const subwindowPlacement = coercePlacement(bus.state[WEB_SUBWINDOW_PLACEMENT_UI_STATE_KEY])
  const pageThumbnailsVisible = coerceBool(bus.state[WEB_PAGE_THUMBNAILS_VISIBLE_UI_STATE_KEY])
  const settingsVisible = coerceBool(bus.state[WEB_SETTINGS_VISIBLE_UI_STATE_KEY])
  const videoMergeLayersRaw = bus.state[VIDEO_SHOW_MERGE_LAYERS_UI_STATE_KEY]
  const videoMergeLayers = typeof videoMergeLayersRaw === 'boolean' ? videoMergeLayersRaw : true

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
        <WebToolbarDock />

        <section className="webPageDock">
          <MultiPageControlWindow />
          <MultiPageControlHandleWindow />
        </section>

        {activeSubwindow ? (
          <section className={subwindowPlacement === 'top' ? 'webSubwindowDock webSubwindowDock--top' : 'webSubwindowDock webSubwindowDock--bottom'}>
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
          <FloatingPanel
            id="page-thumbnails"
            title="Thumbnails"
            className="webPanel--thumbnails"
            onClose={() => {
              postCommand('app.togglePageThumbnailsMenu').catch(() => undefined)
            }}
          >
            <div className="webThumbBody">
              <PageThumbnailsMenuWindow />
            </div>
          </FloatingPanel>
        ) : null}

        {settingsVisible ? (
          <FloatingPanel
            id="settings"
            title="Settings"
            className="webPanel--settings"
            onClose={() => {
              postCommand('app.closeSettingsWindow').catch(() => undefined)
            }}
          >
            <div className="webSettingsBody">
              <SettingsWindow />
            </div>
          </FloatingPanel>
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
