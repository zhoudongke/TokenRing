# TokenRing

TokenRing is a local Windows quota viewer for subscription usage pages that do not expose stable public APIs.
It collects visible quota values from embedded Electron browser pages, so Chrome or Edge does not need to stay open after you have logged in inside TokenRing.

![TokenRing screenshot](docs/screenshot.png)

## Supported Providers

- Claude Pro: `https://claude.ai/settings/usage`
- ChatGPT Codex: `https://chatgpt.com/codex/cloud/settings/analytics#usage`
- Z.ai Coding Plan: `https://z.ai/manage-apikey/subscription`

## How It Works

TokenRing has two collection paths:

1. Embedded collectors inside the Electron tray app. TokenRing opens hidden browser pages for Claude, ChatGPT Codex, and Z.ai, refreshes them about once per minute, then reads visible usage values from those pages.
2. Optional Chrome/Edge extension collection. The extension can still read already-open usage pages and post the latest snapshot to the local app.

The app does not store passwords. Embedded collectors keep login sessions in Electron's local browser session. The extension does not store passwords, cookies, or account tokens.

## Run the Desktop App

```powershell
npm install
npm start
```

The app starts hidden in the Windows tray. Click the TokenRing tray icon or use its tray menu to show the window. Closing or minimizing the window hides it back to the tray.

For embedded collection, click each provider's `Open` button in TokenRing and log in inside the embedded window. After login, TokenRing can keep collecting in the background while Chrome or Edge is closed.

## Packaged Windows Build

```powershell
npm run dist:win
```

The packaged app is written to:

```text
release/app/TokenRing-0.1.0-win-x64.zip
```

Install by extracting the ZIP to a permanent folder and running `TokenRing.exe`.

## Optional Browser Extension

The browser extension is optional when embedded collection is working. It is still useful as a fallback collector for pages already open in Chrome or Edge.

Chrome or Edge:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select the local `extension` folder.
5. Keep the desktop app running.
6. Open the provider usage pages and click **Refresh open tabs now** from the extension popup if needed.

## Embedded Collection

The embedded collectors refresh about once per minute while TokenRing is running. Use **Refresh** in the footer or the tray menu item **Refresh Embedded Collectors** to force an immediate refresh.

Each provider card shows its own collection status next to the provider name:

- `Collecting`: the embedded page is loaded and core metrics were found.
- `Using last value`: the latest pass did not find usable metrics, so TokenRing keeps the last valid values.
- `Login needed`: the embedded page appears to be on a login or authorization flow.
- `Needs attention`: the page loaded, but no 5-hour or weekly metric matched.

First-time setup:

1. Start TokenRing.
2. Click the tray icon to show the window.
3. Click `Open` for Claude, ChatGPT Codex, and Z.ai.
4. Log in inside each embedded browser window if prompted.
5. Close those embedded windows after login if you want; TokenRing hides them and continues collecting in the background.
6. Keep TokenRing running in the tray.

## Display Rules

The main UI shows only two core quota types:

- `5-hour`
- `Weekly`

Other values, such as monthly spend, Codex Spark quota, extra credit, or tool-specific quotas, are hidden from the main UI.

Color rules:

- More than 40% remaining: green
- More than 15% remaining: yellow
- 15% or less remaining: red

## Diagnostics

Collection diagnostics are written to:

```text
%APPDATA%\token-ring\collector-log.jsonl
```

Each log line records the provider, collector source, source URL, incoming metrics, and final 5-hour / weekly values after priority merging. Embedded collectors have priority over the optional browser extension, so stale or incorrect extension results will not overwrite recent embedded values.

## Current Limitations

TokenRing reads visible page text and DOM state heuristically. If a provider changes its page text or DOM structure, the extractor may need to be updated.

If a provider remains `Never updated`, open its embedded page with the `Open` button and confirm you are logged in. If a provider shows `Using last value`, TokenRing is intentionally keeping the last valid 5-hour and weekly values until the next successful pass.

## 中文说明

TokenRing 是一个面向 Windows 的本地额度查看工具，用于快速查看 Claude Pro、ChatGPT Codex 和 Z.ai Coding Plan 的订阅制额度。它不调用这些平台的私有接口，也不保存账号密码，而是读取官方网页上已经展示出来的可见额度信息。

![TokenRing 界面截图](docs/screenshot.png)

### 支持的平台

- Claude Pro：`https://claude.ai/settings/usage`
- ChatGPT Codex：`https://chatgpt.com/codex/cloud/settings/analytics#usage`
- Z.ai Coding Plan：`https://z.ai/manage-apikey/subscription`

### 工作方式

TokenRing 有两条采集路径：

1. 内置浏览器采集器：TokenRing 使用 Electron 后台浏览器窗口打开三个平台的额度页面，定时刷新并读取页面上的 5-hour 和 weekly 额度。
2. Chrome/Edge 扩展：这是可选的备用采集方式，用于读取你已经在浏览器中打开的额度页面，并把结果发送到本地桌面端。

推荐优先使用内置浏览器采集器。首次登录完成后，可以关闭 Chrome/Edge，只要 TokenRing 仍在托盘中运行，它就会继续后台刷新额度。

### 桌面端使用

开发环境运行：

```powershell
npm install
npm start
```

打包 Windows 版本：

```powershell
npm run dist:win
```

打包结果位于：

```text
release/app/TokenRing-0.1.0-win-x64.zip
```

使用步骤：

1. 解压 ZIP 到一个固定目录。
2. 运行 `TokenRing.exe`。
3. 程序启动后会驻留在 Windows 托盘中。
4. 点击托盘图标显示主窗口。
5. 分别点击 Claude、ChatGPT Codex、Z.ai 卡片上的 `Open`。
6. 在 TokenRing 打开的内置浏览器窗口中完成登录。
7. 登录成功后可以关闭这些内置窗口；关闭操作只是隐藏窗口，后台仍会继续采集。

如果右下角没有看到托盘图标，请先检查 Windows 托盘的 `^` 隐藏图标区域。

### 界面说明

每个平台都有独立卡片。卡片标题旁会显示当前采集状态：

- `Collecting`：页面已加载，并成功读到核心额度。
- `Using last value`：最新一轮没有读到可用额度，当前保留上一轮有效值。
- `Login needed`：内置页面处于登录或授权流程，需要重新登录。
- `Needs attention`：页面已加载，但没有匹配到 5-hour 或 weekly 额度。

主界面只显示两类核心额度：

- `5-hour`
- `Weekly`

颜色含义：

- 剩余量大于 40%：绿色
- 剩余量大于 15% 且小于等于 40%：黄色
- 剩余量小于等于 15%：红色

### 刷新逻辑

内置采集器大约每 1 分钟自动刷新一次。你也可以点击底部的 `Refresh` 按钮，或在托盘菜单中点击 `Refresh Embedded Collectors` 立即刷新。

后台刷新会保持隐藏状态，不应在显示器上弹出或闪烁窗口。Z.ai 页面会自动切换到 Usage 标签页后再读取额度。

### 可选浏览器扩展

当内置采集器可用时，浏览器扩展不是必须的。需要使用扩展时：

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启开发者模式。
3. 点击“加载已解压的扩展”。
4. 选择本仓库中的 `extension` 目录。
5. 保持 TokenRing 桌面端运行。
6. 打开对应平台的额度页面。
7. 在扩展弹窗中点击 `Refresh open tabs now`。

### 常见问题

如果某个平台显示 `Never updated`，通常说明该平台尚未成功采集。请确认：

- TokenRing 桌面端正在运行。
- 已点击该平台卡片上的 `Open`。
- 已在内置浏览器窗口中完成登录。
- 官方额度页面已经完整加载。

如果某个平台短暂显示 `Using last value`，通常是网页刷新或页面渲染延迟造成的。TokenRing 会保留上一轮有效的 5-hour 和 weekly 数据，避免界面出现错误跳变。

### 诊断日志

采集日志位于：

```text
%APPDATA%\token-ring\collector-log.jsonl
```

日志会记录每次采集的来源、页面地址、传入指标和最终保留的核心额度，便于排查页面结构变化或登录失效问题。
