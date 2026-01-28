import type { Rgba } from './types'
import { mix, rgba } from './color'

export type MicaMode = 'light' | 'dark'

export function computeMicaFromSeed(seed: Rgba, mode: MicaMode) {
  const darkBase = rgba(15, 16, 20, 255)
  const lightBase = rgba(243, 243, 243, 255)

  const base = mode === 'dark' ? mix(darkBase, seed, 0.12) : mix(lightBase, seed, 0.06)
  const background = mode === 'dark' ? { ...base, a: 220 } : { ...base, a: 200 }
  const surface = mode === 'dark' ? mix(background, rgba(255, 255, 255, 255), 0.06) : mix(background, rgba(0, 0, 0, 255), 0.04)
  const border = mode === 'dark' ? rgba(255, 255, 255, 28) : rgba(0, 0, 0, 22)

  return { background, surface, border }
}

