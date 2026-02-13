import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from '../Framer_Motion'
import { postCommand } from '../toolbar/hooks/useBackend'
import { useZoomOnWheel } from '../toolbar/hooks/useZoomOnWheel'
import './styles/subwindow.css'

const CLOCK_MENU_BOUNDS = { width: 380, height: 280 } as const

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
          {tab === 'clock' ? (
            <div className="clockPrimaryText">{clockText}</div>
          ) : tab === 'timer' ? (
            <>
              <div className="clockPrimaryText">{formatDuration(timerDisplayMs)}</div>
              <div className="clockControls">
                <button
                  type="button"
                  className="clockControlButton"
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
                  {timerRunning ? '暂停' : timerElapsedMs > 0 ? '继续' : '开始'}
                </button>
                <button
                  type="button"
                  className="clockControlButton"
                  onClick={() => {
                    setTimerRunning(false)
                    setTimerStartMs(null)
                    setTimerElapsedMs(0)
                  }}
                >
                  归零
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="clockPrimaryText">{formatDuration(countdownDisplayMs)}</div>
              <div className="clockSecondaryText">{countdownRunning ? '进行中' : '未开始'}</div>
              <div className="clockControls">
                <button
                  type="button"
                  className="clockControlButton"
                  onClick={() => {
                    if (countdownRunning) {
                      if (countdownEndMs) setCountdownRemainingMs(Math.max(0, countdownEndMs - nowMs))
                      setCountdownEndMs(null)
                      setCountdownRunning(false)
                      return
                    }
                    if (countdownRemainingMs <= 0) return
                    setCountdownEndMs(nowMs + countdownRemainingMs)
                    setCountdownRunning(true)
                  }}
                >
                  {countdownRunning ? '暂停' : countdownRemainingMs > 0 && countdownRemainingMs !== 5 * 60 * 1000 ? '开始' : '开始'}
                </button>
                <button
                  type="button"
                  className="clockControlButton"
                  onClick={() => {
                    setCountdownRunning(false)
                    setCountdownEndMs(null)
                    setCountdownRemainingMs(5 * 60 * 1000)
                  }}
                >
                  重置 5:00
                </button>
                <button
                  type="button"
                  className="clockControlButton"
                  onClick={() => {
                    if (countdownRunning) return
                    setCountdownRemainingMs((v) => Math.min(99 * 60 * 60 * 1000, v + 60 * 1000))
                  }}
                >
                  +1分
                </button>
                <button
                  type="button"
                  className="clockControlButton"
                  onClick={() => {
                    if (countdownRunning) return
                    setCountdownRemainingMs((v) => Math.max(0, v - 60 * 1000))
                  }}
                >
                  -1分
                </button>
              </div>
            </>
          )}
        </div>

        <div className="clockTabsBar" role="tablist" aria-label="时钟菜单">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'clock'}
            className={`clockTabButton${tab === 'clock' ? ' clockTabButton--active' : ''}`}
            onClick={() => setTab('clock')}
          >
            时钟
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'timer'}
            className={`clockTabButton${tab === 'timer' ? ' clockTabButton--active' : ''}`}
            onClick={() => setTab('timer')}
          >
            计时器
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'countdown'}
            className={`clockTabButton${tab === 'countdown' ? ' clockTabButton--active' : ''}`}
            onClick={() => setTab('countdown')}
          >
            倒计时
          </button>
        </div>
      </div>
    </motion.div>
  )
}
