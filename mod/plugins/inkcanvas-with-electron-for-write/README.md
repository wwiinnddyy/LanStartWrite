# InkCanvas for Electron Write - 使用文档

## 概述

InkCanvas for Electron Write 是为 LanStartWrite 开发的增强型书写控件插件，使用 InkCanvas 技术替换原有的书写控件，提供更强大的书写体验。

## 版本信息

- **插件版本**: 1.0.0
- **兼容的 LanStartWrite 版本**: 0.2.1+
- **开发日期**: 2026-01-04

## 核心功能

### 1. 增强型笔触绘制
- 支持压力感应（需要支持压力的输入设备）
- 动态笔触粗细调整
- 平滑线条渲染（二次贝塞尔曲线插值）
- 实时笔触预览

### 2. 多模式橡皮擦
- **像素擦除**: 精确擦除单个像素
- **笔画擦除**: 点击或拖动擦除整条笔画
- **矩形擦除**: 框选区域批量擦除

### 3. 图层管理系统
- 支持多图层创建和管理
- 图层可见性控制
- 图层透明度调整
- 图层独立编辑

### 4. 完整的历史记录
- 撤销/重做功能（最多 30 步）
- 智能快照保存
- 历史记录导航

## 安装指南

### 方法一：手动安装（开发模式）

1. 将插件目录复制到 LanStartWrite 的插件目录：
   ```
   复制到: mod/plugins/inkcanvas-with-electron-for-write/
   ```

2. 更新插件注册表：
   编辑 `mod/config/registry.json`，添加：
   ```json
   {
     "schemaVersion": 1,
     "plugins": {
       "inkcanvas-with-electron-for-write": {
         "enabled": true,
         "version": "1.0.0",
         "installedAt": 1704345600000
       }
     },
     "order": [
       "inkcanvas-with-electron-for-write"
     ]
   }
   ```

3. 启动 LanStartWrite：
   ```bash
   npm start
   ```

### 方法二：通过 UI 安装（推荐）

1. 启动 LanStartWrite 应用
2. 打开设置面板
3. 进入"插件管理"页面
4. 拖拽 `.lanmod` 安装包到安装区域
5. 等待安装完成
6. 启用插件

### 方法三：命令行安装

```bash
# 在 LanStartWrite 根目录下执行
node -e "
const fs = require('fs');
const path = require('path');

const registryPath = path.join(__dirname, 'mod', 'config', 'registry.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

registry.plugins['inkcanvas-with-electron-for-write'] = {
  enabled: true,
  version: '1.0.0',
  installedAt: Date.now()
};

if (!registry.order.includes('inkcanvas-with-electron-for-write')) {
  registry.order.push('inkcanvas-with-electron-for-write');
}

fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
console.log('插件已安装并启用');
"
```

## 使用指南

### 基础操作

#### 1. 启用 InkCanvas 模式

1. 打开 LanStartWrite
2. 点击工具栏上的"InkCanvas 画笔"工具
3. 或在"更多"菜单中选择"InkCanvas 模式"

#### 2. 使用画笔工具

1. 点击"InkCanvas 画笔"工具
2. 在弹出的设置面板中调整：
   - **笔刷大小**: 1-50 像素
   - **压力系数**: 0-1（控制压力感应强度）
   - **笔刷颜色**: 选择颜色
3. 点击"应用设置"
4. 在画布上开始书写

#### 3. 使用橡皮擦工具

1. 点击"InkCanvas 橡皮擦"工具
2. 在弹出的设置面板中调整：
   - **橡皮大小**: 5-100 像素
   - **橡皮模式**: 像素/笔画/矩形
3. 点击"应用设置"
4. 在画布上擦除

#### 4. 管理图层

1. 点击"图层管理"工具
2. 在弹出的面板中可以：
   - 查看所有图层列表
   - 新建图层
   - 删除图层
   - 切换当前图层

### 高级功能

#### 压力感应

InkCanvas 支持压力感应功能，需要使用支持压力的输入设备（如数位板、支持压力的触控笔）。

**启用压力感应**：
1. 在 InkCanvas 模式下，点击"切换压力感应"按钮
2. 调整压力系数（0-1）来控制压力对笔触粗细的影响程度

**压力系数说明**：
- 0: 完全忽略压力，使用固定笔触大小
- 0.5: 中等压力影响（推荐）
- 1: 最大压力影响

#### 图层操作

**新建图层**：
- 在图层管理面板中点击"新建图层"
- 或在 InkCanvas 模式下点击"新建图层"按钮

**切换图层**：
- 在图层列表中点击要切换的图层
- 当前图层会高亮显示

**删除图层**：
- 在图层管理面板中点击"删除图层"
- 注意：至少保留一个图层

**清空图层**：
- 在 InkCanvas 模式下点击"清空当前图层"
- 只清空当前图层的内容

#### 历史记录

**撤销**：
- 使用快捷键 `Ctrl+Z`（Windows/Linux）或 `Cmd+Z`（Mac）
- 或点击工具栏上的撤销按钮

**重做**：
- 使用快捷键 `Ctrl+Y`（Windows/Linux）或 `Cmd+Y`（Mac）
- 或点击工具栏上的重做按钮

## API 参考

### 插件事件总线

插件通过事件总线与宿主应用通信：

#### 发布事件

```javascript
Mod.publish('inkcanvas-with-electron-for-write/tool', { tool: 'pen' });
Mod.publish('inkcanvas-with-electron-for-write/pen-settings', {
  brushSize: 4,
  pressureFactor: 0.5,
  brushColor: '#000000'
});
Mod.publish('inkcanvas-with-electron-for-write/eraser-settings', {
  eraserSize: 20,
  eraserMode: 'pixel'
});
Mod.publish('inkcanvas-with-electron-for-write/pressure-toggle', {});
Mod.publish('inkcanvas-with-electron-for-write/layer-add', {});
Mod.publish('inkcanvas-with-electron-for-write/layer-clear', {});
Mod.publish('inkcanvas-with-electron-for-write/layer-delete', {});
```

#### 订阅事件

```javascript
Mod.subscribe('public/inkcanvas-ready');
Mod.subscribe('public/stroke-added');
Mod.subscribe('public/layer-changed');
```

### InkCanvasRenderer API

```javascript
// 创建渲染器实例
const renderer = new InkCanvasRenderer(canvasElement);

// 笔刷设置
renderer.setBrushSize(4);
renderer.setBrushColor('#000000');
renderer.setPressureEnabled(true);
renderer.setPressureFactor(0.5);

// 橡皮擦设置
renderer.setEraserSize(20);
renderer.setEraserMode('pixel');
renderer.setErasing(false);

// 图层操作
renderer.createNewLayer();
renderer.switchLayer(0);
renderer.deleteLayer(0);
renderer.clearLayer(0);
renderer.setLayerVisibility(0, true);
renderer.setLayerOpacity(0, 1);

// 历史记录
renderer.undo();
renderer.redo();

// 获取统计信息
const stats = renderer.getStats();
// { totalLayers: 3, totalStrokes: 45, currentLayer: 0 }
```

## 兼容性测试

### 测试环境

- **操作系统**: Windows 10/11, macOS 10.15+, Linux (Ubuntu 20.04+)
- **Electron 版本**: 26.0.0+
- **Node.js 版本**: 16+

### 测试项目

#### 功能测试

- [x] 笔触绘制
- [x] 线条渲染
- [x] 压力感应
- [x] 橡皮擦（三种模式）
- [x] 图层管理
- [x] 撤销/重做
- [x] 历史记录
- [x] 颜色切换
- [x] 笔刷大小调整

#### 性能测试

- [x] 大量笔迹绘制（1000+ 笔画）
- [x] 多图层切换
- [x] 快速连续操作
- [x] 内存占用测试

#### 兼容性测试

- [x] 不同分辨率屏幕
- [x] 高 DPI 显示器
- [x] 触控设备
- [x] 鼠标输入
- [x] 数位板输入

### 已知问题

1. **压力感应在某些设备上可能不工作**
   - 解决方案：检查设备是否支持压力感应，更新驱动程序

2. **高 DPI 屏幕上可能出现模糊**
   - 解决方案：已在代码中限制 DPR 最大为 1.5

3. **大量笔迹时性能下降**
   - 解决方案：使用图层管理，将内容分散到不同图层

## 故障排除

### 插件无法加载

**症状**: 启动后插件工具栏不显示

**解决方案**:
1. 检查 `mod/config/registry.json` 中插件是否已启用
2. 检查插件文件是否完整
3. 查看控制台错误信息
4. 尝试重新安装插件

### 压力感应不工作

**症状**: 笔触粗细不随压力变化

**解决方案**:
1. 确认输入设备支持压力感应
2. 检查压力感应是否已启用
3. 调整压力系数
4. 更新设备驱动程序

### 图层操作异常

**症状**: 无法切换或删除图层

**解决方案**:
1. 确认至少有一个图层
2. 检查图层索引是否有效
3. 查看控制台错误信息

### 性能问题

**症状**: 绘制时卡顿或延迟

**解决方案**:
1. 减少笔迹数量
2. 使用图层管理分散内容
3. 降低设备像素比
4. 关闭不必要的功能

## 开发者指南

### 插件结构

```
inkcanvas-with-electron-for-write/
├── manifest.json           # 插件清单
├── main.js                 # 插件入口
├── renderer-inkcanvas.js   # 渲染器核心
├── styles.css             # 样式文件
└── icon.svg               # 图标文件
```

### 扩展开发

如需扩展插件功能，可以：

1. 修改 `renderer-inkcanvas.js` 添加新的绘制算法
2. 在 `main.js` 中注册新的工具或模式
3. 通过事件总线与其他插件通信
4. 添加新的 UI 组件

### 调试

1. 打开开发者工具（F12）
2. 查看控制台输出
3. 使用 `console.log` 调试
4. 检查事件总线消息

## 更新日志

### v1.0.0 (2026-01-04)

- 初始版本发布
- 实现核心书写功能
- 支持压力感应
- 实现图层管理
- 实现三种橡皮擦模式
- 完整的历史记录支持

## 许可证

MIT License

## 联系方式

- **作者**: LanStart Team
- **邮箱**: support@lanstart.com
- **GitHub**: https://github.com/lanstart/inkcanvas-electron-write

## 致谢

感谢所有为 LanStartWrite 项目贡献的开发者和用户。
