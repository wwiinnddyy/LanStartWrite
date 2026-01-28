import { describe, expect, it } from 'vitest'
import { buildMonetPalette, extractMonetSeedFromRgbaBitmap } from '../monet'
import { computeMicaFromSeed } from '../mica'

function makeBitmap(width: number, height: number, fill: { r: number; g: number; b: number }, accent?: { x: number; y: number; r: number; g: number; b: number }) {
  const buf = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      buf[i] = fill.r
      buf[i + 1] = fill.g
      buf[i + 2] = fill.b
      buf[i + 3] = 255
    }
  }
  if (accent) {
    const i = (accent.y * width + accent.x) * 4
    buf[i] = accent.r
    buf[i + 1] = accent.g
    buf[i + 2] = accent.b
    buf[i + 3] = 255
  }
  return buf
}

describe('color__feture', () => {
  it('extracts a seed color close to dominant pixels', () => {
    const bmp = makeBitmap(40, 40, { r: 220, g: 60, b: 60 }, { x: 0, y: 0, r: 40, g: 90, b: 220 })
    const seed = extractMonetSeedFromRgbaBitmap(bmp, 40, 40)
    expect(seed.r).toBeGreaterThan(seed.b)
    expect(seed.a).toBe(255)
  })

  it('builds a full tone palette and mica colors', () => {
    const palette = buildMonetPalette({ r: 90, g: 120, b: 210, a: 255 })
    expect(palette.tones.t50.a).toBe(255)
    expect(palette.tones.t99.r).toBeGreaterThanOrEqual(0)

    const micaDark = computeMicaFromSeed(palette.seed, 'dark')
    expect(micaDark.background.a).toBeGreaterThan(150)
    expect(micaDark.border.a).toBeGreaterThan(0)
  })
})

