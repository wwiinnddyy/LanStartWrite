# Electron Starter

Windows 上快速开始：

1. 安装 Node.js（建议 18+）：https://nodejs.org/
2. 打开终端并进入项目目录：

```bash
cd "c:/Users/HiteVision station/Documents/LanStart/electron-app"
```

3. 安装依赖并启动：

```bash
npm install
npm run start
```

或者使用 npx 直接运行最新 Electron：

```bash
npx electron@latest .
```

说明：主进程入口为 `src/main.js`，渲染器页面为 `src/index.html`，预加载脚本为 `src/preload.js`。
