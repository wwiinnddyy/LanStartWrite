import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from '../Framer_Motion'
import { useHyperGlassRealtimeBlur } from '../hyper_glass'
import { Button } from '../button'
import { useEventsPoll } from '../toolbar/hooks/useEventsPoll'
import { postCommand } from '../toolbar/hooks/useBackend'
import '../toolbar-subwindows/styles/subwindow.css'
import './styles.css'

type SortKey = 'cpu' | 'mem' | 'pid'

type ProcessRow = {
  pid: number
  name: string
  cpuPercent?: number
  memoryBytes?: number
}

type WindowRow = {
  ts: number
  title: string
  pid?: number
  processName?: string
  handle?: string
}

function formatBytes(bytes: number | undefined): string {
  if (!Number.isFinite(bytes ?? NaN)) return '-'
  const b = Number(bytes)
  if (b < 1024) return `${Math.round(b)} B`
  const kb = b / 1024
  if (kb < 1024) return `${kb.toFixed(0)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(2)} GB`
}

function formatPct(v: number | undefined): string {
  if (!Number.isFinite(v ?? NaN)) return '-'
  const n = Math.max(0, Number(v))
  if (n < 1) return `${n.toFixed(2)}%`
  if (n < 10) return `${n.toFixed(1)}%`
  return `${n.toFixed(0)}%`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

export function TaskWindowsWatcherMenu(props: { kind: string }) {
  const reduceMotion = useReducedMotion()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const events = useEventsPoll(700)

  const [running, setRunning] = useState(false)
  const [intervalMs, setIntervalMs] = useState(1000)
  const [lastError, setLastError] = useState<string | undefined>(undefined)
  const [sortKey, setSortKey] = useState<SortKey>('cpu')
  const [foreground, setForeground] = useState<WindowRow | undefined>(undefined)
  const [history, setHistory] = useState<WindowRow[]>([])
  const [processes, setProcesses] = useState<ProcessRow[]>([])

  useHyperGlassRealtimeBlur({ root: rootRef.current })

  useEffect(() => {
    let lastWidth = 0
    let lastHeight = 0
    let rafId = 0

    const send = () => {
      rafId = 0
      const measureRect = measureRef.current?.getBoundingClientRect()
      const contentWidth = Math.max(measureRef.current?.scrollWidth ?? 0, measureRect?.width ?? 0)
      const contentHeight = Math.max(measureRef.current?.scrollHeight ?? 0, measureRect?.height ?? 0)
      const width = Math.max(360, Math.min(1600, Math.ceil(contentWidth) + 26))
      const height = Math.max(140, Math.min(900, Math.ceil(contentHeight) + 26))
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
    if (rootRef.current) ro.observe(rootRef.current)
    if (cardRef.current) ro.observe(cardRef.current)
    if (measureRef.current) ro.observe(measureRef.current)
    schedule()

    return () => {
      ro.disconnect()
      if (rafId) window.cancelAnimationFrame(rafId)
    }
  }, [props.kind])

  useEffect(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.type === 'watcherStatus') {
        const s = (e.payload ?? {}) as any
        setRunning(Boolean(s.running))
        const nextInterval = Number(s.intervalMs)
        if (Number.isFinite(nextInterval)) setIntervalMs(nextInterval)
        setLastError(typeof s.lastError === 'string' ? s.lastError : undefined)
        break
      }
    }
  }, [events])

  useEffect(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.type !== 'processChanged') continue
      const p = (e.payload ?? {}) as any
      const list = Array.isArray(p.processes) ? (p.processes as any[]) : []
      const rows: ProcessRow[] = []
      for (const item of list) {
        const pid = Number(item?.pid)
        const name = typeof item?.name === 'string' ? item.name : ''
        if (!Number.isFinite(pid) || !name) continue
        rows.push({
          pid,
          name,
          cpuPercent: Number.isFinite(Number(item?.cpuPercent)) ? Number(item.cpuPercent) : undefined,
          memoryBytes: Number.isFinite(Number(item?.memoryBytes)) ? Number(item.memoryBytes) : undefined
        })
      }
      setProcesses(rows)
      break
    }
  }, [events])

  useEffect(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.type !== 'windowFocusChanged') continue
      const p = (e.payload ?? {}) as any
      const ts = Number(p.ts)
      const w = (p.window ?? {}) as any
      const title = typeof w.title === 'string' ? w.title : ''
      if (!title) break
      const row: WindowRow = {
        ts: Number.isFinite(ts) ? ts : e.ts,
        title,
        pid: Number.isFinite(Number(w.pid)) ? Number(w.pid) : undefined,
        processName: typeof w.processName === 'string' ? w.processName : undefined,
        handle: typeof w.handle === 'string' ? w.handle : undefined
      }
      setForeground(row)
      setHistory((prev) => [row, ...prev].slice(0, 60))
      break
    }
  }, [events])

  const sortedProcesses = useMemo(() => {
    const rows = [...processes]
    rows.sort((a, b) => {
      if (sortKey === 'pid') return a.pid - b.pid
      if (sortKey === 'mem') return (b.memoryBytes ?? -1) - (a.memoryBytes ?? -1)
      return (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1)
    })
    return rows.slice(0, 180)
  }, [processes, sortKey])

  const start = () => {
    postCommand('watcher.start', { intervalMs }).catch(() => undefined)
  }

  const stop = () => {
    postCommand('watcher.stop').catch(() => undefined)
  }

  return (
    <motion.div
      ref={rootRef}
      className="subwindowRoot"
      initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.99 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? undefined : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div ref={cardRef} className="subwindowCard animate-ls-pop-in">
        <div ref={measureRef} className="subwindowMeasure">
          <div className="subwindowTitle">
            <span>监视器</span>
            <span className="subwindowMeta">{running ? '运行中' : '已停止'}</span>
          </div>

          <div className="twRow">
            <Button size="sm" variant={running ? 'light' : 'default'} onClick={start}>
              开始
            </Button>
            <Button size="sm" variant={!running ? 'light' : 'default'} onClick={stop}>
              停止
            </Button>
            <span className="subwindowMeta">间隔 {intervalMs}ms</span>
            <span className="subwindowMeta">{lastError ? `错误: ${lastError}` : ''}</span>
          </div>

          <div className="twSection">
            <div className="twSectionHeader">
              <span>前台窗口</span>
              <span className="subwindowMeta">{foreground ? formatTime(foreground.ts) : '-'}</span>
            </div>
            <div className="twBox">
              <div className="twKeyRow">
                <span className="twKey">标题</span>
                <span className="twValue">{foreground?.title ?? '-'}</span>
              </div>
              <div className="twKeyRow">
                <span className="twKey">进程</span>
                <span className="twValue">
                  {foreground?.processName ?? '-'} {foreground?.pid ? `(${foreground.pid})` : ''}
                </span>
              </div>
              <div className="twKeyRow">
                <span className="twKey">句柄</span>
                <span className="twValue">{foreground?.handle ?? '-'}</span>
              </div>
            </div>
          </div>

          <div className="twSection">
            <div className="twSectionHeader">
              <span>窗口切换</span>
              <span className="subwindowMeta">{history.length}</span>
            </div>
            <div className="subwindowList">
              {history.slice(0, 10).map((h) => (
                <div key={`${h.ts}-${h.handle ?? ''}-${h.pid ?? 0}`} className="subwindowRow">
                  <span>{h.title}</span>
                  <span className="subwindowMeta">{formatTime(h.ts)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="twSection">
            <div className="twSectionHeader">
              <span>进程列表</span>
              <span className="subwindowMeta">{processes.length}</span>
            </div>
            <div className="twRow">
              <Button size="sm" variant={sortKey === 'cpu' ? 'light' : 'default'} onClick={() => setSortKey('cpu')}>
                CPU
              </Button>
              <Button size="sm" variant={sortKey === 'mem' ? 'light' : 'default'} onClick={() => setSortKey('mem')}>
                内存
              </Button>
              <Button size="sm" variant={sortKey === 'pid' ? 'light' : 'default'} onClick={() => setSortKey('pid')}>
                PID
              </Button>
            </div>
            <div className="twProcessTable">
              <div className="twProcessHeader">
                <span>进程</span>
                <span>CPU</span>
                <span>内存</span>
              </div>
              {sortedProcesses.slice(0, 60).map((p) => (
                <div key={p.pid} className="twProcessRow">
                  <span className="twProcName">
                    {p.name} <span className="subwindowMeta">#{p.pid}</span>
                  </span>
                  <span className="twProcNum">{formatPct(p.cpuPercent)}</span>
                  <span className="twProcNum">{formatBytes(p.memoryBytes)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
