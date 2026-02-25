# 变更日志

## 2026-02-25

### Toolbar 尺寸/折叠/拖动失效修复（第二轮）
- 修复“把手拖动失效”根因：将 `.toolbarRoot` 恢复为窗口填充容器（`width/height: 100%`），避免把手窗口被全局 `fit-content` 语义污染。
- 新增 `.toolbarRoot--autoSize`（仅主浮动工具栏使用），主工具栏维持内容驱动尺寸；把手窗口继续使用 `toolbarRoot toolbarHandleRoot`。
- 在 `.toolbarHandleRoot` 显式补充 `width: 100%; height: 100%;`，确保拖拽命中区覆盖整个把手窗口。
- 重写 `useToolbarWindowAutoResize` 尺寸测量：
  - 从 `scrollWidth/scrollHeight` 主导改为 `offset*` 可视尺寸主导（`measureVisualSize`）。
  - 采用“相对 root 的累计 offset + offsetWidth/offsetHeight”计算外接尺寸，避免折叠区 `overflow: hidden` 下的宽度残留。
- 折叠动画时序改为“过程节流 + 结束收敛”：
  - 动画中上报节流到 `80ms`。
  - 动画结束立即上报，并在 `70ms` 做二次收敛。
  - 若未收到结束事件，`320ms` 超时兜底触发最终收敛。
- 事件触发统一：
  - `toggleExpanded` 发送 `lanstart-toolbar-transition-start`。
  - 折叠区 `motion.div` 增加 `onAnimationStart` 兜底与 `onAnimationComplete` 收口，覆盖非点击触发的状态切换。

### Toolbar 自适应尺寸修复（CSS/测量/动画/监听）
- 修复浮动工具栏“内容被裁切、折叠展开后窗口不同步、二级菜单触发异常”的核心链路：
  - `src/toolbar/styles/toolbar.css`：
    - `.toolbarRoot` 从 `width/height: 100%` 改为 `width/height: fit-content`。
    - 移除 `.toolbarRoot` 的 `overflow: hidden`，让内容自然撑开窗口容器。
  - `src/toolbar/hooks/useToolbarWindowAutoResize.ts`：
    - 尺寸计算不再依赖 `getBoundingClientRect()`。
    - 新增 `measureIntrinsicSize(root)`，按 `root.scrollWidth/scrollHeight`、`.toolbarLayout` 的 `scrollWidth/scrollHeight`、以及子元素外接尺寸（`offsetLeft + offsetWidth`、`offsetTop + offsetHeight`）综合计算最终尺寸。
    - 保留“尺寸未变化不重复上报”去重逻辑。
    - `ResizeObserver` 监听目标收敛到真实内容链路：`root(.toolbarDragArea)`、`.toolbarLayout`、`.toolbarCollapsibleSection`、`.toolbarCollapsibleContent`。
    - `MutationObserver` 改为轻量模式：仅 `childList + subtree`。
  - `src/toolbar/FloatingToolbar.tsx`：
    - 折叠/展开点击时发送 `lanstart-toolbar-transition-start`（不再立即强制连发重测）。
    - 折叠区动画结束（`onAnimationComplete`）发送 `lanstart-toolbar-transition-end`。
  - 动画锁策略：
    - hook 收到 `transition-start` 后进入锁定态（220ms + 80ms 兜底）。
    - 锁定态期间监听到变更只标记脏，不立即上报。
    - 收到 `transition-end` 或 300ms 兜底超时后，立即触发最终尺寸上报。

### 浮动工具栏尺寸与二级菜单链路修复（本次）
- 修复前端桥单通道风险：`src/renderer/src/electrobunBridge.ts` 新增 HTTP RPC 兜底（`POST /rpc-http`）。
  - 当 `ws://127.0.0.1:3131/rpc` 不可用或抖动时，自动回退到 HTTP RPC，保证 `postCommand/getUiState/getEvents` 等调用可继续工作。
- 新增后端 RPC HTTP 入口：`src/elysia/index.ts` 增加 `POST /rpc-http`，复用 `handleBackendRpc`，与现有 RPC 方法保持一致。
- 修复工具栏把手窗口入场丢失：`src/bun/windows/toolbarOrchestrator.ts` 在工具栏显示时强制确保把手窗口进入可见态。
- 降低启动期 CEF 多窗口并发压力：`ensurePrimaryWindows({ show: false })` 改为仅预创建工具栏窗口，把手窗口延后到实际显示阶段创建。
- 提升工具栏尺寸跟随可靠性：
  - `src/toolbar/FloatingToolbar.tsx` 改为使用实际挂载的 DOM 节点作为尺寸监听目标（避免初始 `ref.current` 为 `null` 时丢失监听）。
  - `src/toolbar/hooks/useToolbarWindowAutoResize.ts` 增加强制重测事件与短时重测 burst（折叠/展开后多次复测），减少“React 已变化但窗口未同步”。

### React 主导窗口尺寸（新增）
- 明确改为“前端内容驱动窗口尺寸”：窗口宽高由 React `ResizeObserver + MutationObserver` 持续上报，主进程仅执行 `setFrame`。
- 新增 `child` 窗口尺寸上报：`src/renderer/src/App.tsx` 中 `ChildWindow` 现在会发送 `set-app-window-bounds`（宽/高）。
- 新增 `watcher` 窗口尺寸上报：`src/task_windows_watcher/WatcherMenu.tsx` 现在会根据卡片内容变化持续发送 `set-app-window-bounds`（宽/高）。
- 增强 `settings-window` 尺寸上报：`src/settings/SettingsWindow.tsx` 从“仅高度”升级为“宽高同时上报”，并监听结构变化触发重算。

### 多窗口时序与 mut-page 状态机对齐（Electrobun）
- 主进程补回启动门槛：新增“启动等待 + 首次尺寸确认 + 入场编排”时序。
  - 启动时先创建工具栏/把手窗口（离屏），等待 `dom-ready` 与首次 `SET_TOOLBAR_BOUNDS` 上报，再执行入场动画与重排。
  - 新增 `runMainWindowStartupChoreography()`，工具栏从屏幕下方入场到目标位置，避免早期闪烁与布局错位。
- mut-page 升级为双来源状态机：`appMode` 与 `ppt` 两条来源同时生效，显示条件为“任一来源为真”。
  - `source='ppt'` 触发时加入防抖生命周期：`SET_MUT_PAGE_VISIBLE(false)` 走 `900ms` 延迟收敛；`SET_MUT_PAGE_ANCHOR` 清空走 `1200ms` 延迟收敛。
  - 新增 anchor 生命周期处理与 `didAlignToolbarWithPpt` 周期标记，避免频繁抖动与重复编排。
- 补回 `alignFloatingToolbarWithMutPageOnce` 避让定位：
  - 当 mut-page 出现时，工具栏按全屏 bounds 居中计算，如发生水平重叠则自动左/右避让。
  - 工具栏 Y 轴按 mut-page 底边对齐并夹紧到屏幕可用范围，随后触发把手/子窗重排。
- 工具栏二级菜单与通知窗边界策略对齐 1.0 行为：
  - 从“仅 clamp”改为“先按 placement 计算，再越界自动 top/bottom 翻转，再夹紧”。
  - 通知窗显示时重置为 `bottom` 起算，重排时可根据边界自动翻转。
  - 子窗与通知窗均改为跟随工具栏左上角锚点重排，避免极端尺寸下漂移。

### 白屏与窗口时序修复（Electrobun 继续修复）
- 修复窗口初始定位错误：`WindowRegistry.upsert` 不再在首帧读取 `getFrame()` 覆盖默认 bounds，改为信任描述符默认值，避免窗口被错误放在 `0,0`。
- 修复多窗口路由判定不稳定：
  - 别名页面生成脚本 `scripts/dev/generate-window-aliases.mjs` 为每个窗口注入 `window.__LANSTART_WINDOW_ROUTE__`（含 `windowId/kind`）。
  - `src/renderer/src/App.tsx` 路由解析优先级改为：注入路由 > pathname > hash > query。
- 修复工具栏窗口 ID 契约不一致：`WINDOW_ID_FLOATING_TOOLBAR` 改回 `'floating-toolbar'`，与主进程路由和消息统一。
- 降低启动后焦点抖动风险：`src/bun/index.ts` 中 `systemUiaTopmostEnabled` 默认关闭，避免持续轮询导致的焦点抢占。
- 加强开发态运行清理：`scripts/dev/clean-runtime.mjs` 增加 `node.exe/esbuild.exe` 与 Vite 相关命令行匹配，减少 CEF profile 锁冲突。

### 验收快照（本轮）
- `/health` 返回 200（backend 可用）。
- `runtime/windows` 可见 `floating-toolbar`、`floating-toolbar-handle`、`watcher`、`settings-window`、`toolbar-subwindow`，且 `did-finish-load` 事件正常。
- `set-toolbar-bounds` 可驱动窗口尺寸联动（工具栏宽高更新后把手同步）。
- `views` 资源加载日志不再出现 `window/.../assets/...` 路径错误。

### Electrobun 多窗口主链重建（对齐 1.0.0 行为）
- 重建 `src/bun/index.ts`，恢复主进程多窗口编排，不再是单窗口退化实现。
- 接入窗口编排模块：
  - `ToolbarOrchestrator`（浮动工具栏、把手、二级菜单、通知窗）
  - `AppWindowsManager`（child / watcher / settings）
  - `MutPageOrchestrator`（mut-page / handle / thumbnails-menu）
- 恢复主进程消息矩阵处理：
  - `SET_TOOLBAR_BOUNDS`、`TOGGLE_SUBWINDOW`、`SET_SUBWINDOW_HEIGHT`、`SET_SUBWINDOW_BOUNDS`
  - `SET_NOTICE_VISIBLE`、`SET_APP_MODE`、`SET_ANNOTATION_INPUT`、`SET_SCREEN_ANNOTATION_VISIBLE`
  - `SET_MUT_PAGE_VISIBLE`、`SET_MUT_PAGE_ANCHOR`、`SET_MUT_PAGE_BOUNDS`、`TOGGLE_MUT_PAGE_THUMBNAILS_MENU`
  - `OPEN_WATCHER_WINDOW`、`OPEN_SETTINGS_WINDOW`、`MINIMIZE_SETTINGS_WINDOW`、`CLOSE_SETTINGS_WINDOW`、`CONTROL_APP_WINDOW`
  - `SET_APPEARANCE`、`SET_UI_ZOOM`、`SET_NATIVE_MICA`、`SET_LEGACY_WINDOW_IMPLEMENTATION`、`SET_WINDOW_PRELOAD`、`QUIT_APP`
- 主窗口路由统一为路径式：
  - 打包态使用 `views://mainview/window/<windowId>/<kind>/index.html`
  - 开发态（HMR）使用 `http://localhost:5173/?window=<windowId>&kind=<kind>`
- 实现“离屏停放”显隐策略：隐藏窗口改为移至离屏坐标，不依赖 `hide()/showInactive()`。
- 新增主进程侧 `WINDOW_STATUS` / `PROCESS_STATUS` 回传，便于 watcher 与诊断逻辑消费。

### 后端与运行稳定性
- 保留并增强 backend 启动稳定逻辑：
  - `LANSTART_BACKEND_ENTRY` / `LANSTART_BACKEND_CWD` / `LANSTART_CAPABILITY_WORKER_ENTRY` 多入口解析
  - backend 健康检查 `/health`
  - 退出自动重启（指数退避）
- 增加主进程 `MAIN_RPC_REQUEST` 处理：
  - `selectImageFile`、`selectPdfFile`、`selectDirectory`
  - `selectCunoxExportFile`、`selectCunoxImportFile`
  - `clipboardWriteText`、`getToolbarNoticeKind`、`setToolbarNoticeVisible`、`setToolbarNoticeBounds`
  - `restartBackendAll`、`shutdown`
- 保留 PPT `.NET` wrapper 独立进程拉起逻辑（可执行文件存在时自动启动）。

### 托盘与开发体验
- 恢复托盘基础能力：打开设置、重启后端、退出。
- `dev:hmr` 注入 `LANSTART_WEBVIEW_DEV_URL=http://localhost:5173/`，确保 HMR 模式走 Vite 页面。

### 验证结果
- `bun run typecheck` 通过。
- `bun run build:backend` 通过。
- `bun run build:webview` 通过。
- `bun run build:electrobun` 仍受本机缺少 `.NET`（`dotnet not found`）阻塞。

## 2026-02-24

### Bun 主导架构切换（历史记录）
- 运行时从 Electron 主路径切换到 Electrobun（继续使用 CEF 打包）。
- 以 Elysia 作为统一中台，前端通过 `window.lanstart` 对接 RPC。
- 系统能力分层（capability / feature）落地，WinAPI 路径迁移到 Bun Worker + Bun FFI。
