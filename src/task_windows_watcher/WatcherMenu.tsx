import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { motion, useReducedMotion, AnimatePresence } from '../Framer_Motion'
import { useHyperGlassRealtimeBlur } from '../hyper_glass'
import { Button, MotionButton } from '../button'
import '../toolbar-subwindows/styles/subwindow.css'
import './styles.css'

type SortKey = 'cpu' | 'mem' | 'pid'
type ViewMode = 'processes' | 'windows' | 'performance'
type LayoutSize = 'compact' | 'comfortable' | 'spacious'

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

// 图标组件
function PlayIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  )
}

function WindowIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  )
}

function CpuIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="14" x2="4" y2="14" />
    </svg>
  )
}

function MemoryIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <line x1="10" y1="3" x2="10" y2="21" />
      <line x1="14" y1="3" x2="14" y2="21" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}

function ActivityIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function MaximizeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  )
}

function MinimizeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  )
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

function formatBytesCompact(bytes: number | undefined): string {
  if (!Number.isFinite(bytes ?? NaN)) return '-'
  const b = Number(bytes)
  if (b < 1024) return `${Math.round(b)}B`
  const kb = b / 1024
  if (kb < 1024) return `${kb.toFixed(0)}K`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(0)}M`
  const gb = mb / 1024
  return `${gb.toFixed(1)}G`
}

function formatPct(v: number | undefined): string {
  if (!Number.isFinite(v ?? NaN)) return '-'
  const n = Math.max(0, Number(v))
  if (n < 1) return `${n.toFixed(1)}%`
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

function formatTimeCompact(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

// 自定义 hook：监听容器大小变化
function useContainerSize(ref: React.RefObject<HTMLElement>) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (!ref.current) return

    const element = ref.current
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setSize({ width, height })
      }
    })

    observer.observe(element)
    // 初始化尺寸
    setSize({ width: element.clientWidth, height: element.clientHeight })

    return () => observer.disconnect()
  }, [ref])

  return size
}

// 进度条组件
function ProgressBar({ value, max = 100, color = 'var(--ls-accent, #3b82f6)', size = 'md' }: { 
  value: number; 
  max?: number; 
  color?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100))
  const heightClass = size === 'sm' ? '4px' : size === 'lg' ? '10px' : '6px'
  
  return (
    <div className="twProgressBar" style={{ height: heightClass }}>
      <motion.div
        className="twProgressFill"
        initial={{ width: 0 }}
        animate={{ width: `${percentage}%` }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        style={{ backgroundColor: color }}
      />
    </div>
  )
}

// 统计卡片组件
function StatCard({ 
  icon, 
  label, 
  value, 
  subValue, 
  color, 
  layoutSize 
}: { 
  icon: React.ReactNode; 
  label: string; 
  value: string; 
  subValue?: string; 
  color: string;
  layoutSize: LayoutSize;
}) {
  const isCompact = layoutSize === 'compact'
  
  return (
    <motion.div
      className={`twStatCard twStatCard--${layoutSize}`}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.2 }}
    >
      <div className="twStatIcon" style={{ color, display: isCompact ? 'none' : 'flex' }}>{icon}</div>
      <div className="twStatContent">
        <div className="twStatLabel">{label}</div>
        <div className="twStatValue">{value}</div>
        {subValue && !isCompact && <div className="twStatSubValue">{subValue}</div>}
      </div>
    </motion.div>
  )
}

// 可折叠区域组件
function CollapsibleSection({ 
  title, 
  subtitle, 
  children, 
  defaultExpanded = true,
  layoutSize 
}: { 
  title: string; 
  subtitle?: string; 
  children: React.ReactNode; 
  defaultExpanded?: boolean;
  layoutSize?: LayoutSize;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const reduceMotion = useReducedMotion()

  return (
    <div className={`twCollapsibleSection twCollapsibleSection--${layoutSize}`}>
      <MotionButton
        kind="custom"
        className="twCollapsibleHeader"
        onClick={() => setExpanded(!expanded)}
        whileHover={{ backgroundColor: 'rgba(0,0,0,0.03)' }}
        whileTap={{ scale: 0.99 }}
      >
        <span className="twCollapsibleTitle">{title}</span>
        {subtitle && <span className="twCollapsibleSubtitle">{subtitle}</span>}
        <motion.span
          className="twCollapsibleIcon"
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDownIcon />
        </motion.span>
      </MotionButton>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="twCollapsibleContent"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function TaskWindowsWatcherWindow() {
  const reduceMotion = useReducedMotion()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const lastWindowKeyRef = useRef<string>('')

  // 监听容器大小
  const { width: containerWidth } = useContainerSize(cardRef)
  
  // 根据容器宽度确定布局大小
  const layoutSize: LayoutSize = useMemo(() => {
    if (containerWidth < 500) return 'compact'
    if (containerWidth < 800) return 'comfortable'
    return 'spacious'
  }, [containerWidth])

  const [running, setRunning] = useState(false)
  const [intervalMs, setIntervalMs] = useState(1000)
  const [lastError, setLastError] = useState<string | undefined>(undefined)
  const [collecting, setCollecting] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('cpu')
  const [viewMode, setViewMode] = useState<ViewMode>('processes')
  const [foreground, setForeground] = useState<WindowRow | undefined>(undefined)
  const [history, setHistory] = useState<WindowRow[]>([])
  const [processes, setProcesses] = useState<ProcessRow[]>([])

  useHyperGlassRealtimeBlur({ root: rootRef.current })

  useEffect(() => {
    if (!collecting) return
    let cancelled = false
    let timer: number | undefined

    const poll = async () => {
      if (cancelled) return
      try {
        const res = await window.lanstart?.apiRequest({ method: 'GET', path: '/watcher/state' })
        const body = (res?.body ?? {}) as any
        const watcher = (body.watcher ?? {}) as any
        const processesRaw = (body.processes ?? {}) as any
        const foregroundRaw = (body.foreground ?? {}) as any

        setRunning(Boolean(watcher.running))
        const nextInterval = Number(watcher.intervalMs)
        if (Number.isFinite(nextInterval)) setIntervalMs(nextInterval)
        setLastError(typeof watcher.lastError === 'string' ? watcher.lastError : undefined)

        const list = Array.isArray(processesRaw?.processes) ? (processesRaw.processes as any[]) : []
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

        const ts = Number(foregroundRaw?.ts)
        const w = (foregroundRaw?.window ?? undefined) as any
        const title = typeof w?.title === 'string' ? w.title : ''
        if (title) {
          const row: WindowRow = {
            ts: Number.isFinite(ts) ? ts : Date.now(),
            title,
            pid: Number.isFinite(Number(w.pid)) ? Number(w.pid) : undefined,
            processName: typeof w.processName === 'string' ? w.processName : undefined,
            handle: typeof w.handle === 'string' ? w.handle : undefined
          }
          const key = `${row.pid ?? 0}|${row.handle ?? ''}|${row.title}`
          setForeground(row)
          if (key && key !== lastWindowKeyRef.current) {
            lastWindowKeyRef.current = key
            setHistory((prev) => [row, ...prev].slice(0, 60))
          }
        }
      } catch (e) {
        setLastError(e instanceof Error ? e.message : String(e))
      } finally {
        if (cancelled) return
        timer = window.setTimeout(() => void poll(), 700)
      }
    }

    void poll()

    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [collecting])

  const sortedProcesses = useMemo(() => {
    const rows = [...processes]
    rows.sort((a, b) => {
      if (sortKey === 'pid') return a.pid - b.pid
      if (sortKey === 'mem') return (b.memoryBytes ?? -1) - (a.memoryBytes ?? -1)
      return (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1)
    })
    return rows.slice(0, 180)
  }, [processes, sortKey])

  // 计算统计数据
  const stats = useMemo(() => {
    const totalProcesses = processes.length
    const totalMemory = processes.reduce((sum, p) => sum + (p.memoryBytes ?? 0), 0)
    const avgCpu = processes.length > 0
      ? processes.reduce((sum, p) => sum + (p.cpuPercent ?? 0), 0) / processes.length
      : 0
    const topCpuProcess = processes.reduce((max, p) =>
      (p.cpuPercent ?? 0) > (max.cpuPercent ?? 0) ? p : max, processes[0])

    return { totalProcesses, totalMemory, avgCpu, topCpuProcess }
  }, [processes])

  const start = () => setCollecting(true)
  const stop = () => setCollecting(false)

  const isCompact = layoutSize === 'compact'
  const isSpacious = layoutSize === 'spacious'

  return (
    <motion.div
      ref={rootRef}
      className="subwindowRoot twWatcherRoot"
      initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.99 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? undefined : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div ref={cardRef} className={`subwindowCard twWatcherCard twWatcherCard--${layoutSize} animate-ls-pop-in`}>
        <div className="subwindowMeasure">
          {/* 标题和控制区 */}
          <div className={`twHeader twHeader--${layoutSize}`}>
            <div className="twTitleSection">
              <h2 className={`twMainTitle twMainTitle--${layoutSize}`}>系统监视器</h2>
              <div className="twStatusBadges">
                <motion.span
                  className={`twStatusBadge ${collecting ? 'twStatusBadge--active' : ''}`}
                  animate={{ opacity: collecting ? [1, 0.5, 1] : 1 }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  {collecting ? (isCompact ? '●' : '● 监控中') : (isCompact ? '○' : '○ 已暂停')}
                </motion.span>
                {lastError && <span className="twStatusBadge twStatusBadge--error">!</span>}
              </div>
            </div>
            <div className="twControls">
              <Button
                size="sm"
                variant={collecting ? 'light' : 'default'}
                onClick={start}
                className="twControlBtn"
              >
                <PlayIcon />
              </Button>
              <Button
                size="sm"
                variant={!collecting ? 'light' : 'default'}
                onClick={stop}
                className="twControlBtn"
              >
                <PauseIcon />
              </Button>
            </div>
          </div>

          {/* 视图切换标签 */}
          <div className={`twViewTabs twViewTabs--${layoutSize}`}>
            <Button
              kind="custom"
              appRegion="no-drag"
              ariaLabel="进程视图"
              title="进程视图"
              className={`twViewTab ${viewMode === 'processes' ? 'twViewTab--active' : ''}`}
              onClick={() => setViewMode('processes')}
            >
              <ListIcon />
              {!isCompact && <span>进程</span>}
            </Button>
            <Button
              kind="custom"
              appRegion="no-drag"
              ariaLabel="窗口视图"
              title="窗口视图"
              className={`twViewTab ${viewMode === 'windows' ? 'twViewTab--active' : ''}`}
              onClick={() => setViewMode('windows')}
            >
              <WindowIcon />
              {!isCompact && <span>窗口</span>}
            </Button>
            <Button
              kind="custom"
              appRegion="no-drag"
              ariaLabel="性能视图"
              title="性能视图"
              className={`twViewTab ${viewMode === 'performance' ? 'twViewTab--active' : ''}`}
              onClick={() => setViewMode('performance')}
            >
              <ActivityIcon />
              {!isCompact && <span>性能</span>}
            </Button>
          </div>

          {/* 统计卡片 */}
          <div className={`twStatsGrid twStatsGrid--${layoutSize}`}>
            <StatCard
              icon={<ListIcon />}
              label={isCompact ? '进程' : '进程数'}
              value={String(stats.totalProcesses)}
              subValue={isCompact ? undefined : (running ? `采样 ${intervalMs}ms` : '采样停止')}
              color="#3b82f6"
              layoutSize={layoutSize}
            />
            <StatCard
              icon={<MemoryIcon />}
              label={isCompact ? '内存' : '总内存'}
              value={formatBytesCompact(stats.totalMemory)}
              subValue={isCompact ? undefined : undefined}
              color="#10b981"
              layoutSize={layoutSize}
            />
            <StatCard
              icon={<CpuIcon />}
              label={isCompact ? 'CPU' : '平均CPU'}
              value={formatPct(stats.avgCpu)}
              subValue={isCompact ? undefined : (stats.topCpuProcess ? `最高: ${stats.topCpuProcess.name}` : undefined)}
              color="#f59e0b"
              layoutSize={layoutSize}
            />
          </div>

          {/* 前台窗口信息 - 紧凑模式下隐藏 */}
          {!isCompact && (
            <CollapsibleSection 
              title="当前前台窗口" 
              subtitle={foreground ? formatTime(foreground.ts) : undefined}
              layoutSize={layoutSize}
            >
              <div className="twForegroundCard">
                <div className="twForegroundItem">
                  <span className="twForegroundLabel">
                    <WindowIcon />
                    窗口标题
                  </span>
                  <span className="twForegroundValue">{foreground?.title ?? '-'}</span>
                </div>
                <div className="twForegroundItem">
                  <span className="twForegroundLabel">
                    <CpuIcon />
                    进程
                  </span>
                  <span className="twForegroundValue">
                    {foreground?.processName ?? '-'} {foreground?.pid ? `(PID: ${foreground.pid})` : ''}
                  </span>
                </div>
              </div>
            </CollapsibleSection>
          )}

          {/* 窗口切换历史 */}
          {viewMode === 'windows' && (
            <CollapsibleSection 
              title={isCompact ? '历史' : '窗口切换历史'} 
              subtitle={isCompact ? `${history.length}` : `${history.length} 条记录`}
              layoutSize={layoutSize}
            >
              <div className={`twHistoryList twHistoryList--${layoutSize}`}>
                <AnimatePresence mode="popLayout">
                  {history.slice(0, isCompact ? 8 : 15).map((h, index) => (
                    <motion.div
                      key={`${h.ts}-${h.handle ?? ''}-${h.pid ?? 0}`}
                      className={`twHistoryItem twHistoryItem--${layoutSize}`}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ delay: index * 0.03 }}
                      layout
                    >
                      <div className="twHistoryDot" />
                      <span className="twHistoryTitle">{h.title}</span>
                      <span className="twHistoryTime">
                        {isCompact ? formatTimeCompact(h.ts) : formatTime(h.ts)}
                      </span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </CollapsibleSection>
          )}

          {/* 进程列表 */}
          {viewMode === 'processes' && (
            <CollapsibleSection 
              title={isCompact ? '进程' : '进程列表'} 
              subtitle={isCompact ? `${processes.length}` : `${processes.length} 个进程`} 
              defaultExpanded={true}
              layoutSize={layoutSize}
            >
              {/* 排序按钮 */}
              <div className={`twSortBar twSortBar--${layoutSize}`}>
                {!isCompact && <span className="twSortLabel">排序:</span>}
                <Button
                  kind="custom"
                  appRegion="no-drag"
                  ariaLabel="按 CPU 排序"
                  title="按 CPU 排序"
                  className={`twSortBtn ${sortKey === 'cpu' ? 'twSortBtn--active' : ''}`}
                  onClick={() => setSortKey('cpu')}
                >
                  <CpuIcon />
                  {!isCompact && <span>CPU</span>}
                </Button>
                <Button
                  kind="custom"
                  appRegion="no-drag"
                  ariaLabel="按内存排序"
                  title="按内存排序"
                  className={`twSortBtn ${sortKey === 'mem' ? 'twSortBtn--active' : ''}`}
                  onClick={() => setSortKey('mem')}
                >
                  <MemoryIcon />
                  {!isCompact && <span>内存</span>}
                </Button>
                {!isCompact && (
                  <Button
                    kind="custom"
                    appRegion="no-drag"
                    ariaLabel="按 PID 排序"
                    title="按 PID 排序"
                    className={`twSortBtn ${sortKey === 'pid' ? 'twSortBtn--active' : ''}`}
                    onClick={() => setSortKey('pid')}
                  >
                    PID
                  </Button>
                )}
              </div>

              {/* 进程表格 */}
              <div className={`twProcessList twProcessList--${layoutSize}`}>
                <div className={`twProcessHeader twProcessHeader--${layoutSize}`}>
                  <span className="twProcessCol twProcessCol--name">进程</span>
                  <span className="twProcessCol twProcessCol--cpu">CPU</span>
                  {!isCompact && <span className="twProcessCol twProcessCol--mem">内存</span>}
                </div>
                <div className="twProcessBody">
                  <AnimatePresence mode="popLayout">
                    {sortedProcesses.slice(0, isCompact ? 20 : 50).map((p, index) => (
                      <motion.div
                        key={p.pid}
                        className={`twProcessItem twProcessItem--${layoutSize}`}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ delay: index * 0.01 }}
                        layout
                      >
                        <div className="twProcessCol twProcessCol--name">
                          <span className="twProcessName">{p.name}</span>
                          <span className="twProcessPid">#{p.pid}</span>
                        </div>
                        <div className="twProcessCol twProcessCol--cpu">
                          <ProgressBar
                            value={p.cpuPercent ?? 0}
                            max={100}
                            color={p.cpuPercent && p.cpuPercent > 50 ? '#ef4444' : p.cpuPercent && p.cpuPercent > 20 ? '#f59e0b' : '#3b82f6'}
                            size={isCompact ? 'sm' : 'md'}
                          />
                          <span className="twProcessValue">{formatPct(p.cpuPercent)}</span>
                        </div>
                        {!isCompact && (
                          <div className="twProcessCol twProcessCol--mem">
                            <span className="twProcessValue">{formatBytes(p.memoryBytes)}</span>
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            </CollapsibleSection>
          )}

          {/* 性能视图 */}
          {viewMode === 'performance' && (
            <CollapsibleSection 
              title={isCompact ? '性能' : '性能概览'} 
              defaultExpanded={true}
              layoutSize={layoutSize}
            >
              <div className={`twPerformanceGrid twPerformanceGrid--${layoutSize}`}>
                <div className={`twPerformanceCard twPerformanceCard--${layoutSize}`}>
                  <div className="twPerformanceHeader">
                    <CpuIcon />
                    <span>{isCompact ? 'CPU' : 'CPU 使用率'}</span>
                  </div>
                  <div className={`twPerformanceValue twPerformanceValue--${layoutSize}`}>{formatPct(stats.avgCpu)}</div>
                  <ProgressBar value={stats.avgCpu} max={100} color="#3b82f6" size={isCompact ? 'sm' : 'md'} />
                </div>
                <div className={`twPerformanceCard twPerformanceCard--${layoutSize}`}>
                  <div className="twPerformanceHeader">
                    <MemoryIcon />
                    <span>{isCompact ? '内存' : '内存使用'}</span>
                  </div>
                  <div className={`twPerformanceValue twPerformanceValue--${layoutSize}`}>{formatBytesCompact(stats.totalMemory)}</div>
                  <ProgressBar value={stats.totalMemory} max={stats.totalMemory * 1.5} color="#10b981" size={isCompact ? 'sm' : 'md'} />
                </div>
              </div>
            </CollapsibleSection>
          )}
        </div>
      </div>
    </motion.div>
  )
}
