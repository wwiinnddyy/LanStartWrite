import type { App } from 'electron'
import { resolve } from 'node:path'

/**
 * LanStartWrite URL 命令（供其他应用通过自定义协议调用本应用功能）
 *
 * **两种写法（等价）**
 * - 方式 A：`lanstartwrite://app/setTool?tool=pen`
 * - 方式 B：`lanstartwrite://?command=app.setTool&tool=pen`
 *
 * **payload 传参**
 * - 默认：除 `command` 外，所有 query 参数都会合并成 payload（会自动把 `true/false/数字` 转成对应类型）
 * - 也可显式传：`payload=`（URI 编码后的 JSON 字符串），例如：`payload=%7B%22tool%22%3A%22pen%22%7D`
 *
 * **主要命令清单**
 * -（兼容旧命名）`create-window` / `toggle-subwindow` / `set-subwindow-height` / `set-subwindow-bounds` / `set-toolbar-bounds` / `set-mut-page-bounds` / `set-app-window-bounds` / `set-appearance` / `quit`
 *
 * - `win.createWindow`：创建主窗口
 * - `win.setAppMode`：切换模式（payload: `{ mode: "toolbar"|"whiteboard"|"video-show" }`）
 * - `win.setAnnotationInput`：启用/禁用批注输入（payload: `{ enabled: boolean }`）
 * - `win.toggleSubwindow`：切换子窗显示（payload: `{ kind: string, placement: "top"|"bottom" }`）
 * - `win.setSubwindowHeight`：设置子窗高度（payload: `{ kind: string, height: number }`）
 * - `win.setSubwindowBounds`：设置子窗宽高（payload: `{ kind: string, width: number, height: number }`）
 * - `win.setToolbarBounds`：设置工具条窗口宽高（payload: `{ width: number, height: number }`）
 * - `win.setAppWindowBounds`：设置指定窗口的宽高/位置（payload: `{ windowId: string, width?: number, height?: number, x?: number, y?: number }`）
 * - `win.setUiZoom`：设置界面缩放（payload: `{ zoom: number }`）
 * - `win.setNoticeVisible`：显示/隐藏通知窗（payload: `{ visible: boolean }`）
 * - `win.quit`：退出应用
 *
 * - `app.setTool`：切换工具（payload: `{ tool: "pen"|"eraser"|"mouse" }`）
 * - `app.setPenSettings`：设置笔（payload: `{ type?: "writing"|"highlighter"|"laser", color?: string, thickness?: number }`）
 * - `app.setEraserSettings`：设置橡皮（payload: `{ type?: "pixel"|"stroke", thickness?: number }`）
 * - `app.clearPage`：清空当前页
 * - `app.undo`：撤销
 * - `app.redo`：重做
 * - `app.prevPage`：上一页（PPT 放映时为上一张）
 * - `app.nextPage`：下一页（PPT 放映时为下一张）
 * - `app.endPptSlideShow`：结束 PPT 放映
 * - `app.newPage`：新建一页（白板/实物展台）
 * - `app.setPageIndex`：跳转到指定页（payload: `{ index: number }`）
 * - `app.togglePageThumbnailsMenu`：切换缩略图菜单
 * - `app.setWritingFramework`：切换书写后端（payload: `{ framework: "konva"|"qt"|"leafer" }`）
 * - `app.openSettingsWindow`：打开设置窗口
 * - `app.minimizeSettingsWindow`：最小化设置窗口
 * - `app.closeSettingsWindow`：关闭设置窗口
 * - `app.windowControl`：窗口控制（payload: `{ windowId: string, action: "minimize"|"close"|"toggleMaximize" }`）
 *
 * - `watcher.openWindow`：打开任务监控窗口
 * - `watcher.start` / `watcher.setInterval`：启动监控（payload: `{ intervalMs?: number }`）
 * - `watcher.stop`：停止监控（当前为占位）
 *
 * - `qt.*`：转发到主进程的 Qt 书写后端（action 为 `*` 的部分）
 *
 * - `settings.setAppearance`：切换亮/暗色（payload: `{ appearance: "light"|"dark" }`）
 * - `settings.setAppMode`：切换模式并持久化（payload: `{ mode: "toolbar"|"whiteboard"|"video-show" }`）
 * - `settings.setVideoShowMergeLayers`：实物展台-合并图层（payload: `{ enabled: boolean }`）
 * - `settings.setOfficePptMode`：PPT 模式选择（payload: `{ mode: "inkeys"|"based"|"vsto" }`）
 * - `settings.setSystemUiaTopmost`：UIA 强制置顶（payload: `{ enabled: boolean }`）
 * - `settings.setNativeMica`：原生 Mica（payload: `{ enabled: boolean }`）
 * - `settings.setLegacyWindowImplementation`：旧窗口实现开关（payload: `{ enabled: boolean }`）
 * - `settings.setWhiteboardBackground`：白板背景（payload: `{ bgColor?: "#RRGGBB", bgImageUrl?: "file:..."/"data:..."/"", bgImageOpacity?: number }`）
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
