import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Button, ButtonGroup } from '../button'
import { motion, useReducedMotion } from '../Framer_Motion'
import {
  ERASER_SETTINGS_KV_KEY,
  PEN_SETTINGS_KV_KEY,
  TOOLBAR_STATE_KEY,
  TOOLBAR_STATE_UI_STATE_KEY,
  UI_STATE_APP_WINDOW_ID,
  getKv,
  isEraserSettings,
  isPenSettings,
  useAppMode,
  useUiStateBus
} from '../status'
import { usePersistedState } from './hooks/usePersistedState'
import { postCommand } from './hooks/useBackend'
import { useEventsPoll } from './hooks/useEventsPoll'
import { useToolbarWindowAutoResize } from './hooks/useToolbarWindowAutoResize'
import { useZoomOnWheel } from './hooks/useZoomOnWheel'
import { useAppearanceSettings } from '../settings'
import { getAppButtonVisibility } from './utils/constants'
import { WatcherIcon } from './components/ToolbarIcons'
import './styles/toolbar.css'

function ToolbarToolIcon(props: { kind: 'mouse' | 'pen' | 'eraser' | 'whiteboard' | 'video-show' }) {
  const d =
    props.kind === 'mouse'
      ? 'M5 3.059a1 1 0 0 1 1.636-.772l11.006 9.062c.724.596.302 1.772-.636 1.772h-5.592a1.5 1.5 0 0 0-1.134.518l-3.524 4.073c-.606.7-1.756.271-1.756-.655zm12.006 9.062L6 3.059v13.998l3.524-4.072a2.5 2.5 0 0 1 1.89-.864z'
      : props.kind === 'pen'
        ? 'M17.18 2.926a2.975 2.975 0 0 0-4.26-.054l-9.375 9.375a2.44 2.44 0 0 0-.655 1.194l-.878 3.95a.5.5 0 0 0 .597.597l3.926-.873a2.5 2.5 0 0 0 1.234-.678l7.98-7.98l.337.336a1 1 0 0 1 0 1.414l-.94.94a.5.5 0 0 0 .708.706l.939-.94a2 2 0 0 0 0-2.828l-.336-.336l.67-.67a2.975 2.975 0 0 0 .052-4.153m-3.553.653a1.975 1.975 0 0 1 2.793 2.793L7.062 15.73a1.5 1.5 0 0 1-.744.409l-3.16.702l.708-3.183a1.43 1.43 0 0 1 .387-.704z'
        : props.kind === 'eraser'
          ? 'M2.44 11.2a1.5 1.5 0 0 0 0 2.122l4.242 4.242a1.5 1.5 0 0 0 2.121 0l.72-.72a5.5 5.5 0 0 1-.369-1.045l-1.058 1.058a.5.5 0 0 1-.707 0l-4.243-4.242a.5.5 0 0 1 0-.707l1.69-1.69l4.165 4.164q.015-.645.17-1.245L5.543 9.51l6.364-6.364a.5.5 0 0 1 .707 0l4.242 4.243a.5.5 0 0 1 0 .707L15.8 9.154a5.5 5.5 0 0 1 1.045.37l.72-.72a1.5 1.5 0 0 0 0-2.122l-4.242-4.243a1.5 1.5 0 0 0-2.122 0zM14.5 19a4.5 4.5 0 1 0 0-9a4.5 4.5 0 0 0 0 9'
          : props.kind === 'whiteboard'
            ? 'm17.331 3.461l.11.102l.102.11a1.93 1.93 0 0 1-.103 2.606l-3.603 3.617a1.9 1.9 0 0 1-.794.477l-1.96.591a.84.84 0 0 1-1.047-.567a.85.85 0 0 1 .005-.503l.621-1.942c.093-.289.252-.55.465-.765l3.612-3.625a1.904 1.904 0 0 1 2.592-.1m-1.884.806l-3.611 3.626a.9.9 0 0 0-.221.363l-.533 1.664l1.672-.505c.14-.042.27-.12.374-.224l3.603-3.617a.93 1 0 0 0 .06-1.24l-.06-.065l-.064-.06a.904.904 0 0 0-1.22.058M12.891 4H5a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7.134l-1 1.004V13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9.23c.573-.486 1.34-1.11 2.074-1.535c.41-.237.772-.39 1.062-.439c.281-.048.423.01.51.098a.33.33 0 0 1 .106.185a.6.6 0 0 1-.04.276c-.093.276-.31.602-.602 1.01l-.094.132c-.252.35-.538.747-.736 1.144c-.225.447-.392.995-.204 1.557c.17.508.498.845.926 1.011c.402.156.844.144 1.236.073c.785-.14 1.584-.552 2.02-.813a.5.5 0 0 0-.515-.858c-.399.24-1.075.578-1.681.687c-.303.054-.537.042-.698-.021c-.136-.053-.26-.153-.34-.395c-.062-.188-.03-.435.15-.793c.16-.32.396-.649.656-1.01l.093-.131c.276-.386.587-.832.737-1.273c.077-.229.122-.486.08-.753a1.32 1.32 0 0 0-.386-.736c-.397-.396-.914-.456-1.386-.376c-.462.079-.945.3-1.394.559c-.546.315-1.096.722-1.574 1.104V7a2 2 0 0 1 2-2h6.895z'
            : 'M5 4a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h5a3 3 0 0 0 3-3v-.321l3.037 2.097a1.25 1.25 0 0 0 1.96-1.029V6.252a1.25 1.25 0 0 0-1.96-1.028L13 7.32V7a3 3 0 0 0-3-3zm8 4.536l3.605-2.49a.25.25 0 0 1 .392.206v7.495a.25.25 0 0 1-.392.206L13 11.463zM3 7a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <path fill="currentColor" d={d} />
    </svg>
  )
}

function UndoIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  )
}

function RedoIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
    </svg>
  )
}

function EventsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 13a4 4 0 0 1 8 0" />
      <path d="M12 21a8 8 0 1 1 8-8" />
      <path d="M20 21l-2.5-2.5" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20">
      <path
        fill="currentColor"
        d="M10 2a8 8 0 1 1 0 16a8 8 0 0 1 0-16m0 1a7 7 0 1 0 0 14a7 7 0 0 0 0-14m-.5 2a.5.5 0 0 1 .492.41L10 5.5V10h2.5a.5.5 0 0 1 .09.992L12.5 11h-3a.5.5 0 0 1-.492-.41L9 10.5v-5a.5.5 0 0 1 .5-.5"
      />
    </svg>
  )
}

function ChevronLeftIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

type ToolbarState = {
  collapsed: boolean
  uiWidth?: number
  uiButtonSize?: 'sm' | 'md'
  tool?: 'mouse' | 'pen' | 'eraser'
  expanded?: boolean
  allowedPrimaryButtons?: PrimaryButtonId[]
  allowedSecondaryButtons?: SecondaryButtonId[]
  primaryButtonsOrder?: PrimaryButtonId[]
  pinnedSecondaryButtonsOrder?: SecondaryButtonId[]
  secondaryButtonsOrder?: SecondaryButtonId[]
}

type PrimaryButtonId = 'mouse' | 'pen' | 'eraser' | 'whiteboard' | 'video-show'
type SecondaryButtonId = 'undo' | 'redo' | 'clock' | 'feature-panel' | 'events' | 'watcher'

const ALL_SECONDARY_BUTTONS: SecondaryButtonId[] = ['undo', 'redo', 'clock', 'feature-panel', 'events', 'watcher']
const DEFAULT_ALLOWED_PRIMARY_BUTTONS: PrimaryButtonId[] = ['mouse', 'pen', 'eraser', 'whiteboard', 'video-show']
const DEFAULT_ALLOWED_SECONDARY_BUTTONS: SecondaryButtonId[] = ['undo', 'redo', 'feature-panel']

const DEFAULT_PRIMARY_BUTTONS_ORDER: PrimaryButtonId[] = ['mouse', 'pen', 'eraser', 'whiteboard', 'video-show']
const DEFAULT_SECONDARY_BUTTONS_ORDER: SecondaryButtonId[] = ['undo', 'redo', 'feature-panel']

function normalizeAllowedPrimaryButtons(input: unknown): PrimaryButtonId[] {
  if (!Array.isArray(input)) return DEFAULT_ALLOWED_PRIMARY_BUTTONS
  const allowed = new Set(DEFAULT_ALLOWED_PRIMARY_BUTTONS)
  const unique: PrimaryButtonId[] = []
  for (const item of input) {
    if (item !== 'mouse' && item !== 'pen' && item !== 'eraser' && item !== 'whiteboard' && item !== 'video-show') continue
    if (!allowed.has(item)) continue
    if (unique.includes(item)) continue
    unique.push(item)
  }
  return unique.length ? unique : DEFAULT_ALLOWED_PRIMARY_BUTTONS
}

function normalizeAllowedSecondaryButtons(input: unknown): SecondaryButtonId[] {
  if (!Array.isArray(input)) return DEFAULT_ALLOWED_SECONDARY_BUTTONS
  const allowed = new Set(ALL_SECONDARY_BUTTONS)
  const unique: SecondaryButtonId[] = []
  for (const item of input) {
    if (item !== 'undo' && item !== 'redo' && item !== 'clock' && item !== 'feature-panel' && item !== 'events' && item !== 'watcher') continue
    if (!allowed.has(item)) continue
    if (unique.includes(item)) continue
    unique.push(item)
  }
  return unique.length ? unique : DEFAULT_ALLOWED_SECONDARY_BUTTONS
}

function normalizePinnedSecondaryButtonsOrder(input: unknown, allowedButtons: readonly SecondaryButtonId[]): SecondaryButtonId[] {
  const allowed = new Set(allowedButtons)
  const unique: SecondaryButtonId[] = []
  if (Array.isArray(input)) {
    for (const item of input) {
      if (item !== 'undo' && item !== 'redo' && item !== 'clock' && item !== 'feature-panel' && item !== 'events' && item !== 'watcher') continue
      if (!allowed.has(item)) continue
      if (unique.includes(item)) continue
      unique.push(item)
    }
  }
  return unique
}

function normalizePrimaryButtonsOrder(input: unknown, allowedButtons: readonly PrimaryButtonId[]): PrimaryButtonId[] {
  const allowed = new Set(allowedButtons)
  const unique: PrimaryButtonId[] = []
  if (Array.isArray(input)) {
    for (const item of input) {
      if (item !== 'mouse' && item !== 'pen' && item !== 'eraser' && item !== 'whiteboard' && item !== 'video-show') continue
      if (!allowed.has(item)) continue
      if (unique.includes(item)) continue
      unique.push(item)
    }
  }

  for (const item of DEFAULT_PRIMARY_BUTTONS_ORDER) if (allowed.has(item) && !unique.includes(item)) unique.push(item)
  for (const item of allowedButtons) if (!unique.includes(item)) unique.push(item)
  return unique
}

function normalizeSecondaryButtonsOrder(
  input: unknown,
  allowedButtons: readonly SecondaryButtonId[],
  pinnedButtons?: readonly SecondaryButtonId[]
): SecondaryButtonId[] {
  const allowed = new Set(allowedButtons)
  const pinned = new Set(pinnedButtons ?? [])
  const unique: SecondaryButtonId[] = []
  if (Array.isArray(input)) {
    for (const item of input) {
      if (item !== 'undo' && item !== 'redo' && item !== 'clock' && item !== 'feature-panel' && item !== 'events' && item !== 'watcher') continue
      if (!allowed.has(item)) continue
      if (pinned.has(item)) continue
      if (unique.includes(item)) continue
      unique.push(item)
    }
  }

  for (const item of DEFAULT_SECONDARY_BUTTONS_ORDER) {
    if (!allowed.has(item)) continue
    if (pinned.has(item)) continue
    if (!unique.includes(item)) unique.push(item)
  }
  for (const item of allowedButtons) {
    if (pinned.has(item)) continue
    if (!unique.includes(item)) unique.push(item)
  }
  return unique
}

function arraysEqual<T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function stripToolbarTool(value: ToolbarState): ToolbarState {
  const { tool: _drop, ...rest } = value as any
  return rest as ToolbarState
}

function isToolbarState(value: unknown): value is ToolbarState {
  if (!value || typeof value !== 'object') return false
  const v = value as any
  if (typeof v.collapsed !== 'boolean') return false
  if (v.uiWidth !== undefined && typeof v.uiWidth !== 'number') return false
  if (v.uiButtonSize !== undefined && v.uiButtonSize !== 'sm' && v.uiButtonSize !== 'md') return false
  if (v.tool !== undefined && v.tool !== 'mouse' && v.tool !== 'pen' && v.tool !== 'eraser') return false
  if (v.expanded !== undefined && typeof v.expanded !== 'boolean') return false
  if (v.allowedPrimaryButtons !== undefined && !Array.isArray(v.allowedPrimaryButtons)) return false
  if (v.allowedSecondaryButtons !== undefined && !Array.isArray(v.allowedSecondaryButtons)) return false
  if (v.primaryButtonsOrder !== undefined && !Array.isArray(v.primaryButtonsOrder)) return false
  if (v.pinnedSecondaryButtonsOrder !== undefined && !Array.isArray(v.pinnedSecondaryButtonsOrder)) return false
  if (v.secondaryButtonsOrder !== undefined && !Array.isArray(v.secondaryButtonsOrder)) return false
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
    uiWidth: 360,
    uiButtonSize: 'sm',
    expanded: true,
    allowedPrimaryButtons: DEFAULT_ALLOWED_PRIMARY_BUTTONS,
    allowedSecondaryButtons: DEFAULT_ALLOWED_SECONDARY_BUTTONS,
    primaryButtonsOrder: DEFAULT_PRIMARY_BUTTONS_ORDER,
    pinnedSecondaryButtonsOrder: [],
    secondaryButtonsOrder: DEFAULT_SECONDARY_BUTTONS_ORDER
  }, { validate: isToolbarState, mapLoad: stripToolbarTool, mapSave: stripToolbarTool })

  const bus = useUiStateBus(UI_STATE_APP_WINDOW_ID)
  const revRaw = bus.state[TOOLBAR_STATE_UI_STATE_KEY]
  const rev = typeof revRaw === 'number' ? revRaw : typeof revRaw === 'string' ? Number(revRaw) : 0
  const lastRevRef = useRef(0)

  useEffect(() => {
    if (!rev) return
    if (rev === lastRevRef.current) return
    lastRevRef.current = rev
    let cancelled = false

    ;(async () => {
      try {
        const loaded = await getKv<unknown>(TOOLBAR_STATE_KEY)
        if (cancelled) return
        if (!isToolbarState(loaded)) return
        setState(stripToolbarTool(loaded))
      } catch {
        return
      }
    })()

    return () => {
      cancelled = true
    }
  }, [rev, setState])

  useEffect(() => {
    const normalizedAllowedPrimary = normalizeAllowedPrimaryButtons((state as any).allowedPrimaryButtons)
    const normalizedAllowedSecondary = normalizeAllowedSecondaryButtons((state as any).allowedSecondaryButtons)
    const normalizedPinnedSecondary = normalizePinnedSecondaryButtonsOrder((state as any).pinnedSecondaryButtonsOrder, normalizedAllowedSecondary)
    const normalizedPrimary = normalizePrimaryButtonsOrder((state as any).primaryButtonsOrder, normalizedAllowedPrimary)
    const normalizedSecondary = normalizeSecondaryButtonsOrder((state as any).secondaryButtonsOrder, normalizedAllowedSecondary, normalizedPinnedSecondary)
    const normalized: ToolbarState = {
      collapsed: Boolean(state.collapsed),
      uiWidth: typeof state.uiWidth === 'number' ? state.uiWidth : 360,
      uiButtonSize: state.uiButtonSize === 'md' ? 'md' : 'sm',
      tool: state.tool === 'pen' ? 'pen' : state.tool === 'eraser' ? 'eraser' : 'mouse',
      expanded: state.expanded !== false,
      allowedPrimaryButtons: normalizedAllowedPrimary,
      allowedSecondaryButtons: normalizedAllowedSecondary,
      primaryButtonsOrder: normalizedPrimary,
      pinnedSecondaryButtonsOrder: normalizedPinnedSecondary,
      secondaryButtonsOrder: normalizedSecondary
    }
    if (
      normalized.collapsed !== state.collapsed ||
      normalized.uiWidth !== state.uiWidth ||
      normalized.uiButtonSize !== state.uiButtonSize ||
      normalized.tool !== state.tool ||
      normalized.expanded !== state.expanded ||
      !arraysEqual(normalizedAllowedPrimary, state.allowedPrimaryButtons) ||
      !arraysEqual(normalizedAllowedSecondary, state.allowedSecondaryButtons) ||
      !arraysEqual(normalizedPrimary, state.primaryButtonsOrder) ||
      !arraysEqual(normalizedPinnedSecondary, state.pinnedSecondaryButtonsOrder) ||
      !arraysEqual(normalizedSecondary, state.secondaryButtonsOrder)
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
  const uiButtonSize = state.uiButtonSize || 'sm'
  const reduceMotion = useReducedMotion()
  const tool: 'mouse' | 'pen' | 'eraser' = state.tool === 'pen' ? 'pen' : state.tool === 'eraser' ? 'eraser' : 'mouse'
  const { appMode, setAppMode } = useAppMode()
  const whiteboardActive = appMode === 'whiteboard'
  const videoShowActive = appMode === 'video-show'
  const isExpanded = state.expanded !== false
  const backendEvents = useEventsPoll(800)
  const lastProcessedEventIdRef = useRef(0)
  const watcherWasShownRef = useRef(false)
  const lastWatcherClosedAtRef = useRef(0)

  // 应用外观设置（强调色等）
  useAppearanceSettings()

  useToolbarWindowAutoResize({ root: contentRef.current })
  useZoomOnWheel()

  useEffect(() => {
    postCommand('app.setTool', { tool: 'mouse' }).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!backendEvents.length) return
    const next = backendEvents.filter((e) => e.id > lastProcessedEventIdRef.current)
    if (!next.length) return
    lastProcessedEventIdRef.current = next[next.length - 1]!.id

    for (const item of next) {
      if (item.type === 'WINDOW_STATUS') {
        const payload = (item.payload ?? {}) as any
        const windowId = typeof payload.windowId === 'string' ? payload.windowId : ''
        const event = typeof payload.event === 'string' ? payload.event : ''
        if (windowId !== 'watcher') continue

        if (event === 'show' || event === 'did-finish-load') {
          watcherWasShownRef.current = true
          continue
        }

        if (event === 'closed') {
          if (!watcherWasShownRef.current) continue
          watcherWasShownRef.current = false

          const now = Date.now()
          if (now - lastWatcherClosedAtRef.current < 800) continue
          lastWatcherClosedAtRef.current = now

          void postCommand('win.setNoticeVisible', { visible: true })
        }
      }
    }
  }, [backendEvents])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const pen = await getKv<unknown>(PEN_SETTINGS_KV_KEY)
        if (cancelled) return
        if (isPenSettings(pen)) {
          postCommand('app.setPenSettings', pen).catch(() => undefined)
        }
      } catch {}

      try {
        const eraser = await getKv<unknown>(ERASER_SETTINGS_KV_KEY)
        if (cancelled) return
        if (isEraserSettings(eraser)) {
          postCommand('app.setEraserSettings', eraser).catch(() => undefined)
        }
      } catch {}
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const toggleExpanded = () => {
    setState({ ...state, expanded: !isExpanded })
  }

  // 处理笔按钮点击
  const handlePenClick = () => {
    if (tool === 'pen') {
      // 如果笔已经是当前工具，打开二级菜单（独立窗口）
      void postCommand('toggle-subwindow', { kind: 'pen', placement: 'bottom' })
    } else {
      // 否则切换到笔工具
      setState({ ...state, tool: 'pen' })
      void postCommand('app.setTool', { tool: 'pen' })
    }
  }

  // 处理橡皮按钮点击
  const handleEraserClick = () => {
    if (tool === 'eraser') {
      // 如果橡皮已经是当前工具，打开二级菜单（独立窗口）
      void postCommand('toggle-subwindow', { kind: 'eraser', placement: 'bottom' })
    } else {
      // 否则切换到橡皮工具
      setState({ ...state, tool: 'eraser' })
      void postCommand('app.setTool', { tool: 'eraser' })
    }
  }

  const primaryButtonsOrder = state.primaryButtonsOrder ?? DEFAULT_PRIMARY_BUTTONS_ORDER
  const pinnedSecondaryButtonsOrder = state.pinnedSecondaryButtonsOrder ?? []
  const secondaryButtonsOrder = state.secondaryButtonsOrder ?? DEFAULT_SECONDARY_BUTTONS_ORDER

  const renderPrimaryButton = (id: PrimaryButtonId) => {
    if (id === 'mouse') {
      const visibility = getAppButtonVisibility('mouse')
      return (
        <Button
          key="mouse"
          size={uiButtonSize}
          variant={tool === 'mouse' ? 'light' : 'default'}
          ariaLabel="鼠标"
          title="鼠标"
          showInToolbar={visibility.showInToolbar}
          showInFeaturePanel={visibility.showInFeaturePanel}
          onClick={() => {
            setState({ ...state, tool: 'mouse' })
            void postCommand('app.setTool', { tool: 'mouse' })
          }}
        >
          <ToolbarToolIcon kind="mouse" />
        </Button>
      )
    }

    if (id === 'pen') {
      const visibility = getAppButtonVisibility('pen')
      return (
        <Button
          key="pen"
          size={uiButtonSize}
          variant={tool === 'pen' ? 'light' : 'default'}
          ariaLabel="笔"
          title={tool === 'pen' ? '笔（再次点击打开设置）' : '笔'}
          showInToolbar={visibility.showInToolbar}
          showInFeaturePanel={visibility.showInFeaturePanel}
          onClick={handlePenClick}
        >
          <ToolbarToolIcon kind="pen" />
        </Button>
      )
    }

    if (id === 'eraser') {
      const visibility = getAppButtonVisibility('eraser')
      return (
        <Button
          key="eraser"
          size={uiButtonSize}
          variant={tool === 'eraser' ? 'light' : 'default'}
          ariaLabel="橡皮"
          title={tool === 'eraser' ? '橡皮（再次点击打开设置）' : '橡皮'}
          showInToolbar={visibility.showInToolbar}
          showInFeaturePanel={visibility.showInFeaturePanel}
          onClick={handleEraserClick}
        >
          <ToolbarToolIcon kind="eraser" />
        </Button>
      )
    }

    if (id === 'whiteboard') {
      const visibility = getAppButtonVisibility('whiteboard')
      return (
        <Button
          key="whiteboard"
          size={uiButtonSize}
          variant={whiteboardActive ? 'light' : 'default'}
          ariaLabel="白板"
          title="白板"
          showInToolbar={visibility.showInToolbar}
          showInFeaturePanel={visibility.showInFeaturePanel}
          onClick={() => {
            setAppMode(whiteboardActive ? 'toolbar' : 'whiteboard')
          }}
        >
          <ToolbarToolIcon kind="whiteboard" />
        </Button>
      )
    }

    const visibility = getAppButtonVisibility('video-show')
    return (
      <Button
        key="video-show"
        size={uiButtonSize}
        variant={videoShowActive ? 'light' : 'default'}
        ariaLabel="视频展台"
        title="视频展台"
        showInToolbar={visibility.showInToolbar}
        showInFeaturePanel={visibility.showInFeaturePanel}
        onClick={() => {
          setAppMode(videoShowActive ? 'toolbar' : 'video-show')
        }}
      >
        <ToolbarToolIcon kind="video-show" />
      </Button>
    )
  }

  const renderSecondaryButton = (id: SecondaryButtonId) => {
    if (id === 'undo') {
      const visibility = getAppButtonVisibility('undo')
      return (
        <Button
          key="undo"
          size={uiButtonSize}
          ariaLabel="撤销"
          title="撤销"
          showInToolbar={visibility.showInToolbar}
          showInFeaturePanel={visibility.showInFeaturePanel}
          onClick={() => {
            void postCommand('app.undo')
          }}
        >
          <UndoIcon />
        </Button>
      )
    }

    if (id === 'redo') {
      const visibility = getAppButtonVisibility('redo')
      return (
        <Button
          key="redo"
          size={uiButtonSize}
          ariaLabel="重做"
          title="重做"
          showInToolbar={visibility.showInToolbar}
          showInFeaturePanel={visibility.showInFeaturePanel}
          onClick={() => {
            void postCommand('app.redo')
          }}
        >
          <RedoIcon />
        </Button>
      )
    }

    if (id === 'clock') {
      const visibility = getAppButtonVisibility('clock')
      return (
        <Button
          key="clock"
          size={uiButtonSize}
          ariaLabel="时钟"
          title="时钟"
          showInToolbar={visibility.showInToolbar}
          showInFeaturePanel={visibility.showInFeaturePanel}
          onClick={() => {
            void postCommand('toggle-subwindow', { kind: 'clock', placement: 'bottom' })
          }}
        >
          <ClockIcon />
        </Button>
      )
    }

    if (id === 'events') {
      const visibility = getAppButtonVisibility('events')
      return (
        <Button
          key="events"
          size={uiButtonSize}
          ariaLabel="事件"
          title="事件"
          showInToolbar={visibility.showInToolbar}
          showInFeaturePanel={visibility.showInFeaturePanel}
          onClick={() => {
            void postCommand('toggle-subwindow', { kind: 'events', placement: 'bottom' })
          }}
        >
          <EventsIcon />
        </Button>
      )
    }

    if (id === 'watcher') {
      const visibility = getAppButtonVisibility('watcher')
      return (
        <Button
          key="watcher"
          size={uiButtonSize}
          ariaLabel="监视器"
          title="监视器"
          showInToolbar={visibility.showInToolbar}
          showInFeaturePanel={visibility.showInFeaturePanel}
          onClick={() => {
            void postCommand('watcher.openWindow')
          }}
        >
          <WatcherIcon />
        </Button>
      )
    }

    const visibility = getAppButtonVisibility('feature-panel')
    return (
      <Button
        key="feature-panel"
        size={uiButtonSize}
        ariaLabel="功能面板"
        title="功能面板"
        showInToolbar={visibility.showInToolbar}
        showInFeaturePanel={visibility.showInFeaturePanel}
        onClick={() => {
          void postCommand('toggle-subwindow', { kind: 'feature-panel', placement: 'bottom' })
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20">
          <path
            fill="currentColor"
            d="M4.5 17a1.5 1.5 0 0 1-1.493-1.355L3 15.501v-11a1.5 1.5 0 0 1 1.356-1.493L4.5 3H9a1.5 1.5 0 0 1 1.493 1.355l.007.145v.254l2.189-2.269a1.5 1.5 0 0 1 2.007-.138l.116.101l2.757 2.725a1.5 1.5 0 0 1 .111 2.011l-.103.116l-2.311 2.2h.234a1.5 1.5 0 0 1 1.493 1.356L17 11v4.5a1.5 1.5 0 0 1-1.355 1.493L15.5 17zm5-6.5H4v5a.5.5 0 0 0 .326.47l.084.023l.09.008h5zm6 0h-5V16h5a.5.5 0 0 0 .492-.41L16 15.5V11a.5.5 0 0 0-.41-.491zm-5-2.79V9.5h1.79zM9 4H4.5a.5.5 0 0 0-.492.411L4 4.501v5h5.5v-5a.5.5 0 0 0-.326-.469L9.09 4.01zm5.122-.826a.5.5 0 0 0-.645-.053l-.068.06l-2.616 2.713a.5.5 0 0 0-.057.623l.063.078l2.616 2.615a.5.5 0 0 0 .62.07l.078-.061l2.758-2.627a.5.5 0 0 0 .054-.638l-.059-.069z"
          />
        </svg>
      </Button>
    )
  }

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
          {/* 主要工具按钮区域 */}
          <div className="toolbarBarRow">
            <ButtonGroup>
              {primaryButtonsOrder.map(renderPrimaryButton)}
              {pinnedSecondaryButtonsOrder.map(renderSecondaryButton)}
            </ButtonGroup>
          </div>

          {/* 折叠/展开切换按钮 */}
          <div className="toolbarBarRow">
            {(() => {
              const visibility = getAppButtonVisibility('toggle-expanded')
              return (
            <Button
              size={uiButtonSize}
              variant="light"
              className="toolbarToggleButton"
              title={isExpanded ? '点击折叠工具栏' : '点击展开工具栏'}
              showInToolbar={visibility.showInToolbar}
              showInFeaturePanel={visibility.showInFeaturePanel}
              onClick={toggleExpanded}
            >
              {isExpanded ? <ChevronLeftIcon /> : <ChevronRightIcon />}
            </Button>
              )
            })()}
          </div>

          {/* 可折叠区域 */}
          <motion.div
            className="toolbarCollapsibleSection"
            initial={false}
            animate={{
              width: isExpanded ? 'auto' : 0,
              opacity: isExpanded ? 1 : 0
            }}
            transition={reduceMotion ? undefined : { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="toolbarBarRow toolbarCollapsibleContent">
              <ButtonGroup>
                {secondaryButtonsOrder.map(renderSecondaryButton)}
              </ButtonGroup>
            </div>
          </motion.div>
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

  // 应用外观设置（强调色等）
  useAppearanceSettings()

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
