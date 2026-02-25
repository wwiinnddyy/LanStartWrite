import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const projectRoot = process.cwd()
const distDir = resolve(projectRoot, 'dist')
const sourceIndex = join(distDir, 'index.html')

if (!existsSync(sourceIndex)) {
  console.error(`[window-aliases] missing source file: ${sourceIndex}`)
  process.exit(1)
}

const html = readFileSync(sourceIndex, 'utf8')

const aliases = [
  { path: 'window/floating-toolbar/index.html', windowId: 'floating-toolbar' },
  { path: 'window/floating-toolbar-handle/index.html', windowId: 'floating-toolbar-handle' },
  { path: 'window/toolbar-subwindow/index.html', windowId: 'toolbar-subwindow' },
  { path: 'window/toolbar-subwindow/events/index.html', windowId: 'toolbar-subwindow', kind: 'events' },
  { path: 'window/toolbar-subwindow/clock/index.html', windowId: 'toolbar-subwindow', kind: 'clock' },
  { path: 'window/toolbar-subwindow/feature-panel/index.html', windowId: 'toolbar-subwindow', kind: 'feature-panel' },
  { path: 'window/toolbar-subwindow/notes/index.html', windowId: 'toolbar-subwindow', kind: 'notes' },
  { path: 'window/toolbar-subwindow/settings/index.html', windowId: 'toolbar-subwindow', kind: 'settings' },
  { path: 'window/toolbar-subwindow/pen/index.html', windowId: 'toolbar-subwindow', kind: 'pen' },
  { path: 'window/toolbar-subwindow/eraser/index.html', windowId: 'toolbar-subwindow', kind: 'eraser' },
  { path: 'window/toolbar-notice/index.html', windowId: 'toolbar-notice' },
  { path: 'window/watcher/index.html', windowId: 'watcher' },
  { path: 'window/settings-window/index.html', windowId: 'settings-window' },
  { path: 'window/child/index.html', windowId: 'child' },
  { path: 'window/paint-board/index.html', windowId: 'paint-board' },
  { path: 'window/paint-board/annotation/index.html', windowId: 'paint-board', kind: 'annotation' },
  { path: 'window/paint-board/video-show/index.html', windowId: 'paint-board', kind: 'video-show' },
  { path: 'window/paint-board/pdf/index.html', windowId: 'paint-board', kind: 'pdf' },
  { path: 'window/mut-page/index.html', windowId: 'mut-page' },
  { path: 'window/mut-page-handle/index.html', windowId: 'mut-page-handle' },
  { path: 'window/mut-page-thumbnails-menu/index.html', windowId: 'mut-page-thumbnails-menu' },
  { path: 'window/lanstart-bar/index.html', windowId: 'lanstart-bar' }
]

for (const alias of aliases) {
  const rel = alias.path
  const abs = join(distDir, rel)
  const relDir = dirname(rel).replace(/\\/g, '/')
  const depth = relDir.split('/').filter(Boolean).length
  const baseHref = depth > 0 ? `${'../'.repeat(depth)}` : './'
  const route = JSON.stringify({ windowId: alias.windowId, kind: alias.kind ?? null })
  let aliasHtml = html
  if (!aliasHtml.includes('<base ')) {
    aliasHtml = aliasHtml.replace('<head>', `<head>\n    <base href="${baseHref}">`)
  }
  if (!aliasHtml.includes('__LANSTART_WINDOW_ROUTE__')) {
    aliasHtml = aliasHtml.replace(
      '</head>',
      `    <script>window.__LANSTART_WINDOW_ROUTE__=${route};</script>\n  </head>`
    )
  }
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, aliasHtml, 'utf8')
}

console.log(`[window-aliases] generated ${aliases.length} alias pages`)
