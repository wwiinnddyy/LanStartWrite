import React, { useEffect, useMemo, useState } from 'react'
import { FloatingToolbarApp, FloatingToolbarHandleApp, WINDOW_ID_FLOATING_TOOLBAR, WINDOW_ID_FLOATING_TOOLBAR_HANDLE } from '../../toolbar'
import { useEventsPoll } from '../../toolbar/hooks/useEventsPoll'
import { Button } from '../../button'
import { EventsMenu, FeaturePanelMenu, SettingsMenu } from '../../toolbar-subwindows'
import { TaskWindowsWatcherWindow } from '../../task_windows_watcher'
import { PaintBoardApp } from '../../paint_board'

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
      <div className="childHeader">
        <div className="childTitle">子窗口</div>
        <div className="childMeta">backend: {health}</div>
      </div>

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
  )
}

export default function App() {
  const { windowId, kind } = useWindowParams()

  if (windowId === 'child') return <ChildWindow />
  if (windowId === WINDOW_ID_FLOATING_TOOLBAR) return <FloatingToolbarApp />
  if (windowId === WINDOW_ID_FLOATING_TOOLBAR_HANDLE) return <FloatingToolbarHandleApp />
  if (windowId === 'paint-board') return <PaintBoardApp />
  if (windowId === 'watcher') return <TaskWindowsWatcherWindow />

  if (windowId === 'toolbar-subwindow') {
    if (kind === 'events') return <EventsMenu kind="events" />
    if (kind === 'feature-panel') return <FeaturePanelMenu kind="feature-panel" />
    if (kind === 'settings') return <SettingsMenu kind="settings" />
    return <EventsMenu kind="events" />
  }

  return <FloatingToolbarApp />
}
