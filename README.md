# TokenRing

TokenRing is a local Windows-friendly quota viewer for subscription usage pages that do not expose stable public APIs.

The MVP supports:

- Claude Pro usage page: `https://claude.ai/settings/usage`
- ChatGPT Codex usage page: `https://chatgpt.com/codex/cloud/settings/analytics#usage`
- Z.ai subscription page: `https://z.ai/manage-apikey/subscription`

![TokenRing screenshot](docs/screenshot.png)

## How It Works

TokenRing has two parts:

1. A local Electron tray app that listens on `http://127.0.0.1:18765` and displays ring gauges.
2. A Chrome/Edge extension that reads visible usage percentages from the official pages you are already logged into and posts them to the local app.

The extension does not store passwords, cookies, or account tokens. It only reads rendered text/progress values from the three allowed pages and sends the latest snapshot to localhost.

## Run the Desktop App

```powershell
npm install
npm start
```

The app starts hidden in the Windows tray. Click the TokenRing tray icon or use its tray menu to show the window. Closing or minimizing the window hides it back to the tray.

## Install the Browser Extension

Chrome or Edge:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select `D:\my_software\TokenRing\extension`.

Then open each usage page while the desktop app is running:

- Claude: `https://claude.ai/settings/usage`
- ChatGPT Codex: `https://chatgpt.com/codex/cloud/settings/analytics#usage`
- Z.ai: `https://z.ai/manage-apikey/subscription`

The rings update when the extension detects visible percentages on the page.

The extension also refreshes any already-open usage tabs about once per minute. You can force a refresh from the extension popup with **Refresh open tabs now**.

## Color Rules

- More than 40% remaining: green
- More than 15% remaining: yellow
- 15% or less remaining: red

## Current Limitations

This MVP reads visible percentages heuristically. If a provider changes its page text or DOM structure, update `extension/content.js` for that provider.

If TokenRing shows that a page was seen but no metrics were found, the extension is installed and connected, but the extractor did not match that page's current text or DOM.

If a page remains `Never updated`, open the extension popup and click **Refresh open tabs now**. The popup reports whether it used the normal content script or the forced injection fallback for each open usage tab.

Codex and Claude usually display remaining/used values differently, so TokenRing normalizes them:

- ChatGPT Codex defaults to treating percentages as remaining.
- Claude and Z.ai default to treating percentages as used.

## 中文说明

TokenRing 是一个面向 Windows 的本地额度查看工具，用于快速查看 Claude Pro、ChatGPT Codex 和 Z.ai Coding Plan 的订阅制额度。它不调用这些平台的私有接口，也不保存账号密码、Cookie 或登录令牌，而是通过浏览器扩展读取你已经登录的官方 usage 页面上可见的额度百分比，再发送到本机桌面端显示。

![TokenRing 界面截图](docs/screenshot.png)

### 工作方式

TokenRing 由两个部分组成：

1. Windows 桌面端：Electron 托盘应用，监听 `http://127.0.0.1:18765`，负责本地存储和圆环显示。
2. Chrome/Edge 扩展：在官方 usage 页面中读取可见的额度文本和进度条，并把结果发送到本机桌面端。

支持的页面：

- Claude Pro：`https://claude.ai/settings/usage`
- ChatGPT Codex：`https://chatgpt.com/codex/cloud/settings/analytics#usage`
- Z.ai：`https://z.ai/manage-apikey/subscription`

### 安装桌面端

开发环境运行：

```powershell
npm install
npm start
```

打包后运行：

1. 解压 `release/app/TokenRing-0.1.0-win-x64.zip`。
2. 运行解压目录中的 `TokenRing.exe`。
3. 程序启动后默认隐藏在 Windows 右下角托盘中。
4. 点击托盘图标，或在托盘右键菜单中选择 `Show TokenRing` 显示窗口。

如果右下角没有直接看到图标，请先检查 Windows 托盘的 `^` 隐藏图标区域。

### 安装浏览器扩展

1. 解压 `release/extension/TokenRing-Collector-0.1.2.zip` 到一个固定目录。
2. 打开 `chrome://extensions` 或 `edge://extensions`。
3. 开启开发者模式。
4. 点击“加载已解压的扩展”。
5. 选择刚才解压出来的扩展目录。
6. 保持 TokenRing 桌面端运行。
7. 打开 Claude、ChatGPT Codex、Z.ai 的 usage 页面。
8. 点击扩展图标中的 `Refresh open tabs now`，手动刷新一次已打开页面。

扩展也会定时刷新已经打开的 usage 页面，因此页面保持打开时，额度会自动更新。

### 显示规则

界面只显示两类核心额度：

- `5-hour`
- `Weekly`

其他项目，例如 monthly spend、Codex Spark 额度或额外工具额度，会被隐藏。

颜色含义：

- 剩余量大于 40%：绿色
- 剩余量大于 15% 且小于等于 40%：黄色
- 剩余量小于等于 15%：红色

### 常见问题

如果某个平台显示 `Never updated`，通常说明扩展还没有在对应页面成功采集。请确认：

- 桌面端正在运行。
- 浏览器扩展已经加载并启用。
- 你已经登录对应平台。
- usage 页面已经完整加载。
- 已在扩展弹窗中点击 `Refresh open tabs now`。

如果 Z.ai 或其他平台某一项数据偶尔短暂没有读到，桌面端会保留上一轮同类指标，不会用半包刷新清空已有的 weekly 数据。

### 打包

生成桌面端和扩展包：

```powershell
npm run dist
```

单独生成 README 截图：

```powershell
npm run screenshot
```
