import React, { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from '../Framer_Motion'
import { Button } from '../button'
import { useEventsPoll } from '../toolbar/hooks/useEventsPoll'
import { deleteUiStateKey, getKv, postCommand, putKv, putUiStateKey } from '../toolbar/hooks/useBackend'
import { useZoomOnWheel } from '../toolbar/hooks/useZoomOnWheel'
import { WatcherIcon } from '../toolbar/components/ToolbarIcons'
import { APP_MODE_UI_STATE_KEY, NOTICE_KIND_UI_STATE_KEY, NOTES_RELOAD_REV_UI_STATE_KEY, UI_STATE_APP_WINDOW_ID, VIDEO_SHOW_PAGES_KV_KEY, useUiStateBus } from '../status'
import '../toolbar-subwindows/styles/subwindow.css'

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  let idx = 0
  let v = bytes
  while (v >= 1024 && idx < units.length - 1) {
    v /= 1024
    idx += 1
  }
  const digits = idx <= 1 ? 0 : idx === 2 ? 1 : 2
  return `${v.toFixed(digits)} ${units[idx]}`
}

function HistoryIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <path
        fill="currentColor"
        d="M10 4a6 6 0 1 1-5.982 5.538a.5.5 0 1 0-.998-.076Q3 9.73 3 10a7 7 0 1 0 2-4.899V3.5a.5.5 0 0 0-1 0v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 0-1H5.528A5.98 5.98 0 0 1 10 4m0 2.5a.5.5 0 0 0-1 0v4a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 0-1H10z"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

export function NotificationSubwindow(props: { kind: 'notice' }) {
  useZoomOnWheel()
  const reduceMotion = useReducedMotion()
  const events = useEventsPoll(800)
  const bus = useUiStateBus(UI_STATE_APP_WINDOW_ID)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const outerPadding = 12

  const lastProcessedEventIdRef = useRef(0)
  const lastMemoryTotalBytesRef = useRef(0)
  const [memoryTotalBytes, setMemoryTotalBytes] = useState(0)

  useEffect(() => {
    if (!events.length) return
    const next = events.filter((e) => e.id > lastProcessedEventIdRef.current)
    if (!next.length) return
    lastProcessedEventIdRef.current = next[next.length - 1]!.id

    for (const item of next) {
      if (item.type !== 'processChanged') continue
      const payload = (item.payload ?? {}) as any
      const processes = Array.isArray(payload.processes) ? payload.processes : []
      let total = 0
      for (const p of processes) {
        const mem = Number((p as any)?.memoryBytes)
        if (!Number.isFinite(mem) || mem <= 0) continue
        total += mem
      }
      if (total !== lastMemoryTotalBytesRef.current) {
        lastMemoryTotalBytesRef.current = total
        setMemoryTotalBytes(total)
      }
    }
  }, [events])

  const noticeKindRaw = bus.state[NOTICE_KIND_UI_STATE_KEY]
  const noticeKind = typeof noticeKindRaw === 'string' ? noticeKindRaw : ''
  const isRestoreNotesNotice = noticeKind === 'notesRestore'

  useEffect(() => {
    const root = rootRef.current
    const card = cardRef.current
    const measure = measureRef.current
    if (!root) return
    if (typeof ResizeObserver === 'undefined') return

    let lastHeight = 0
    let lastWidth = 0
    let rafId = 0

    const send = () => {
      rafId = 0
      const contentWidth = measure?.scrollWidth ?? 0
      const contentHeight = measure?.scrollHeight ?? 0
      // 增加 2px 以补偿边框占用的空间，确保内边距视觉上四边等宽
      const width = Math.max(260, Math.min(420, Math.ceil(contentWidth) + outerPadding * 2 + 2))
      const height = Math.max(56, Math.min(96, Math.ceil(contentHeight) + outerPadding * 2 + 2))
      if (width === lastWidth && height === lastHeight) return
      lastWidth = width
      lastHeight = height
      postCommand('set-subwindow-bounds', { kind: props.kind, width, height }).catch(() => undefined)
    }

    const schedule = () => {
      if (rafId) return
      rafId = window.requestAnimationFrame(send)
    }

    const ro = new ResizeObserver(schedule)
    ro.observe(root)
    if (card) ro.observe(card)
    if (measure) ro.observe(measure)
    schedule()

    return () => {
      ro.disconnect()
      if (rafId) window.cancelAnimationFrame(rafId)
    }
  }, [props.kind])

  const close = () => {
    deleteUiStateKey(UI_STATE_APP_WINDOW_ID, NOTICE_KIND_UI_STATE_KEY).catch(() => undefined)
    void postCommand('win.setNoticeVisible', { visible: false })
  }

  const openWatcher = () => {
    void postCommand('watcher.openWindow')
    close()
  }

  const text = `内存占用 ${formatBytes(memoryTotalBytes || lastMemoryTotalBytesRef.current)}`

  const restoreNotes = async () => {
    const appModeRaw = bus.state[APP_MODE_UI_STATE_KEY]
    const notesKvKey =
      appModeRaw === 'whiteboard'
        ? 'annotation-notes-whiteboard'
        : appModeRaw === 'video-show'
          ? 'annotation-notes-video-show'
          : appModeRaw === 'pdf'
            ? 'annotation-notes-pdf'
            : 'annotation-notes-toolbar'
    const notesHistoryKvKey = `${notesKvKey}-prev`
    try {
      const prev = await getKv<unknown>(notesHistoryKvKey)
      await putKv(notesKvKey, prev)
      if (appModeRaw === 'video-show') {
        try {
          const prevPages = await getKv<unknown>(`${VIDEO_SHOW_PAGES_KV_KEY}-prev`)
          await putKv(VIDEO_SHOW_PAGES_KV_KEY, prevPages)
        } catch {}
      }
      await putUiStateKey(UI_STATE_APP_WINDOW_ID, NOTES_RELOAD_REV_UI_STATE_KEY, Date.now())
    } catch {}
    close()
  }

  return (
    <motion.div
      ref={rootRef}
      className="subwindowRoot"
      initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.99 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? undefined : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div
        ref={cardRef}
        className="subwindowCard animate-ls-pop-in"
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          padding: outerPadding,
          gap: 12,
          cursor: isRestoreNotesNotice ? 'default' : 'pointer'
        }}
        role={isRestoreNotesNotice ? undefined : 'button'}
        tabIndex={isRestoreNotesNotice ? undefined : 0}
        onClick={(e) => {
          if (isRestoreNotesNotice) return
          const target = e.target as HTMLElement | null
          if (target?.closest?.('button')) return
          openWatcher()
        }}
        onKeyDown={(e) => {
          if (isRestoreNotesNotice) return
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          openWatcher()
        }}
      >
        <div
          ref={measureRef}
          className="subwindowMeasure"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', maxWidth: '100%' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, minWidth: 0, maxWidth: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, maxWidth: '100%' }}>
              <div style={{ width: 18, height: 18, opacity: 0.92, flex: '0 0 auto' }} aria-hidden="true">
                {isRestoreNotesNotice ? <HistoryIcon /> : <WatcherIcon />}
              </div>
              <div
                style={{
                  fontSize: 12,
                  opacity: 0.92,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0
                }}
              >
                {isRestoreNotesNotice ? '是否还原笔记？' : text}
              </div>
            </div>

            <div
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onPointerCancel={(e) => e.stopPropagation()}
              onPointerLeave={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}
            >
              <Button variant="default" size="sm" ariaLabel="关闭通知" title="关闭" onClick={close}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6L6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </Button>
              {isRestoreNotesNotice ? (
                <Button variant="default" size="sm" ariaLabel="确定还原笔记" title="确定" onClick={restoreNotes}>
                  <CheckIcon />
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
