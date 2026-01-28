export type Rgba = { r: number; g: number; b: number; a: number }

export type MonetPalette = {
  seed: Rgba
  tones: Record<
    | 't0'
    | 't10'
    | 't20'
    | 't30'
    | 't40'
    | 't50'
    | 't60'
    | 't70'
    | 't80'
    | 't90'
    | 't95'
    | 't99'
    | 't100',
    Rgba
  >
}

export type SystemColors = {
  ok: boolean
  mode: 'light' | 'dark'
  wallpaperPath?: string
  monet: MonetPalette
  mica: {
    background: Rgba
    surface: Rgba
    border: Rgba
  }
}

