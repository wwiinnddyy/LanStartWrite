import React, { useEffect, useMemo, useRef } from 'react'
import {
  APP_MODE_UI_STATE_KEY,
  NOTES_PAGE_INDEX_UI_STATE_KEY,
  NOTES_PAGE_TOTAL_UI_STATE_KEY,
  UI_STATE_APP_WINDOW_ID,
  isAppMode,
  postCommand,
  useUiStateBus
} from '../status'
import { Button } from '../button'
import { useAppearanceSettings } from '../settings'
import { useZoomOnWheel } from '../toolbar/hooks/useZoomOnWheel'
import '../toolbar/styles/toolbar.css'

function AddIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <path fill="currentColor" d="M10 3.5a.5.5 0 0 1 .5.5v5.5H16a.5.5 0 0 1 0 1h-5.5V16a.5.5 0 0 1-1 0v-5.5H4a.5.5 0 0 1 0-1h5.5V4a.5.5 0 0 1 .5-.5" />
    </svg>
  )
}

function CaptureIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <path
        fill="currentColor"
        d="M10 4.25a5.75 5.75 0 1 0 0 11.5a5.75 5.75 0 0 0 0-11.5m0 1.5a4.25 4.25 0 1 1 0 8.5a4.25 4.25 0 0 1 0-8.5"
      />
    </svg>
  )
}

function PrevPageIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M12.5 4.75L7 10l5.5 5.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function NextPageIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M7.5 4.75L13 10l-5.5 5.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function MultiPageControlWindow() {
  useZoomOnWheel()
  const bus = useUiStateBus(UI_STATE_APP_WINDOW_ID)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const { toolbarButtonHintsEnabled } = useAppearanceSettings()

  const pageIndexRaw = bus.state[NOTES_PAGE_INDEX_UI_STATE_KEY]
  const pageTotalRaw = bus.state[NOTES_PAGE_TOTAL_UI_STATE_KEY]
  const appModeRaw = bus.state[APP_MODE_UI_STATE_KEY]
  const appMode = isAppMode(appModeRaw) ? appModeRaw : 'toolbar'

  const { index, total } = useMemo(() => {
    const totalV = typeof pageTotalRaw === 'number' ? pageTotalRaw : typeof pageTotalRaw === 'string' ? Number(pageTotalRaw) : NaN
    const indexV = typeof pageIndexRaw === 'number' ? pageIndexRaw : typeof pageIndexRaw === 'string' ? Number(pageIndexRaw) : NaN
    const t = Number.isFinite(totalV) ? Math.floor(totalV) : -1
    const i = Number.isFinite(indexV) ? Math.floor(indexV) : -1
    if (t < 1 || i < 0) return { index: -1, total: -1 }
    return { index: Math.max(0, Math.min(t - 1, i)), total: t }
  }, [pageIndexRaw, pageTotalRaw])

  const outerPadding = 10
  const gap = 10
  const buttonHeight = toolbarButtonHintsEnabled ? 54 : 40

  const withButtonHint = (icon: React.ReactNode, label: string) => {
    if (!toolbarButtonHintsEnabled) return icon
    return (
      <span className="toolbarButtonStack">
        <span className="toolbarButtonIcon">{icon}</span>
        <span className="toolbarButtonHint">{label}</span>
      </span>
    )
  }

  const pageLabel = useMemo(() => {
    if (appMode !== 'video-show') return `${index + 1}/${total}`
    if (index <= 0) return 'Live'
    const photoTotal = Math.max(0, total - 1)
    return `${index}/${Math.max(1, photoTotal)}`
  }, [appMode, index, total])

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
      <div
        className="toolbarRoot"
        data-toolbar-button-hints={toolbarButtonHintsEnabled ? 'true' : undefined}
        style={{ width: 'auto', height: 'auto' }}
      >
        <div ref={contentRef} className="toolbarDragArea" style={{ padding: outerPadding }}>
          <div className="toolbarLayout" style={{ gap }}>
            <div className="toolbarBarRow" style={{ display: 'inline-flex', alignItems: 'center', gap }}>
              <Button
                size="sm"
                kind="icon"
                ariaLabel="上一页"
                title="上一页"
                onClick={() => postCommand('app.prevPage', {}).catch(() => undefined)}
              >
                {withButtonHint(<PrevPageIcon />, '上一页')}
              </Button>

              <Button
                size="sm"
                kind="text"
                ariaLabel="页面缩略图查看菜单"
                title="页面缩略图查看菜单"
                disabled={index < 0 || total < 1}
                onClick={() => postCommand('app.togglePageThumbnailsMenu', {}).catch(() => undefined)}
                style={{
                  height: buttonHeight,
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
              >
                {withButtonHint(<NextPageIcon />, '下一页')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function MultiPageControlHandleWindow() {
  useZoomOnWheel()
  const bus = useUiStateBus(UI_STATE_APP_WINDOW_ID)
  const { toolbarButtonHintsEnabled } = useAppearanceSettings()
  const appModeRaw = bus.state[APP_MODE_UI_STATE_KEY]
  const appMode = isAppMode(appModeRaw) ? appModeRaw : 'toolbar'

  const withButtonHint = (icon: React.ReactNode, label: string) => {
    if (!toolbarButtonHintsEnabled) return icon
    return (
      <span className="toolbarButtonStack">
        <span className="toolbarButtonIcon">{icon}</span>
        <span className="toolbarButtonHint">{label}</span>
      </span>
    )
  }

  const action = useMemo(() => {
    if (appMode === 'video-show') {
      return {
        visible: true as const,
        ariaLabel: '拍摄按钮',
        title: '拍摄按钮',
        onClick: () => postCommand('app.newPage', {}).catch(() => undefined),
        icon: <CaptureIcon />
      }
    }
    return {
      visible: true as const,
      ariaLabel: '新建页面',
      title: '新建页面',
      onClick: () => postCommand('app.newPage', {}).catch(() => undefined),
      icon: <AddIcon />
    }
  }, [appMode])

  return (
    <div className="toolbarRoot" data-toolbar-button-hints={toolbarButtonHintsEnabled ? 'true' : undefined}>
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 10, boxSizing: 'border-box' }}>
        {action.visible ? (
          <Button
            size="sm"
            kind="icon"
            ariaLabel={action.ariaLabel}
            title={action.title}
            onClick={action.onClick}
          >
            {withButtonHint(
              action.icon,
              action.ariaLabel === '拍摄按钮'
                ? '拍摄'
                : action.ariaLabel === '新建页面'
                  ? '新建'
                  : action.ariaLabel
            )}
          </Button>
        ) : (
          <div style={{ width: 40, height: toolbarButtonHintsEnabled ? 54 : 40 }} />
        )}
      </div>
    </div>
  )
}
