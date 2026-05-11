const TOKEN_RING_ENDPOINT = "http://127.0.0.1:18765/api/usage";
const EXTRACTOR_VERSION = "0.1.0";

const PLATFORM_CONFIG = {
  claude: {
    host: "claude.ai",
    path: "/settings/usage",
    defaultPercentMeaning: "used",
    labels: {
      fiveHour: "5-hour",
      weekly: "Weekly"
    }
  },
  chatgpt_codex: {
    host: "chatgpt.com",
    paths: [
      "/codex/settings/usage",
      "/codex/cloud/settings/usage",
      "/codex/cloud/settings/analytics"
    ],
    defaultPercentMeaning: "remaining",
    labels: {
      fiveHour: "5-hour",
      weekly: "Weekly"
    }
  },
  zai: {
    host: "z.ai",
    path: "/manage-apikey/subscription",
    defaultPercentMeaning: "used",
    labels: {
      tokens: "Token usage",
      tools: "Search / reader"
    }
  }
};

function getProvider() {
  const { host, pathname } = window.location;
  return Object.entries(PLATFORM_CONFIG).find(([, config]) => {
    if (host !== config.host) return false;
    if (config.path) return pathname.startsWith(config.path);
    if (config.paths) return config.paths.some((path) => pathname.startsWith(path));
    return false;
  })?.[0] || null;
}

function visibleText(element) {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return "";
  }
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return "";
  return normalizeText(element.innerText || element.textContent || "");
}

function normalizeText(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function metricKind(text, provider) {
  const lower = text.toLowerCase();
  if (/5\s*[- ]?\s*h|5\s*hour|five\s*hour|session|local\s+messages|cloud\s+tasks|5\s*\u5c0f\u65f6/.test(lower)) return "5h";
  if (/week|weekly|\u6bcf\u5468/.test(lower)) return "weekly";
  if (/month|monthly|\u6bcf\u6708/.test(lower)) return "monthly";
  if (/code\s+review/.test(lower)) return "code_review";
  if (/web\s*search|reader|zread|search/.test(lower)) return "tools";
  if (/token/.test(lower)) return "tokens";
  if (provider === "chatgpt_codex" && /limit|usage|codex|rate/.test(lower)) return "codex";
  return null;
}

function labelForKind(kind, provider) {
  const labels = PLATFORM_CONFIG[provider].labels;
  if (kind === "5h") return labels.fiveHour || "5-hour";
  if (kind === "weekly") return labels.weekly || "Weekly";
  if (kind === "monthly") return "Monthly";
  if (kind === "code_review") return "Code review";
  if (kind === "tokens") return labels.tokens || "Token usage";
  if (kind === "tools") return labels.tools || "Tool usage";
  return "Usage";
}

function percentMeaning(text, provider) {
  const lower = text.toLowerCase();
  if (/remaining|left|available|\u5269\u4f59|\u53ef\u7528/.test(lower)) return "remaining";
  if (/used|usage|consumed|\u5df2\u7528|\u4f7f\u7528/.test(lower)) return "used";
  return PLATFORM_CONFIG[provider].defaultPercentMeaning;
}

function resetText(text) {
  const patterns = [
    /(?:reset|resets|renews|refreshes|next reset|\u91cd\u7f6e|\u6062\u590d)(?:\s+in|\s+at|[:\uff1a])?\s*([^.;|]{3,80})/i,
    /(?:in|after)\s+(\d+\s*(?:h|hr|hour|hours|m|min|minute|minutes|d|day|days)[^.;|]{0,60})/i,
    /(\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return normalizeText(match[0]);
  }
  return null;
}

function scoreText(text) {
  let score = 0;
  if (/5\s*[- ]?\s*h|5\s*hour|five\s*hour|session|5\s*\u5c0f\u65f6/i.test(text)) score += 4;
  if (/week|weekly|\u6bcf\u5468/i.test(text)) score += 4;
  if (/token/i.test(text)) score += 3;
  if (/search|reader|zread/i.test(text)) score += 3;
  if (/remaining|left|available|used|usage|limit|quota/i.test(text)) score += 2;
  if (/reset|resets|renews|refreshes|\u91cd\u7f6e|\u6062\u590d/i.test(text)) score += 1;
  return score;
}

function candidateElements() {
  return Array.from(document.querySelectorAll([
    "[role='progressbar']",
    "[aria-valuenow]",
    "section",
    "article",
    "li",
    "tr",
    "div",
    "p",
    "span"
  ].join(",")));
}

function extractTextPercentCandidates(provider) {
  const candidates = [];
  const percentPattern = /(\d{1,3}(?:\.\d+)?)\s*%/g;
  for (const element of candidateElements()) {
    const text = visibleText(element);
    if (!text || text.length > 450) continue;
    let match;
    while ((match = percentPattern.exec(text))) {
      const percent = Number(match[1]);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) continue;
      const kind = metricKind(text, provider);
      if (!kind) continue;
      candidates.push({
        kind,
        percent,
        meaning: percentMeaning(text, provider),
        label: labelForKind(kind, provider),
        resetText: resetText(text),
        rawText: text,
        score: scoreText(text)
      });
    }
  }
  return candidates;
}

function extractProgressCandidates(provider) {
  const candidates = [];
  const elements = Array.from(document.querySelectorAll("[role='progressbar'], [aria-valuenow]"));
  for (const element of elements) {
    const value = Number(element.getAttribute("aria-valuenow"));
    if (!Number.isFinite(value) || value < 0 || value > 100) continue;
    const parent = element.closest("section, article, li, tr, div") || element.parentElement;
    const text = normalizeText(`${visibleText(parent || element)} ${element.getAttribute("aria-label") || ""}`);
    const kind = metricKind(text, provider);
    if (!kind) continue;
    candidates.push({
      kind,
      percent: value,
      meaning: percentMeaning(text, provider),
      label: labelForKind(kind, provider),
      resetText: resetText(text),
      rawText: text,
      score: scoreText(text) + 1
    });
  }
  return candidates;
}

function toMetric(candidate) {
  const usedPct = candidate.meaning === "used" ? candidate.percent : 100 - candidate.percent;
  const remainingPct = candidate.meaning === "remaining" ? candidate.percent : 100 - candidate.percent;
  return {
    kind: candidate.kind,
    label: candidate.label,
    usedPct,
    remainingPct,
    resetText: candidate.resetText,
    rawText: candidate.rawText
  };
}

function dedupeCandidates(candidates) {
  const byKind = new Map();
  for (const candidate of candidates) {
    const previous = byKind.get(candidate.kind);
    if (!previous || candidate.score > previous.score || candidate.rawText.length < previous.rawText.length) {
      byKind.set(candidate.kind, candidate);
    }
  }
  return Array.from(byKind.values()).map(toMetric);
}

function extractUsage(provider) {
  if (provider === "chatgpt_codex") {
    const chatGptMetrics = extractChatGptCodexUsage();
    if (chatGptMetrics.length) return chatGptMetrics;
  }
  const candidates = [
    ...extractTextPercentCandidates(provider),
    ...extractProgressCandidates(provider)
  ];
  return dedupeCandidates(candidates);
}

function extractChatGptCodexUsage() {
  const pageText = normalizeText(document.body?.innerText || "");
  const results = [];
  const seenKinds = new Set();
  const cardPattern = /((?:GPT-5\.3-Codex-Spark\s*)?(?:5\s*\u5c0f\u65f6|\u6bcf\u5468)\s*\u4f7f\u7528\u9650\u989d)\s*(\d{1,3}(?:\.\d+)?)\s*%\s*\u5269\u4f59/gi;
  let cardMatch;
  while ((cardMatch = cardPattern.exec(pageText))) {
    const labelText = cardMatch[1];
    const percent = Number(cardMatch[2]);
    const lowerLabel = labelText.toLowerCase();
    const isSpark = lowerLabel.includes("gpt-5.3-codex-spark");
    const isWeekly = /\u6bcf\u5468/.test(labelText);
    const kind = isSpark ? (isWeekly ? "spark_weekly" : "spark_5h") : (isWeekly ? "weekly" : "5h");
    if (seenKinds.has(kind) || !Number.isFinite(percent)) continue;
    seenKinds.add(kind);
    const after = pageText.slice(cardPattern.lastIndex, cardPattern.lastIndex + 220);
    const resetMatch = after.match(/\u91cd\u7f6e\u65f6\u95f4\s*[:\uff1a]\s*(.*?)(?=\s+(?:GPT-5\.3-Codex-Spark|5\s*\u5c0f\u65f6|\u6bcf\u5468|\u5269\u4f59\u989d|$))/i);
    const label = isSpark
      ? (isWeekly ? "GPT-5.3-Codex-Spark Weekly" : "GPT-5.3-Codex-Spark 5-hour")
      : (isWeekly ? "Weekly" : "5-hour");
    results.push({
      kind,
      label,
      remainingPct: Math.max(0, Math.min(100, percent)),
      usedPct: Math.max(0, Math.min(100, 100 - percent)),
      resetText: resetMatch ? `Reset time: ${resetMatch[1].trim()}` : null,
      rawText: pageText.slice(Math.max(0, cardMatch.index - 80), Math.min(pageText.length, cardPattern.lastIndex + 160))
    });
  }
  return results;
}

async function postUsage(provider, metrics) {
  await fetch(TOKEN_RING_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      metrics,
      status: metrics.length ? "ok" : "no_metrics",
      message: metrics.length ? `Collected ${metrics.length} metric(s)` : "Usage page detected, but no percentage values matched",
      sourceUrl: window.location.href,
      extractorVersion: EXTRACTOR_VERSION
    })
  });
}

let activeProvider = null;
let collectorStarted = false;

function scheduleCollector(provider) {
  if (collectorStarted && activeProvider === provider) return;
  activeProvider = provider;
  collectorStarted = true;

  let timer = null;
  const run = async () => {
    const currentProvider = getProvider() || provider;
    const metrics = extractUsage(currentProvider);
    try {
      await postUsage(currentProvider, metrics);
      return { ok: true, provider: currentProvider, metricsCount: metrics.length };
    } catch {
      // The desktop app may be closed. Keep the page untouched and retry on the next mutation.
      return { ok: false, provider: currentProvider, metricsCount: metrics.length };
    }
  };

  const debouncedRun = () => {
    clearTimeout(timer);
    timer = setTimeout(run, 700);
  };

  run();
  setInterval(run, 15000);
  new MutationObserver(debouncedRun).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-valuenow", "style", "class"]
  });

  window.__tokenRingRun = run;
}

function tryStartCollector() {
  const provider = getProvider();
  if (provider) {
    scheduleCollector(provider);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "TOKENRING_COLLECT_NOW") return false;
  tryStartCollector();
  if (window.__tokenRingRun) {
    window.__tokenRingRun().then(sendResponse);
  } else {
    sendResponse({ ok: false, provider: null, metricsCount: 0, error: `Unsupported URL: ${window.location.href}` });
  }
  return true;
});

function installLocationWatcher() {
  let lastUrl = window.location.href;
  const check = () => {
    if (window.location.href === lastUrl) return;
    lastUrl = window.location.href;
    tryStartCollector();
  };

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function pushState(...args) {
    const result = originalPushState.apply(this, args);
    setTimeout(check, 0);
    return result;
  };
  history.replaceState = function replaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    setTimeout(check, 0);
    return result;
  };
  window.addEventListener("popstate", check);
  window.addEventListener("hashchange", check);
  setInterval(check, 1000);
}

installLocationWatcher();
tryStartCollector();
