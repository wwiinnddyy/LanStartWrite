import type { ForegroundWindowSample } from './types'

export type ActiveApp = 'unknown' | 'word' | 'ppt'

export function identifyActiveApp(sample: ForegroundWindowSample | undefined): { activeApp: ActiveApp; pptFullscreen: boolean } {
  if (!sample) return { activeApp: 'unknown', pptFullscreen: false }
  const name = (sample.processName ?? '').toLowerCase()
  const title = (sample.title ?? '').toLowerCase()

  if (name.includes('winword') || name === 'word' || name.includes('microsoft word')) return { activeApp: 'word', pptFullscreen: false }
  if (name.includes('powerpnt') || name.includes('powerpoint') || name === 'ppt') {
    const pptFullscreen =
      title.includes('slide show') ||
      title.includes('幻灯片放映') ||
      title.includes('slideshow') ||
      title.includes('presentation') ||
      title.includes('放映')
    return { activeApp: 'ppt', pptFullscreen }
  }

  return { activeApp: 'unknown', pptFullscreen: false }
}

