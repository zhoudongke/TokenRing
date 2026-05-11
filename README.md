# TokenRing

TokenRing is a local Windows-friendly quota viewer for subscription usage pages that do not expose stable public APIs.

The MVP supports:

- Claude Pro usage page: `https://claude.ai/settings/usage`
- ChatGPT Codex usage page: `https://chatgpt.com/codex/cloud/settings/analytics#usage`
- Z.ai subscription page: `https://z.ai/manage-apikey/subscription`

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
