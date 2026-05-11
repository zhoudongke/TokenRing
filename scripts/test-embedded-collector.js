const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { buildExtractionScript } = require("../src/collector-extractors");

const samples = [
  {
    provider: "chatgpt_codex",
    html: `
      <main>
        <h1>Codex 分析</h1>
        <section>5 小时使用限额 <strong>93%</strong> 剩余 <span>重置时间： 19:22</span></section>
        <section>每周使用限额 <strong>79%</strong> 剩余 <span>重置时间： 2026年5月14日 19:43</span></section>
        <section>GPT-5.3-Codex-Spark 5 小时使用限额 <strong>100%</strong> 剩余</section>
      </main>
    `,
    expected: { "5h": 93, weekly: 79 }
  },
  {
    provider: "claude",
    html: `
      <main>
        <section>5-hour usage 60% used Resets in 13 min</section>
        <section>Weekly 10% used Resets Sun 12:00 PM</section>
      </main>
    `,
    expected: { "5h": 40, weekly: 90 }
  },
  {
    provider: "zai",
    html: `
      <main>
        <section>5 小时 31% 使用</section>
        <section>每周 6% 使用 Reset Time: 2026-05-18 02:52</section>
      </main>
    `,
    expected: { "5h": 69, weekly: 94 }
  }
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  for (const sample of samples) {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(sample.html)}`);
    const result = await win.webContents.executeJavaScript(buildExtractionScript(sample.provider), true);
    assertExpected(sample, result);
  }

  win.destroy();
  app.quit();
});

function assertExpected(sample, result) {
  const byKind = new Map(result.metrics.map((metric) => [metric.kind, metric]));
  for (const [kind, expected] of Object.entries(sample.expected)) {
    const metric = byKind.get(kind);
    if (!metric) {
      throw new Error(`${sample.provider} missing metric ${kind}`);
    }
    const actual = Math.round(metric.remainingPct);
    if (actual !== expected) {
      throw new Error(`${sample.provider} ${kind}: expected ${expected}, got ${actual}`);
    }
  }
  console.log(`${sample.provider} ok`);
}
