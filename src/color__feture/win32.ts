import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

async function regQueryValue(path: string, name: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', path, '/v', name], { windowsHide: true })
    const lines = String(stdout).split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (!trimmed.toLowerCase().startsWith(name.toLowerCase())) continue
      const parts = trimmed.split(/\s+/)
      const value = parts.slice(2).join(' ').trim()
      return value || undefined
    }
    return undefined
  } catch {
    return undefined
  }
}

export async function getWindowsWallpaperPath(): Promise<string | undefined> {
  const direct = await regQueryValue('HKCU\\Control Panel\\Desktop', 'Wallpaper')
  if (direct && existsSync(direct)) return direct

  const appData = process.env.APPDATA
  if (appData) {
    const transcoded = join(appData, 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper')
    if (existsSync(transcoded)) return transcoded
    const cachedFiles = [
      join(appData, 'Microsoft', 'Windows', 'Themes', 'CachedFiles'),
      join(appData, 'Microsoft', 'Windows', 'Themes', 'CachedFiles', 'CachedImage_1920_1080_POS4.jpg')
    ]
    for (const p of cachedFiles) {
      if (existsSync(p)) return p
    }
  }

  const userProfile = process.env.USERPROFILE
  if (userProfile) {
    const themes = join(userProfile, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper')
    if (existsSync(themes)) return themes
  }

  return undefined
}

export async function getWindowsAppsThemeMode(): Promise<'light' | 'dark'> {
  const v = await regQueryValue(
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
    'AppsUseLightTheme'
  )
  if (v === '0x1' || v === '1') return 'light'
  if (v === '0x0' || v === '0') return 'dark'
  return 'dark'
}

