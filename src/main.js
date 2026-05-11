const { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain, session } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { buildExtractionScript } = require("./collector-extractors");

const PORT = 18765;
const COLLECTOR_INTERVAL_MS = 60 * 1000;
const COLLECTOR_NAVIGATION_TIMEOUT_MS = 30 * 1000;
const COLLECTOR_SETTLE_MS = 2500;
const COLLECTOR_METRIC_WAIT_MS = 20 * 1000;
const COLLECTOR_METRIC_POLL_MS = 2000;
const COLLECTOR_PARTITION = "persist:tokenring-collector";
const LOWER_PRIORITY_OVERRIDE_MS = 10 * 60 * 1000;
const SOURCE_PRIORITY = {
  embedded: 2,
  extension: 1,
  unknown: 0
};
const PROVIDER_URLS = {
  claude: "https://claude.ai/settings/usage",
  chatgpt_codex: "https://chatgpt.com/codex/cloud/settings/analytics#usage",
  zai: "https://z.ai/manage-apikey/subscription"
};

let tray;
let mainWindow;
let server;
let storePath;
let logPath;
const collectorWindows = new Map();
const collectorTimers = new Map();
const collectorRefreshes = new Map();
const programmaticRefreshes = new Map();
const userVisibleCollectors = new Set();
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
  const extractorVersion = payload.extractorVersion ? String(payload.extractorVersion).slice(0, 40) : "unknown";
  const collectorSource = payload.collectorSource
    ? String(payload.collectorSource).slice(0, 40)
    : inferCollectorSource(extractorVersion);
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
        collectorSource,
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
    collectorSource,
    extractorVersion
  };
}

function inferCollectorSource(extractorVersion) {
  if (String(extractorVersion || "").startsWith("embedded")) return "embedded";
  if (String(extractorVersion || "").includes("forced") || String(extractorVersion || "") !== "unknown") return "extension";
  return "unknown";
}

function metricPriority(metric) {
  return SOURCE_PRIORITY[metric?.collectorSource] ?? SOURCE_PRIORITY.unknown;
}

function metricAgeMs(metric) {
  const time = Date.parse(metric?.observedAt || "");
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return Date.now() - time;
}

function shouldReplaceMetric(previous, next) {
  if (!previous) return true;
  if (metricPriority(next) >= metricPriority(previous)) return true;
  return metricAgeMs(previous) > LOWER_PRIORITY_OVERRIDE_MS;
}

function mergeMetrics(previousMetrics = [], nextMetrics = [], previousSource = "unknown") {
  const merged = new Map();
  for (const metric of previousMetrics) {
    if (metric && metric.kind) {
      merged.set(metric.kind, {
        ...metric,
        collectorSource: metric.collectorSource || previousSource
      });
    }
  }
  for (const metric of nextMetrics) {
    if (metric && metric.kind) {
      const previous = merged.get(metric.kind);
      if (shouldReplaceMetric(previous, metric)) {
        merged.set(metric.kind, metric);
      }
    }
  }
  return Array.from(merged.values());
}

function mergeUsage(payload) {
  const record = sanitizeUsagePayload(payload);
  const previous = state.providers[record.provider];
  if (previous) {
    const previousSource = previous.collectorSource || inferCollectorSource(previous.extractorVersion);
    record.metrics = mergeMetrics(previous.metrics, record.metrics, previousSource);
    if (record.status === "no_metrics" && hasCoreMetrics(record.metrics)) {
      record.status = "stale";
      record.message = `No metrics found in latest pass; keeping previous ${record.metrics.filter(isCoreMetric).length}/2 core metric(s)`;
    }
  }
  state.updatedAt = record.collectedAt;
  state.providers[record.provider] = record;
  appendCollectorLog(record, payload);
  writeState();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("usage-updated", state);
  }
  return record;
}

function isCoreMetric(metric) {
  return metric.kind === "5h" || metric.kind === "weekly";
}

function hasCoreMetrics(metrics = []) {
  return metrics.some(isCoreMetric);
}

function appendCollectorLog(record, incomingPayload) {
  if (!logPath) return;
  const logRecord = {
    time: record.collectedAt,
    provider: record.provider,
    collectorSource: record.collectorSource,
    status: record.status,
    sourceUrl: record.sourceUrl,
    incomingMetrics: (incomingPayload.metrics || []).map((metric) => ({
      kind: metric.kind,
      remainingPct: metric.remainingPct,
      usedPct: metric.usedPct
    })),
    finalCoreMetrics: record.metrics
      .filter((metric) => metric.kind === "5h" || metric.kind === "weekly")
      .map((metric) => ({
        kind: metric.kind,
        remainingPct: metric.remainingPct,
        usedPct: metric.usedPct,
        collectorSource: metric.collectorSource,
        observedAt: metric.observedAt
      }))
  };
  try {
    fs.appendFileSync(logPath, `${JSON.stringify(logRecord)}\n`, "utf8");
  } catch {
    // Logging must not interrupt quota collection.
  }
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
    { label: "Open Embedded Claude", click: () => openCollectorWindow("claude") },
    { label: "Open Embedded ChatGPT Codex", click: () => openCollectorWindow("chatgpt_codex") },
    { label: "Open Embedded Z.ai", click: () => openCollectorWindow("zai") },
    { label: "Refresh Embedded Collectors", click: () => collectAllEmbeddedProviders() },
    { type: "separator" },
    { label: "Open Claude in Browser", click: () => shell.openExternal(PROVIDER_URLS.claude) },
    { label: "Open ChatGPT Codex in Browser", click: () => shell.openExternal(PROVIDER_URLS.chatgpt_codex) },
    { label: "Open Z.ai in Browser", click: () => shell.openExternal(PROVIDER_URLS.zai) },
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
  if (!PROVIDER_URLS[provider]) return false;
  openCollectorWindow(provider);
  return true;
});

ipcMain.handle("get-state", async () => state);

ipcMain.handle("refresh-collectors", async () => {
  await collectAllEmbeddedProviders();
  return state;
});

ipcMain.handle("window-action", async (_event, action) => {
  if (!mainWindow) return;
  if (action === "hide") mainWindow.hide();
  if (action === "minimize") mainWindow.hide();
  if (action === "close") mainWindow.hide();
});

app.whenReady().then(() => {
  storePath = path.join(app.getPath("userData"), "usage-state.json");
  logPath = path.join(app.getPath("userData"), "collector-log.jsonl");
  readState();
  configureCollectorSession();
  startServer();
  createTray();
  createWindow();
  startEmbeddedCollectors();
});

app.on("before-quit", () => {
  app.isQuiting = true;
  for (const timer of collectorTimers.values()) {
    clearInterval(timer);
  }
  for (const win of collectorWindows.values()) {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
  if (server) {
    server.close();
  }
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

function configureCollectorSession() {
  const collectorSession = session.fromPartition(COLLECTOR_PARTITION);
  const userAgent = collectorSession.getUserAgent().replace(/\sElectron\/\S+/, "");
  collectorSession.setUserAgent(userAgent);
}

function startEmbeddedCollectors() {
  for (const provider of Object.keys(PROVIDER_URLS)) {
    ensureCollectorWindow(provider);
    refreshAndCollectEmbeddedProvider(provider);
    const timer = setInterval(() => {
      refreshAndCollectEmbeddedProvider(provider);
    }, COLLECTOR_INTERVAL_MS);
    collectorTimers.set(provider, timer);
  }
}

function ensureCollectorWindow(provider) {
  const existing = collectorWindows.get(provider);
  if (existing && !existing.isDestroyed()) {
    return existing;
  }

  const win = new BrowserWindow({
    width: 1120,
    height: 820,
    show: false,
    skipTaskbar: true,
    title: `TokenRing Collector - ${provider}`,
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    webPreferences: {
      partition: COLLECTOR_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  collectorWindows.set(provider, win);

  win.on("close", (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      userVisibleCollectors.delete(provider);
      win.hide();
    }
  });

  win.webContents.on("did-finish-load", () => {
    scheduleEmbeddedCollect(provider);
  });

  win.webContents.on("did-navigate-in-page", () => {
    scheduleEmbeddedCollect(provider);
  });

  win.loadURL(PROVIDER_URLS[provider]);
  return win;
}

function openCollectorWindow(provider) {
  const win = ensureCollectorWindow(provider);
  if (win.isMinimized()) {
    win.restore();
  }
  userVisibleCollectors.add(provider);
  win.center();
  win.show();
  win.focus();
  refreshAndCollectEmbeddedProvider(provider);
}

async function collectAllEmbeddedProviders() {
  const results = await Promise.allSettled(Object.keys(PROVIDER_URLS).map((provider) => refreshAndCollectEmbeddedProvider(provider)));
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("usage-updated", state);
  }
  return results;
}

function refreshAndCollectEmbeddedProvider(provider) {
  const existing = collectorRefreshes.get(provider);
  if (existing) return existing;

  const refresh = runRefreshAndCollectEmbeddedProvider(provider).finally(() => {
    if (collectorRefreshes.get(provider) === refresh) {
      collectorRefreshes.delete(provider);
    }
  });
  collectorRefreshes.set(provider, refresh);
  return refresh;
}

async function runRefreshAndCollectEmbeddedProvider(provider) {
  const restoreVisibility = await makeCollectorWindowRenderable(provider);
  try {
    await refreshCollectorWindow(provider, { forceReload: true });
    return await collectEmbeddedProviderWhenReady(provider);
  } finally {
    restoreVisibility();
    programmaticRefreshes.delete(provider);
  }
}

async function makeCollectorWindowRenderable(provider) {
  const win = ensureCollectorWindow(provider);
  if (userVisibleCollectors.has(provider) || win.isDestroyed()) {
    return () => {};
  }

  const previousBounds = win.getBounds();
  win.setBounds({
    x: -32000,
    y: -32000,
    width: previousBounds.width,
    height: previousBounds.height
  });
  win.showInactive();
  await wait(250);

  return () => {
    if (win.isDestroyed() || userVisibleCollectors.has(provider)) return;
    win.hide();
    win.setBounds(previousBounds);
  };
}

async function refreshCollectorWindow(provider, options = {}) {
  const win = ensureCollectorWindow(provider);
  if (win.isDestroyed() || win.webContents.isDestroyed()) {
    return;
  }

  const targetUrl = PROVIDER_URLS[provider];
  const currentUrl = win.webContents.getURL();
  const targetWithoutHash = targetUrl.split("#")[0];
  const sameTarget = currentUrl === targetUrl || currentUrl.startsWith(targetWithoutHash);

  if (!sameTarget) {
    markProgrammaticRefresh(provider);
    await loadCollectorUrl(win, targetUrl);
  } else if (options.forceReload) {
    markProgrammaticRefresh(provider);
    await reloadCollectorUrl(win);
  }

  await wait(COLLECTOR_SETTLE_MS);
}

function markProgrammaticRefresh(provider) {
  programmaticRefreshes.set(provider, Date.now() + COLLECTOR_NAVIGATION_TIMEOUT_MS + COLLECTOR_SETTLE_MS);
}

function scheduleEmbeddedCollect(provider) {
  const ignoreUntil = programmaticRefreshes.get(provider);
  if (ignoreUntil && Date.now() < ignoreUntil) {
    return;
  }
  if (ignoreUntil) {
    programmaticRefreshes.delete(provider);
  }
  setTimeout(() => collectEmbeddedProviderWhenReady(provider), 1500);
}

function loadCollectorUrl(win, url) {
  return withNavigationTimeout(win.loadURL(url));
}

function reloadCollectorUrl(win) {
  return withNavigationTimeout(new Promise((resolve, reject) => {
    const cleanup = () => {
      win.webContents.off("did-finish-load", handleDone);
      win.webContents.off("did-fail-load", handleFail);
    };
    const handleDone = () => {
      cleanup();
      resolve();
    };
    const handleFail = (_event, errorCode, errorDescription) => {
      cleanup();
      reject(new Error(`Reload failed ${errorCode}: ${errorDescription}`));
    };
    win.webContents.once("did-finish-load", handleDone);
    win.webContents.once("did-fail-load", handleFail);
    win.webContents.reloadIgnoringCache();
  }));
}

async function withNavigationTimeout(promise) {
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(resolve, COLLECTOR_NAVIGATION_TIMEOUT_MS);
  });
  try {
    await Promise.race([promise.catch(() => undefined), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectEmbeddedProvider(provider) {
  const win = ensureCollectorWindow(provider);
  if (win.isDestroyed() || win.webContents.isDestroyed() || win.webContents.isLoading()) {
    return null;
  }

  try {
    const payload = await win.webContents.executeJavaScript(buildExtractionScript(provider), true);
    return mergeUsage(payload);
  } catch (error) {
    return mergeUsage({
      provider,
      metrics: [],
      status: "collector_error",
      message: `Embedded collector error: ${error.message}`,
      sourceUrl: win.webContents.getURL(),
      extractorVersion: "embedded-0.1.0"
    });
  }
}

async function collectEmbeddedProviderWhenReady(provider) {
  const startedAt = Date.now();
  let lastRecord = null;

  while (Date.now() - startedAt <= COLLECTOR_METRIC_WAIT_MS) {
    lastRecord = await collectEmbeddedProvider(provider);
    if (lastRecord && lastRecord.status === "ok" && hasCoreMetrics(lastRecord.metrics)) {
      return lastRecord;
    }
    await wait(COLLECTOR_METRIC_POLL_MS);
  }

  return lastRecord;
}
