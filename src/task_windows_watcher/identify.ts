import type { ForegroundWindowSample } from './types'

export type ActiveApp = 'unknown' | 'word' | 'ppt'

function normalizeToken(input: unknown): string {
  const s = typeof input === 'string' ? input : ''
  return s.trim().toLowerCase().replace(/\.exe$/i, '').replace(/[\s._-]+/g, '')
}

function normalizeTitle(input: unknown): string {
  const s = typeof input === 'string' ? input : ''
  return s.trim().toLowerCase()
}

function looksLikePowerPointTitle(title: string): boolean {
  if (!title) return false
  if (title.includes('microsoft powerpoint')) return true
  if (title.includes('powerpoint')) return true
  if (title.includes('powerpnt')) return true
  if (/\.(pptx|pptm|ppt|ppsx|ppsm|pps)\b/i.test(title)) return true
  if (title.includes('幻灯片') || title.includes('演示文稿')) return true
  return false
}

function looksLikePptSlideShowTitle(title: string): boolean {
  if (!title) return false
  if (title.includes('slide show')) return true
  if (title.includes('slideshow')) return true
  if (title.includes('幻灯片放映')) return true
  if (title.includes('放映')) return true
  if (title.includes('展示') && title.includes('幻灯片')) return true
  return false
}

export function identifyActiveApp(sample: ForegroundWindowSample | undefined): { activeApp: ActiveApp; pptFullscreen: boolean } {
  if (!sample) return { activeApp: 'unknown', pptFullscreen: false }
  const nameToken = normalizeToken(sample.processName)
  const title = normalizeTitle(sample.title)

  if (nameToken.includes('winword') || nameToken === 'word' || nameToken.includes('microsoftword')) return { activeApp: 'word', pptFullscreen: false }

  let pptScore = 0
  if (nameToken === 'powerpnt' || nameToken.includes('powerpnt')) pptScore += 3
  if (nameToken === 'pptview' || nameToken.includes('pptview')) pptScore += 2
  if (nameToken.includes('powerpoint') || nameToken === 'ppt') pptScore += 2
  if (looksLikePowerPointTitle(title)) pptScore += 2
  if (looksLikePptSlideShowTitle(title)) pptScore += 2

  if (pptScore >= 3) {
    const pptFullscreen = looksLikePptSlideShowTitle(title)
    return { activeApp: 'ppt', pptFullscreen }
  }

  return { activeApp: 'unknown', pptFullscreen: false }
}

