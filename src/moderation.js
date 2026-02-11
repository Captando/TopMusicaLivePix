const fs = require("node:fs");
const path = require("node:path");

const { warn } = require("./logger");

function normalizeText(v) {
  return String(v || "")
    .trim()
    .toLowerCase();
}

function cleanLabel(v) {
  const s = String(v || "").trim();
  return s;
}

function cleanReason(v) {
  return String(v || "")
    .trim()
    .slice(0, 300);
}

class ModerationStore {
  constructor({ filePath } = {}) {
    this.filePath = String(filePath || "").trim();
    this.state = {
      version: 1,
      blockedSenders: [],
      blockedKeywords: []
    };

    if (this.filePath) {
      this._loadFromDisk();
    }
  }

  _normalizeList(list, { field }) {
    if (!Array.isArray(list)) return [];

    const out = [];
    const seen = new Set();

    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const valueRaw = item[field] ?? item.value ?? item.label;
      const value = normalizeText(valueRaw);
      if (!value || seen.has(value)) continue;
      seen.add(value);

      out.push({
        value,
        label: cleanLabel(item.label || valueRaw || value),
        reason: cleanReason(item.reason),
        at: Number(item.at) || Date.now()
      });
    }

    return out;
  }

  _loadFromDisk() {
    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });

      if (!fs.existsSync(this.filePath)) {
        this._saveToDisk();
        return;
      }

      const raw = fs.readFileSync(this.filePath, "utf8");
      if (!raw.trim()) {
        this._saveToDisk();
        return;
      }

      const json = JSON.parse(raw);
      this.state = {
        version: 1,
        blockedSenders: this._normalizeList(json.blockedSenders, { field: "sender" }),
        blockedKeywords: this._normalizeList(json.blockedKeywords, { field: "keyword" })
      };
      this._saveToDisk();
    } catch (e) {
      warn(`Failed to load moderation store ${this.filePath}: ${e.message}`);
      this.state = {
        version: 1,
        blockedSenders: [],
        blockedKeywords: []
      };
    }
  }

  _saveToDisk() {
    if (!this.filePath) return;

    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      const payload = JSON.stringify(this.state, null, 2);
      fs.writeFileSync(this.filePath, payload, "utf8");
    } catch (e) {
      warn(`Failed to save moderation store ${this.filePath}: ${e.message}`);
    }
  }

  snapshot() {
    return {
      version: this.state.version,
      blockedSenders: [...this.state.blockedSenders],
      blockedKeywords: [...this.state.blockedKeywords]
    };
  }

  isSenderBlocked(sender) {
    const key = normalizeText(sender);
    if (!key) return null;
    return this.state.blockedSenders.find((x) => x.value === key) || null;
  }

  findBlockedKeyword(message) {
    const text = normalizeText(message);
    if (!text) return null;

    for (const item of this.state.blockedKeywords) {
      if (!item || !item.value) continue;
      if (text.includes(item.value)) return item;
    }

    return null;
  }

  blockSender(sender, reason) {
    const label = cleanLabel(sender);
    const value = normalizeText(sender);
    if (!value) return { ok: false, reason: "missing_sender" };

    if (this.state.blockedSenders.some((x) => x.value === value)) {
      return { ok: false, reason: "already_blocked" };
    }

    const entry = {
      value,
      label: label || value,
      reason: cleanReason(reason),
      at: Date.now()
    };

    this.state.blockedSenders.push(entry);
    this._saveToDisk();
    return { ok: true, entry };
  }

  unblockSender(sender) {
    const value = normalizeText(sender);
    if (!value) return { ok: false, reason: "missing_sender" };

    const before = this.state.blockedSenders.length;
    this.state.blockedSenders = this.state.blockedSenders.filter((x) => x.value !== value);
    const changed = this.state.blockedSenders.length !== before;

    if (!changed) return { ok: false, reason: "not_found" };

    this._saveToDisk();
    return { ok: true };
  }

  blockKeyword(keyword, reason) {
    const label = cleanLabel(keyword);
    const value = normalizeText(keyword);
    if (!value) return { ok: false, reason: "missing_keyword" };

    if (this.state.blockedKeywords.some((x) => x.value === value)) {
      return { ok: false, reason: "already_blocked" };
    }

    const entry = {
      value,
      label: label || value,
      reason: cleanReason(reason),
      at: Date.now()
    };

    this.state.blockedKeywords.push(entry);
    this._saveToDisk();
    return { ok: true, entry };
  }

  unblockKeyword(keyword) {
    const value = normalizeText(keyword);
    if (!value) return { ok: false, reason: "missing_keyword" };

    const before = this.state.blockedKeywords.length;
    this.state.blockedKeywords = this.state.blockedKeywords.filter((x) => x.value !== value);
    const changed = this.state.blockedKeywords.length !== before;

    if (!changed) return { ok: false, reason: "not_found" };

    this._saveToDisk();
    return { ok: true };
  }
}

module.exports = { ModerationStore };
