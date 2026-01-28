import type { MonetPalette, Rgba } from './types'
import { clamp01, hslToRgb, luma, mix, rgbToHsl, rgba } from './color'

type Bin = { r: number; g: number; b: number; count: number }

function binKey(c: Rgba): number {
  const r = c.r >> 3
  const g = c.g >> 3
  const b = c.b >> 3
  return (r << 10) | (g << 5) | b
}

function binToRgb(key: number): Rgba {
  const r = (key >> 10) & 31
  const g = (key >> 5) & 31
  const b = key & 31
  return rgba((r << 3) + 4, (g << 3) + 4, (b << 3) + 4, 255)
}

export function extractMonetSeedFromRgbaBitmap(
  rgbaBitmap: Uint8Array,
  width: number,
  height: number
): Rgba {
  if (width <= 0 || height <= 0 || rgbaBitmap.length < width * height * 4) {
    return rgba(82, 92, 120, 255)
  }

  const stride = width * 4
  const targetSamples = 20000
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / targetSamples)))

  const map = new Map<number, Bin>()
  for (let y = 0; y < height; y += step) {
    const row = y * stride
    for (let x = 0; x < width; x += step) {
      const i = row + x * 4
      const a = rgbaBitmap[i + 3] ?? 255
      if (a < 200) continue
      const r = rgbaBitmap[i] ?? 0
      const g = rgbaBitmap[i + 1] ?? 0
      const b = rgbaBitmap[i + 2] ?? 0
      const key = binKey({ r, g, b, a })
      const existing = map.get(key)
      if (existing) existing.count += 1
      else map.set(key, { r, g, b, count: 1 })
    }
  }

  if (map.size === 0) return rgba(82, 92, 120, 255)

  const bins: Array<{ key: number; count: number }> = []
  for (const [key, v] of map.entries()) bins.push({ key, count: v.count })
  bins.sort((a, b) => b.count - a.count)

  let best = binToRgb(bins[0]!.key)
  let bestScore = -Infinity
  const candidates = bins.slice(0, Math.min(60, bins.length))
  for (const c of candidates) {
    const rgb = binToRgb(c.key)
    const hsl = rgbToHsl(rgb)
    const sat = hsl.s
    const lum = hsl.l
    const lumScore = 1 - Math.abs(lum - 0.55) * 1.8
    const satScore = sat * 1.2
    const freqScore = Math.log10(c.count + 1) * 0.9
    const score = freqScore + satScore + lumScore
    if (score > bestScore) {
      bestScore = score
      best = rgb
    }
  }

  return best
}

function toneFromSeed(seed: Rgba, l: number, extraSat: number): Rgba {
  const hsl = rgbToHsl(seed)
  const s = clamp01(hsl.s * (1 + extraSat))
  return hslToRgb({ h: hsl.h, s, l }, 255)
}

export function buildMonetPalette(seed: Rgba): MonetPalette {
  const seedLum = luma(seed)
  const target = seedLum < 0.12 ? rgba(120, 140, 190, 255) : seedLum > 0.92 ? rgba(80, 90, 120, 255) : seed
  const normalizedSeed = mix(seed, target, seedLum < 0.12 || seedLum > 0.92 ? 0.35 : 0)

  const tones: MonetPalette['tones'] = {
    t0: toneFromSeed(normalizedSeed, 0.02, -0.2),
    t10: toneFromSeed(normalizedSeed, 0.12, -0.15),
    t20: toneFromSeed(normalizedSeed, 0.22, -0.1),
    t30: toneFromSeed(normalizedSeed, 0.32, -0.06),
    t40: toneFromSeed(normalizedSeed, 0.42, -0.02),
    t50: toneFromSeed(normalizedSeed, 0.52, 0),
    t60: toneFromSeed(normalizedSeed, 0.62, 0.02),
    t70: toneFromSeed(normalizedSeed, 0.72, 0.03),
    t80: toneFromSeed(normalizedSeed, 0.82, 0.04),
    t90: toneFromSeed(normalizedSeed, 0.9, 0.04),
    t95: toneFromSeed(normalizedSeed, 0.95, 0.03),
    t99: toneFromSeed(normalizedSeed, 0.985, 0.02),
    t100: toneFromSeed(normalizedSeed, 0.995, 0)
  }

  return { seed: normalizedSeed, tones }
}
