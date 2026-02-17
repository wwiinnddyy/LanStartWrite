import React from 'react'
import { FeaturePanelIcon, QuitIcon, SettingsIcon, WatcherIcon } from '../toolbar/components/ToolbarIcons'
import { LanStartBarRegistry } from './registry'

let builtinRegistered = false

export function ensureBuiltinLanStartBarContributions(registry: LanStartBarRegistry): void {
  if (builtinRegistered) return
  builtinRegistered = true

  registry.register({
    id: 'feature-panel',
    label: '功能面板',
    ariaLabel: '功能面板',
    title: '功能面板',
    icon: <FeaturePanelIcon />,
    variant: 'default',
    size: 'sm',
    kind: 'icon',
    order: 10,
    action: { type: 'toggleSubwindow', kind: 'feature-panel', placement: 'bottom' }
  })

  registry.register({
    id: 'watcher',
    label: '监视器',
    ariaLabel: '监视器',
    title: '监视器',
    icon: <WatcherIcon />,
    variant: 'default',
    size: 'sm',
    kind: 'icon',
    order: 20,
    action: { type: 'postCommand', command: 'watcher.openWindow' }
  })

  registry.register({
    id: 'settings',
    label: '设置',
    ariaLabel: '设置',
    title: '设置',
    icon: <SettingsIcon />,
    variant: 'default',
    size: 'sm',
    kind: 'icon',
    order: 30,
    action: { type: 'postCommand', command: 'app.openSettingsWindow' }
  })

  registry.register({
    id: 'quit',
    label: '退出',
    ariaLabel: '退出',
    title: '退出',
    icon: <QuitIcon />,
    variant: 'danger',
    size: 'sm',
    kind: 'icon',
    order: 999,
    action: { type: 'postCommand', command: 'quit' }
  })
}

