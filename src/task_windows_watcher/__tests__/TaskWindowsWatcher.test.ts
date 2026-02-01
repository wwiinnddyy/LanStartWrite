import { describe, expect, it, vi } from 'vitest'
import { TaskWindowsWatcher } from '../TaskWindowsWatcher'
import { identifyActiveApp } from '../identify'
import type { TaskWatcherAdapter } from '../types'

describe('TaskWindowsWatcher', () => {
  it('emits process snapshot only on change', async () => {
    vi.useFakeTimers()
    const emitted: any[] = []
    let cpu = 1

    const adapter: TaskWatcherAdapter = {
      getProcesses: async () => [{ pid: 100, name: 'demo', cpuTimeMs: cpu, memoryBytes: 1024 * 1024 }],
      getForegroundWindow: async () => undefined
    }

    let now = 0
    const watcher = new TaskWindowsWatcher({
      adapter,
      emit: (m) => emitted.push(m),
      now: () => now,
      defaultIntervalMs: 1000
    })

    watcher.start(1000)
    await watcher.tick()
    cpu += 1000
    now += 1000
    await watcher.tick()
    await watcher.tick()
    watcher.stop()

    const snaps = emitted.filter((e) => e.type === 'TASK_WATCHER_PROCESS_SNAPSHOT')
    expect(snaps.length).toBe(2)
    vi.useRealTimers()
  })

  it('emits window focus only when it changes', async () => {
    vi.useFakeTimers()
    const emitted: any[] = []
    const windows = [
      { title: 'A', pid: 1, processName: 'WINWORD', handle: '1' },
      { title: 'A', pid: 1, processName: 'WINWORD', handle: '1' },
      { title: 'B', pid: 2, processName: 'POWERPNT', handle: '2' }
    ]
    let idx = 0

    const adapter: TaskWatcherAdapter = {
      getProcesses: async () => [],
      getForegroundWindow: async () => windows[idx++]
    }

    let now = 0
    const watcher = new TaskWindowsWatcher({
      adapter,
      emit: (m) => emitted.push(m),
      now: () => now,
      defaultIntervalMs: 1000
    })

    watcher.start(1000)
    await watcher.tick()
    now += 1000
    await watcher.tick()
    now += 1000
    await watcher.tick()
    watcher.stop()

    const focus = emitted.filter((e) => e.type === 'TASK_WATCHER_WINDOW_FOCUS')
    expect(focus.length).toBe(2)
    vi.useRealTimers()
  })
})

describe('identifyActiveApp', () => {
  it('detects word and ppt', () => {
    expect(identifyActiveApp({ title: 'Doc', processName: 'WINWORD' }).activeApp).toBe('word')
    const ppt = identifyActiveApp({ title: 'Slide Show', processName: 'POWERPNT' })
    expect(ppt.activeApp).toBe('ppt')
    expect(ppt.pptFullscreen).toBe(true)
  })
})

