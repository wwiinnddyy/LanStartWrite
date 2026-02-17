import React, { useEffect, useMemo, useState } from 'react'
import { FloatingToolbarApp, FloatingToolbarHandleApp, WINDOW_ID_FLOATING_TOOLBAR, WINDOW_ID_FLOATING_TOOLBAR_HANDLE } from '../../toolbar'
import { useEventsPoll } from '../../toolbar/hooks/useEventsPoll'
import { Button } from '../../button'
import { ClockMenu, EventsMenu, FeaturePanelMenu, PenSubmenu, EraserSubmenu, SettingsMenu } from '../../toolbar-subwindows'
import { NotificationSubwindow } from '../../toolbar_notice/NotificationSubwindow'
import { TaskWindowsWatcherWindow } from '../../task_windows_watcher'
import { AnnotationOverlayApp, PaintBoardBackgroundApp } from '../../paint_board'
import { PdfBackgroundApp } from '../../PDF'
import { VideoShowBackgroundApp } from '../../video_show'
import { MultiPageControlHandleWindow, MultiPageControlWindow, PageThumbnailsMenuWindow } from '../../mut_page'
import { useHyperGlassRealtimeBlur } from '../../hyper_glass'
import { SettingsWindow, useAppearanceSettings } from '../../settings'
import { AppWindowTitlebar } from '../../app_windows_manerger/renderer'
import { LanStartBarApp, WINDOW_ID_LANSTART_BAR } from '../../LanStartBar'

function useWindowParams(): { windowId: string; kind?: string } {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const windowId = params.get('window') || WINDOW_ID_FLOATING_TOOLBAR
    const kind = params.get('kind') || undefined
    return { windowId, kind }
  }, [])
}

function ChildWindow() {
  const events = useEventsPoll()
  const [health, setHealth] = useState<string>('…')

  useEffect(() => {
    const run = async () => {
      try {
        if (!window.lanstart) throw new Error('lanstart_unavailable')
        const res = await window.lanstart.apiRequest({ method: 'GET', path: '/health' })
        const json = (res.body ?? {}) as { ok?: unknown; port?: unknown }
        setHealth(json.ok ? `ok:${Number(json.port ?? 0)}` : 'bad')
      } catch {
        setHealth('offline')
      }
    }
    run()
  }, [])

  return (
    <div className="childRoot">
      <AppWindowTitlebar windowId="child" title="数据库" subtitle={`backend: ${health}`} showMaximize={false} />
      <div className="childContent">
        <div className="childActions">
          <Button
            size="md"
            variant="light"
            onClick={async () => {
              await window.lanstart?.putKv('hello', { time: Date.now(), from: 'child' })
            }}
          >
            写入 LevelDB
          </Button>
          <Button
            size="md"
            variant="light"
            onClick={async () => {
              await window.lanstart?.getKv('hello')
            }}
          >
            读取 LevelDB
          </Button>
        </div>

        <div className="childEvents">
          {events.slice(-8).map((e) => (
            <div key={e.id} className="childEventRow">
              <span className="childEventType">{e.type}</span>
              <span className="childEventId">#{e.id}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutError: Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(timeoutError), ms)
    promise.then(
      (v) => {
        window.clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        window.clearTimeout(timer)
        reject(e)
      }
    )
  })
}

function WithAppearance(props: { children: React.ReactNode }) {
  const { legacyWindowImplementation, windowBackgroundMode } = useAppearanceSettings()
  useHyperGlassRealtimeBlur({
    root: !legacyWindowImplementation && windowBackgroundMode === 'blur' ? document.documentElement : null
  })

  const [lanstartHint, setLanstartHint] = useState<{ kind: 'missing' | 'offline'; message: string } | null>(null)
  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (!window.lanstart) {
        if (!cancelled) setLanstartHint({ kind: 'missing', message: '预加载未注入（window.lanstart 不存在），窗口通信将不可用' })
        return
      }
      try {
        const res = await withTimeout(
          window.lanstart.apiRequest({ method: 'GET', path: '/health' }),
          2500,
          new Error('health_timeout')
        )
        const ok = Boolean((res as any)?.body?.ok)
        if (!ok) throw new Error('health_bad')
        if (!cancelled) setLanstartHint(null)
      } catch {
        if (!cancelled) setLanstartHint({ kind: 'offline', message: '后端未响应（/health 离线），部分功能将不可用' })
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      {props.children}
      {lanstartHint ? (
        <div style={{ position: 'fixed', left: 8, right: 8, bottom: 8, zIndex: 999999, pointerEvents: 'none' }}>
          <div
            style={{
              margin: '0 auto',
              maxWidth: 720,
              background: 'rgba(0,0,0,0.66)',
              color: 'rgba(255,255,255,0.92)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12,
              padding: '10px 12px',
              fontSize: 12,
              lineHeight: 1.3,
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)'
            }}
          >
            {lanstartHint.message}
          </div>
        </div>
      ) : null}
    </>
  )
}

export default function App() {
  const { windowId, kind } = useWindowParams()

  if (windowId === 'child') return <WithAppearance><ChildWindow /></WithAppearance>
  if (windowId === WINDOW_ID_FLOATING_TOOLBAR) return <WithAppearance><FloatingToolbarApp /></WithAppearance>
  if (windowId === WINDOW_ID_FLOATING_TOOLBAR_HANDLE) return <WithAppearance><FloatingToolbarHandleApp /></WithAppearance>
  if (windowId === 'paint-board') {
    if (kind === 'annotation') return <AnnotationOverlayApp />
    if (kind === 'video-show') return <VideoShowBackgroundApp />
    if (kind === 'pdf') return <PdfBackgroundApp />
    return <PaintBoardBackgroundApp />
  }
  if (windowId === 'watcher') return <WithAppearance><TaskWindowsWatcherWindow /></WithAppearance>
  if (windowId === 'settings-window') return <WithAppearance><SettingsWindow /></WithAppearance>
  if (windowId === WINDOW_ID_LANSTART_BAR) return <WithAppearance><LanStartBarApp /></WithAppearance>
  if (windowId === 'toolbar-notice') return <WithAppearance><NotificationSubwindow kind="notice" /></WithAppearance>
  if (windowId === 'mut-page') return <WithAppearance><MultiPageControlWindow /></WithAppearance>
  if (windowId === 'mut-page-handle') return <WithAppearance><MultiPageControlHandleWindow /></WithAppearance>
  if (windowId === 'mut-page-thumbnails-menu') return <WithAppearance><PageThumbnailsMenuWindow /></WithAppearance>

  if (windowId === 'toolbar-subwindow') {
    if (kind === 'events') return <WithAppearance><EventsMenu kind="events" /></WithAppearance>
    if (kind === 'clock') return <WithAppearance><ClockMenu kind="clock" /></WithAppearance>
    if (kind === 'feature-panel') return <WithAppearance><FeaturePanelMenu kind="feature-panel" /></WithAppearance>
    if (kind === 'notes') return <WithAppearance><FeaturePanelMenu kind="notes" /></WithAppearance>
    if (kind === 'settings') return <WithAppearance><SettingsMenu kind="settings" /></WithAppearance>
    if (kind === 'pen') return <WithAppearance><PenSubmenu kind="pen" /></WithAppearance>
    if (kind === 'eraser') return <WithAppearance><EraserSubmenu kind="eraser" /></WithAppearance>
    return <WithAppearance><EventsMenu kind="events" /></WithAppearance>
  }

  return <WithAppearance><FloatingToolbarApp /></WithAppearance>
}
