const { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 18765;
const PROVIDER_URLS = {
  claude: "https://claude.ai/settings/usage",
  chatgpt_codex: "https://chatgpt.com/codex/cloud/settings/analytics#usage",
  zai: "https://z.ai/manage-apikey/subscription"
};

let tray;
let mainWindow;
let server;
let storePath;
let state = {
  updatedAt: null,
  providers: {}
};

function readState() {
  try {
    const raw = fs.readFileSync(storePath, "utf8");
    state = JSON.parse(raw);
  } catch {
    state = { updatedAt: null, providers: {} };
  }
}

function writeState() {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(state, null, 2), "utf8");
}

function sanitizeUsagePayload(payload) {
  const provider = String(payload.provider || "").trim();
  if (!Object.prototype.hasOwnProperty.call(PROVIDER_URLS, provider)) {
    throw new Error("Unsupported provider");
  }

  const metrics = Array.isArray(payload.metrics) ? payload.metrics : [];
  const normalizedMetrics = metrics
    .map((metric) => {
      const remainingPct = Number(metric.remainingPct);
      const usedPct = Number(metric.usedPct);
      return {
        kind: String(metric.kind || "usage").slice(0, 64),
        label: String(metric.label || "Usage").slice(0, 120),
        remainingPct: Number.isFinite(remainingPct) ? Math.max(0, Math.min(100, remainingPct)) : null,
        usedPct: Number.isFinite(usedPct) ? Math.max(0, Math.min(100, usedPct)) : null,
        resetText: metric.resetText ? String(metric.resetText).slice(0, 200) : null,
        rawText: metric.rawText ? String(metric.rawText).slice(0, 500) : null,
        observedAt: new Date().toISOString()
      };
    })
    .filter((metric) => metric.remainingPct !== null || metric.usedPct !== null);

  return {
    provider,
    metrics: normalizedMetrics,
    status: payload.status ? String(payload.status).slice(0, 60) : (normalizedMetrics.length ? "ok" : "no_metrics"),
    message: payload.message ? String(payload.message).slice(0, 240) : null,
    sourceUrl: payload.sourceUrl ? String(payload.sourceUrl).slice(0, 500) : PROVIDER_URLS[provider],
    collectedAt: new Date().toISOString(),
    extractorVersion: payload.extractorVersion ? String(payload.extractorVersion).slice(0, 40) : "unknown"
  };
}

function mergeMetrics(previousMetrics = [], nextMetrics = []) {
  const merged = new Map();
  for (const metric of previousMetrics) {
    if (metric && metric.kind) {
      merged.set(metric.kind, metric);
    }
  }
  for (const metric of nextMetrics) {
    if (metric && metric.kind) {
      merged.set(metric.kind, metric);
    }
  }
  return Array.from(merged.values());
}

function mergeUsage(payload) {
  const record = sanitizeUsagePayload(payload);
  const previous = state.providers[record.provider];
  if (previous) {
    record.metrics = mergeMetrics(previous.metrics, record.metrics);
  }
  state.updatedAt = record.collectedAt;
  state.providers[record.provider] = record;
  writeState();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("usage-updated", state);
  }
  return record;
}

function sendJson(res, statusCode, body) {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(json);
}

function startServer() {
  server = http.createServer((req, res) => {
    const remote = req.socket.remoteAddress || "";
    const isLoopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
    if (!isLoopback) {
      sendJson(res, 403, { ok: false, error: "Loopback only" });
      return;
    }

    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    if (req.method === "GET" && req.url === "/api/state") {
      sendJson(res, 200, { ok: true, state });
      return;
    }

    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, { ok: true, app: "TokenRing", port: PORT });
      return;
    }

    if (req.method === "POST" && req.url === "/api/usage") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 128 * 1024) {
          req.destroy();
        }
      });
      req.on("end", () => {
        try {
          const payload = JSON.parse(body || "{}");
          const record = mergeUsage(payload);
          sendJson(res, 200, { ok: true, record });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message });
        }
      });
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  });

  server.listen(PORT, "127.0.0.1");
}

function createTrayIcon() {
  const iconPath = path.join(__dirname, "..", "assets", "icon.png");
  const icon = nativeImage.createFromBuffer(fs.readFileSync(iconPath));
  return icon.resize({ width: 16, height: 16 });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (!mainWindow) {
    createWindow();
  }
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
    return;
  }
  showWindow();
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("TokenRing");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show TokenRing", click: showWindow },
    { label: "Hide TokenRing", click: () => mainWindow?.hide() },
    { type: "separator" },
    { label: "Open Claude Usage", click: () => shell.openExternal(PROVIDER_URLS.claude) },
    { label: "Open ChatGPT Codex Usage", click: () => shell.openExternal(PROVIDER_URLS.chatgpt_codex) },
    { label: "Open Z.ai Subscription", click: () => shell.openExternal(PROVIDER_URLS.zai) },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() }
  ]));
  tray.on("click", toggleWindow);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 390,
    height: 610,
    minWidth: 360,
    minHeight: 520,
    frame: false,
    resizable: true,
    transparent: true,
    show: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    title: "TokenRing",
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("minimize", (event) => {
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on("close", (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

ipcMain.handle("open-provider", async (_event, provider) => {
  const url = PROVIDER_URLS[provider];
  if (!url) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle("get-state", async () => state);

ipcMain.handle("window-action", async (_event, action) => {
  if (!mainWindow) return;
  if (action === "hide") mainWindow.hide();
  if (action === "minimize") mainWindow.hide();
  if (action === "close") mainWindow.hide();
});

app.whenReady().then(() => {
  storePath = path.join(app.getPath("userData"), "usage-state.json");
  readState();
  startServer();
  createTray();
  createWindow();
});

app.on("before-quit", () => {
  app.isQuiting = true;
  if (server) {
    server.close();
  }
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
