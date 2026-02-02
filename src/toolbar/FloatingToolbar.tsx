import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Button, ButtonGroup } from '../button'
import { motion, useReducedMotion } from '../Framer_Motion'
import { useHyperGlassRealtimeBlur } from '../hyper_glass'
import { TOOLBAR_STATE_KEY, useAppMode } from '../status'
import { usePersistedState } from './hooks/usePersistedState'
import { markQuitting, postCommand } from './hooks/useBackend'
import { useToolbarWindowAutoResize } from './hooks/useToolbarWindowAutoResize'
import './styles/toolbar.css'

function ToolbarToolIcon(props: { kind: 'mouse' | 'pen' | 'eraser' | 'whiteboard' }) {
  const d =
    props.kind === 'mouse'
      ? 'M5 3.059a1 1 0 0 1 1.636-.772l11.006 9.062c.724.596.302 1.772-.636 1.772h-5.592a1.5 1.5 0 0 0-1.134.518l-3.524 4.073c-.606.7-1.756.271-1.756-.655zm12.006 9.062L6 3.059v13.998l3.524-4.072a2.5 2.5 0 0 1 1.89-.864z'
      : props.kind === 'pen'
        ? 'M17.18 2.926a2.975 2.975 0 0 0-4.26-.054l-9.375 9.375a2.44 2.44 0 0 0-.655 1.194l-.878 3.95a.5.5 0 0 0 .597.597l3.926-.873a2.5 2.5 0 0 0 1.234-.678l7.98-7.98l.337.336a1 1 0 0 1 0 1.414l-.94.94a.5.5 0 0 0 .708.706l.939-.94a2 2 0 0 0 0-2.828l-.336-.336l.67-.67a2.975 2.975 0 0 0 .052-4.153m-3.553.653a1.975 1.975 0 0 1 2.793 2.793L7.062 15.73a1.5 1.5 0 0 1-.744.409l-3.16.702l.708-3.183a1.43 1.43 0 0 1 .387-.704z'
        : props.kind === 'eraser'
          ? 'M2.44 11.2a1.5 1.5 0 0 0 0 2.122l4.242 4.242a1.5 1.5 0 0 0 2.121 0l.72-.72a5.5 5.5 0 0 1-.369-1.045l-1.058 1.058a.5.5 0 0 1-.707 0l-4.243-4.242a.5.5 0 0 1 0-.707l1.69-1.69l4.165 4.164q.015-.645.17-1.245L5.543 9.51l6.364-6.364a.5.5 0 0 1 .707 0l4.242 4.243a.5.5 0 0 1 0 .707L15.8 9.154a5.5 5.5 0 0 1 1.045.37l.72-.72a1.5 1.5 0 0 0 0-2.122l-4.242-4.243a1.5 1.5 0 0 0-2.122 0zM14.5 19a4.5 4.5 0 1 0 0-9a4.5 4.5 0 0 0 0 9'
          : 'm17.331 3.461l.11.102l.102.11a1.93 1.93 0 0 1-.103 2.606l-3.603 3.617a1.9 1.9 0 0 1-.794.477l-1.96.591a.84.84 0 0 1-1.047-.567a.85.85 0 0 1 .005-.503l.621-1.942c.093-.289.252-.55.465-.765l3.612-3.625a1.904 1.904 0 0 1 2.592-.1m-1.884.806l-3.611 3.626a.9.9 0 0 0-.221.363l-.533 1.664l1.672-.505c.14-.042.27-.12.374-.224l3.603-3.617a.93.93 0 0 0 .06-1.24l-.06-.065l-.064-.06a.904.904 0 0 0-1.22.058M12.891 4H5a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7.134l-1 1.004V13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9.23c.573-.486 1.34-1.11 2.074-1.535c.41-.237.772-.39 1.062-.439c.281-.048.423.01.51.098a.33.33 0 0 1 .106.185a.6.6 0 0 1-.04.276c-.093.276-.31.602-.602 1.01l-.094.132c-.252.35-.538.747-.736 1.144c-.225.447-.392.995-.204 1.557c.17.508.498.845.926 1.011c.402.156.844.144 1.236.073c.785-.14 1.584-.552 2.02-.813a.5.5 0 0 0-.515-.858c-.399.24-1.075.578-1.681.687c-.303.054-.537.042-.698-.021c-.136-.053-.26-.153-.34-.395c-.062-.188-.03-.435.15-.793c.16-.32.396-.649.656-1.01l.093-.131c.276-.386.587-.832.737-1.273c.077-.229.122-.486.08-.753a1.32 1.32 0 0 0-.386-.736c-.397-.396-.914-.456-1.386-.376c-.462.079-.945.3-1.394.559c-.546.315-1.096.722-1.574 1.104V7a2 2 0 0 1 2-2h6.895z'

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <path fill="currentColor" d={d} />
    </svg>
  )
}

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
            ariaLabel="鼠标"
            title="鼠标"
            onClick={() => {
              setState({ ...state, tool: 'mouse' })
              void postCommand('app.setTool', { tool: 'mouse' })
            }}
          >
            <ToolbarToolIcon kind="mouse" />
          </Button>

          <Button
            size={uiButtonSize}
            variant={tool === 'pen' ? 'light' : 'default'}
            ariaLabel="笔"
            title="笔"
            onClick={() => {
              setState({ ...state, tool: 'pen' })
              void postCommand('app.setTool', { tool: 'pen' })
            }}
          >
            <ToolbarToolIcon kind="pen" />
          </Button>

          <Button
            size={uiButtonSize}
            variant={tool === 'eraser' ? 'light' : 'default'}
            ariaLabel="橡皮"
            title="橡皮"
            onClick={() => {
              setState({ ...state, tool: 'eraser' })
              void postCommand('app.setTool', { tool: 'eraser' })
            }}
          >
            <ToolbarToolIcon kind="eraser" />
          </Button>

          <Button
            size={uiButtonSize}
            variant={whiteboardActive ? 'light' : 'default'}
            ariaLabel="白板"
            title="白板"
            onClick={() => {
              setAppMode(whiteboardActive ? 'toolbar' : 'whiteboard')
            }}
          >
            <ToolbarToolIcon kind="whiteboard" />
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
              void postCommand('toggle-subwindow', { kind: 'feature-panel', placement: 'bottom' })
            }}
          >
            功能面板
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
              void postCommand('watcher.openWindow')
            }}
          >
            监视器
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
  const [dragging, setDragging] = useState(false)

  useHyperGlassRealtimeBlur({ root: rootRef.current })

  useEffect(() => {
    if (!dragging) return
    const reset = () => setDragging(false)
    window.addEventListener('pointerup', reset, { passive: true })
    window.addEventListener('pointercancel', reset, { passive: true })
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('pointerup', reset)
      window.removeEventListener('pointercancel', reset)
      window.removeEventListener('blur', reset)
    }
  }, [dragging])

  return (
    <motion.div
      ref={rootRef}
      className="toolbarRoot toolbarHandleRoot"
      initial={reduceMotion ? false : { opacity: 0, y: 6, scale: 0.985 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? undefined : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="toolbarHandleContent">
        <Button
          appRegion="drag"
          className={dragging ? 'toolbarDragHandleButton toolbarDragHandleButton--dragging' : 'toolbarDragHandleButton'}
          title="浮动工具栏拖动把手"
          onPointerDown={() => setDragging(true)}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onPointerLeave={() => setDragging(false)}
        >
          <svg
            className="toolbarDragHandleIcon"
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 20 20"
          >
            <path
              fill="currentColor"
              d={
                dragging
                  ? 'M7.75 17.25a.75.75 0 0 0 1.5 0V2.75a.75.75 0 0 0-1.5 0zm3 0a.75.75 0 0 0 1.5 0V2.75a.75.75 0 0 0-1.5 0z'
                  : 'M8 17.5a.5.5 0 0 0 1 0v-15a.5.5 0 0 0-1 0zm3 0a.5.5 0 0 0 1 0v-15a.5.5 0 0 0-1 0z'
              }
            />
          </svg>
        </Button>
      </div>
    </motion.div>
  )
}
