import type React from 'react'
import type { ButtonKind, ButtonSize, ButtonVariant } from '../button'

export type LanStartBarItemAction =
  | { type: 'postCommand'; command: string; payload?: unknown }
  | { type: 'toggleSubwindow'; kind: string; placement: 'top' | 'bottom' }

export type LanStartBarItem = Readonly<{
  id: string
  label: string
  icon?: React.ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  kind?: ButtonKind
  ariaLabel?: string
  title?: string
  order?: number
  group?: string
  action: LanStartBarItemAction
}>

export class LanStartBarRegistry {
  private readonly items = new Map<string, LanStartBarItem>()
  private readonly listeners = new Set<() => void>()

  register(item: LanStartBarItem): () => void {
    this.items.set(item.id, item)
    this.emit()
    return () => {
      const stored = this.items.get(item.id)
      if (stored === item) {
        this.items.delete(item.id)
        this.emit()
      }
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  list(): LanStartBarItem[] {
    return Array.from(this.items.values()).sort((a, b) => {
      const ga = a.group ?? ''
      const gb = b.group ?? ''
      if (ga !== gb) return ga.localeCompare(gb)
      const oa = typeof a.order === 'number' ? a.order : 0
      const ob = typeof b.order === 'number' ? b.order : 0
      if (oa !== ob) return oa - ob
      return a.label.localeCompare(b.label)
    })
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }
}

export const lanStartBarRegistry = new LanStartBarRegistry()

export function registerLanStartBarItem(item: LanStartBarItem): () => void {
  return lanStartBarRegistry.register(item)
}
