import React from 'react'
import { Box, Select } from '@mantine/core'
import { motion } from '../../Framer_Motion'
import { putUiStateKey, TOOLBAR_STATE_KEY, TOOLBAR_STATE_UI_STATE_KEY, UI_STATE_APP_WINDOW_ID, useAppAppearance, usePersistedState } from '../../status'
import { Button } from '../../button'
import type { SettingsTab } from '../types'
import { AccentColorPicker } from './AccentColorPicker'
import { TransitionSettings } from './TransitionSettings'
import { useAppearanceSettings } from '../hooks/useAppearanceSettings'
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
        <button
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
        </button>

        <button
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
        </button>
      </div>

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
  type PrimaryButtonId = 'mouse' | 'pen' | 'eraser' | 'whiteboard'
  type SecondaryButtonId = 'undo' | 'redo' | 'feature-panel'
  type SelectedButton =
    | { group: 'primary'; id: PrimaryButtonId }
    | { group: 'secondary'; id: SecondaryButtonId }

  type ToolbarState = {
    collapsed: boolean
    alwaysOnTop: boolean
    uiWidth?: number
    uiButtonSize?: 'sm' | 'md'
    tool?: 'mouse' | 'pen' | 'eraser'
    expanded?: boolean
    primaryButtonsOrder?: Array<'mouse' | 'pen' | 'eraser' | 'whiteboard'>
    secondaryButtonsOrder?: Array<'undo' | 'redo' | 'feature-panel'>
  }

  const DEFAULT_PRIMARY: PrimaryButtonId[] = ['mouse', 'pen', 'eraser', 'whiteboard']
  const DEFAULT_SECONDARY: SecondaryButtonId[] = ['undo', 'redo', 'feature-panel']

  const isToolbarState = (value: unknown): value is ToolbarState => {
    if (!value || typeof value !== 'object') return false
    const v = value as any
    const okBase = typeof v.collapsed === 'boolean' && typeof v.alwaysOnTop === 'boolean'
    if (!okBase) return false
    if (v.uiWidth !== undefined && typeof v.uiWidth !== 'number') return false
    if (v.uiButtonSize !== undefined && v.uiButtonSize !== 'sm' && v.uiButtonSize !== 'md') return false
    if (v.tool !== undefined && v.tool !== 'mouse' && v.tool !== 'pen' && v.tool !== 'eraser') return false
    if (v.expanded !== undefined && typeof v.expanded !== 'boolean') return false
    if (v.primaryButtonsOrder !== undefined && !Array.isArray(v.primaryButtonsOrder)) return false
    if (v.secondaryButtonsOrder !== undefined && !Array.isArray(v.secondaryButtonsOrder)) return false
    return true
  }

  const [toolbarState, setToolbarState] = usePersistedState<ToolbarState>(
    TOOLBAR_STATE_KEY,
    {
      collapsed: false,
      alwaysOnTop: true,
      uiWidth: 360,
      uiButtonSize: 'sm',
      expanded: true,
      primaryButtonsOrder: DEFAULT_PRIMARY,
      secondaryButtonsOrder: DEFAULT_SECONDARY,
    },
    { validate: isToolbarState }
  )

  const primaryButtonsOrder = toolbarState.primaryButtonsOrder ?? DEFAULT_PRIMARY
  const secondaryButtonsOrder = toolbarState.secondaryButtonsOrder ?? DEFAULT_SECONDARY

  const labelForButton = (id: PrimaryButtonId | SecondaryButtonId) => {
    if (id === 'mouse') return '鼠标'
    if (id === 'pen') return '笔'
    if (id === 'eraser') return '橡皮'
    if (id === 'whiteboard') return '白板'
    if (id === 'undo') return '撤销'
    if (id === 'redo') return '重做'
    return '功能面板'
  }

  function ToolbarToolIcon(props: { kind: PrimaryButtonId }) {
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

  const iconForButton = (id: PrimaryButtonId | SecondaryButtonId) => {
    if (id === 'mouse') return <ToolbarToolIcon kind="mouse" />
    if (id === 'pen') return <ToolbarToolIcon kind="pen" />
    if (id === 'eraser') return <ToolbarToolIcon kind="eraser" />
    if (id === 'whiteboard') return <ToolbarToolIcon kind="whiteboard" />
    if (id === 'undo') return <UndoIcon />
    if (id === 'redo') return <RedoIcon />
    return <FeaturePanelIcon />
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
    if (!secondaryButtonsOrder.includes(selectedButton.id)) {
      setSelectedButton({ group: 'secondary', id: secondaryButtonsOrder[0] ?? 'undo' })
    }
  }, [primaryButtonsOrder, secondaryButtonsOrder, selectedButton.group, selectedButton.id])

  const selectedLabel = labelForButton(selectedButton.id)
  const selectedIcon = iconForButton(selectedButton.id)
  const selectedIndex =
    selectedButton.group === 'primary'
      ? primaryButtonsOrder.indexOf(selectedButton.id)
      : secondaryButtonsOrder.indexOf(selectedButton.id)
  const selectedCount = selectedButton.group === 'primary' ? primaryButtonsOrder.length : secondaryButtonsOrder.length
  const canMovePrev = selectedIndex > 0
  const canMoveNext = selectedIndex >= 0 && selectedIndex < selectedCount - 1

  const moveSelected = (delta: -1 | 1) => {
    setToolbarState((prev) => {
      if (selectedButton.group === 'primary') {
        const order = prev.primaryButtonsOrder ?? DEFAULT_PRIMARY
        const index = order.indexOf(selectedButton.id)
        if (index < 0) return prev
        const nextIndex = index + delta
        if (nextIndex < 0 || nextIndex >= order.length) return prev
        const nextOrder = moveItem(order, index, nextIndex)
        return { ...prev, primaryButtonsOrder: nextOrder }
      }

      const order = prev.secondaryButtonsOrder ?? DEFAULT_SECONDARY
      const index = order.indexOf(selectedButton.id)
      if (index < 0) return prev
      const nextIndex = index + delta
      if (nextIndex < 0 || nextIndex >= order.length) return prev
      const nextOrder = moveItem(order, index, nextIndex)
      return { ...prev, secondaryButtonsOrder: nextOrder }
    })

    window.setTimeout(() => {
      void putUiStateKey(UI_STATE_APP_WINDOW_ID, TOOLBAR_STATE_UI_STATE_KEY, Date.now())
    }, 320)
  }

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
              {selectedButton.group === 'primary' ? '主工具区' : '扩展区'} · 第 {selectedIndex + 1} / {selectedCount}{' '}
              个
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
              onPointerDown={() => moveSelected(-1)}
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
              onPointerDown={() => moveSelected(1)}
            >
              <ChevronRightIcon />
            </Button>
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

      <div className="settingsContentPlaceholder">
        <div className="settingsContentPlaceholderIcon">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 19l7-7 3 3-7 7-3-3z" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
          </svg>
        </div>
        <p className="settingsContentPlaceholderText">{writingSystemLabel} 的启用与设置即将推出</p>
      </div>
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

function AboutSettings() {
  return (
    <div className="settingsContentSection">
      <h2 className="settingsContentTitle">关于</h2>
      <p className="settingsContentDescription">应用信息和版本详情</p>
      
      <div className="settingsAboutCard">
        <div className="settingsAboutLogo">
          <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4" />
            <path d="M12 18v4" />
            <path d="M4.93 4.93l2.83 2.83" />
            <path d="M16.24 16.24l2.83 2.83" />
            <path d="M2 12h4" />
            <path d="M18 12h4" />
            <path d="M4.93 19.07l2.83-2.83" />
            <path d="M16.24 7.76l2.83-2.83" />
          </svg>
        </div>
        <h3 className="settingsAboutAppName">LanStartWrite</h3>
        <p className="settingsAboutVersion">版本 {__APP_VERSION__}</p>
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

const contentComponents: Record<SettingsTab, React.FC> = {
  appearance: AppearanceSettings,
  toolbar: ToolbarSettings,
  'feature-panel': FeaturePanelSettings,
  annotation: AnnotationSettings,
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
