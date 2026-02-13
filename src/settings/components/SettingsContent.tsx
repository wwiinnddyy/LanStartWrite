import React from 'react'
import { Box, Select, Switch } from '@mantine/core'
import { motion } from '../../Framer_Motion'
import {
  APP_MODE_UI_STATE_KEY,
  LEAFER_SETTINGS_KV_KEY,
  LEAFER_SETTINGS_UI_STATE_KEY,
  TOOLBAR_STATE_KEY,
  TOOLBAR_STATE_UI_STATE_KEY,
  UI_STATE_APP_WINDOW_ID,
  VIDEO_SHOW_MERGE_LAYERS_KV_KEY,
  VIDEO_SHOW_MERGE_LAYERS_UI_STATE_KEY,
  OFFICE_PPT_MODE_KV_KEY,
  OFFICE_PPT_MODE_UI_STATE_KEY,
  type OfficePptMode,
  SYSTEM_UIA_TOPMOST_KV_KEY,
  SYSTEM_UIA_TOPMOST_UI_STATE_KEY,
  SYSTEM_MERGE_RENDERER_PIPELINE_KV_KEY,
  ADMIN_STATUS_UI_STATE_KEY,
  WHITEBOARD_BG_COLOR_KV_KEY,
  WHITEBOARD_BG_COLOR_UI_STATE_KEY,
  WHITEBOARD_BG_IMAGE_OPACITY_UI_STATE_KEY,
  WHITEBOARD_BG_IMAGE_URL_KV_KEY,
  WHITEBOARD_BG_IMAGE_URL_UI_STATE_KEY,
  isFileOrDataUrl,
  isHexColor,
  isLeaferSettings,
  putKv,
  putUiStateKey,
  selectImageFile,
  type LeaferSettings,
  useAppAppearance,
  usePersistedState,
  useUiStateBus
} from '../../status'
import {
  Button,
  getToolbarDefaultAllowedSecondaryButtonIds,
  getToolbarDefaultSecondaryOrder,
  getAppButtonLabel,
  getToolbarPrimaryButtonIds,
  getToolbarSecondaryButtonIds,
  isToolbarPrimaryButtonId,
  isToolbarSecondaryButtonId,
  type ToolbarPrimaryButtonId,
  type ToolbarSecondaryButtonId
} from '../../button'
import type { SettingsTab } from '../types'
import { AccentColorPicker } from './AccentColorPicker'
import { TransitionSettings } from './TransitionSettings'
import { useAppearanceSettings } from '../hooks/useAppearanceSettings'
import LanStartLogoSvg from '../../../iconpack/3d1b23de6a48e1d67f4c637d117897cd26c5594cfbb15bc6092a3546d8cc425a(1).svg'
import './SettingsContent.css'

interface SettingsContentProps {
  activeTab: SettingsTab
}

// 外观设置组件
function AppearanceSettings() {
  const { appearance, setAppearance } = useAppAppearance()
  const {
    accentColor,
    setAccentColor,
    nativeMicaEnabled,
    setNativeMicaEnabled,
    legacyWindowImplementation,
    setLegacyWindowImplementation,
    windowBackgroundMode,
    setWindowBackgroundMode,
    transitionPreset,
    setTransitionPreset,
    backgroundTransition,
    setBackgroundTransition,
  } = useAppearanceSettings()

  return (
    <div className="settingsContentSection">
      <h2 className="settingsContentTitle">外观</h2>
      <p className="settingsContentDescription">选择您喜欢的主题外观</p>

      {/* 主题模式选择 */}
      <div className="settingsAppearanceOptions">
        <Button
          kind="custom"
          appRegion="no-drag"
          ariaLabel="浅色主题"
          title="浅色主题"
          className={`settingsAppearanceCard ${appearance === 'light' ? 'settingsAppearanceCard--active' : ''}`}
          onClick={() => setAppearance('light')}
        >
          <div className="settingsAppearancePreview settingsAppearancePreview--light">
            <div className="settingsAppearancePreviewHeader" />
            <div className="settingsAppearancePreviewContent">
              <div className="settingsAppearancePreviewSidebar" />
              <div className="settingsAppearancePreviewMain" />
            </div>
          </div>
          <span className="settingsAppearanceLabel">浅色</span>
        </Button>

        <Button
          kind="custom"
          appRegion="no-drag"
          ariaLabel="深色主题"
          title="深色主题"
          className={`settingsAppearanceCard ${appearance === 'dark' ? 'settingsAppearanceCard--active' : ''}`}
          onClick={() => setAppearance('dark')}
        >
          <div className="settingsAppearancePreview settingsAppearancePreview--dark">
            <div className="settingsAppearancePreviewHeader" />
            <div className="settingsAppearancePreviewContent">
              <div className="settingsAppearancePreviewSidebar" />
              <div className="settingsAppearancePreviewMain" />
            </div>
          </div>
          <span className="settingsAppearanceLabel">深色</span>
        </Button>
      </div>

      <div className="settingsSubSection">
        <h3 className="settingsSubTitle">窗口材质</h3>
        <p className="settingsSubDescription">开启后使用 Windows 原生黑白 Mica 背景，并让窗口背景透明（澎湃 OS 3 模式将强制关闭）</p>
        <Switch
          checked={legacyWindowImplementation && nativeMicaEnabled}
          disabled={!legacyWindowImplementation}
          onChange={(e) => setNativeMicaEnabled(e.currentTarget.checked)}
          label="启用原生 Mica 效果"
          size="md"
        />
      </div>

      <div className="settingsSubSection">
        <h3 className="settingsSubTitle">窗口实现</h3>
        <p className="settingsSubDescription">切换澎湃 OS 3 新圆角实现与旧实现（会自动重建浮动窗口）</p>
        <Switch
          checked={legacyWindowImplementation}
          onChange={(e) => setLegacyWindowImplementation(e.currentTarget.checked)}
          label="使用旧版窗口实现"
          size="md"
        />
      </div>

      {!legacyWindowImplementation && (
        <div className="settingsSubSection">
          <h3 className="settingsSubTitle">窗口背景</h3>
          <p className="settingsSubDescription">仅澎湃 OS 3 新窗口实现生效</p>
          <Select
            value={windowBackgroundMode}
            onChange={(v) => {
              if (v === 'opaque' || v === 'blur' || v === 'transparent') setWindowBackgroundMode(v)
            }}
            data={[
              { value: 'opaque', label: '实现（不透明）' },
              { value: 'blur', label: '模糊（HyperGlass）' },
              { value: 'transparent', label: '透明' },
            ]}
            allowDeselect={false}
            size="md"
          />
        </div>
      )}

      {/* 强调色设置 */}
      <div className="settingsSubSection">
        <h3 className="settingsSubTitle">
          强调色
          <span className="settingsSubTitleHint">（{appearance === 'dark' ? '深色' : '浅色'}模式独立设置）</span>
        </h3>
        <p className="settingsSubDescription">选择应用的主题强调色</p>
        <AccentColorPicker value={accentColor.value} onChange={setAccentColor} />
      </div>

      {/* 过渡效果设置 */}
      <div className="settingsSubSection">
        <h3 className="settingsSubTitle">过渡效果</h3>
        <p className="settingsSubDescription">调整界面动画和背景过渡效果</p>
        <TransitionSettings
          transitionPreset={transitionPreset.value}
          onTransitionChange={setTransitionPreset}
          backgroundTransition={backgroundTransition.value}
          onBackgroundTransitionChange={setBackgroundTransition}
        />
      </div>
    </div>
  )
}

// 各选项卡的内容占位组件
function ToolbarSettings() {
  type PrimaryButtonId = ToolbarPrimaryButtonId
  type SecondaryButtonId = ToolbarSecondaryButtonId
  type SelectedButton =
    | { group: 'primary'; id: PrimaryButtonId }
    | { group: 'pinned'; id: SecondaryButtonId }
    | { group: 'secondary'; id: SecondaryButtonId }

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

  const DEFAULT_PRIMARY: PrimaryButtonId[] = getToolbarPrimaryButtonIds()
  const DEFAULT_SECONDARY: SecondaryButtonId[] = getToolbarDefaultAllowedSecondaryButtonIds()
  const ALL_SECONDARY: SecondaryButtonId[] = getToolbarSecondaryButtonIds()
  const DEFAULT_SECONDARY_ORDER: SecondaryButtonId[] = getToolbarDefaultSecondaryOrder()

  function normalizeAllowedPrimaryButtons(input: unknown): PrimaryButtonId[] {
    if (!Array.isArray(input)) return DEFAULT_PRIMARY
    const allowed = new Set(getToolbarPrimaryButtonIds())
    const unique: PrimaryButtonId[] = []
    for (const item of input) {
      if (!isToolbarPrimaryButtonId(item)) continue
      if (!allowed.has(item)) continue
      if (unique.includes(item)) continue
      unique.push(item)
    }
    return unique.length ? unique : DEFAULT_PRIMARY
  }

  function normalizeAllowedSecondaryButtons(input: unknown): SecondaryButtonId[] {
    if (!Array.isArray(input)) return DEFAULT_SECONDARY
    const allowed = new Set(getToolbarSecondaryButtonIds())
    const unique: SecondaryButtonId[] = []
    for (const item of input) {
      if (!isToolbarSecondaryButtonId(item)) continue
      if (!allowed.has(item)) continue
      if (unique.includes(item)) continue
      unique.push(item)
    }
    return unique.length ? unique : DEFAULT_SECONDARY
  }

  function normalizePrimaryButtonsOrder(input: unknown, allowedButtons: readonly PrimaryButtonId[]): PrimaryButtonId[] {
    const allowed = new Set(allowedButtons)
    const unique: PrimaryButtonId[] = []
    if (Array.isArray(input)) {
      for (const item of input) {
        if (!isToolbarPrimaryButtonId(item)) continue
        if (!allowed.has(item)) continue
        if (unique.includes(item)) continue
        unique.push(item)
      }
    }
    for (const item of DEFAULT_PRIMARY) if (allowed.has(item) && !unique.includes(item)) unique.push(item)
    for (const item of allowedButtons) if (!unique.includes(item)) unique.push(item)
    return unique
  }

  function normalizePinnedSecondaryButtonsOrder(input: unknown, allowedButtons: readonly SecondaryButtonId[]): SecondaryButtonId[] {
    const allowed = new Set(allowedButtons)
    const unique: SecondaryButtonId[] = []
    if (Array.isArray(input)) {
      for (const item of input) {
        if (!isToolbarSecondaryButtonId(item)) continue
        if (!allowed.has(item)) continue
        if (unique.includes(item)) continue
        unique.push(item)
      }
    }
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
        if (!isToolbarSecondaryButtonId(item)) continue
        if (!allowed.has(item)) continue
        if (pinned.has(item)) continue
        if (unique.includes(item)) continue
        unique.push(item)
      }
    }
    for (const item of DEFAULT_SECONDARY_ORDER) {
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

  const isToolbarState = (value: unknown): value is ToolbarState => {
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

  const stripToolbarTool = (value: ToolbarState): ToolbarState => {
    const { tool: _drop, ...rest } = value as any
    return rest as ToolbarState
  }

  const [toolbarState, setToolbarState] = usePersistedState<ToolbarState>(
    TOOLBAR_STATE_KEY,
    {
      collapsed: false,
      uiWidth: 360,
      uiButtonSize: 'sm',
      expanded: true,
      allowedPrimaryButtons: DEFAULT_PRIMARY,
      allowedSecondaryButtons: DEFAULT_SECONDARY,
      primaryButtonsOrder: DEFAULT_PRIMARY,
      pinnedSecondaryButtonsOrder: [],
      secondaryButtonsOrder: DEFAULT_SECONDARY,
    },
    { validate: isToolbarState, mapLoad: stripToolbarTool, mapSave: stripToolbarTool }
  )

  const allowedPrimaryButtons = normalizeAllowedPrimaryButtons((toolbarState as any).allowedPrimaryButtons)
  const allowedSecondaryButtons = normalizeAllowedSecondaryButtons((toolbarState as any).allowedSecondaryButtons)

  const primaryButtonsOrder = normalizePrimaryButtonsOrder(toolbarState.primaryButtonsOrder, allowedPrimaryButtons)
  const pinnedSecondaryButtonsOrder = normalizePinnedSecondaryButtonsOrder(
    (toolbarState as any).pinnedSecondaryButtonsOrder,
    allowedSecondaryButtons
  )
  const secondaryButtonsOrder = normalizeSecondaryButtonsOrder(toolbarState.secondaryButtonsOrder, allowedSecondaryButtons, pinnedSecondaryButtonsOrder)

  const labelForButton = (id: PrimaryButtonId | SecondaryButtonId) => {
    return getAppButtonLabel(id)
  }

  function ToolbarToolIcon(props: { kind: PrimaryButtonId }) {
    const d =
      props.kind === 'mouse'
        ? 'M5 3.059a1 1 0 0 1 1.636-.772l11.006 9.062c.724.596.302 1.772-.636 1.772h-5.592a1.5 1.5 0 0 0-1.134.518l-3.524 4.073c-.606.7-1.756.271-1.756-.655zm12.006 9.062L6 3.059v13.998l3.524-4.072a2.5 2.5 0 0 1 1.89-.864z'
        : props.kind === 'pen'
          ? 'M17.18 2.926a2.975 2.975 0 0 0-4.26-.054l-9.375 9.375a2.44 2.44 0 0 0-.655 1.194l-.878 3.95a.5.5 0 0 0 .597.597l3.926-.873a2.5 2.5 0 0 0 1.234-.678l7.98-7.98l.337.336a1 1 0 0 1 0 1.414l-.94.94a.5.5 0 0 0 .708.706l.939-.94a2 2 0 0 0 0-2.828l-.336-.336l.67-.67a2.975 2.975 0 0 0 .052-4.153m-3.553.653a1.975 1.975 0 0 1 2.793 2.793L7.062 15.73a1.5 1.5 0 0 1-.744.409l-3.16.702l.708-3.183a1.43 1.43 0 0 1 .387-.704z'
          : props.kind === 'eraser'
            ? 'M2.44 11.2a1.5 1.5 0 0 0 0 2.122l4.242 4.242a1.5 1.5 0 0 0 2.121 0l.72-.72a5.5 5.5 0 0 1-.369-1.045l-1.058 1.058a.5.5 0 0 1-.707 0l-4.243-4.242a.5.5 0 0 1 0-.707l1.69-1.69l4.165 4.164q.015-.645.17-1.245L5.543 9.51l6.364-6.364a.5.5 0 0 1 .707 0l4.242 4.243a.5.5 0 0 1 0 .707L15.8 9.154a5.5 5.5 0 0 1 1.045.37l.72-.72a1.5 1.5 0 0 0 0-2.122l-4.242-4.243a1.5 1.5 0 0 0-2.122 0zM14.5 19a4.5 4.5 0 1 0 0-9a4.5 4.5 0 0 0 0 9'
            : props.kind === 'whiteboard'
              ? 'm17.331 3.461l.11.102l.102.11a1.93 1.93 0 0 1-.103 2.606l-3.603 3.617a1.9 1.9 0 0 1-.794.477l-1.96.591a.84.84 0 0 1-1.047-.567a.85.85 0 0 1 .005-.503l.621-1.942c.093-.289.252-.55.465-.765l3.612-3.625a1.904 1.904 0 0 1 2.592-.1m-1.884.806l-3.611 3.626a.9.9 0 0 0-.221.363l-.533 1.664l1.672-.505c.14-.042.27-.12.374-.224l3.603-3.617a.93.93 0 0 0 .06-1.24l-.06-.065l-.064-.06a.904.904 0 0 0-1.22.058M12.891 4H5a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7.134l-1 1.004V13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9.23c.573-.486 1.34-1.11 2.074-1.535c.41-.237.772-.39 1.062-.439c.281-.048.423.01.51.098a.33.33 0 0 1 .106.185a.6.6 0 0 1-.04.276c-.093.276-.31.602-.602 1.01l-.094.132c-.252.35-.538.747-.736 1.144c-.225.447-.392.995-.204 1.557c.17.508.498.845.926 1.011c.402.156.844.144 1.236.073c.785-.14 1.584-.552 2.02-.813a.5.5 0 0 0-.515-.858c-.399.24-1.075.578-1.681.687c-.303.054-.537.042-.698-.021c-.136-.053-.26-.153-.34-.395c-.062-.188-.03-.435.15-.793c.16-.32.396-.649.656-1.01l.093-.131c.276-.386.587-.832.737-1.273c.077-.229.122-.486.08-.753a1.32 1.32 0 0 0-.386-.736c-.397-.396-.914-.456-1.386-.376c-.462.079-.945.3-1.394.559c-.546.315-1.096.722-1.574 1.104V7a2 2 0 0 1 2-2h6.895z'
              : 'M5 4a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h5a3 3 0 0 0 3-3v-.321l3.037 2.097a1.25 1.25 0 0 0 1.96-1.029V6.252a1.25 1.25 0 0 0-1.96-1.028L13 7.32V7a3 3 0 0 0-3-3zm8 4.536l3.605-2.49a.25.25 0 0 1 .392.206v7.495a.25.25 0 0 1-.392.206L13 11.463zM3 7a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'

    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
        <path fill="currentColor" d={d} />
      </svg>
    )
  }

  function UndoIcon() {
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
        <path d="M3 7v6h6" />
        <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
      </svg>
    )
  }

  function RedoIcon() {
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
        <path d="M21 7v6h-6" />
        <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
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

  function FeaturePanelIcon() {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20">
        <path
          fill="currentColor"
          d="M4.5 17a1.5 1.5 0 0 1-1.493-1.355L3 15.501v-11a1.5 1.5 0 0 1 1.356-1.493L4.5 3H9a1.5 1.5 0 0 1 1.493 1.355l.007.145v.254l2.189-2.269a1.5 1.5 0 0 1 2.007-.138l.116.101l2.757 2.725a1.5 1.5 0 0 1 .111 2.011l-.103.116l-2.311 2.2h.234a1.5 1.5 0 0 1 1.493 1.356L17 11v4.5a1.5 1.5 0 0 1-1.355 1.493L15.5 17zm5-6.5H4v5a.5.5 0 0 0 .326.47l.084.023l.09.008h5zm6 0h-5V16h5a.5.5 0 0 0 .492-.41L16 15.5V11a.5.5 0 0 0-.41-.491zm-5-2.79V9.5h1.79zM9 4H4.5a.5.5 0 0 0-.492.411L4 4.501v5h5.5v-5a.5.5 0 0 0-.326-.469L9.09 4.01zm5.122-.826a.5.5 0 0 0-.645-.053l-.068.06l-2.616 2.713a.5.5 0 0 0-.057.623l.063.078l2.616 2.615a.5.5 0 0 0 .62.07l.078-.061l2.758-2.627a.5.5 0 0 0 .054-.638l-.059-.069z"
        />
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

  function WatcherIcon() {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3.5-7 10-7s10 7 10 7s-3.5 7-10 7s-10-7-10-7" />
        <path d="M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6" />
      </svg>
    )
  }

  function ChevronLeftIcon() {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
    )
  }

  function ChevronRightIcon() {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    )
  }

  function PlusIcon() {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    )
  }

  function TrashIcon() {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="M19 6l-1 14H6L5 6" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
      </svg>
    )
  }

  const iconForButton = (id: PrimaryButtonId | SecondaryButtonId) => {
    if (id === 'mouse') return <ToolbarToolIcon kind="mouse" />
    if (id === 'pen') return <ToolbarToolIcon kind="pen" />
    if (id === 'eraser') return <ToolbarToolIcon kind="eraser" />
    if (id === 'whiteboard') return <ToolbarToolIcon kind="whiteboard" />
    if (id === 'video-show') return <ToolbarToolIcon kind="video-show" />
    if (id === 'undo') return <UndoIcon />
    if (id === 'redo') return <RedoIcon />
    if (id === 'clock') return <ClockIcon />
    if (id === 'events') return <EventsIcon />
    if (id === 'watcher') return <WatcherIcon />
    return <FeaturePanelIcon />
  }

  const descriptionForButton = (id: PrimaryButtonId | SecondaryButtonId) => {
    if (id === 'mouse') return '切换到鼠标工具'
    if (id === 'pen') return '切换到笔工具（再次点击可打开设置）'
    if (id === 'eraser') return '切换到橡皮工具'
    if (id === 'whiteboard') return '进入/退出白板模式'
    if (id === 'video-show') return '进入/退出视频展台模式'
    if (id === 'undo') return '撤销上一步操作'
    if (id === 'redo') return '重做上一步操作'
    if (id === 'clock') return '打开时钟窗口'
    if (id === 'events') return '打开事件列表窗口'
    if (id === 'watcher') return '打开进程与窗口监视器'
    return '打开功能面板'
  }

  const moveItem = <T,>(list: readonly T[], fromIndex: number, toIndex: number): T[] => {
    if (fromIndex === toIndex) return [...list]
    const next = [...list]
    const [item] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, item)
    return next
  }

  function SelectableToolbarButtonItem(props: {
    group: SelectedButton['group']
    id: PrimaryButtonId | SecondaryButtonId
    selected: boolean
    onSelect: () => void
  }) {
    const label = labelForButton(props.id)
    const icon = iconForButton(props.id)

    return (
      <div className="settingsToolbarReorderItem">
        <Button
          size="sm"
          variant={props.selected ? 'light' : undefined}
          title={label}
          ariaLabel={label}
          appRegion="no-drag"
          onClick={props.onSelect}
          onPointerDown={() => props.onSelect()}
        >
          {icon}
        </Button>
      </div>
    )
  }

  const [selectedButton, setSelectedButton] = React.useState<SelectedButton>({ group: 'primary', id: 'mouse' })

  React.useEffect(() => {
    if (selectedButton.group === 'primary') {
      if (!primaryButtonsOrder.includes(selectedButton.id)) {
        setSelectedButton({ group: 'primary', id: primaryButtonsOrder[0] ?? 'mouse' })
      }
      return
    }
    if (selectedButton.group === 'pinned') {
      if (!pinnedSecondaryButtonsOrder.length) {
        if (secondaryButtonsOrder.length) setSelectedButton({ group: 'secondary', id: secondaryButtonsOrder[0] ?? 'undo' })
        else setSelectedButton({ group: 'primary', id: primaryButtonsOrder[0] ?? 'mouse' })
        return
      }
      if (!pinnedSecondaryButtonsOrder.includes(selectedButton.id)) {
        setSelectedButton({ group: 'pinned', id: pinnedSecondaryButtonsOrder[0] ?? 'undo' })
      }
      return
    }
    if (!secondaryButtonsOrder.length) {
      if (pinnedSecondaryButtonsOrder.length) setSelectedButton({ group: 'pinned', id: pinnedSecondaryButtonsOrder[0] ?? 'undo' })
      else setSelectedButton({ group: 'primary', id: primaryButtonsOrder[0] ?? 'mouse' })
      return
    }
    if (!secondaryButtonsOrder.includes(selectedButton.id)) {
      setSelectedButton({ group: 'secondary', id: secondaryButtonsOrder[0] ?? 'undo' })
    }
  }, [pinnedSecondaryButtonsOrder, primaryButtonsOrder, secondaryButtonsOrder, selectedButton.group, selectedButton.id])

  const selectedLabel = labelForButton(selectedButton.id)
  const selectedIcon = iconForButton(selectedButton.id)
  const selectedIndex =
    selectedButton.group === 'primary'
      ? primaryButtonsOrder.indexOf(selectedButton.id)
      : selectedButton.group === 'pinned'
        ? pinnedSecondaryButtonsOrder.indexOf(selectedButton.id)
        : secondaryButtonsOrder.indexOf(selectedButton.id)
  const selectedCount =
    selectedButton.group === 'primary'
      ? primaryButtonsOrder.length
      : selectedButton.group === 'pinned'
        ? pinnedSecondaryButtonsOrder.length
        : secondaryButtonsOrder.length
  const canMovePrev = selectedIndex > 0
  const canMoveNext = selectedIndex >= 0 && selectedIndex < selectedCount - 1

  const persistToolbarState = (next: ToolbarState) => {
    const persisted = stripToolbarTool(next)
    setToolbarState(persisted)
    void (async () => {
      try {
        await putKv(TOOLBAR_STATE_KEY, persisted)
      } catch {
        return
      }
      try {
        await putUiStateKey(UI_STATE_APP_WINDOW_ID, TOOLBAR_STATE_UI_STATE_KEY, Date.now())
      } catch {
        return
      }
    })()
  }

  const moveSelected = (delta: -1 | 1) => {
    if (selectedButton.group === 'primary') {
      const order = primaryButtonsOrder
      const index = order.indexOf(selectedButton.id)
      if (index < 0) return
      const nextIndex = index + delta
      if (nextIndex < 0 || nextIndex >= order.length) return
      const nextOrder = moveItem(order, index, nextIndex)
      persistToolbarState({
        ...toolbarState,
        allowedPrimaryButtons,
        allowedSecondaryButtons,
        primaryButtonsOrder: nextOrder,
        pinnedSecondaryButtonsOrder,
        secondaryButtonsOrder,
      })
      return
    }

    if (selectedButton.group === 'pinned') {
      const order = pinnedSecondaryButtonsOrder
      const index = order.indexOf(selectedButton.id)
      if (index < 0) return
      const nextIndex = index + delta
      if (nextIndex < 0 || nextIndex >= order.length) return
      const nextOrder = moveItem(order, index, nextIndex)
      persistToolbarState({
        ...toolbarState,
        allowedPrimaryButtons,
        allowedSecondaryButtons,
        primaryButtonsOrder,
        pinnedSecondaryButtonsOrder: nextOrder,
        secondaryButtonsOrder,
      })
      return
    }

    const order = secondaryButtonsOrder
    const index = order.indexOf(selectedButton.id)
    if (index < 0) return
    const nextIndex = index + delta
    if (nextIndex < 0 || nextIndex >= order.length) return
    const nextOrder = moveItem(order, index, nextIndex)
    persistToolbarState({
      ...toolbarState,
      allowedPrimaryButtons,
      allowedSecondaryButtons,
      primaryButtonsOrder,
      pinnedSecondaryButtonsOrder,
      secondaryButtonsOrder: nextOrder,
    })
  }

  const addButtonToToolbar = (placement: 'primary' | 'pinned' | 'secondary', id: PrimaryButtonId | SecondaryButtonId) => {
    if (placement === 'primary') {
      const nextId = id as PrimaryButtonId
      if (allowedPrimaryButtons.includes(nextId)) return
      const nextAllowed = [...allowedPrimaryButtons, nextId]
      const nextOrder = normalizePrimaryButtonsOrder([...primaryButtonsOrder, nextId], nextAllowed)
      persistToolbarState({
        ...toolbarState,
        allowedPrimaryButtons: nextAllowed,
        allowedSecondaryButtons,
        primaryButtonsOrder: nextOrder,
        pinnedSecondaryButtonsOrder,
        secondaryButtonsOrder,
      })
      return
    }

    const nextId = id as SecondaryButtonId
    const nextAllowed = allowedSecondaryButtons.includes(nextId) ? allowedSecondaryButtons : [...allowedSecondaryButtons, nextId]

    if (placement === 'pinned') {
      const nextPinned = normalizePinnedSecondaryButtonsOrder([...pinnedSecondaryButtonsOrder, nextId], nextAllowed)
      const nextSecondary = normalizeSecondaryButtonsOrder(
        secondaryButtonsOrder.filter((x) => x !== nextId),
        nextAllowed,
        nextPinned
      )
      persistToolbarState({
        ...toolbarState,
        allowedPrimaryButtons,
        allowedSecondaryButtons: nextAllowed,
        primaryButtonsOrder,
        pinnedSecondaryButtonsOrder: nextPinned,
        secondaryButtonsOrder: nextSecondary,
      })
      return
    }

    const nextPinned = normalizePinnedSecondaryButtonsOrder(
      pinnedSecondaryButtonsOrder.filter((x) => x !== nextId),
      nextAllowed
    )
    const nextSecondary = normalizeSecondaryButtonsOrder([...secondaryButtonsOrder, nextId], nextAllowed, nextPinned)
    persistToolbarState({
      ...toolbarState,
      allowedPrimaryButtons,
      allowedSecondaryButtons: nextAllowed,
      primaryButtonsOrder,
      pinnedSecondaryButtonsOrder: nextPinned,
      secondaryButtonsOrder: nextSecondary,
    })
  }

  const canDeleteSelected =
    selectedButton.group === 'primary'
      ? allowedPrimaryButtons.length > 1
      : allowedSecondaryButtons.includes(selectedButton.id as SecondaryButtonId)

  const deleteSelected = () => {
    if (selectedButton.group === 'primary') {
      const target = selectedButton.id
      if (!allowedPrimaryButtons.includes(target)) return
      const nextAllowed = allowedPrimaryButtons.filter((x) => x !== target)
      if (!nextAllowed.length) return
      const nextOrder = normalizePrimaryButtonsOrder(primaryButtonsOrder.filter((x) => x !== target), nextAllowed)
      persistToolbarState({
        ...toolbarState,
        allowedPrimaryButtons: nextAllowed,
        allowedSecondaryButtons,
        primaryButtonsOrder: nextOrder,
        pinnedSecondaryButtonsOrder,
        secondaryButtonsOrder,
      })
      return
    }

    const target = selectedButton.id as SecondaryButtonId
    const nextAllowed = allowedSecondaryButtons.filter((x) => x !== target)
    const nextPinned = normalizePinnedSecondaryButtonsOrder(
      pinnedSecondaryButtonsOrder.filter((x) => x !== target),
      nextAllowed
    )
    const nextSecondary = normalizeSecondaryButtonsOrder(
      secondaryButtonsOrder.filter((x) => x !== target),
      nextAllowed,
      nextPinned
    )
    persistToolbarState({
      ...toolbarState,
      allowedPrimaryButtons,
      allowedSecondaryButtons: nextAllowed,
      primaryButtonsOrder,
      pinnedSecondaryButtonsOrder: nextPinned,
      secondaryButtonsOrder: nextSecondary,
    })
  }

  const [pendingAdd, setPendingAdd] = React.useState<null | { id: PrimaryButtonId | SecondaryButtonId }>(null)

  const allAddableButtons: Array<{ group: SelectedButton['group']; id: PrimaryButtonId | SecondaryButtonId }> = [
    ...DEFAULT_PRIMARY.map((id) => ({ group: 'primary' as const, id })),
    ...ALL_SECONDARY.map((id) => ({ group: 'secondary' as const, id })),
  ]

  return (
    <div className="settingsContentSection">
      <h2 className="settingsContentTitle">浮动工具栏</h2>
      <p className="settingsContentDescription">配置浮动工具栏的外观和行为</p>

      <div className="settingsToolbarPreview">
        <div className="settingsToolbarPreviewTitle">按钮顺序预览</div>
        <div className="settingsToolbarPreviewHint">点击按钮查看信息，并用下方按钮调整前后顺序</div>

        <div className="settingsToolbarPreviewToolbarShell">
          <Box className="settingsToolbarPreviewToolbarDragArea">
            <Box className="settingsToolbarPreviewToolbarLayout">
              <Box className="settingsToolbarPreviewToolbarBarRow">
                <Box className="settingsToolbarReorderGroup flex flex-nowrap items-center gap-2">
                  {primaryButtonsOrder.map((id) => (
                    <SelectableToolbarButtonItem
                      key={id}
                      group="primary"
                      id={id}
                      selected={selectedButton.group === 'primary' && selectedButton.id === id}
                      onSelect={() => setSelectedButton({ group: 'primary', id })}
                    />
                  ))}
                  {pinnedSecondaryButtonsOrder.map((id) => (
                    <SelectableToolbarButtonItem
                      key={`pinned:${id}`}
                      group="pinned"
                      id={id}
                      selected={selectedButton.group === 'pinned' && selectedButton.id === id}
                      onSelect={() => setSelectedButton({ group: 'pinned', id })}
                    />
                  ))}
                </Box>
              </Box>

              <Box className="settingsToolbarPreviewToolbarBarRow">
                <Button
                  size="sm"
                  variant="light"
                  className="settingsToolbarPreviewToggleButton"
                  title="折叠/展开（预览）"
                  ariaLabel="折叠/展开（预览）"
                  appRegion="no-drag"
                >
                  <ChevronLeftIcon />
                </Button>
              </Box>

              <Box className="settingsToolbarPreviewToolbarBarRow">
                <Box className="settingsToolbarReorderGroup flex flex-nowrap items-center gap-2">
                  {secondaryButtonsOrder.map((id) => (
                    <SelectableToolbarButtonItem
                      key={id}
                      group="secondary"
                      id={id}
                      selected={selectedButton.group === 'secondary' && selectedButton.id === id}
                      onSelect={() => setSelectedButton({ group: 'secondary', id })}
                    />
                  ))}
                </Box>
              </Box>
            </Box>
          </Box>
        </div>

        <div className="settingsToolbarSelectionPanel">
          <div className="settingsToolbarSelectionHeader">
            <div className="settingsToolbarSelectionTitle">按钮信息</div>
            <div className="settingsToolbarSelectionMeta">
              第 {selectedIndex + 1} / {selectedCount} 个
            </div>
          </div>

          <div className="settingsToolbarSelectionBody">
            <div className="settingsToolbarSelectionIcon">{selectedIcon}</div>
            <div className="settingsToolbarSelectionName">{selectedLabel}</div>
          </div>

          <div className="settingsToolbarSelectionActions">
            <Button
              size="sm"
              variant="light"
              title="向前调整"
              ariaLabel="向前调整"
              appRegion="no-drag"
              disabled={!canMovePrev}
              onClick={() => moveSelected(-1)}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              size="sm"
              variant="light"
              title="向后调整"
              ariaLabel="向后调整"
              appRegion="no-drag"
              disabled={!canMoveNext}
              onClick={() => moveSelected(1)}
            >
              <ChevronRightIcon />
            </Button>
            <Button
              size="sm"
              variant="danger"
              title="删除"
              ariaLabel="删除"
              appRegion="no-drag"
              disabled={!canDeleteSelected}
              onClick={deleteSelected}
            >
              <TrashIcon />
            </Button>
          </div>
        </div>

        <div className="settingsToolbarAddPanel">
          <div className="settingsToolbarAddHeader">
            <div className="settingsToolbarAddTitle">添加按钮</div>
            <div className="settingsToolbarAddMeta">点击右侧加号，选择添加到折叠/非折叠区域</div>
          </div>

          <div className="settingsToolbarAddList">
            {allAddableButtons.map((item) => {
              const label = labelForButton(item.id)
              const icon = iconForButton(item.id)
              const desc = descriptionForButton(item.id)
              const isAdded =
                item.group === 'primary'
                  ? allowedPrimaryButtons.includes(item.id as PrimaryButtonId)
                  : allowedSecondaryButtons.includes(item.id as SecondaryButtonId)

              return (
                <div key={`${item.group}:${item.id}`} className="settingsToolbarAddRow">
                  <div className="settingsToolbarAddLeft">
                    <Button size="sm" variant="light" title={label} ariaLabel={label} appRegion="no-drag">
                      {icon}
                    </Button>
                  </div>

                  <div className="settingsToolbarAddMiddle">
                    <div className="settingsToolbarAddName">
                      {label}
                    </div>
                    <div className="settingsToolbarAddDesc">{desc}</div>
                  </div>

                  <div className="settingsToolbarAddRight">
                    <Button
                      size="sm"
                      variant="light"
                      title={isAdded ? '已添加' : '添加到浮动工具栏'}
                      ariaLabel={isAdded ? '已添加' : '添加到浮动工具栏'}
                      appRegion="no-drag"
                      disabled={isAdded}
                      onClick={() => {
                        if (isAdded) return
                        setPendingAdd((prev) => (prev?.id === item.id ? null : { id: item.id }))
                      }}
                    >
                      <PlusIcon />
                    </Button>
                    {pendingAdd?.id === item.id ? (
                      <div className="settingsToolbarAddSubmenu">
                        <Button
                          size="sm"
                          variant="light"
                          className="settingsToolbarAddSubmenuItem"
                          title="添加到非折叠区域"
                          ariaLabel="添加到非折叠区域"
                          appRegion="no-drag"
                          onClick={() => {
                            const placement =
                              item.group === 'primary'
                                ? ('primary' as const)
                                : ('pinned' as const)
                            addButtonToToolbar(placement, item.id)
                            setPendingAdd(null)
                          }}
                        >
                          非折叠区域
                        </Button>
                        <Button
                          size="sm"
                          variant="light"
                          className="settingsToolbarAddSubmenuItem"
                          title={item.group === 'primary' ? '该按钮只能添加到非折叠区域' : '添加到折叠区域'}
                          ariaLabel="添加到折叠区域"
                          appRegion="no-drag"
                          disabled={item.group === 'primary'}
                          onClick={() => {
                            addButtonToToolbar('secondary', item.id)
                            setPendingAdd(null)
                          }}
                        >
                          折叠区域
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function FeaturePanelSettings() {
  return (
    <div className="settingsContentSection">
      <h2 className="settingsContentTitle">功能面板</h2>
      <p className="settingsContentDescription">管理功能面板的显示选项</p>
      
      <div className="settingsContentPlaceholder">
        <div className="settingsContentPlaceholderIcon">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </div>
        <p className="settingsContentPlaceholderText">功能面板设置即将推出</p>
      </div>
    </div>
  )
}

function AnnotationSettings() {
  const [writingSystem, setWritingSystem] = React.useState<'leafer' | 'inkcanvas' | 'winui'>('leafer')
  const writingSystemLabel =
    writingSystem === 'inkcanvas' ? 'inkcanvas' : writingSystem === 'winui' ? 'winui' : 'leafer.js'

  const [leaferSettings, setLeaferSettings] = usePersistedState<LeaferSettings>(
    LEAFER_SETTINGS_KV_KEY,
    {
      multiTouch: false,
      inkSmoothing: true,
      showInkWhenPassthrough: true,
      freezeScreen: false,
      rendererEngine: 'canvas2d',
      nibMode: 'off',
      postBakeOptimize: false,
      postBakeOptimizeOnce: false
    },
    { validate: isLeaferSettings }
  )

  const nibPreviewRef = React.useRef<HTMLCanvasElement | null>(null)

  React.useEffect(() => {
    const canvas = nibPreviewRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    const cssW = Math.max(1, Math.floor(rect.width))
    const cssH = Math.max(1, Math.floor(rect.height))
    const dpr = Math.max(1, Math.floor((globalThis.devicePixelRatio as number) || 1))

    const targetW = cssW * dpr
    const targetH = cssH * dpr
    if (canvas.width !== targetW) canvas.width = targetW
    if (canvas.height !== targetH) canvas.height = targetH

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
    const smoothstep = (edge0: number, edge1: number, x: number) => {
      const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
      return t * t * (3 - 2 * t)
    }

    const points: Array<{ x: number; y: number }> = []
    const padX = 10
    const padY = 12
    const w = cssW - padX * 2
    const h = cssH - padY * 2
    for (let i = 0; i <= 64; i++) {
      const t = i / 64
      const x = padX + w * t
      const y = padY + h * (0.55 + 0.18 * Math.sin(t * Math.PI * 2.2) + 0.05 * Math.sin(t * Math.PI * 6.2))
      points.push({ x, y })
    }

    const totalLen = (() => {
      let len = 0
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x
        const dy = points[i].y - points[i - 1].y
        len += Math.hypot(dx, dy)
      }
      return Math.max(1e-6, len)
    })()

    const nibMode = leaferSettings.nibMode ?? 'off'
    const baseWidth = 12
    const widths: number[] = new Array(points.length).fill(baseWidth)

    if (nibMode === 'dynamic') {
      let acc = 0
      for (let i = 0; i < points.length; i++) {
        if (i > 0) {
          const dx = points[i].x - points[i - 1].x
          const dy = points[i].y - points[i - 1].y
          acc += Math.hypot(dx, dy)
        }
        const t = acc / totalLen
        const start = smoothstep(0, 0.16, t)
        const end = smoothstep(0, 0.16, 1 - t)
        const taper = Math.min(start, end)

        const dist = i > 0 ? Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) : 0
        const speedFactor = clamp(1.15 - dist * 0.12, 0.55, 1.15)
        const w = baseWidth * (0.35 + 0.65 * taper) * speedFactor
        widths[i] = clamp(w, 2, 40)
      }
    }

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'rgba(20, 20, 20, 0.85)'

    if (nibMode !== 'dynamic') {
      ctx.lineWidth = baseWidth
      ctx.beginPath()
      for (let i = 0; i < points.length; i++) {
        const p = points[i]
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
      return
    }

    for (let i = 1; i < points.length; i++) {
      const w0 = widths[i - 1]
      const w1 = widths[i]
      ctx.lineWidth = (w0 + w1) / 2
      ctx.beginPath()
      ctx.moveTo(points[i - 1].x, points[i - 1].y)
      ctx.lineTo(points[i].x, points[i].y)
      ctx.stroke()
    }
  }, [leaferSettings.nibMode])

  const persistLeaferSettings = (next: LeaferSettings) => {
    setLeaferSettings(next)
    void (async () => {
      try {
        await putKv(LEAFER_SETTINGS_KV_KEY, next)
      } catch {
        return
      }
      try {
        await putUiStateKey(UI_STATE_APP_WINDOW_ID, LEAFER_SETTINGS_UI_STATE_KEY, Date.now())
      } catch {
        return
      }
    })()
  }

  return (
    <div className="settingsContentSection">
      <h2 className="settingsContentTitle">批注系统</h2>
      <p className="settingsContentDescription">配置批注工具和笔刷设置</p>

      <div className="settingsFormCard">
        <div className="settingsFormTitle">书写系统</div>
        <div className="settingsFormDescription">切换不同书写系统的启用与设置（占位）</div>
        <Select
          value={writingSystem}
          data={[
            { value: 'leafer', label: 'leafer.js' },
            { value: 'inkcanvas', label: 'inkcanvas' },
            { value: 'winui', label: 'winui' }
          ]}
          allowDeselect={false}
          onChange={(value) => {
            if (value === 'leafer' || value === 'inkcanvas' || value === 'winui') setWritingSystem(value)
          }}
        />
      </div>

      {writingSystem === 'leafer' ? (
        <div className="settingsFormCard">
          <div className="settingsFormTitle">Leafer.js</div>
          <div className="settingsFormDescription">配置 Leafer.js 书写体验</div>
          <div className="settingsFormGroup">
            <div className="settingsFormTitle">笔迹渲染引擎</div>
            <div className="settingsFormDescription">Canvas2D 默认启用低延迟模式；WebGPU 为实验性</div>
            <Select
              value={leaferSettings.rendererEngine ?? 'canvas2d'}
              data={[
                { value: 'canvas2d', label: 'Canvas2D（低延迟，默认）' },
                { value: 'svg', label: 'SVG（矢量）' },
                { value: 'webgl', label: 'WebGL' },
                { value: 'webgpu', label: 'WebGPU（实验性）' }
              ]}
              allowDeselect={false}
              onChange={(value) => {
                if (value !== 'canvas2d' && value !== 'svg' && value !== 'webgl' && value !== 'webgpu') return
                persistLeaferSettings({ ...leaferSettings, rendererEngine: value })
              }}
            />
          </div>
          <div className="settingsFormGroup">
            <div className="settingsFormTitle">笔锋</div>
            <div className="settingsFormDescription">基于分段烘干模拟笔锋（静态模式暂未加入）</div>
            <Select
              value={leaferSettings.nibMode ?? 'off'}
              data={[
                { value: 'off', label: '关闭' },
                { value: 'dynamic', label: '动态烘干笔锋' },
                { value: 'static', label: '静态笔锋（暂未加入）' }
              ]}
              allowDeselect={false}
              onChange={(value) => {
                if (value !== 'off' && value !== 'dynamic' && value !== 'static') return
                persistLeaferSettings({ ...leaferSettings, nibMode: value })
              }}
            />
            <div className="settingsNibPreview">
              <div className="settingsNibPreviewTitle">效果预览</div>
              <canvas ref={nibPreviewRef} className="settingsNibPreviewCanvas" />
            </div>
          </div>
          <div className="settingsSwitchList">
            <Switch
              checked={leaferSettings.multiTouch}
              onChange={(e) => persistLeaferSettings({ ...leaferSettings, multiTouch: e.currentTarget.checked })}
              label="多指书写"
              size="md"
            />
            <Switch
              checked={leaferSettings.inkSmoothing}
              onChange={(e) => persistLeaferSettings({ ...leaferSettings, inkSmoothing: e.currentTarget.checked })}
              label="墨迹平滑"
              size="md"
            />
            <Switch
              checked={leaferSettings.postBakeOptimize ?? false}
              onChange={(e) => {
                const checked = e.currentTarget.checked
                persistLeaferSettings({ ...leaferSettings, postBakeOptimize: checked, postBakeOptimizeOnce: checked ? false : leaferSettings.postBakeOptimizeOnce })
              }}
              label="烘干后处理优化"
              size="md"
            />
            <Switch
              checked={leaferSettings.postBakeOptimizeOnce ?? false}
              onChange={(e) => {
                const checked = e.currentTarget.checked
                persistLeaferSettings({ ...leaferSettings, postBakeOptimizeOnce: checked, postBakeOptimize: checked ? false : leaferSettings.postBakeOptimize })
              }}
              label="笔迹单次烘干"
              size="md"
            />
            <Switch
              checked={leaferSettings.showInkWhenPassthrough}
              onChange={(e) =>
                persistLeaferSettings({ ...leaferSettings, showInkWhenPassthrough: e.currentTarget.checked })
              }
              label="操作穿透时显示笔迹"
              size="md"
            />
            <Switch
              checked={leaferSettings.freezeScreen}
              onChange={(e) => persistLeaferSettings({ ...leaferSettings, freezeScreen: e.currentTarget.checked })}
              label="屏幕内容冻结批注"
              size="md"
            />
          </div>
        </div>
      ) : (
        <div className="settingsContentPlaceholder">
          <div className="settingsContentPlaceholderIcon">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 19l7-7 3 3-7 7-3-3z" />
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
            </svg>
          </div>
          <p className="settingsContentPlaceholderText">{writingSystemLabel} 的启用与设置即将推出</p>
        </div>
      )}
    </div>
  )
}

function LanStartBarSettings() {
  return (
    <div className="settingsContentSection">
      <h2 className="settingsContentTitle">LanStartBar</h2>
      <p className="settingsContentDescription">配置 LanStartBar 的显示和行为</p>
      
      <div className="settingsContentPlaceholder">
        <div className="settingsContentPlaceholderIcon">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <line x1="6" y1="10" x2="6" y2="14" />
            <line x1="10" y1="10" x2="10" y2="14" />
            <line x1="14" y1="10" x2="14" y2="14" />
            <line x1="18" y1="10" x2="18" y2="14" />
          </svg>
        </div>
        <p className="settingsContentPlaceholderText">LanStartBar 设置即将推出</p>
      </div>
    </div>
  )
}

function WhiteboardSettings() {
  const presets = [
    { label: '酸绿', value: '#95C459' },
    { label: '浅灰', value: '#333333' },
    { label: '深灰', value: '#2E2F33' },
    { label: '希绿', value: '#0F261E' },
    { label: 'icc绿', value: '#172A25' },
    { label: '鸿白', value: '#FFFFFF' },
  ] as const

  const bus = useUiStateBus(UI_STATE_APP_WINDOW_ID)
  const uiBg = bus.state[WHITEBOARD_BG_COLOR_UI_STATE_KEY]
  const bgColor = isHexColor(uiBg) ? uiBg : '#ffffff'
  const uiBgImageUrl = bus.state[WHITEBOARD_BG_IMAGE_URL_UI_STATE_KEY]
  const bgImageUrl = isFileOrDataUrl(uiBgImageUrl) ? uiBgImageUrl : ''
  const uiOpacity = bus.state[WHITEBOARD_BG_IMAGE_OPACITY_UI_STATE_KEY]
  const bgImageOpacity =
    typeof uiOpacity === 'number'
      ? Math.max(0, Math.min(1, uiOpacity))
      : typeof uiOpacity === 'string' && Number.isFinite(Number(uiOpacity))
        ? Math.max(0, Math.min(1, Number(uiOpacity)))
        : 0.5

  const onPickBgImage = async () => {
    try {
      const res = await selectImageFile()
      const url = typeof res?.fileUrl === 'string' ? res.fileUrl : ''
      if (!url) return
      await putUiStateKey(UI_STATE_APP_WINDOW_ID, WHITEBOARD_BG_IMAGE_URL_UI_STATE_KEY, url)
    } catch {
      return
    }
  }

  return (
    <div className="settingsContentSection">
      <h2 className="settingsContentTitle">白板</h2>
      <p className="settingsContentDescription">选择白板背景颜色</p>

      <div className="settingsWhiteboardColorGrid">
        {presets.map((preset) => (
          <div key={preset.label} className="settingsWhiteboardColorItem">
            <Button
              kind="custom"
              appRegion="no-drag"
              ariaLabel={preset.label}
              title={`${preset.label} ${preset.value}`}
              className={`settingsWhiteboardColorSwatch ${bgColor === preset.value ? 'settingsWhiteboardColorSwatch--active' : ''}`}
              onClick={() => putUiStateKey(UI_STATE_APP_WINDOW_ID, WHITEBOARD_BG_COLOR_UI_STATE_KEY, preset.value).catch(() => undefined)}
              style={{ background: preset.value }}
            >
              <span className="settingsWhiteboardColorSwatchInner" />
            </Button>
            <div className="settingsWhiteboardColorLabel">{preset.label}</div>
          </div>
        ))}
      </div>

      <div className="settingsSubSection">
        <h3 className="settingsSubTitle">背景图</h3>
        <p className="settingsSubDescription">选择一张图片作为白板背景</p>
        <Button kind="text" size="md" appRegion="no-drag" ariaLabel="添加图片背景" onClick={onPickBgImage}>
          添加图片背景
        </Button>
        {bgImageUrl ? (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              style={{
                width: 240,
                maxWidth: '100%',
                aspectRatio: '16 / 10',
                borderRadius: 12,
                overflow: 'hidden',
                border: '1px solid rgba(0,0,0,0.14)',
                background: 'rgba(255,255,255,0.06)'
              }}
            >
              <img
                src={bgImageUrl}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'center',
                  display: 'block',
                  opacity: bgImageOpacity
                }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.9, minWidth: 60 }}>透明度</div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(bgImageOpacity * 100)}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  const next = Number.isFinite(v) ? Math.max(0, Math.min(1, v / 100)) : 0.5
                  putUiStateKey(UI_STATE_APP_WINDOW_ID, WHITEBOARD_BG_IMAGE_OPACITY_UI_STATE_KEY, next).catch(() => undefined)
                }}
                style={{ flex: 1 }}
              />
              <div style={{ fontSize: 12, opacity: 0.9, minWidth: 44, textAlign: 'right' }}>{Math.round(bgImageOpacity * 100)}%</div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <Button
                kind="text"
                size="md"
                appRegion="no-drag"
                ariaLabel="删除背景图片"
                onClick={() => putUiStateKey(UI_STATE_APP_WINDOW_ID, WHITEBOARD_BG_IMAGE_URL_UI_STATE_KEY, '').catch(() => undefined)}
              >
                删除背景图片
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function AboutSettings() {
  return (
    <div className="settingsContentSection">
      <h2 className="settingsContentTitle">关于</h2>
      <p className="settingsContentDescription">应用信息和版本详情</p>
      
      <div className="settingsAboutCard">
        <div className="settingsAboutLogo">
          <img src={LanStartLogoSvg} width={64} height={64} alt="LanStartWrite" />
        </div>
        <h3 className="settingsAboutAppName">LanStartWrite</h3>
        <p className="settingsAboutVersion">
          版本 {__APP_VERSION__} · 代号 {__APP_CODENAME__}
        </p>
        <p className="settingsAboutDescription">
          一款现代化的屏幕批注和演示工具，
          <br />
          帮助您更高效地进行屏幕标注和演示。
        </p>
        
        <div className="settingsAboutLinks">
          <a href="#" className="settingsAboutLink">官方网站</a>
          <a href="#" className="settingsAboutLink">GitHub</a>
          <a href="#" className="settingsAboutLink">反馈问题</a>
        </div>
      </div>
      
      <div className="settingsAboutCredits">
        <h4 className="settingsAboutCreditsTitle">技术栈</h4>
        <div className="settingsAboutCreditsList">
          <span className="settingsAboutCredit">Electron</span>
          <span className="settingsAboutCredit">React</span>
          <span className="settingsAboutCredit">TypeScript</span>
          <span className="settingsAboutCredit">Framer Motion</span>
        </div>
      </div>
    </div>
  )
}

function VideoShowSettings() {
  const bus = useUiStateBus(UI_STATE_APP_WINDOW_ID)
  const mode = bus.state[APP_MODE_UI_STATE_KEY]

  const [mergeLayers, setMergeLayers] = usePersistedState<boolean>(VIDEO_SHOW_MERGE_LAYERS_KV_KEY, true, {
    validate: (v): v is boolean => typeof v === 'boolean'
  })

  const persistMergeLayers = (next: boolean) => {
    setMergeLayers(next)
    void (async () => {
      try {
        await putKv(VIDEO_SHOW_MERGE_LAYERS_KV_KEY, next)
      } catch {
        return
      }
      try {
        await putUiStateKey(UI_STATE_APP_WINDOW_ID, VIDEO_SHOW_MERGE_LAYERS_UI_STATE_KEY, next)
      } catch {
        return
      }
    })()
  }

  const disabled = mode !== 'video-show'

  return (
    <div className="settingsContentSection">
      <h2 className="settingsContentTitle">视频展台</h2>
      <p className="settingsContentDescription">配置视频展台模式下的画面与批注设置</p>

      <div className="settingsFormCard">
        <div className="settingsFormTitle">图像与批注层</div>
        <div className="settingsFormDescription">仅在进入视频展台模式后生效</div>
        <Switch
          checked={mergeLayers}
          onChange={(e) => persistMergeLayers(e.currentTarget.checked)}
          label="合并图像与批注层"
          size="md"
          disabled={disabled}
        />
      </div>
    </div>
  )
}

function OfficeSettings() {
  const [pptMode, setPptMode] = usePersistedState<OfficePptMode>(OFFICE_PPT_MODE_KV_KEY, 'inkeys', {
    validate: (v): v is OfficePptMode => v === 'inkeys' || v === 'based' || v === 'vsto'
  })

  const [pptBackendStatus, setPptBackendStatus] = React.useState<'loading' | 'ok' | 'error'>('loading')

  const persistPptMode = (next: string | null) => {
    const v = next as OfficePptMode
    if (v !== 'inkeys' && v !== 'based' && v !== 'vsto') return
    setPptMode(v)
    void (async () => {
      try {
        await putKv(OFFICE_PPT_MODE_KV_KEY, v)
      } catch {
        return
      }
      try {
        await putUiStateKey(UI_STATE_APP_WINDOW_ID, OFFICE_PPT_MODE_UI_STATE_KEY, v)
      } catch {
        return
      }
    })()
  }

  React.useEffect(() => {
    if (pptMode !== 'inkeys') {
      setPptBackendStatus('loading')
      return
    }

    let cancelled = false
    const check = async () => {
      try {
        const res = await window.lanstart?.apiRequest({ method: 'GET', path: '/ppt/health' })
        const ok = (res as any)?.status === 200 && Boolean((res as any)?.body?.ok)
        if (!cancelled) setPptBackendStatus(ok ? 'ok' : 'error')
      } catch {
        if (!cancelled) setPptBackendStatus('error')
      }
    }

    void check()
    const timer = setInterval(check, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [pptMode])

  return (
    <div className="settingsContentSection">
      <h2 className="settingsContentTitle">Office</h2>
      <p className="settingsContentDescription">配置 Office 办公软件的相关设置</p>

      <div className="settingsFormCard">
        <div className="settingsFormTitle">Word</div>
        <div className="settingsFormDescription">Word 相关设置（暂无）</div>
      </div>

      <div className="settingsFormCard">
        <div className="settingsFormTitle">PowerPoint</div>
        <div className="settingsFormDescription">PowerPoint 演示模式设置</div>
        <div className="settingsFormGroup">
          <Select
            label="演示模式"
            description="选择 PowerPoint 的控制与批注实现方式"
            value={pptMode}
            onChange={persistPptMode}
            data={[
              { value: 'inkeys', label: 'InKeys' },
              { value: 'based', label: 'Based (未实现)' },
              { value: 'vsto', label: 'VSTO (未实现)' }
            ]}
          />
        </div>
        {pptMode === 'inkeys' && (
          <Box mt="md">
            <div className="settingsBackendStatus">
              <span className={`settingsBackendStatusDot settingsBackendStatusDot--${pptBackendStatus}`} />
              <span className="settingsBackendStatusText">
                {pptBackendStatus === 'loading'
                  ? '正在检查后端服务...'
                  : pptBackendStatus === 'ok'
                    ? 'PPT 联动功能正常，后端服务运行正常'
                    : '后端服务连接失败，请检查服务状态'}
              </span>
            </div>
          </Box>
        )}
      </div>
    </div>
  )
}

function SystemSettings() {
  const bus = useUiStateBus(UI_STATE_APP_WINDOW_ID)
  const isAdmin = bus.state[ADMIN_STATUS_UI_STATE_KEY] === true

  const [uiaTopmost, setUiaTopmost] = usePersistedState<boolean>(SYSTEM_UIA_TOPMOST_KV_KEY, true, {
    validate: (v): v is boolean => typeof v === 'boolean'
  })

  const [mergeRendererPipeline, setMergeRendererPipeline] = usePersistedState<boolean>(SYSTEM_MERGE_RENDERER_PIPELINE_KV_KEY, false, {
    validate: (v): v is boolean => typeof v === 'boolean'
  })

  const persistUiaTopmost = (next: boolean) => {
    setUiaTopmost(next)
    void (async () => {
      try {
        await putKv(SYSTEM_UIA_TOPMOST_KV_KEY, next)
      } catch {
        return
      }
      try {
        await putUiStateKey(UI_STATE_APP_WINDOW_ID, SYSTEM_UIA_TOPMOST_UI_STATE_KEY, next)
      } catch {}
    })()
  }

  const persistMergeRendererPipeline = (next: boolean) => {
    setMergeRendererPipeline(next)
    void (async () => {
      try {
        await putKv(SYSTEM_MERGE_RENDERER_PIPELINE_KV_KEY, next)
      } catch {}
    })()
  }

  return (
    <div className="settingsContentSection">
      <h2 className="settingsContentTitle">系统</h2>
      <p className="settingsContentDescription">配置系统相关能力与运行状态</p>

      <div className="settingsFormCard">
        <div className="settingsFormTitle">权限状态</div>
        <div className="settingsFormDescription">用于判断是否启用管理员增强置顶策略</div>
        <div className="settingsFormGroup">
          <div className="settingsBackendStatus">
            <span className={`settingsBackendStatusDot settingsBackendStatusDot--${isAdmin ? 'ok' : 'error'}`} />
            <span className="settingsBackendStatusText">{isAdmin ? '已获得管理员权限' : '未获得管理员权限'}</span>
          </div>
        </div>
      </div>

      <div className="settingsFormCard">
        <div className="settingsFormTitle">置顶策略</div>
        <div className="settingsFormDescription">开启后使用 UIA/Win32 强制置顶（更稳，但更激进）</div>
        <div className="settingsFormGroup">
          <Switch checked={uiaTopmost} onChange={(e) => persistUiaTopmost(e.currentTarget.checked)} label="启用 UIA 强制置顶" size="md" />
        </div>
      </div>

      <div className="settingsFormCard">
        <div className="settingsFormTitle">渲染进程</div>
        <div className="settingsFormDescription">
          开启后多个窗口会尽量共享 renderer 进程以降低内存占用（独立性降低，任一窗口卡死可能影响其它窗口；会自动重建窗口）
        </div>
        <div className="settingsFormGroup">
          <Switch
            checked={mergeRendererPipeline}
            onChange={(e) => persistMergeRendererPipeline(e.currentTarget.checked)}
            label="合并渲染管线（共享 renderer）"
            size="md"
          />
        </div>
      </div>
    </div>
  )
}

const contentComponents: Record<SettingsTab, React.FC> = {
  appearance: AppearanceSettings,
  toolbar: ToolbarSettings,
  'feature-panel': FeaturePanelSettings,
  annotation: AnnotationSettings,
  whiteboard: WhiteboardSettings,
  'video-show': VideoShowSettings,
  office: OfficeSettings,
  system: SystemSettings,
  'lanstart-bar': LanStartBarSettings,
  about: AboutSettings,
}

export function SettingsContent({ activeTab }: SettingsContentProps) {
  const ContentComponent = contentComponents[activeTab]
  
  return (
    <div className="settingsContent">
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.2 }}
        className="settingsContentInner"
      >
        <ContentComponent />
      </motion.div>
    </div>
  )
}
