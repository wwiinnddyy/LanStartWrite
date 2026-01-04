# LanStartWrite 插件系统开发指南

## 版本控制信息

- 文档版本：1.0.0
- 插件 API 版本：1（由宿主在 init 下发）
- 适配应用版本：0.2.1（见 package.json）
- 更新时间：2026-01-03

## 1. 概述

LanStartWrite 插件以 `.lanmod` 作为分发包，安装后落盘到 `mod/plugins/<pluginId>/`。运行时插件以 Web Worker（module worker）形式启动，由渲染进程宿主 [mod.js](file:///c:/Users/HiteVision%20station/Documents/LanStart/LanStartWrite/src/mod.js) 提供受控 API，并在主进程 [main.js](file:///c:/Users/HiteVision%20station/Documents/LanStart/LanStartWrite/src/main.js) 完成安装校验与签名验证。

## 2. 目录结构与文件约定

```
mod/
  plugins/
    <pluginId>/
      manifest.json
      main.js            # entry.kind=worker 时的入口
      ...resources...
  config/
    registry.json        # 已安装插件清单、启用状态、顺序、签名信息
    trust.json           # 受信任公钥列表（用于签名验证）
  temp/                  # 安装临时目录（解压/校验）
```

## 3. manifest.json 规范（核心字段）

最小可用示例（与项目 README 一致）：

```json
{
  "schemaVersion": 1,
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "type": "feature",
  "author": "You",
  "permissions": ["ui:toolbar", "bus:cross"],
  "dependencies": [],
  "resources": [],
  "entry": { "kind": "worker", "path": "main.js" }
}
```

字段语义（宿主校验要点）：

- schemaVersion：当前为 1。
- id：插件全局唯一标识，落盘目录与注册表 key。
- version：语义化版本；安装时会进行依赖范围检查。
- permissions：决定插件可用的能力集合（见第 5 节）。
- resources：可选。若提供，安装时会逐项校验 `size/sha256`。
- entry.kind：当前主要支持 `worker`。

## 4. 生命周期管理

### 4.1 安装（主进程）

安装由主进程处理，核心步骤：

```
选择 .lanmod
  ↓
解压到 temp/install-*
  ↓
读取 manifest.json → 校验 schema/id/version/依赖/覆盖冲突
  ↓
逐项校验 resources（size/sha256）
  ↓
校验 signature.sig（可通过 LANSTART_ALLOW_UNSIGNED=1 放宽，仅开发）
  ↓
落盘到 mod/plugins/<id>/ 并写入 registry.json
  ↓
广播 mod:changed
```

参考实现： [main.js:_installLanmod](file:///c:/Users/HiteVision%20station/Documents/LanStart/LanStartWrite/src/main.js)。

### 4.2 启用/加载（渲染进程宿主）

渲染进程宿主会：

1. 读取已启用插件列表（`mod:list`）。
2. 在启动预算内（budgetMs）依次启动 Worker。
3. Worker `ready` 后下发 `init`（包含 apiVersion/pluginId/manifest）。
4. 插件通过 Mod API 注册工具/模式/Overlay，或订阅/发布总线事件。

参考实现： [mod.js:_loadAll/_spawnWorker](file:///c:/Users/HiteVision%20station/Documents/LanStart/LanStartWrite/src/mod.js#L174-L373)。

### 4.3 卸载/重载

- 卸载：由主进程删除落盘目录并更新 registry，然后广播 `mod:changed`。
- 重载：渲染进程收到 `mod:changed` 后做合并式 reload（80ms 定时合并），并终止所有旧 Worker 后重新加载。

## 5. 权限模型

权限由 manifest.permissions 声明，宿主在渲染进程与 Worker 之间执行强制检查：

- ui:toolbar：允许 `registerTool`
- ui:mode：允许 `registerMode`
- ui:menu：允许 `registerMenuButton`（二级菜单快捷区）
- ui:overlay：允许 `showOverlay/closeOverlay`
- bus:cross：允许访问 `public/*` 或 `*/public/*` 主题
- net:fetch：允许在 Worker 中使用 `fetch/WebSocket`（否则会被宿主裁剪为不可用）

主题访问规则参考： [mod.js:_canTopic](file:///c:/Users/HiteVision%20station/Documents/LanStart/LanStartWrite/src/mod.js#L22-L30)。

## 6. 插件 API（Worker 内）

Worker 启动后，宿主会注入全局对象 `self.Mod`，并以事件方式分发宿主消息。

### 6.1 事件监听

- Mod.on('init', (data)=>{})
  - data：{ apiVersion, pluginId, manifest }
- Mod.on('bus', (data)=>{})
  - data：{ topic, payload }
- Mod.on('tool', (data)=>{})
  - data：{ toolId }
- Mod.on('menu', (data)=>{})
  - data：{ buttonId }
- Mod.on('mode', (data)=>{})
  - data：{ modeId, active }
- Mod.on('ui', (data)=>{})
  - data：{ action, value }

### 6.2 总线能力

- Mod.subscribe(topic)
- Mod.publish(topic, payload)

约束：

- 推荐使用 `pluginId/<topic>` 作为私有主题，天然允许。
- 跨插件或宿主公共主题使用 `public/<topic>`，需声明 `bus:cross`。

### 6.3 UI 扩展能力

- Mod.registerTool(def)
  - 需要权限 ui:toolbar
  - def.id：工具 id（与 pluginId 组合成全局唯一）
  - def.title/def.iconSvg/def.iconUrl/def.iconClass/def.label：用于宿主创建按钮
- Mod.registerMode(def)
  - 需要权限 ui:mode
  - def.id：模式 id
  - def.ui：可选 Overlay 定义（kind=html/asset）
- Mod.registerMenuButton(def)
  - 需要权限 ui:menu
  - def.id：按钮 id（与 pluginId 组合成全局唯一）
  - def.title：用于 tooltip/无障碍标签
  - def.iconSvg/def.iconUrl/def.iconClass/def.label：用于宿主创建按钮
- Mod.showOverlay(def)
  - 需要权限 ui:overlay
  - def.kind='html'：def.html 为 HTML 字符串
  - def.kind='asset'：def.path 为插件资源相对路径
- Mod.closeOverlay()

## 7. 调试与测试方法

### 7.1 开发期绕过签名（仅开发）

- 设置环境变量 `LANSTART_ALLOW_UNSIGNED=1`，允许安装未签名 `.lanmod`。
- 生产环境建议保持默认校验策略，并维护 trust.json 的受信任公钥。

### 7.2 调试入口

- 打开渲染进程 DevTools（开发模式下通常可用）。
- 插件 Worker 发生错误时会向宿主发送 `error` 消息（宿主当前选择忽略，开发期可在插件侧自行捕获并 publish 到私有主题用于展示）。

### 7.3 常用排查清单

- 安装失败：检查 resources 的 size/sha256、signature.sig、manifest 字段合法性。
- 启用无效：检查 registry.json 中 enabled 状态与顺序；确认 entry.kind/path 正确。
- 总线不通：检查主题命名是否满足规则与 bus:cross 权限。
- Overlay 不显示：检查 ui:overlay 权限与 HTML/asset 路径可读性。

## 8. 性能优化指南

### 8.1 启动性能

- 控制入口脚本体积：避免在 Worker 初始化阶段做大量同步计算。
- 延迟注册：在收到 init 后再注册工具/模式，且按需注册。
- 避免启动期爆发式订阅：订阅只订必要主题，减少消息分发成本。

### 8.2 运行时性能

- 降低 publish 频率：对高频事件做节流/防抖（例如鼠标移动、连续拖拽）。
- payload 保持可序列化且体积小：Worker/主线程通信需要结构化克隆，避免传递 DOM、函数或大对象。
- Overlay 内容分片更新：避免每次都整块 innerHTML 重建；优先局部更新或减少刷新频率。

### 8.3 与宿主预算的关系

宿主加载插件有启动预算限制（mod.js 的 budgetMs），超出预算会跳过部分插件以保证主 UI 可用。插件应避免在入口同步阻塞，以降低被跳过的概率。

## 9. 最佳实践与常见问题

- 主题命名：优先使用 `pluginId/<feature>` 私有主题；公共主题使用 `public/<event>` 并明确版本/兼容策略。
- 权限最小化：只申请需要的 permissions，减少潜在风险面。
- UI 扩展一致性：工具按钮 iconSvg 需提供合理的 aria/title 文本；避免破坏宿主样式。
