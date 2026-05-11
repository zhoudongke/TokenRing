# TokenRing Design

## Goal

Provide a fast local view of subscription quota pages for:

- Claude Pro
- ChatGPT Pro / Codex
- Z.ai Coding Plan

These subscription pages do not expose stable public quota APIs. TokenRing therefore reads visible usage values from official pages the user opens while already logged in.

## Architecture

```text
Official usage pages
  -> Embedded Electron collector windows
  -> Electron main process metric merge
  -> Ring dashboard

Optional browser extension path:

Official usage pages in Chrome/Edge
  -> Browser extension content script / forced injection
  -> POST http://127.0.0.1:18765/api/usage
  -> Electron tray app metric merge
  -> Local JSON snapshot
  -> Ring dashboard
```

## Security Boundary

Embedded collectors store login state in Electron's persistent browser session and do not store passwords directly.

The optional extension is scoped to three exact usage pages and localhost. It does not:

- store account credentials
- read cookies directly
- send data to a remote server
- call subscription benefits through unsupported model APIs

The desktop app accepts requests only from loopback addresses.

## Data Contract

`POST /api/usage`

```json
{
  "provider": "claude",
  "sourceUrl": "https://claude.ai/settings/usage",
  "extractorVersion": "0.1.0",
  "metrics": [
    {
      "kind": "5h",
      "label": "5-hour",
      "remainingPct": 73,
      "usedPct": 27,
      "resetText": "resets in 2h 14m",
      "rawText": "..."
    }
  ]
}
```

Provider IDs:

- `claude`
- `chatgpt_codex`
- `zai`

## Normalization Rules

The UI always displays remaining percentage.

- ChatGPT Codex defaults to treating visible percentages as remaining.
- Claude defaults to treating visible percentages as used.
- Z.ai defaults to treating visible percentages as used.
- If nearby text contains `remaining`, `left`, or `available`, the extractor treats the value as remaining.
- If nearby text contains `used`, `usage`, or `consumed`, the extractor treats the value as used.

## MVP Limitations

The extractor is heuristic. If a provider changes page labels or removes visible percentages, update `extension/content.js` with a provider-specific extractor.

The first version intentionally avoids packet capture, private API calls, and automated login.
