import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { Button, ButtonGroup } from '../button'
import { motion, useReducedMotion } from '../Framer_Motion'
import { useHyperGlassRealtimeBlur } from '../hyper_glass'
import { TOOLBAR_STATE_KEY, useAppMode } from '../status'
import { usePersistedState } from './hooks/usePersistedState'
import { markQuitting, postCommand } from './hooks/useBackend'
import { useToolbarWindowAutoResize } from './hooks/useToolbarWindowAutoResize'
import './styles/toolbar.css'

type ToolbarState = {
  collapsed: boolean
  alwaysOnTop: boolean
  uiWidth?: number
  uiButtonSize?: 'sm' | 'md'
  tool?: 'mouse' | 'pen' | 'eraser'
}

function isToolbarState(value: unknown): value is ToolbarState {
  if (!value || typeof value !== 'object') return false
  const v = value as any
  const okBase = typeof v.collapsed === 'boolean' && typeof v.alwaysOnTop === 'boolean'
  if (!okBase) return false
  if (v.uiWidth !== undefined && typeof v.uiWidth !== 'number') return false
  if (v.uiButtonSize !== undefined && v.uiButtonSize !== 'sm' && v.uiButtonSize !== 'md') return false
  if (v.tool !== undefined && v.tool !== 'mouse' && v.tool !== 'pen' && v.tool !== 'eraser') return false
  return true
}

type ToolbarContextValue = {
  state: ToolbarState
  setState: (next: ToolbarState) => void
}

const ToolbarContext = createContext<ToolbarContextValue | null>(null)

function useToolbar() {
  const ctx = useContext(ToolbarContext)
  if (!ctx) throw new Error('ToolbarProviderMissing')
  return ctx
}

function ToolbarProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = usePersistedState<ToolbarState>(TOOLBAR_STATE_KEY, {
    collapsed: false,
    alwaysOnTop: true,
    uiWidth: 360,
    uiButtonSize: 'sm'
  }, { validate: isToolbarState })

  useEffect(() => {
    const normalized: ToolbarState = {
      collapsed: Boolean(state.collapsed),
      alwaysOnTop: Boolean(state.alwaysOnTop),
      uiWidth: typeof state.uiWidth === 'number' ? state.uiWidth : 360,
      uiButtonSize: state.uiButtonSize === 'md' ? 'md' : 'sm',
      tool: state.tool === 'pen' ? 'pen' : state.tool === 'eraser' ? 'eraser' : 'mouse'
    }
    if (
      normalized.collapsed !== state.collapsed ||
      normalized.alwaysOnTop !== state.alwaysOnTop ||
      normalized.uiWidth !== state.uiWidth ||
      normalized.uiButtonSize !== state.uiButtonSize ||
      normalized.tool !== state.tool
    ) {
      setState(normalized)
    }
  }, [setState, state])

  const value = useMemo<ToolbarContextValue>(() => ({ state, setState }), [state, setState])
  return <ToolbarContext.Provider value={value}>{children}</ToolbarContext.Provider>
}

function FloatingToolbarInner() {
  const { state, setState } = useToolbar()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const uiButtonSize: 'sm' = 'sm'
  const reduceMotion = useReducedMotion()
  const tool: 'mouse' | 'pen' | 'eraser' = state.tool === 'pen' ? 'pen' : state.tool === 'eraser' ? 'eraser' : 'mouse'
  const { appMode, setAppMode } = useAppMode()
  const whiteboardActive = appMode === 'whiteboard'

  useToolbarWindowAutoResize({ root: contentRef.current })
  useHyperGlassRealtimeBlur({ root: rootRef.current })

  return (
    <motion.div
      ref={rootRef}
      className="toolbarRoot"
      initial={reduceMotion ? false : { opacity: 0, y: 6, scale: 0.985 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? undefined : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div ref={contentRef} className="toolbarDragArea">
        <div className="toolbarLayout">
          <div className="toolbarBarRow">
            <ButtonGroup>
          <Button
            size={uiButtonSize}
            variant={tool === 'mouse' ? 'light' : 'default'}
            onClick={() => {
              setState({ ...state, tool: 'mouse' })
              void postCommand('app.setTool', { tool: 'mouse' })
            }}
          >
            鼠标
          </Button>

          <Button
            size={uiButtonSize}
            variant={tool === 'pen' ? 'light' : 'default'}
            onClick={() => {
              setState({ ...state, tool: 'pen' })
              void postCommand('app.setTool', { tool: 'pen' })
            }}
          >
            笔
          </Button>

          <Button
            size={uiButtonSize}
            variant={tool === 'eraser' ? 'light' : 'default'}
            onClick={() => {
              setState({ ...state, tool: 'eraser' })
              void postCommand('app.setTool', { tool: 'eraser' })
            }}
          >
            橡皮
          </Button>

          <Button
            size={uiButtonSize}
            variant={whiteboardActive ? 'light' : 'default'}
            onClick={() => {
              setAppMode(whiteboardActive ? 'toolbar' : 'whiteboard')
            }}
          >
            白板
          </Button>

          <Button
            size={uiButtonSize}
            onClick={() => {
              void postCommand('create-window')
            }}
          >
            新建窗口
          </Button>

          <Button
            size={uiButtonSize}
            onClick={() => {
              void postCommand('toggle-subwindow', { kind: 'events', placement: 'bottom' })
            }}
          >
            事件
          </Button>

          <Button
            size={uiButtonSize}
            onClick={() => {
              void postCommand('toggle-subwindow', { kind: 'watcher', placement: 'bottom' })
            }}
          >
            监视
          </Button>

          <Button
            size={uiButtonSize}
            onClick={() => {
              void postCommand('toggle-subwindow', { kind: 'settings', placement: 'top' })
            }}
          >
            设置
          </Button>

          <Button
            size={uiButtonSize}
            variant={state.alwaysOnTop ? 'light' : 'default'}
            title="切换是否始终置顶（由主进程执行）"
            onClick={() => {
              const next = !state.alwaysOnTop
              setState({ ...state, alwaysOnTop: next })
              void postCommand('set-toolbar-always-on-top', { value: next })
            }}
          >
            置顶
          </Button>

          <Button
            size={uiButtonSize}
            variant="danger"
            onClick={() => {
              markQuitting()
              void postCommand('quit')
            }}
          >
            退出
          </Button>
          </ButtonGroup>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export function FloatingToolbarApp() {
  return (
    <ToolbarProvider>
      <FloatingToolbarInner />
    </ToolbarProvider>
  )
}

export function FloatingToolbarHandleApp() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion()

  useHyperGlassRealtimeBlur({ root: rootRef.current })

  return (
    <motion.div
      ref={rootRef}
      className="toolbarRoot toolbarHandleRoot"
      initial={reduceMotion ? false : { opacity: 0, y: 6, scale: 0.985 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? undefined : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="toolbarHandleContent">
        <Button appRegion="drag" className="toolbarDragHandleButton" title="拖动">
          {''}
        </Button>
      </div>
    </motion.div>
  )
}
