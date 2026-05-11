const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const outputPath = path.join(root, "docs", "screenshot.png");
const preloadPath = path.join(os.tmpdir(), "tokenring-screenshot-preload.js");

const mockState = {
  updatedAt: "2026-05-11T07:31:00.000Z",
  providers: {
    claude: {
      collectedAt: "2026-05-11T07:31:00.000Z",
      metrics: [
        { kind: "5h", label: "5-hour", remainingPct: 40, resetText: "Resets in 13 min" },
        { kind: "weekly", label: "Weekly", remainingPct: 90, resetText: "Resets Sun 12:00 PM" }
      ]
    },
    chatgpt_codex: {
      collectedAt: "2026-05-11T07:31:00.000Z",
      metrics: [
        { kind: "5h", label: "5-hour", remainingPct: 92, resetText: "Reset time: 19:22" },
        { kind: "weekly", label: "Weekly", remainingPct: 79, resetText: "Reset time: 2026-05-14 19:43" }
      ]
    },
    zai: {
      collectedAt: "2026-05-11T07:31:00.000Z",
      metrics: [
        { kind: "5h", label: "5-hour", remainingPct: 69, resetText: "Reset time not found" },
        { kind: "weekly", label: "Weekly", remainingPct: 94, resetText: "Reset Time: 2026-05-18 02:52" }
      ]
    }
  }
};

fs.writeFileSync(
  preloadPath,
  `
  window.tokenRing = {
    getState: async () => ${JSON.stringify(mockState)},
    openProvider: async () => true,
    windowAction: async () => undefined,
    onUsageUpdated: () => undefined
  };
  `,
  "utf8"
);

app.whenReady().then(async () => {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const window = new BrowserWindow({
    width: 390,
    height: 860,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: false,
      nodeIntegration: false
    }
  });

  await window.loadFile(path.join(root, "src", "renderer", "index.html"));
  await window.webContents.executeJavaScript(`render(${JSON.stringify(mockState)})`);
  await new Promise((resolve) => setTimeout(resolve, 700));
  const image = await window.capturePage();
  fs.writeFileSync(outputPath, image.toPNG());
  window.destroy();
  app.quit();
});
