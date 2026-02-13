import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from '../Framer_Motion'
import { cn } from '../Tailwind'
import { postCommand } from '../toolbar/hooks/useBackend'
import { useZoomOnWheel } from '../toolbar/hooks/useZoomOnWheel'
import './styles/subwindow.css'

const CLOCK_MENU_BOUNDS = { width: 420, height: 320 } as const

function PlayIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <path
        fill="currentColor"
        d="M17.22 8.687a1.498 1.498 0 0 1 0 2.626l-9.997 5.499A1.5 1.5 0 0 1 5 15.499V4.501a1.5 1.5 0 0 1 2.223-1.313zm-.482 1.75a.5.5 0 0 0 0-.875L6.741 4.063A.5.5 0 0 0 6 4.501v10.998a.5.5 0 0 0 .741.438z"
      />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <path
        fill="currentColor"
        d="M5 2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM4 4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zm9-2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-1 2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1z"
      />
    </svg>
  )
}

function ResetIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <path
        fill="currentColor"
        d="M16 10A6 6 0 0 0 5.528 6H7.5a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 1 0v1.601a7 7 0 1 1-1.98 4.361a.5.5 0 0 1 .998.076A6 6 0 1 0 16 10"
      />
    </svg>
  )
}

function pad2(v: number): string {
  return String(v).padStart(2, '0')
}

function formatClock(nowMs: number): string {
  const date = new Date(nowMs)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
  return `${pad2(minutes)}:${pad2(seconds)}`
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function msToHms(ms: number): { h: number; m: number; s: number } {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return { h, m, s }
}

function hmsToMs(h: number, m: number, s: number): number {
  const hh = clampInt(h, 0, 99)
  const mm = clampInt(m, 0, 59)
  const ss = clampInt(s, 0, 59)
  return (hh * 3600 + mm * 60 + ss) * 1000
}

function WheelColumn(props: {
  label: string
  min: number
  max: number
  value: number
  pad2?: boolean
  disabled?: boolean
  onChange: (next: number) => void
}) {
  const reduceMotion = useReducedMotion()
  const itemHeight = 28
  const visibleCount = 5
  const middleIndex = Math.floor(visibleCount / 2)
  const startYRef = useRef<number | null>(null)

  const setValue = (next: number) => {
    props.onChange(clampInt(next, props.min, props.max))
  }

  const items = useMemo(() => {
    const out: number[] = []
    for (let i = props.min; i <= props.max; i++) out.push(i)
    return out
  }, [props.max, props.min])

  const translateY = useMemo(() => {
    const idx = clampInt(props.value - props.min, 0, items.length - 1)
    return middleIndex * itemHeight - idx * itemHeight
  }, [itemHeight, items.length, middleIndex, props.min, props.value])

  return (
    <div className={cn('clockWheelCol', props.disabled && 'clockWheelCol--disabled')}>
      <div className="clockWheelLabel">{props.label}</div>
      <div
        className="clockWheelViewport"
        style={{ height: visibleCount * itemHeight }}
        onWheel={(e) => {
          if (props.disabled) return
          e.preventDefault()
          e.stopPropagation()
          const dy = e.deltaY
          if (Math.abs(dy) < 1) return
          setValue(props.value + (dy > 0 ? 1 : -1))
        }}
        onPointerDown={(e) => {
          if (props.disabled) return
          ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
          startYRef.current = e.clientY
        }}
        onPointerMove={(e) => {
          if (props.disabled) return
          if (startYRef.current === null) return
          const delta = startYRef.current - e.clientY
          if (Math.abs(delta) < itemHeight) return
          const steps = Math.trunc(delta / itemHeight)
          if (steps === 0) return
          startYRef.current = startYRef.current - steps * itemHeight
          setValue(props.value + steps)
        }}
        onPointerUp={(e) => {
          if (startYRef.current === null) return
          startYRef.current = null
          try {
            ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
          } catch {}
        }}
        onPointerCancel={(e) => {
          if (startYRef.current === null) return
          startYRef.current = null
          try {
            ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
          } catch {}
        }}
      >
        <div className="clockWheelHighlight" style={{ top: middleIndex * itemHeight }} />
        <motion.div
          className="clockWheelTrack"
          initial={false}
          animate={{ y: translateY }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: 'spring', stiffness: 520, damping: 46, mass: 0.8 }
          }
        >
          {items.map((n) => {
            const selected = n === props.value
            const text = props.pad2 ? pad2(n) : String(n)
            return (
              <button
                key={n}
                type="button"
                className={cn('clockWheelItem', selected && 'clockWheelItem--selected')}
                style={{ height: itemHeight }}
                disabled={props.disabled}
                onClick={() => setValue(n)}
              >
                {text}
              </button>
            )
          })}
        </motion.div>
      </div>
    </div>
  )
}

export function ClockMenu(props: { kind: string }) {
  useZoomOnWheel()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion()
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [tab, setTab] = useState<'clock' | 'timer' | 'countdown'>('clock')

  const [timerRunning, setTimerRunning] = useState(false)
  const [timerStartMs, setTimerStartMs] = useState<number | null>(null)
  const [timerElapsedMs, setTimerElapsedMs] = useState(0)

  const [countdownRunning, setCountdownRunning] = useState(false)
  const [countdownEndMs, setCountdownEndMs] = useState<number | null>(null)
  const [countdownPresetMs, setCountdownPresetMs] = useState(5 * 60 * 1000)
  const [countdownRemainingMs, setCountdownRemainingMs] = useState(5 * 60 * 1000)

  const clockText = useMemo(() => formatClock(nowMs), [nowMs])

  useEffect(() => {
    postCommand('set-subwindow-bounds', { kind: props.kind, ...CLOCK_MENU_BOUNDS }).catch(() => undefined)
  }, [props.kind])

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 100)
    return () => window.clearInterval(id)
  }, [])

  const timerDisplayMs = useMemo(() => {
    if (!timerRunning) return timerElapsedMs
    if (!timerStartMs) return timerElapsedMs
    return timerElapsedMs + Math.max(0, nowMs - timerStartMs)
  }, [nowMs, timerElapsedMs, timerRunning, timerStartMs])

  const countdownDisplayMs = useMemo(() => {
    if (!countdownRunning) return countdownRemainingMs
    if (!countdownEndMs) return countdownRemainingMs
    return Math.max(0, countdownEndMs - nowMs)
  }, [countdownEndMs, countdownRemainingMs, countdownRunning, nowMs])

  useEffect(() => {
    if (!countdownRunning) return
    if (countdownDisplayMs > 0) return
    setCountdownRunning(false)
    setCountdownEndMs(null)
    setCountdownRemainingMs(0)
  }, [countdownDisplayMs, countdownRunning])

  const countdownPresetHms = useMemo(() => msToHms(countdownPresetMs), [countdownPresetMs])

  return (
    <motion.div
      ref={rootRef}
      className="subwindowRoot"
      initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.99 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? undefined : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div ref={cardRef} className="subwindowCard clockMenuCard animate-ls-pop-in">
        <div className="subwindowMeasure clockMenuMeasure">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              className="clockTabPane"
              initial={reduceMotion ? undefined : { opacity: 0, y: 10, scale: 0.99 }}
              animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -8, scale: 0.99 }}
              transition={reduceMotion ? undefined : { duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {tab === 'clock' ? (
                <motion.div layout className="clockPrimaryText">
                  {clockText}
                </motion.div>
              ) : tab === 'timer' ? (
                <>
                  <motion.div layout className="clockPrimaryText">
                    {formatDuration(timerDisplayMs)}
                  </motion.div>
                  <motion.div layout className="clockActionRow">
                    <motion.button
                      type="button"
                      className="clockActionButton clockActionButton--primary"
                      aria-label={timerRunning ? '暂停' : timerElapsedMs > 0 ? '继续' : '开始'}
                      title={timerRunning ? '暂停' : timerElapsedMs > 0 ? '继续' : '开始'}
                      whileTap={reduceMotion ? undefined : { scale: 0.96 }}
                      onClick={() => {
                        if (timerRunning) {
                          if (timerStartMs) setTimerElapsedMs((v) => v + Math.max(0, nowMs - timerStartMs))
                          setTimerStartMs(null)
                          setTimerRunning(false)
                          return
                        }
                        setTimerStartMs(nowMs)
                        setTimerRunning(true)
                      }}
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.span
                          key={timerRunning ? 'pause' : 'play'}
                          className="clockIconSwap"
                          initial={reduceMotion ? undefined : { opacity: 0, scale: 0.92 }}
                          animate={reduceMotion ? undefined : { opacity: 1, scale: 1 }}
                          exit={reduceMotion ? undefined : { opacity: 0, scale: 0.92 }}
                          transition={reduceMotion ? undefined : { duration: 0.12 }}
                        >
                          {timerRunning ? <PauseIcon /> : <PlayIcon />}
                        </motion.span>
                      </AnimatePresence>
                    </motion.button>
                    <motion.button
                      type="button"
                      className="clockActionButton clockActionButton--secondary"
                      aria-label="归零"
                      title="归零"
                      whileTap={reduceMotion ? undefined : { scale: 0.96 }}
                      onClick={() => {
                        setTimerRunning(false)
                        setTimerStartMs(null)
                        setTimerElapsedMs(0)
                      }}
                    >
                      <ResetIcon />
                    </motion.button>
                  </motion.div>
                </>
              ) : (
                <motion.div layout className="clockCountdownLayout">
                  <AnimatePresence mode="wait" initial={false}>
                    {countdownRunning ? (
                      <motion.div
                        key="running"
                        layout
                        initial={reduceMotion ? undefined : { opacity: 0, y: 10 }}
                        animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                        exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
                        transition={reduceMotion ? undefined : { duration: 0.14 }}
                        className="clockPrimaryText"
                      >
                        {formatDuration(countdownDisplayMs)}
                      </motion.div>
                    ) : (
                      <motion.div
                        key="edit"
                        layout
                        initial={reduceMotion ? undefined : { opacity: 0, y: 10 }}
                        animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                        exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
                        transition={reduceMotion ? undefined : { duration: 0.14 }}
                        className="clockWheelRow"
                        aria-label="设置倒计时"
                      >
                        <WheelColumn
                          label="时"
                          min={0}
                          max={99}
                          value={countdownPresetHms.h}
                          pad2
                          disabled={countdownRunning}
                          onChange={(h) => {
                            const next = hmsToMs(h, countdownPresetHms.m, countdownPresetHms.s)
                            setCountdownPresetMs(next)
                            setCountdownRemainingMs(next)
                          }}
                        />
                        <div className="clockWheelSep" aria-hidden="true">
                          :
                        </div>
                        <WheelColumn
                          label="分"
                          min={0}
                          max={59}
                          value={countdownPresetHms.m}
                          pad2
                          disabled={countdownRunning}
                          onChange={(m) => {
                            const next = hmsToMs(countdownPresetHms.h, m, countdownPresetHms.s)
                            setCountdownPresetMs(next)
                            setCountdownRemainingMs(next)
                          }}
                        />
                        <div className="clockWheelSep" aria-hidden="true">
                          :
                        </div>
                        <WheelColumn
                          label="秒"
                          min={0}
                          max={59}
                          value={countdownPresetHms.s}
                          pad2
                          disabled={countdownRunning}
                          onChange={(s) => {
                            const next = hmsToMs(countdownPresetHms.h, countdownPresetHms.m, s)
                            setCountdownPresetMs(next)
                            setCountdownRemainingMs(next)
                          }}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <motion.div layout className="clockActionRow">
                    <motion.button
                      type="button"
                      className="clockActionButton clockActionButton--primary"
                      aria-label={countdownRunning ? '暂停' : '开始'}
                      title={countdownRunning ? '暂停' : '开始'}
                      whileTap={reduceMotion ? undefined : { scale: 0.96 }}
                      onClick={() => {
                        if (countdownRunning) {
                          if (countdownEndMs) setCountdownRemainingMs(Math.max(0, countdownEndMs - nowMs))
                          setCountdownEndMs(null)
                          setCountdownRunning(false)
                          return
                        }
                        const remaining = countdownRemainingMs > 0 ? countdownRemainingMs : countdownPresetMs
                        if (remaining <= 0) return
                        if (countdownRemainingMs !== remaining) setCountdownRemainingMs(remaining)
                        setCountdownEndMs(nowMs + remaining)
                        setCountdownRunning(true)
                      }}
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.span
                          key={countdownRunning ? 'pause' : 'play'}
                          className="clockIconSwap"
                          initial={reduceMotion ? undefined : { opacity: 0, scale: 0.92 }}
                          animate={reduceMotion ? undefined : { opacity: 1, scale: 1 }}
                          exit={reduceMotion ? undefined : { opacity: 0, scale: 0.92 }}
                          transition={reduceMotion ? undefined : { duration: 0.12 }}
                        >
                          {countdownRunning ? <PauseIcon /> : <PlayIcon />}
                        </motion.span>
                      </AnimatePresence>
                    </motion.button>
                    <motion.button
                      type="button"
                      className="clockActionButton clockActionButton--secondary"
                      aria-label="重置"
                      title={`重置 ${formatDuration(countdownPresetMs)}`}
                      whileTap={reduceMotion ? undefined : { scale: 0.96 }}
                      onClick={() => {
                        setCountdownRunning(false)
                        setCountdownEndMs(null)
                        setCountdownRemainingMs(countdownPresetMs)
                      }}
                    >
                      <ResetIcon />
                    </motion.button>
                  </motion.div>
                </motion.div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <LayoutGroup id="clock-tabs">
          <div className="clockTabsBar" role="tablist" aria-label="时钟菜单">
            <motion.button
              type="button"
              role="tab"
              aria-selected={tab === 'clock'}
              className={cn('clockTabButton', tab === 'clock' && 'clockTabButton--active')}
              whileTap={reduceMotion ? undefined : { scale: 0.98 }}
              onClick={() => setTab('clock')}
            >
              {tab === 'clock' && <motion.div layoutId="clockTabActiveBg" className="clockTabActiveBg" />}
              <span className="clockTabLabel">时钟</span>
            </motion.button>
            <motion.button
              type="button"
              role="tab"
              aria-selected={tab === 'timer'}
              className={cn('clockTabButton', tab === 'timer' && 'clockTabButton--active')}
              whileTap={reduceMotion ? undefined : { scale: 0.98 }}
              onClick={() => setTab('timer')}
            >
              {tab === 'timer' && <motion.div layoutId="clockTabActiveBg" className="clockTabActiveBg" />}
              <span className="clockTabLabel">计时器</span>
            </motion.button>
            <motion.button
              type="button"
              role="tab"
              aria-selected={tab === 'countdown'}
              className={cn('clockTabButton', tab === 'countdown' && 'clockTabButton--active')}
              whileTap={reduceMotion ? undefined : { scale: 0.98 }}
              onClick={() => setTab('countdown')}
            >
              {tab === 'countdown' && <motion.div layoutId="clockTabActiveBg" className="clockTabActiveBg" />}
              <span className="clockTabLabel">倒计时</span>
            </motion.button>
          </div>
        </LayoutGroup>
      </div>
    </motion.div>
  )
}
