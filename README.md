# LanStartWrite

基于 **electron-vite + Electron + React + TypeScript** 的桌面端应用项目，包含浮动工具栏、批注/画板、设置窗口、视频展台等模块。

## 环境要求

- Node.js 18+（推荐 LTS）
- pnpm（项目默认包管理器）
- Windows 10/11（项目主要运行环境）

## 快速开始

安装依赖：

```bash
pnpm install
```

开发模式启动（Electron + Renderer Dev Server）：

```bash
pnpm dev
```

构建：

```bash
pnpm build
```

预览构建产物：

```bash
pnpm preview
```

## 常用命令

项目脚本定义在 [package.json](./package.json)：

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动开发模式 |
| `pnpm build` | 构建生产版本 |
| `pnpm preview` | 预览生产版本 |
| `pnpm test` | 运行测试（vitest run） |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm release` | 发布流程（release-it） |

## 开发者工具

需要启动时自动打开 DevTools，可设置环境变量：

```powershell
$env:LANSTART_OPEN_DEVTOOLS="1"
pnpm dev
```

## 目录结构（简版）

```
src/
  main/                 Electron 主进程
  preload/              预加载脚本
  renderer/             渲染进程（React）
  toolbar/              浮动工具栏
  toolbar-subwindows/   工具栏子窗口
  settings/             设置窗口与配置 UI
  annotation_writing/   批注/书写相关
  paint_board/          画板
  video_show/           视频展台相关
  task_windows_watcher/ 任务窗口监视
  elysia/               后端服务（Elysia）
  LeavelDB/             本地数据存储（LevelDB）
```

## 常见问题

### 1) `'electron-vite' 不是内部或外部命令`

通常是依赖未安装或 `node_modules` 缺失导致。先执行：

```bash
pnpm install
pnpm dev
```

### 2) `failed to load config ... config must export or return an object`

说明 `electron.vite.config.ts` 未正确默认导出配置对象。请确认该文件存在并包含 `export default defineConfig(...)`。

## 更多说明

更完整的运行指南请看 [run.md](./run.md)。

## 项目引用

- 智绘教 Inkeys（GPL-3.0）：https://github.com/Alan-CRL/Inkeys

## 开源许可

本项目以 GPL-3.0 许可证开源发布，详见 [LICENSE](./LICENSE)。

