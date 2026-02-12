import React, { useEffect, useMemo, useRef } from 'react'
import {
  ACTIVE_APP_UI_STATE_KEY,
  APP_MODE_UI_STATE_KEY,
  NOTES_PAGE_INDEX_UI_STATE_KEY,
  NOTES_PAGE_TOTAL_UI_STATE_KEY,
  PPT_FULLSCREEN_UI_STATE_KEY,
  PPT_PAGE_INDEX_UI_STATE_KEY,
  PPT_PAGE_TOTAL_UI_STATE_KEY,
  UI_STATE_APP_WINDOW_ID,
  isActiveApp,
  isAppMode,
  postCommand,
  useUiStateBus
} from '../status'
import { Button } from '../button'
import { useZoomOnWheel } from '../toolbar/hooks/useZoomOnWheel'
import '../toolbar/styles/toolbar.css'
import exitIconSvgRaw from '../../iconpack/flent_icon/fluent--arrow-exit-20-regular.svg?raw'

function AddIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <path fill="currentColor" d="M10 3.5a.5.5 0 0 1 .5.5v5.5H16a.5.5 0 0 1 0 1h-5.5V16a.5.5 0 0 1-1 0v-5.5H4a.5.5 0 0 1 0-1h5.5V4a.5.5 0 0 1 .5-.5" />
    </svg>
  )
}

export function MultiPageControlWindow() {
  useZoomOnWheel()
  const bus = useUiStateBus(UI_STATE_APP_WINDOW_ID)
  const contentRef = useRef<HTMLDivElement | null>(null)

  const activeAppRaw = bus.state[ACTIVE_APP_UI_STATE_KEY]
  const activeApp = isActiveApp(activeAppRaw) ? activeAppRaw : 'unknown'
  const pptFullscreen = bus.state[PPT_FULLSCREEN_UI_STATE_KEY] === true
  const isPpt = activeApp === 'ppt' && pptFullscreen

  const pageIndexRaw = isPpt ? bus.state[PPT_PAGE_INDEX_UI_STATE_KEY] : bus.state[NOTES_PAGE_INDEX_UI_STATE_KEY]
  const pageTotalRaw = isPpt ? bus.state[PPT_PAGE_TOTAL_UI_STATE_KEY] : bus.state[NOTES_PAGE_TOTAL_UI_STATE_KEY]
  const appModeRaw = bus.state[APP_MODE_UI_STATE_KEY]
  const appMode = isAppMode(appModeRaw) ? appModeRaw : 'toolbar'

  const { index, total } = useMemo(() => {
    const totalV = typeof pageTotalRaw === 'number' ? pageTotalRaw : typeof pageTotalRaw === 'string' ? Number(pageTotalRaw) : NaN
    const indexV = typeof pageIndexRaw === 'number' ? pageIndexRaw : typeof pageIndexRaw === 'string' ? Number(pageIndexRaw) : NaN
    const t = Number.isFinite(totalV) ? Math.floor(totalV) : -1
    const i = Number.isFinite(indexV) ? Math.floor(indexV) : -1
    if (t < 1 || i < 0) return { index: -1, total: -1 }
    return { index: Math.max(0, Math.min(t - 1, i)), total: t }
  }, [pageIndexRaw, pageTotalRaw, isPpt])

  const outerPadding = 10
  const gap = 10
  const pageLabel = useMemo(() => {
    if (isPpt) return index >= 0 && total >= 1 ? `${index + 1}/${total}` : '--/--'
    if (appMode !== 'video-show') return `${index + 1}/${total}`
    if (index <= 0) return 'Live'
    const photoTotal = Math.max(0, total - 1)
    return `${index}/${Math.max(1, photoTotal)}`
  }, [activeApp, appMode, index, total, isPpt])

  useEffect(() => {
    const root = contentRef.current
    if (!root) return
    if (typeof ResizeObserver === 'undefined') return

    let lastWidth = 0
    let lastHeight = 0
    let rafId = 0

    const clampInt = (value: number, min: number, max: number) => {
      const v = Math.round(value)
      return Math.max(min, Math.min(max, v))
    }

    const send = () => {
      rafId = 0
      const rect = root.getBoundingClientRect()
      const width = clampInt(rect.width, 120, 1200)
      const height = clampInt(rect.height, 40, 400)
      if (width === lastWidth && height === lastHeight) return
      lastWidth = width
      lastHeight = height
      postCommand('set-mut-page-bounds', { width, height }).catch(() => undefined)
    }

    const schedule = () => {
      if (rafId) return
      rafId = window.requestAnimationFrame(send)
    }

    const mo =
      typeof MutationObserver === 'undefined'
        ? undefined
        : new MutationObserver(() => {
            schedule()
          })
    mo?.observe(root, { subtree: true, childList: true, attributes: true, characterData: true })

    const ro = new ResizeObserver(schedule)
    ro.observe(root)
    schedule()

    return () => {
      ro.disconnect()
      mo?.disconnect()
      if (rafId) window.cancelAnimationFrame(rafId)
    }
  }, [])

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: 0,
        boxSizing: 'border-box',
        background: 'transparent'
      }}
    >
      <div className="toolbarRoot" style={{ width: 'auto', height: 'auto' }}>
        <div ref={contentRef} className="toolbarDragArea" style={{ padding: outerPadding }}>
          <div className="toolbarLayout" style={{ gap }}>
            <div className="toolbarBarRow" style={{ display: 'inline-flex', alignItems: 'center', gap }}>
              <Button
                size="sm"
                kind="icon"
                ariaLabel="上一页"
                title="上一页"
                onClick={() => postCommand('app.prevPage', {}).catch(() => undefined)}
                style={{ fontSize: 18, lineHeight: 1 }}
              >
                ‹
              </Button>

              <Button
                size="sm"
                kind="text"
                ariaLabel="页面缩略图查看菜单"
                title="页面缩略图查看菜单"
                disabled={activeApp === 'ppt' || index < 0 || total < 1}
                onClick={() => postCommand('app.togglePageThumbnailsMenu', {}).catch(() => undefined)}
                style={{
                  height: 40,
                  minWidth: 86,
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums'
                }}
              >
                {pageLabel}
              </Button>

              <Button
                size="sm"
                kind="icon"
                ariaLabel="下一页"
                title="下一页"
                onClick={() => postCommand('app.nextPage', {}).catch(() => undefined)}
                style={{ fontSize: 18, lineHeight: 1 }}
              >
                ›
              </Button>
            </div>

            <div className="toolbarBarRow" style={{ display: 'inline-flex', alignItems: 'center' }}>
            {activeApp === 'ppt' ? (
              isPpt ? (
              <Button
                size="sm"
                kind="icon"
                ariaLabel="结束放映"
                title="结束放映"
                onClick={() => postCommand('app.endPptSlideShow', {}).catch(() => undefined)}
              >
                <span style={{ width: 20, height: 20, display: 'inline-flex', lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: exitIconSvgRaw }} />
              </Button>
              ) : null
            ) : (
              <Button
                size="sm"
                kind="icon"
                ariaLabel={appMode === 'video-show' ? '拍摄按钮' : '新建页面'}
                title={appMode === 'video-show' ? '拍摄按钮' : '新建页面'}
                onClick={() => postCommand('app.newPage', {}).catch(() => undefined)}
              >
                <AddIcon />
              </Button>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
