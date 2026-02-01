import { useEffect, useRef, useState } from 'react'
import { getEvents, type BackendEventItem } from '../../status'

export function useEventsPoll(intervalMs = 800) {
  const [items, setItems] = useState<BackendEventItem[]>([])
  const latestRef = useRef(0)

  useEffect(() => {
    let cancelled = false

    const tick = async () => {
      try {
        const res = await getEvents(latestRef.current)
        if (cancelled) return
        if (res.items.length) setItems((prev) => [...prev.slice(-80), ...res.items])
        latestRef.current = res.latest
      } catch {
        return
      }
    }

    const id = window.setInterval(tick, intervalMs)
    tick()
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [intervalMs])

  return items
}
