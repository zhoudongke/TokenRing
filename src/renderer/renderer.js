const PROVIDERS = [
  { id: "claude", name: "Claude Pro", url: "https://claude.ai/settings/usage" },
  { id: "chatgpt_codex", name: "ChatGPT Codex", url: "https://chatgpt.com/codex/cloud/settings/analytics#usage" },
  { id: "zai", name: "Z.ai Coding Plan", url: "https://z.ai/manage-apikey/subscription" }
];

const providerList = document.getElementById("providerList");
const lastUpdated = document.getElementById("lastUpdated");

function colorForRemaining(remainingPct) {
  if (remainingPct > 40) return "var(--green)";
  if (remainingPct > 15) return "var(--yellow)";
  return "var(--red)";
}

function formatTime(value) {
  if (!value) return "Never updated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getRemaining(metric) {
  if (typeof metric.remainingPct === "number") return metric.remainingPct;
  if (typeof metric.usedPct === "number") return Math.max(0, 100 - metric.usedPct);
  return 0;
}

function visibleMetrics(record) {
  const allowedKinds = ["5h", "weekly"];
  const metrics = record?.metrics || [];
  const byKind = new Map(metrics.map((metric) => [metric.kind, metric]));
  return allowedKinds.map((kind) => byKind.get(kind)).filter(Boolean);
}

function renderMetric(metric) {
  const remaining = Math.round(getRemaining(metric));
  const color = colorForRemaining(remaining);
  const reset = metric.resetText || "Reset time not found";
  return `
    <article class="metric">
      <div class="ring" style="--pct:${remaining}; --color:${color}">
        <span>${remaining}%</span>
      </div>
      <div class="metric-label">${escapeHtml(metric.label || metric.kind || "Usage")}</div>
      <div class="metric-reset">${escapeHtml(reset)}</div>
    </article>
  `;
}

function renderProvider(provider, record) {
  const metrics = visibleMetrics(record);
  const bestRemaining = metrics.length ? Math.min(...metrics.map(getRemaining)) : null;
  const dotColor = bestRemaining === null ? "var(--muted)" : colorForRemaining(bestRemaining);
  const emptyMessage = record
    ? `${record.message || "The usage page was seen, but no percentage matched yet."} Keep the official page open and fully loaded, then use the extension popup to refresh open tabs.`
    : "Open this provider's usage page while the extension is installed. TokenRing will read visible usage values and keep the latest local snapshot here.";
  const body = metrics.length
    ? `<div class="metric-grid">${metrics.slice(0, 4).map(renderMetric).join("")}</div>`
    : `<div class="empty">${escapeHtml(emptyMessage)}</div>`;

  return `
    <section class="provider">
      <div class="provider-head">
        <div class="provider-name">
          <span class="provider-dot" style="background:${dotColor}"></span>
          <div>
            <h2>${escapeHtml(provider.name)}</h2>
            <div class="provider-time">${escapeHtml(formatTime(record?.collectedAt))}</div>
          </div>
        </div>
        <button class="open-btn" data-provider="${provider.id}">Open</button>
      </div>
      ${body}
    </section>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function render(state) {
  const records = state?.providers || {};
  providerList.innerHTML = PROVIDERS.map((provider) => renderProvider(provider, records[provider.id])).join("");
  lastUpdated.textContent = state?.updatedAt ? `Last update ${formatTime(state.updatedAt)}` : "Open usage pages to collect data";
}

async function refresh() {
  try {
    const state = await window.tokenRing.getState();
    render(state);
  } catch {
    render({ providers: {} });
  }
}

providerList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-provider]");
  if (!button) return;
  window.tokenRing.openProvider(button.dataset.provider);
});

document.getElementById("openAllBtn").addEventListener("click", () => {
  for (const provider of PROVIDERS) {
    window.tokenRing.openProvider(provider.id);
  }
});

document.getElementById("minimizeBtn").addEventListener("click", () => {
  window.tokenRing.windowAction("minimize");
});

document.getElementById("hideBtn").addEventListener("click", () => {
  window.tokenRing.windowAction("hide");
});

window.tokenRing.onUsageUpdated(render);
refresh();
setInterval(refresh, 5000);
