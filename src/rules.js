const {
  extractFirstUrl,
  isWhitelistedUrl,
  normalizeText,
  parseYoutubeVideoId
} = require("./utils");

function parseDonationContext(donation, rulesConfig) {
  const cfg = rulesConfig || {};
  const normalizedMessage = normalizeText(donation.message);

  const urlFound = extractFirstUrl(donation.message);
  const urlAllowed =
    urlFound && isWhitelistedUrl(urlFound, cfg.urlWhitelist) ? urlFound : null;
  const videoId = urlAllowed ? parseYoutubeVideoId(urlAllowed) : null;

  return {
    normalizedMessage,
    url: urlAllowed,
    videoId
  };
}

function includesKeyword(messageNorm, keyword) {
  const k = normalizeText(keyword);
  if (!k) return false;
  return messageNorm.includes(k);
}

function matchRule(rule, donation, ctx) {
  if (!rule || typeof rule !== "object") return false;
  if (rule.enabled === false) return false;

  const when = rule.when || {};

  if (typeof when.minValue === "number" && donation.value < when.minValue) {
    return false;
  }

  if (when.isNewTop === true && !ctx.isNewTop) return false;
  if (when.isNewTop === false && ctx.isNewTop) return false;

  if (when.hasUrl === true && !ctx.url) return false;
  if (when.hasUrl === false && ctx.url) return false;

  if (Array.isArray(when.keywordsAny) && when.keywordsAny.length) {
    const ok = when.keywordsAny.some((kw) =>
      includesKeyword(ctx.normalizedMessage, kw)
    );
    if (!ok) return false;
  }

  if (Array.isArray(when.keywordsAll) && when.keywordsAll.length) {
    const ok = when.keywordsAll.every((kw) =>
      includesKeyword(ctx.normalizedMessage, kw)
    );
    if (!ok) return false;
  }

  if (typeof when.regex === "string" && when.regex.trim()) {
    try {
      const re = new RegExp(when.regex, "i");
      if (!re.test(donation.message || "")) return false;
    } catch {
      // Ignore bad regex and treat as non-match.
      return false;
    }
  }

  return true;
}

function channelFromType(type) {
  const t = String(type || "");
  if (t.startsWith("music.")) return "music";
  if (t.startsWith("minecraft.")) return "minecraft";
  return "system";
}

function musicKindScore(type) {
  switch (type) {
    case "music.playNow":
      return 2;
    case "music.enqueue":
      return 1;
    default:
      return 0;
  }
}

function decideActions(donation, ctx, rulesConfig) {
  const cfg = rulesConfig || {};
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];

  const matched = [];
  for (const r of rules) {
    if (!matchRule(r, donation, ctx)) continue;
    const prio = typeof r.priority === "number" ? r.priority : 0;
    const actions = Array.isArray(r.actions) ? r.actions : [];
    for (const a of actions) {
      if (!a || typeof a !== "object" || !a.type) continue;
      matched.push({
        ...a,
        _ruleId: r.id || "rule",
        _rulePriority: prio
      });
    }
  }

  // Resolve conflicts per channel (ex: music.playNow beats music.enqueue).
  const byChannel = new Map();
  for (const a of matched) {
    const ch = channelFromType(a.type);
    const arr = byChannel.get(ch) || [];
    arr.push(a);
    byChannel.set(ch, arr);
  }

  const resolved = [];

  for (const [ch, arr] of byChannel.entries()) {
    if (ch === "music") {
      const best = [...arr].sort((x, y) => {
        const dk = musicKindScore(y.type) - musicKindScore(x.type);
        if (dk !== 0) return dk;
        return (y._rulePriority || 0) - (x._rulePriority || 0);
      })[0];
      if (best) resolved.push(best);
      continue;
    }

    // For other channels, keep all but prefer higher-priority first.
    arr.sort((x, y) => (y._rulePriority || 0) - (x._rulePriority || 0));
    resolved.push(...arr);
  }

  // Stable-ish order: higher priority actions first.
  resolved.sort((x, y) => (y._rulePriority || 0) - (x._rulePriority || 0));

  return resolved;
}

module.exports = { decideActions, parseDonationContext };
