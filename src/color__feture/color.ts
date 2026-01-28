import type { Rgba } from './types'

export function clampByte(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(255, Math.round(v)))
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

export function rgba(r: number, g: number, b: number, a = 255): Rgba {
  return { r: clampByte(r), g: clampByte(g), b: clampByte(b), a: clampByte(a) }
}

export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  const k = clamp01(t)
  return rgba(
    a.r + (b.r - a.r) * k,
    a.g + (b.g - a.g) * k,
    a.b + (b.b - a.b) * k,
    a.a + (b.a - a.a) * k
  )
}

export type Hsl = { h: number; s: number; l: number }

export function rgbToHsl(c: Rgba): Hsl {
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = 0
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) * 60
      break
    case g:
      h = ((b - r) / d + 2) * 60
      break
    default:
      h = ((r - g) / d + 4) * 60
      break
  }
  return { h, s, l }
}

function hueToRgb(p: number, q: number, t: number): number {
  let x = t
  if (x < 0) x += 1
  if (x > 1) x -= 1
  if (x < 1 / 6) return p + (q - p) * 6 * x
  if (x < 1 / 2) return q
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
  return p
}

export function hslToRgb(hsl: Hsl, alpha = 255): Rgba {
  const h = ((hsl.h % 360) + 360) % 360
  const s = clamp01(hsl.s)
  const l = clamp01(hsl.l)
  if (s === 0) {
    const v = clampByte(l * 255)
    return rgba(v, v, v, alpha)
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hk = h / 360
  const r = hueToRgb(p, q, hk + 1 / 3)
  const g = hueToRgb(p, q, hk)
  const b = hueToRgb(p, q, hk - 1 / 3)
  return rgba(r * 255, g * 255, b * 255, alpha)
}

export function luma(c: Rgba): number {
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

