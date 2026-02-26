import type { App } from 'electron'
import { resolve } from 'node:path'

/**
 * LanStartWrite URL 鍛戒护锛堜緵鍏朵粬搴旂敤閫氳繃鑷畾涔夊崗璁皟鐢ㄦ湰搴旂敤鍔熻兘锛?
 *
 * **涓ょ写法（等价）**
 * - 方式 A：`lanstartwrite://app/setTool?tool=pen`
 * - 方式 B：`lanstartwrite://?command=app.setTool&tool=pen`
 *
 * **payload 传参**
 * - 榛樿：除 `command` 澶栵紝鎵€鏈?query 鍙傛暟閮戒細鍚堝苟鎴?payload锛堜細鑷姩鎶?`true/false/数字` 杞垚瀵瑰簲绫诲瀷锛?
 * - 也可显式传：`payload=`（URI 编码后的 JSON 瀛楃串），例如：`payload=%7B%22tool%22%3A%22pen%22%7D`
 *
 * **涓昏命令清单**
 * -（兼容旧命名）`create-window` / `toggle-subwindow` / `set-subwindow-height` / `set-subwindow-bounds` / `set-toolbar-bounds` / `set-mut-page-bounds` / `set-app-window-bounds` / `set-appearance` / `quit`
 *
 * - `win.createWindow`：创建主窗口
 * - `win.setAppMode`锛氬垏鎹㈡ā式（payload: `{ mode: "toolbar"|"whiteboard"|"video-show" }`锛?
 * - `win.setAnnotationInput`锛氬惎鐢?禁用批注输入（payload: `{ enabled: boolean }`锛?
 * - `win.toggleSubwindow`锛氬垏鎹㈠瓙绐楁樉绀猴紙payload: `{ kind: string, placement: "top"|"bottom" }`锛?
 * - `win.setSubwindowHeight`锛氳缃瓙绐楅珮搴︼紙payload: `{ kind: string, height: number }`锛?
 * - `win.setSubwindowBounds`锛氳缃瓙绐楀楂橈紙payload: `{ kind: string, width: number, height: number }`锛?
 * - `win.setToolbarBounds`锛氳缃伐鍏锋潯绐楀彛瀹介珮锛坧ayload: `{ width: number, height: number }`锛?
 * - `win.setAppWindowBounds`锛氳缃寚瀹氱獥鍙ｇ殑瀹介珮/位置（payload: `{ windowId: string, width?: number, height?: number, x?: number, y?: number }`锛?
 * - `win.setUiZoom`锛氳缃晫闈㈢缉鏀撅紙payload: `{ zoom: number }`锛?
 * - `win.setNoticeVisible`锛氭樉绀?隐藏通知窗（payload: `{ visible: boolean }`锛?
 * - `win.quit`锛氶€€鍑哄簲鐢?
 *
 * - `app.setTool`锛氬垏鎹㈠伐鍏凤紙payload: `{ tool: "pen"|"eraser"|"mouse" }`锛?
 * - `app.setPenSettings`锛氳缃瑪锛坧ayload: `{ type?: "writing"|"highlighter"|"laser", color?: string, thickness?: number }`锛?
 * - `app.setEraserSettings`锛氳缃鐨紙payload: `{ type?: "pixel"|"stroke", thickness?: number }`锛?
 * - `app.clearPage`锛氭竻绌哄綋鍓嶉〉
 * - `app.undo`锛氭挙閿€
 * - `app.redo`锛氶噸鍋?
 * - `app.prevPage`锛氫笂涓€椤? * - `app.nextPage`锛氫笅涓€椤? * - `app.newPage`：新建一页（白板/瀹炵墿灞曞彴锛? * - `app.setPageIndex`锛氳烦杞埌鎸囧畾椤碉紙payload: `{ index: number }`锛?
 * - `app.togglePageThumbnailsMenu`锛氬垏鎹㈢缉鐣ュ浘鑿滃崟
 * - `app.setWritingFramework`锛氬垏鎹功鍐欏悗绔紙payload: `{ framework: "konva"|"qt"|"leafer" }`锛?
 * - `app.openSettingsWindow`锛氭墦寮€设置窗口
 * - `app.minimizeSettingsWindow`：最小化设置窗口
 * - `app.closeSettingsWindow`锛氬叧闂缃獥鍙?
 * - `app.windowControl`：窗口控制（payload: `{ windowId: string, action: "minimize"|"close"|"toggleMaximize" }`锛?
 *
 * - `qt.*`：转发到主进程的 Qt 涔﹀啓鍚庣（action 涓?`*` 的部分）
 *
 * - `settings.setAppearance`锛氬垏鎹寒/暗色（payload: `{ appearance: "light"|"dark" }`锛?
 * - `settings.setAppMode`锛氬垏鎹㈡ā式并持久化（payload: `{ mode: "toolbar"|"whiteboard"|"video-show" }`锛?
 * - `settings.setVideoShowMergeLayers`锛氬疄鐗╁睍鍙?合并图层（payload: `{ enabled: boolean }`锛?
 * - `settings.setWhiteboardBackground`锛氱櫧鏉胯儗鏅紙payload: `{ bgColor?: "#RRGGBB", bgImageUrl?: "file:..."/"data:..."/"", bgImageOpacity?: number }`锛?
 */

type Dispatch = (input: { command: string; payload?: unknown; sourceUrl: string }) => Promise<void>

function stripSurroundingQuotes(s: string): string {
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) return s.slice(1, -1)
  return s
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function coerceQueryValue(v: string): unknown {
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v)) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return v
}

export function extractLanstartwriteUrlFromArgv(argv: string[]): string | undefined {
  for (const raw of argv) {
    const v = stripSurroundingQuotes(String(raw ?? ''))
    if (v.startsWith('lanstartwrite://')) return v
  }
  return undefined
}

export function parseLanstartwriteUrl(rawUrl: string): { command: string; payload?: unknown } | undefined {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return undefined
  }

  if (u.protocol !== 'lanstartwrite:') return undefined

  const commandParam = u.searchParams.get('command') ?? ''
  const host = u.host ?? ''
  const path = (u.pathname ?? '').replace(/^\/+/, '')

  let command = commandParam
  if (!command) {
    if (host && !path) command = host
    else if (host && path) command = `${host}.${path}`
    else if (path) command = path
  }

  command = command.replaceAll('/', '.').replaceAll('\\', '.').replaceAll('..', '.').replace(/^\.+/, '').replace(/\.+$/, '')
  if (!command) return undefined

  const payloadRaw = u.searchParams.get('payload')
  if (payloadRaw != null) {
    const decoded = decodeURIComponent(payloadRaw)
    const parsed = safeParseJson(decoded)
    if (parsed !== undefined) return { command, payload: parsed }
    return { command, payload: decoded }
  }

  const payload: Record<string, unknown> = {}
  for (const [k, v] of u.searchParams.entries()) {
    if (k === 'command') continue
    payload[k] = coerceQueryValue(v)
  }
  if (Object.keys(payload).length > 0) return { command, payload }

  return { command }
}

function registerAsDefaultProtocolClient(app: App, scheme: string): void {
  try {
    if (process.platform === 'win32') {
      if (process.defaultApp) {
        const appPath = process.argv[1] ? resolve(process.argv[1]) : process.execPath
        app.setAsDefaultProtocolClient(scheme, process.execPath, [appPath])
      } else {
        app.setAsDefaultProtocolClient(scheme)
      }
      return
    }
    app.setAsDefaultProtocolClient(scheme)
  } catch {
    return
  }
}

export function createLanstartwriteLinkController(opts: {
  scheme?: string
  dispatch: Dispatch
  focusApp?: () => void
}) {
  const scheme = opts.scheme ?? 'lanstartwrite'
  const pending: string[] = []

  const tryDispatch = async (rawUrl: string): Promise<boolean> => {
    const parsed = parseLanstartwriteUrl(rawUrl)
    if (!parsed) return true
    try {
      opts.focusApp?.()
    } catch {}
    try {
      await opts.dispatch({ command: parsed.command, payload: parsed.payload, sourceUrl: rawUrl })
      return true
    } catch {
      return false
    }
  }

  const enqueue = (rawUrl: string): void => {
    if (!rawUrl) return
    if (pending.length > 50) pending.shift()
    pending.push(rawUrl)
  }

  const handleRawUrl = (rawUrl: string): void => {
    const normalized = stripSurroundingQuotes(String(rawUrl ?? ''))
    if (!normalized.startsWith(`${scheme}://`)) return
    void tryDispatch(normalized).then((ok) => {
      if (!ok) enqueue(normalized)
    })
  }

  const register = (app: App): boolean => {
    registerAsDefaultProtocolClient(app, scheme)

    const gotLock = app.requestSingleInstanceLock()
    if (!gotLock) {
      try {
        app.quit()
      } catch {}
      return false
    }

    app.on('open-url', (e, url) => {
      try {
        e.preventDefault()
      } catch {}
      handleRawUrl(url)
    })

    app.on('second-instance', (_e, argv) => {
      const url = extractLanstartwriteUrlFromArgv(argv)
      if (url) handleRawUrl(url)
      else opts.focusApp?.()
    })

    app.once('ready', () => {
      const initialUrl = extractLanstartwriteUrlFromArgv(process.argv)
      if (initialUrl) handleRawUrl(initialUrl)
    })

    return true
  }

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return
    const batch = pending.splice(0, pending.length)
    for (const item of batch) {
      const ok = await tryDispatch(item)
      if (!ok) enqueue(item)
    }
  }

  return { register, flush }
}

