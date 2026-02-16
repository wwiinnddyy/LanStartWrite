import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from '../Framer_Motion'
import { Button } from '../button'
import { useEventsPoll } from '../toolbar/hooks/useEventsPoll'
import { deleteUiStateKey, getKv, postCommand, putKv, putUiStateKey } from '../toolbar/hooks/useBackend'
import { useZoomOnWheel } from '../toolbar/hooks/useZoomOnWheel'
import { WatcherIcon } from '../toolbar/components/ToolbarIcons'
import {
  APP_MODE_UI_STATE_KEY,
  CLOCK_COUNTDOWN_END_MS_UI_STATE_KEY,
  CLOCK_COUNTDOWN_PRESET_MS_UI_STATE_KEY,
  CLOCK_COUNTDOWN_RUNNING_UI_STATE_KEY,
  CLOCK_TAB_UI_STATE_KEY,
  CLOCK_TIMER_ELAPSED_MS_UI_STATE_KEY,
  CLOCK_TIMER_RUNNING_UI_STATE_KEY,
  CLOCK_TIMER_START_MS_UI_STATE_KEY,
  NOTICE_KIND_UI_STATE_KEY,
  NOTES_RELOAD_REV_UI_STATE_KEY,
  UI_STATE_APP_WINDOW_ID,
  VIDEO_SHOW_PAGES_KV_KEY,
  useUiStateBus,
  type ClockTab
} from '../status'
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

function ClockIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <path
        fill="currentColor"
        d="M10 2a8 8 0 1 1 0 16a8 8 0 0 1 0-16m0 1a7 7 0 1 0 0 14a7 7 0 0 0 0-14m-.5 2a.5.5 0 0 1 .492.41L10 5.5V10h2.5a.5.5 0 0 1 .09.992L12.5 11h-3a.5.5 0 0 1-.492-.41L9 10.5v-5a.5.5 0 0 1 .5-.5"
      />
    </svg>
  )
}

function pad2(v: number): string {
  return String(v).padStart(2, '0')
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
  return `${pad2(minutes)}:${pad2(seconds)}`
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
  const isClockFloatNotice = noticeKind === 'clockFloat'

  const timerRunning = Boolean(bus.state[CLOCK_TIMER_RUNNING_UI_STATE_KEY])
  const timerStartMs = Number(bus.state[CLOCK_TIMER_START_MS_UI_STATE_KEY])
  const timerElapsedMs = Number(bus.state[CLOCK_TIMER_ELAPSED_MS_UI_STATE_KEY])

  const countdownRunning = Boolean(bus.state[CLOCK_COUNTDOWN_RUNNING_UI_STATE_KEY])
  const countdownEndMs = Number(bus.state[CLOCK_COUNTDOWN_END_MS_UI_STATE_KEY])
  const countdownPresetMs = Number(bus.state[CLOCK_COUNTDOWN_PRESET_MS_UI_STATE_KEY])

  const [clockNowMs, setClockNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!isClockFloatNotice) return
    const id = window.setInterval(() => setClockNowMs(Date.now()), 200)
    return () => window.clearInterval(id)
  }, [isClockFloatNotice])

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
      const width = Math.max(
        isClockFloatNotice ? 0 : 260,
        Math.min(420, Math.ceil(contentWidth) + outerPadding * 2 + 2)
      )
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

  const clockFloatShownAtRef = useRef<number | null>(null)
  const clockFloatEverActiveRef = useRef(false)
  useEffect(() => {
    if (!isClockFloatNotice) {
      clockFloatShownAtRef.current = null
      clockFloatEverActiveRef.current = false
      return
    }
    if (clockFloatShownAtRef.current === null) clockFloatShownAtRef.current = Date.now()
  }, [isClockFloatNotice])

  const timerActive = isClockFloatNotice && timerRunning
  const countdownActive = isClockFloatNotice && countdownRunning
  useEffect(() => {
    if (!isClockFloatNotice) return
    if (timerActive || countdownActive) clockFloatEverActiveRef.current = true
  }, [countdownActive, isClockFloatNotice, timerActive])

  const countdownProgress = useMemo(() => {
    if (!isClockFloatNotice) return 0
    if (!countdownActive) return 0
    if (!Number.isFinite(countdownEndMs)) return 0
    const total = Number.isFinite(countdownPresetMs) && countdownPresetMs > 0 ? countdownPresetMs : 0
    if (total <= 0) return 0
    const remain = Math.max(0, countdownEndMs - clockNowMs)
    return Math.min(1, Math.max(0, 1 - remain / total))
  }, [clockNowMs, countdownActive, countdownEndMs, countdownPresetMs, isClockFloatNotice])

  const clockText = useMemo(() => {
    if (!isClockFloatNotice) return ''
    if (countdownActive) {
      if (Number.isFinite(countdownEndMs)) return `倒计时 ${formatDuration(Math.max(0, countdownEndMs - clockNowMs))}`
      return '倒计时'
    }
    if (timerActive) {
      const base = Number.isFinite(timerElapsedMs) && timerElapsedMs > 0 ? timerElapsedMs : 0
      if (Number.isFinite(timerStartMs)) return `计时 ${formatDuration(base + Math.max(0, clockNowMs - timerStartMs))}`
      return `计时 ${formatDuration(base)}`
    }
    return '时钟'
  }, [clockNowMs, countdownActive, countdownEndMs, isClockFloatNotice, timerActive, timerElapsedMs, timerStartMs])

  useEffect(() => {
    if (!isClockFloatNotice) return
    if (countdownActive && Number.isFinite(countdownEndMs) && countdownEndMs <= clockNowMs) {
      putUiStateKey(UI_STATE_APP_WINDOW_ID, CLOCK_COUNTDOWN_RUNNING_UI_STATE_KEY, false).catch(() => undefined)
      putUiStateKey(UI_STATE_APP_WINDOW_ID, CLOCK_COUNTDOWN_END_MS_UI_STATE_KEY, null).catch(() => undefined)
      close()
      return
    }
    if (timerActive || countdownActive) return
    if (clockFloatEverActiveRef.current) close()
  }, [clockNowMs, countdownActive, countdownEndMs, isClockFloatNotice, timerActive])

  const openClock = () => {
    let tab: ClockTab = 'clock'
    if (countdownActive) tab = 'countdown'
    else if (timerActive) tab = 'timer'
    putUiStateKey(UI_STATE_APP_WINDOW_ID, CLOCK_TAB_UI_STATE_KEY, tab).catch(() => undefined)
    void postCommand('toggle-subwindow', { kind: 'clock', placement: 'bottom' })
    close()
  }

  const text = isClockFloatNotice
    ? clockText
    : `内存占用 ${formatBytes(memoryTotalBytes || lastMemoryTotalBytesRef.current)}`

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
          cursor: isRestoreNotesNotice ? 'default' : 'pointer',
          position: 'relative',
          overflow: isClockFloatNotice ? 'hidden' : undefined
        }}
        role={isRestoreNotesNotice ? undefined : 'button'}
        tabIndex={isRestoreNotesNotice ? undefined : 0}
        onClick={(e) => {
          if (isRestoreNotesNotice) return
          const target = e.target as HTMLElement | null
          if (target?.closest?.('button')) return
          if (isClockFloatNotice) openClock()
          else openWatcher()
        }}
        onKeyDown={(e) => {
          if (isRestoreNotesNotice) return
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          if (isClockFloatNotice) openClock()
          else openWatcher()
        }}
      >
        {isClockFloatNotice && !reduceMotion ? (
          countdownActive ? (
            <>
              <motion.div
                aria-hidden="true"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0, opacity: 0.92 }}
                initial={false}
              >
                <motion.div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: '0%',
                    overflow: 'hidden',
                    background: 'var(--ls-btn-light-bg-hover, var(--ls-accent-light, rgba(59, 130, 246, 0.12)))'
                  }}
                  initial={false}
                  animate={{ height: `${Math.round(countdownProgress * 100)}%` }}
                  transition={{ duration: 0.45, ease: 'linear' }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background:
                        'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 45%, rgba(255,255,255,0) 100%)',
                      opacity: 0.35
                    }}
                  />
                  <motion.div
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: -18,
                      height: 36,
                      opacity: 0.85
                    }}
                    animate={{ y: [0, 2, 0] }}
                    transition={{ duration: 2.8, ease: 'easeInOut', repeat: Infinity }}
                  >
                    <motion.svg
                      viewBox="0 0 120 20"
                      preserveAspectRatio="none"
                      style={{ width: '200%', height: '100%', display: 'block' }}
                      animate={{ x: ['0%', '-50%'] }}
                      transition={{ duration: 4.5, ease: 'linear', repeat: Infinity }}
                    >
                      <path
                        d="M0 10 Q 15 2 30 10 T 60 10 T 90 10 T 120 10 V20 H0 Z"
                        fill="rgba(255,255,255,0.28)"
                      />
                      <path
                        d="M0 12 Q 15 20 30 12 T 60 12 T 90 12 T 120 12 V20 H0 Z"
                        fill="rgba(255,255,255,0.16)"
                      />
                    </motion.svg>
                  </motion.div>
                </motion.div>
              </motion.div>
            </>
          ) : timerActive ? (
            <>
              <motion.div
                aria-hidden="true"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0, opacity: 0.92 }}
                initial={false}
              >
                <motion.div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: '42%',
                    overflow: 'hidden',
                    background: 'var(--ls-btn-light-bg-hover, var(--ls-accent-light, rgba(59, 130, 246, 0.12)))'
                  }}
                  animate={{ height: ['34%', '62%', '34%'] }}
                  transition={{ duration: 7.5, ease: 'easeInOut', repeat: Infinity }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background:
                        'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 45%, rgba(255,255,255,0) 100%)',
                      opacity: 0.3
                    }}
                  />
                  <motion.div
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: -18,
                      height: 36,
                      opacity: 0.85
                    }}
                    animate={{ y: [0, 2, 0] }}
                    transition={{ duration: 3.2, ease: 'easeInOut', repeat: Infinity }}
                  >
                    <motion.svg
                      viewBox="0 0 120 20"
                      preserveAspectRatio="none"
                      style={{ width: '200%', height: '100%', display: 'block' }}
                      animate={{ x: ['0%', '-50%'] }}
                      transition={{ duration: 5.2, ease: 'linear', repeat: Infinity }}
                    >
                      <path
                        d="M0 10 Q 15 2 30 10 T 60 10 T 90 10 T 120 10 V20 H0 Z"
                        fill="rgba(255,255,255,0.28)"
                      />
                      <path
                        d="M0 12 Q 15 20 30 12 T 60 12 T 90 12 T 120 12 V20 H0 Z"
                        fill="rgba(255,255,255,0.16)"
                      />
                    </motion.svg>
                  </motion.div>
                </motion.div>
              </motion.div>
            </>
          ) : null
        ) : null}
        <div
          ref={measureRef}
          className="subwindowMeasure"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            maxWidth: '100%',
            position: 'relative',
            zIndex: 1
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, minWidth: 0, maxWidth: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: isClockFloatNotice ? 8 : 12, minWidth: 0, maxWidth: '100%' }}>
              <div style={{ width: 18, height: 18, opacity: 0.92, flex: '0 0 auto' }} aria-hidden="true">
                {isRestoreNotesNotice ? <HistoryIcon /> : isClockFloatNotice ? <ClockIcon /> : <WatcherIcon />}
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

            {isClockFloatNotice ? null : (
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
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
