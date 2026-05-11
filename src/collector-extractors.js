function buildExtractionScript(provider) {
  return `(${collectUsageInPage.toString()})(${JSON.stringify(provider)})`;
}

function collectUsageInPage(provider) {
  const sourceUrl = window.location.href;
  const pageText = normalizeText(document.body ? document.body.innerText || "" : "");
  const metrics = provider === "chatgpt_codex" ? extractChatGptCodexUsage(pageText) : extractGenericUsage(provider);

  return {
    provider,
    metrics,
    status: metrics.length ? "ok" : "no_metrics",
    message: metrics.length
      ? `Embedded collector found ${metrics.length} metric(s)`
      : `Embedded collector saw the page, but found no usable percentages. Text length: ${pageText.length}`,
    sourceUrl,
    collectorSource: "embedded",
    extractorVersion: "embedded-0.1.0"
  };

  function normalizeText(text) {
    return String(text).replace(/\s+/g, " ").trim();
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

  function extractChatGptCodexUsage(text) {
    const results = [];
    const seenKinds = new Set();
    const cardPattern = /((?:GPT-5\.3-Codex-Spark\s*)?(?:5\s*\u5c0f\u65f6|\u6bcf\u5468)\s*\u4f7f\u7528\u9650\u989d)\s*(\d{1,3}(?:\.\d+)?)\s*%\s*\u5269\u4f59/gi;
    let cardMatch;

    while ((cardMatch = cardPattern.exec(text))) {
      const labelText = cardMatch[1];
      const percent = Number(cardMatch[2]);
      const lowerLabel = labelText.toLowerCase();
      const isSpark = lowerLabel.includes("gpt-5.3-codex-spark");
      const isWeekly = /\u6bcf\u5468/.test(labelText);
      const kind = isSpark ? (isWeekly ? "spark_weekly" : "spark_5h") : (isWeekly ? "weekly" : "5h");
      if (seenKinds.has(kind) || !Number.isFinite(percent)) continue;

      seenKinds.add(kind);
      const after = text.slice(cardPattern.lastIndex, cardPattern.lastIndex + 220);
      const resetMatch = after.match(/\u91cd\u7f6e\u65f6\u95f4\s*[:\uff1a]\s*(.*?)(?=\s+(?:GPT-5\.3-Codex-Spark|5\s*\u5c0f\u65f6|\u6bcf\u5468|\u5269\u4f59\u989d|$))/i);
      const label = isSpark
        ? (isWeekly ? "GPT-5.3-Codex-Spark Weekly" : "GPT-5.3-Codex-Spark 5-hour")
        : (isWeekly ? "Weekly" : "5-hour");

      results.push({
        kind,
        label,
        remainingPct: clampPercent(percent),
        usedPct: clampPercent(100 - percent),
        resetText: resetMatch ? `Reset time: ${resetMatch[1].trim()}` : null,
        rawText: text.slice(Math.max(0, cardMatch.index - 80), Math.min(text.length, cardPattern.lastIndex + 160))
      });
    }

    return results;
  }

  function extractGenericUsage(currentProvider) {
    const candidates = [
      ...extractTextPercentCandidates(currentProvider),
      ...extractProgressCandidates(currentProvider)
    ];
    return dedupeCandidates(candidates).map(toMetric);
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

  function extractTextPercentCandidates(currentProvider) {
    const candidates = [];
    const percentPattern = /(\d{1,3}(?:\.\d+)?)\s*%/g;
    for (const element of candidateElements()) {
      const text = visibleText(element);
      if (!text || text.length > 450) continue;
      let match;
      while ((match = percentPattern.exec(text))) {
        const percent = Number(match[1]);
        if (!Number.isFinite(percent) || percent < 0 || percent > 100) continue;
        const kind = metricKind(text, currentProvider);
        if (!kind) continue;
        candidates.push({
          kind,
          percent,
          meaning: percentMeaning(text, currentProvider),
          label: labelForKind(kind, currentProvider),
          resetText: resetText(text),
          rawText: text,
          score: scoreText(text)
        });
      }
    }
    return candidates;
  }

  function extractProgressCandidates(currentProvider) {
    const candidates = [];
    const elements = Array.from(document.querySelectorAll("[role='progressbar'], [aria-valuenow]"));
    for (const element of elements) {
      const value = Number(element.getAttribute("aria-valuenow"));
      if (!Number.isFinite(value) || value < 0 || value > 100) continue;
      const parent = element.closest("section, article, li, tr, div") || element.parentElement;
      const text = normalizeText(`${visibleText(parent || element)} ${element.getAttribute("aria-label") || ""}`);
      const kind = metricKind(text, currentProvider);
      if (!kind) continue;
      candidates.push({
        kind,
        percent: value,
        meaning: percentMeaning(text, currentProvider),
        label: labelForKind(kind, currentProvider),
        resetText: resetText(text),
        rawText: text,
        score: scoreText(text) + 1
      });
    }
    return candidates;
  }

  function metricKind(text, currentProvider) {
    const lower = text.toLowerCase();
    if (/5\s*[- ]?\s*h|5\s*hour|five\s*hour|session|local\s+messages|cloud\s+tasks|5\s*\u5c0f\u65f6/.test(lower)) return "5h";
    if (/week|weekly|\u6bcf\u5468/.test(lower)) return "weekly";
    if (/month|monthly|\u6bcf\u6708/.test(lower)) return "monthly";
    if (/code\s+review/.test(lower)) return "code_review";
    if (/web\s*search|reader|zread|search/.test(lower)) return "tools";
    if (/token/.test(lower)) return "tokens";
    if (currentProvider === "chatgpt_codex" && /limit|usage|codex|rate/.test(lower)) return "codex";
    return null;
  }

  function labelForKind(kind, currentProvider) {
    if (kind === "5h") return "5-hour";
    if (kind === "weekly") return "Weekly";
    if (kind === "monthly") return "Monthly";
    if (kind === "code_review") return "Code review";
    if (kind === "tokens") return currentProvider === "zai" ? "Token usage" : "Tokens";
    if (kind === "tools") return currentProvider === "zai" ? "Search / reader" : "Tool usage";
    return "Usage";
  }

  function percentMeaning(text, currentProvider) {
    const lower = text.toLowerCase();
    if (/remaining|left|available|\u5269\u4f59|\u53ef\u7528/.test(lower)) return "remaining";
    if (/used|usage|consumed|\u5df2\u7528|\u4f7f\u7528/.test(lower)) return "used";
    return currentProvider === "chatgpt_codex" ? "remaining" : "used";
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
    if (/remaining|left|available|used|usage|limit|quota|\u5269\u4f59|\u4f7f\u7528/i.test(text)) score += 2;
    if (/reset|resets|renews|refreshes|\u91cd\u7f6e|\u6062\u590d/i.test(text)) score += 1;
    return score;
  }

  function dedupeCandidates(candidates) {
    const byKind = new Map();
    for (const candidate of candidates) {
      const previous = byKind.get(candidate.kind);
      if (!previous || candidate.score > previous.score || candidate.rawText.length < previous.rawText.length) {
        byKind.set(candidate.kind, candidate);
      }
    }
    return Array.from(byKind.values());
  }

  function toMetric(candidate) {
    const isUsed = candidate.meaning === "used";
    return {
      kind: candidate.kind,
      label: candidate.label,
      usedPct: clampPercent(isUsed ? candidate.percent : 100 - candidate.percent),
      remainingPct: clampPercent(isUsed ? 100 - candidate.percent : candidate.percent),
      resetText: candidate.resetText,
      rawText: candidate.rawText
    };
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, value));
  }
}

module.exports = {
  buildExtractionScript
};
