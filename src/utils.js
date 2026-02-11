function clampInt(n, { min, max, fallback }) {
  const x = Number.parseInt(String(n), 10);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(max, Math.max(min, x));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getByPath(obj, dotPath) {
  if (!dotPath) return undefined;
  const parts = String(dotPath)
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;

  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function firstDefined(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim().replace(",", ".");
    const n = Number.parseFloat(normalized);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extractFirstUrl(text) {
  const s = String(text || "");
  const m = s.match(/https?:\/\/[^\s<>()]+/i);
  if (m && m[0]) {
    // Remove common trailing punctuation that often appears in chat.
    return m[0].replace(/[),.;:!?\]'\"»]+$/g, "");
  }

  // Also accept "www.youtube.com/..." without scheme.
  const m2 = s.match(/\b(www\.[^\s<>()]+)\b/i);
  if (m2 && m2[1]) {
    return `https://${m2[1]}`.replace(/[),.;:!?\]'\"»]+$/g, "");
  }

  return null;
}

function parseYoutubeVideoId(urlString) {
  try {
    const u = new URL(urlString);
    const host = (u.hostname || "").toLowerCase();

    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }

    if (host.endsWith("youtube.com")) {
      if (u.pathname === "/watch") {
        const id = u.searchParams.get("v");
        return id || null;
      }

      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "shorts" && parts[1]) return parts[1];
      if (parts[0] === "live" && parts[1]) return parts[1];
      if (parts[0] === "embed" && parts[1]) return parts[1];
    }

    return null;
  } catch {
    return null;
  }
}

function isWhitelistedUrl(urlString, whitelistHosts) {
  if (!urlString) return false;
  try {
    const u = new URL(urlString);
    const host = (u.hostname || "").toLowerCase();
    const wl = (whitelistHosts || []).map((h) => String(h).toLowerCase());
    return wl.includes(host);
  } catch {
    return false;
  }
}

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

module.exports = {
  asNumber,
  clampInt,
  extractFirstUrl,
  firstDefined,
  getByPath,
  isWhitelistedUrl,
  newId,
  normalizeText,
  parseYoutubeVideoId,
  sleep
};
