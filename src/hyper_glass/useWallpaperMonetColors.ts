import { useCallback, useEffect, useState } from 'react'

export type MonetColor = {
  name: string
  value: string
  light: {
    primary: string
    primaryHover: string
    primaryActive: string
    primaryLight: string
    gradient: string
  }
  dark: {
    primary: string
    primaryHover: string
    primaryActive: string
    primaryLight: string
    gradient: string
  }
}

// 从RGB颜色生成莫奈色系
type RgbColor = { r: number; g: number; b: number }

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0, s = 0, l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      case b: h = (r - g) / d + 4; break
    }
    h /= 6
  }

  return { h: h * 360, s: s * 100, l: l * 100 }
}

function hslToRgb(h: number, s: number, l: number): RgbColor {
  h /= 360
  s /= 100
  l /= 100
  let r: number, g: number, b: number

  if (s === 0) {
    r = g = b = l
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }

  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) }
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`
}

// 生成莫奈色系变体
function generateMonetColor(baseColor: RgbColor, name: string): MonetColor {
  const hsl = rgbToHsl(baseColor.r, baseColor.g, baseColor.b)
  
  // 浅色主题
  const lightPrimary = hslToRgb(hsl.h, Math.min(85, hsl.s + 10), Math.min(60, hsl.l + 15))
  const lightHover = hslToRgb(hsl.h, Math.min(90, hsl.s + 15), Math.min(55, hsl.l + 10))
  const lightActive = hslToRgb(hsl.h, Math.min(95, hsl.s + 20), Math.min(50, hsl.l + 5))
  const lightLight = hslToRgb(hsl.h, Math.min(80, hsl.s), Math.min(95, hsl.l + 40))
  
  // 深色主题
  const darkPrimary = hslToRgb(hsl.h, Math.min(85, hsl.s + 5), Math.min(75, hsl.l + 25))
  const darkHover = hslToRgb(hsl.h, Math.min(90, hsl.s + 10), Math.min(70, hsl.l + 20))
  const darkActive = hslToRgb(hsl.h, Math.min(95, hsl.s + 15), Math.min(65, hsl.l + 15))
  const darkLight = hslToRgb(hsl.h, Math.min(70, hsl.s - 10), Math.min(30, hsl.l - 10))

  return {
    name,
    value: `monet-${name.toLowerCase().replace(/\s+/g, '-')}`,
    light: {
      primary: rgbToHex(lightPrimary.r, lightPrimary.g, lightPrimary.b),
      primaryHover: rgbToHex(lightHover.r, lightHover.g, lightHover.b),
      primaryActive: rgbToHex(lightActive.r, lightActive.g, lightActive.b),
      primaryLight: `rgba(${lightLight.r}, ${lightLight.g}, ${lightLight.b}, 0.15)`,
      gradient: `linear-gradient(135deg, ${rgbToHex(lightPrimary.r, lightPrimary.g, lightPrimary.b)} 0%, ${rgbToHex(lightHover.r, lightHover.g, lightHover.b)} 100%)`,
    },
    dark: {
      primary: rgbToHex(darkPrimary.r, darkPrimary.g, darkPrimary.b),
      primaryHover: rgbToHex(darkHover.r, darkHover.g, darkHover.b),
      primaryActive: rgbToHex(darkActive.r, darkActive.g, darkActive.b),
      primaryLight: `rgba(${darkLight.r}, ${darkLight.g}, ${darkLight.b}, 0.2)`,
      gradient: `linear-gradient(135deg, ${rgbToHex(darkPrimary.r, darkPrimary.g, darkPrimary.b)} 0%, ${rgbToHex(darkHover.r, darkHover.g, darkHover.b)} 100%)`,
    },
  }
}

// 从图像数据提取主色调
function extractDominantColors(imageData: ImageData): RgbColor[] {
  const { data, width, height } = imageData
  const colorMap = new Map<string, { color: RgbColor; count: number }>()
  
  // 采样像素
  const sampleStep = Math.max(1, Math.floor(Math.sqrt((width * height) / 1000)))
  
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const i = (y * width + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const a = data[i + 3]
      
      // 跳过透明像素和过暗/过亮的像素
      if (a < 128) continue
      const brightness = (r + g + b) / 3
      if (brightness < 30 || brightness > 225) continue
      
      // 量化颜色以减少变体
      const quantizedR = Math.round(r / 16) * 16
      const quantizedG = Math.round(g / 16) * 16
      const quantizedB = Math.round(b / 16) * 16
      const key = `${quantizedR},${quantizedG},${quantizedB}`
      
      if (colorMap.has(key)) {
        colorMap.get(key)!.count++
      } else {
        colorMap.set(key, { color: { r: quantizedR, g: quantizedG, b: quantizedB }, count: 1 })
      }
    }
  }
  
  // 按出现频率排序并返回前5个
  const sortedColors = Array.from(colorMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(item => item.color)
  
  return sortedColors
}

export function useWallpaperMonetColors() {
  const [monetColors, setMonetColors] = useState<MonetColor[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const extractColors = useCallback(async () => {
    const api = window.hyperGlass
    if (!api) {
      setError('hyperGlass API not available')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // 捕获屏幕缩略图
      const capture = await api.captureDisplayThumbnail({ maxSide: 320 })
      
      // 解码图像
      const res = await fetch(capture.dataUrl)
      const blob = await res.blob()
      const bmp = await createImageBitmap(blob)
      
      // 绘制到 canvas 获取像素数据
      const canvas = document.createElement('canvas')
      canvas.width = bmp.width
      canvas.height = bmp.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('Failed to get canvas context')
      
      ctx.drawImage(bmp, 0, 0)
      bmp.close()
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      
      // 提取主色调
      const dominantColors = extractDominantColors(imageData)
      
      // 生成莫奈色系
      const colors = dominantColors.map((color, index) => 
        generateMonetColor(color, `壁纸 ${index + 1}`)
      )
      
      setMonetColors(colors)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to extract colors')
      console.error('[useWallpaperMonetColors] Failed to extract colors:', e)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    extractColors()
  }, [extractColors])

  return {
    monetColors,
    isLoading,
    error,
    refresh: extractColors,
  }
}
