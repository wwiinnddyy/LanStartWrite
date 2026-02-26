# LanStartWrite 运行指南

## 环境要求

- **Node.js**: 18.x 或更高版本
- **包管理器**: pnpm (推荐) 或 npm
- **操作系统**: Windows 10/11 (支持 Mica 材质效果)

## 安装依赖

### 使用 pnpm (推荐)

```bash
pnpm install
```

### 使用 npm

```bash
npm install
```

## 开发模式运行

### 启动开发服务器

```bash
pnpm dev
# 或
npm run dev
```

### 打开开发者工具

设置环境变量后启动：

```powershell
$env:LANSTART_OPEN_DEVTOOLS="1"
pnpm dev
```

## 构建生产版本

### 完整构建

```bash
pnpm build
# 或
npm run build
```

### 预览生产版本

```bash
pnpm preview
# 或
npm run preview
```

## 测试

### 运行所有测试

```bash
pnpm test
# 或
npm run test
```

### 测试文件位置

- `src/button/__tests__/Button.test.tsx`
- `src/hyper_glass/__tests__/thumbnailBlur.test.ts`
- `src/toolbar/__tests__/FloatingToolbar.test.tsx`

## 类型检查

```bash
pnpm typecheck
# 或
npm run typecheck
```

## 发布

### 创建发布版本

```bash
pnpm release
# 或
npm run release
```

## 项目结构

```
lanstart-write/
├── src/
│   ├── main/              # Electron 主进程
│   ├── preload/           # 预加载脚本
│   ├── renderer/          # 渲染进程 (React)
│   ├── elysia/            # 后端服务
│   ├── toolbar/           # 浮动工具栏
│   ├── toolbar-subwindows/# 工具栏子窗口
│   ├── settings/          # 设置页面
│   ├── paint_board/       # 画板
│   ├── button/            # 按钮组件
│   ├── Mantine/           # Mantine UI 配置
│   ├── Tailwind/          # Tailwind CSS 配置
│   ├── Framer_Motion/     # 动画库
│   ├── hyper_glass/       # 毛玻璃效果
│   ├── LeavelDB/          # 数据库
│   └── status/            # 状态管理
├── out/                   # 构建输出
├── resources/             # 静态资源
└── electron-builder.yml   # 打包配置
```

## 常用命令速查

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发模式 |
| `pnpm build` | 构建生产版本 |
| `pnpm preview` | 预览生产版本 |
| `pnpm test` | 运行测试 |
| `pnpm typecheck` | 类型检查 |
| `pnpm release` | 创建发布 |

## 常见问题

### 安装依赖失败

如果遇到原生模块编译失败，尝试：

```bash
# 清理缓存
pnpm store prune

# 重新安装
pnpm install
```

### 开发服务器启动慢

首次启动需要编译 Electron 和原生模块，请耐心等待。后续启动会更快。

### Windows 上 Mica 效果不显示

确保：
- Windows 版本 >= 10 2004
- 已启用透明效果 (设置 > 个性化 > 颜色 > 透明效果)

## 技术栈

- **Electron**: 35.x
- **React**: 18.x
- **TypeScript**: 5.x
- **Vite**: 6.x
- **Elysia**: 1.x
- **Framer Motion**: 12.x
- **Mantine**: 8.x
- **Tailwind CSS**: 3.x
- **LevelDB**: 10.x
