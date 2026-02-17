import React, { useMemo, useSyncExternalStore } from 'react'
import { Button, ButtonGroup } from '../button'
import { useAppearanceSettings } from '../settings'
import { markQuitting, postCommand } from '../toolbar/hooks/useBackend'
import { LanStartBarRegistry, lanStartBarRegistry, type LanStartBarItem, type LanStartBarItemAction } from './registry'
import '../toolbar/styles/toolbar.css'

export const WINDOW_ID_LANSTART_BAR = 'lanstart-bar'

function runAction(action: LanStartBarItemAction): void {
  if (action.type === 'postCommand') {
    void postCommand(action.command, action.payload)
    return
  }

  void postCommand('toggle-subwindow', { kind: action.kind, placement: action.placement })
}

function useLanStartBarItems(registry: LanStartBarRegistry): LanStartBarItem[] {
  const subscribe = useMemo(() => (listener: () => void) => registry.subscribe(listener), [registry])
  const getSnapshot = useMemo(() => () => registry.list(), [registry])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function LanStartBarApp(props: { registry?: LanStartBarRegistry }) {
  useAppearanceSettings()

  const registry = useMemo(() => props.registry ?? lanStartBarRegistry, [props.registry])

  const items = useLanStartBarItems(registry)

  return (
    <div className="toolbarRoot" data-window="lanstart-bar">
      <div className="toolbarDragArea">
        <div className="toolbarLayout">
          <div className="toolbarBarRow">
            <ButtonGroup>
              {items.map((item) => (
                <Button
                  key={item.id}
                  size={item.size ?? 'sm'}
                  variant={item.variant ?? 'default'}
                  kind={item.kind ?? (item.icon ? 'icon' : 'text')}
                  ariaLabel={item.ariaLabel ?? item.label}
                  title={item.title ?? item.label}
                  onClick={() => {
                    if (item.id === 'quit') markQuitting()
                    runAction(item.action)
                  }}
                >
                  {item.icon ?? item.label}
                </Button>
              ))}
            </ButtonGroup>
          </div>
        </div>
      </div>
    </div>
  )
}
