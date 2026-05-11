const button = document.getElementById("refresh");
const status = document.getElementById("status");
const results = document.getElementById("results");

async function checkDesktop() {
  try {
    const response = await fetch("http://127.0.0.1:18765/api/health");
    const data = await response.json();
    status.textContent = data.ok ? "Desktop app is connected." : "Desktop app did not respond correctly.";
  } catch {
    status.textContent = "Desktop app is not reachable.";
  }
}

button.addEventListener("click", () => {
  status.textContent = "Refreshing open usage tabs...";
  results.innerHTML = "";
  chrome.runtime.sendMessage({ type: "TOKENRING_COLLECT_ALL" }, (response) => {
    if (!response?.ok) {
      status.textContent = "Refresh failed. Check extension permissions.";
      return;
    }
    status.textContent = `Refreshed ${response.tabCount} open usage tab(s).`;
    results.innerHTML = response.results.map(renderResult).join("");
  });
});

checkDesktop();

function renderResult(result) {
  const title = result.provider || "unknown";
  const ok = result.ok ? "ok" : "failed";
  const detail = result.ok
    ? `${result.mode || "unknown"}; metrics: ${result.metricsCount ?? "?"}; text: ${result.textLength ?? "n/a"}`
    : `${result.mode || "unknown"}; ${result.error || "unknown error"}`;
  return `<div class="result"><strong>${escapeHtml(title)} - ${escapeHtml(ok)}</strong>${escapeHtml(detail)}<br>${escapeHtml(result.url || "")}</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
