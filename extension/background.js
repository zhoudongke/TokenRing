const USAGE_TARGETS = [
  { provider: "claude", url: "https://claude.ai/settings/usage*" },
  { provider: "chatgpt_codex", url: "https://chatgpt.com/codex/*" },
  { provider: "zai", url: "https://z.ai/manage-apikey/subscription*" }
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("tokenring-refresh", { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("tokenring-refresh", { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "tokenring-refresh") {
    collectFromOpenTabs();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "TOKENRING_COLLECT_ALL") return false;
  collectFromOpenTabs().then((result) => sendResponse(result));
  return true;
});

async function collectFromOpenTabs() {
  const tabs = [];
  for (const target of USAGE_TARGETS) {
    const matched = await chrome.tabs.query({ url: target.url });
    tabs.push(...matched.map((tab) => ({ ...tab, tokenRingProvider: target.provider })));
  }

  const uniqueTabs = Array.from(new Map(tabs.map((tab) => [tab.id, tab])).values());
  const results = await Promise.allSettled(uniqueTabs.map((tab) => collectFromTab(tab)));
  return {
    ok: true,
    tabCount: uniqueTabs.length,
    results: results.map((result) => result.status === "fulfilled" ? result.value : { ok: false, error: String(result.reason) })
  };
}

async function collectFromTab(tab) {
  const tabId = tab.id;
  const provider = providerFromUrl(tab.url) || tab.tokenRingProvider;
  const forced = await collectByForcedInjection(tabId, provider, tab.url);
  if (forced.ok || forced.metricsCount >= 0) {
    return forced;
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "TOKENRING_COLLECT_NOW" });
    if (response?.ok || response?.metricsCount >= 0) {
      return { ...response, tabId, url: tab.url, mode: "content-script" };
    }
  } catch (error) {
    return { ok: false, tabId, url: tab.url, provider, mode: "failed", error: error.message };
  }

  return { ok: false, tabId, url: tab.url, provider, mode: "failed", error: "No collector response" };
}

async function collectByForcedInjection(tabId, provider, url) {
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: forcedCollectUsage,
      args: [provider]
    });
    return {
      tabId,
      url,
      mode: "forced-injection",
      ...(injected?.[0]?.result || { ok: false, error: "No result from forced injection" })
    };
  } catch (error) {
    return { ok: false, tabId, url, provider, mode: "forced-injection-failed", error: error.message };
  }
}

function providerFromUrl(urlText) {
  try {
    const url = new URL(urlText);
    if (url.hostname === "claude.ai" && url.pathname.startsWith("/settings/usage")) return "claude";
    if (url.hostname === "chatgpt.com" && url.pathname.startsWith("/codex/")) return "chatgpt_codex";
    if (url.hostname === "z.ai" && url.pathname.startsWith("/manage-apikey/subscription")) return "zai";
  } catch {
    return null;
  }
  return null;
}

async function forcedCollectUsage(provider) {
  const endpoint = "http://127.0.0.1:18765/api/usage";
  const text = document.body ? document.body.innerText.replace(/\s+/g, " ").trim() : "";
  const metrics = provider === "chatgpt_codex" ? parseChatGptCodexText(text) : [];
  const seen = new Set(metrics.map((metric) => metric.kind));
  const percentPattern = /(\d{1,3}(?:\.\d+)?)\s*%/g;
  const lowerPage = text.toLowerCase();

  function parseChatGptCodexText(pageText) {
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

  function contextAt(index) {
    return text.slice(Math.max(0, index - 140), Math.min(text.length, index + 180));
  }

  function kindFromContext(context) {
    const lower = context.toLowerCase();
    if (/5\s*[- ]?\s*h|5\s*hour|five\s*hour|session|local\s+messages|cloud\s+tasks|5\s*\u5c0f\u65f6/.test(lower)) return "5h";
    if (/week|weekly|\u6bcf\u5468/.test(lower)) return "weekly";
    if (/month|monthly|\u6bcf\u6708/.test(lower)) return "monthly";
    if (/code\s+review/.test(lower)) return "code_review";
    if (/web\s*search|reader|zread|search/.test(lower)) return "tools";
    if (/token/.test(lower)) return "tokens";
    if (provider === "chatgpt_codex" && /limit|usage|codex|rate/.test(lower)) return "codex";
    return null;
  }

  function labelFromKind(kind) {
    if (kind === "5h") return "5-hour";
    if (kind === "weekly") return "Weekly";
    if (kind === "monthly") return "Monthly";
    if (kind === "code_review") return "Code review";
    if (kind === "tokens") return "Token usage";
    if (kind === "tools") return "Search / reader";
    return "Usage";
  }

  function isRemaining(context) {
    const lower = context.toLowerCase();
    if (/remaining|left|available|\u5269\u4f59|\u53ef\u7528/.test(lower)) return true;
    if (/used|usage|consumed|\u5df2\u7528|\u4f7f\u7528/.test(lower)) return false;
    return provider === "chatgpt_codex";
  }

  function resetFromContext(context) {
    const patterns = [
      /(?:reset|resets|renews|refreshes|next reset|\u91cd\u7f6e|\u6062\u590d)(?:\s+in|\s+at|[:\uff1a])?\s*([^.;|]{3,80})/i,
      /(?:in|after)\s+(\d+\s*(?:h|hr|hour|hours|m|min|minute|minutes|d|day|days)[^.;|]{0,60})/i
    ];
    for (const pattern of patterns) {
      const match = context.match(pattern);
      if (match) return match[0].replace(/\s+/g, " ").trim();
    }
    return null;
  }

  let match;
  while ((match = percentPattern.exec(text))) {
    const percent = Number(match[1]);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) continue;
    const context = contextAt(match.index);
    const kind = kindFromContext(context);
    if (!kind || seen.has(kind)) continue;
    seen.add(kind);
    const remainingPct = isRemaining(context) ? percent : 100 - percent;
    const usedPct = isRemaining(context) ? 100 - percent : percent;
    metrics.push({
      kind,
      label: labelFromKind(kind),
      remainingPct,
      usedPct,
      resetText: resetFromContext(context),
      rawText: context.slice(0, 500)
    });
  }

  const payload = {
    provider,
    metrics,
    status: metrics.length ? "ok" : "no_metrics",
    message: metrics.length
      ? `Forced collector found ${metrics.length} metric(s)`
      : `Forced collector saw this page, but found no usable percentages. Text length: ${text.length}. Contains usage keyword: ${/usage|limit|remaining|quota|rate/i.test(lowerPage)}`,
    sourceUrl: location.href,
    collectorSource: "extension",
    extractorVersion: "0.1.1-forced"
  };

  await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  return { ok: true, provider, metricsCount: metrics.length, textLength: text.length };
}
