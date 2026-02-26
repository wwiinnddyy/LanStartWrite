import React from 'react'
import { FeaturePanelIcon, QuitIcon, SettingsIcon } from '../toolbar/components/ToolbarIcons'
import { LanStartBarRegistry } from './registry'

let builtinRegistered = false

export function ensureBuiltinLanStartBarContributions(registry: LanStartBarRegistry): void {
  if (builtinRegistered) return
  builtinRegistered = true

  registry.register({
    id: 'feature-panel',
    label: '鍔熻兘闈㈡澘',
    ariaLabel: '鍔熻兘闈㈡澘',
    title: '鍔熻兘闈㈡澘',
    icon: <FeaturePanelIcon />,
    variant: 'default',
    size: 'sm',
    kind: 'icon',
    order: 10,
    action: { type: 'toggleSubwindow', kind: 'feature-panel', placement: 'bottom' }
  })

  registry.register({
    id: 'settings',
    label: '璁剧疆',
    ariaLabel: '璁剧疆',
    title: '璁剧疆',
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



