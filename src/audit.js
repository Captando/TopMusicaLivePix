const fs = require("node:fs");
const path = require("node:path");

const { warn } = require("./logger");
const { newId } = require("./utils");

function asPositiveInt(value, fallback, max) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function normalizeKey(v) {
  return String(v || "")
    .trim()
    .toLowerCase();
}

function normalizeName(v) {
  const s = String(v || "").trim();
  return s || "Anon";
}

class AuditLog {
  constructor({ filePath, maxEvents = 5000 } = {}) {
    this.filePath = String(filePath || "").trim();
    this.maxEvents = asPositiveInt(maxEvents, 5000, 200_000);
    this.events = [];

    if (this.filePath) {
      this._loadFromDisk();
    }
  }

  _loadFromDisk() {
    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });

      if (!fs.existsSync(this.filePath)) {
        fs.writeFileSync(this.filePath, "", "utf8");
        return;
      }

      const raw = fs.readFileSync(this.filePath, "utf8");
      if (!raw.trim()) return;

      const lines = raw.split(/\r?\n/).filter(Boolean);
      const parsed = [];

      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          if (!item || typeof item !== "object") continue;
          parsed.push(item);
        } catch {
          // Keep reading even if one line is corrupt.
        }
      }

      if (parsed.length > this.maxEvents) {
        this.events = parsed.slice(parsed.length - this.maxEvents);
      } else {
        this.events = parsed;
      }
    } catch (e) {
      warn(`Failed to load audit log ${this.filePath}: ${e.message}`);
      this.events = [];
    }
  }

  _appendLine(line) {
    if (!this.filePath) return;

    try {
      fs.appendFileSync(this.filePath, line, "utf8");
    } catch (e) {
      warn(`Failed to append audit log ${this.filePath}: ${e.message}`);
    }
  }

  append(event) {
    const entry = {
      id: newId("audit"),
      at: Date.now(),
      ...(event && typeof event === "object" ? event : { payload: event })
    };

    this.events.push(entry);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }

    this._appendLine(`${JSON.stringify(entry)}\n`);
    return entry;
  }

  query({ limit = 100, type, sinceAt, sender, donationId, actionType } = {}) {
    const max = asPositiveInt(limit, 100, 1000);
    const typeNeedle = String(type || "").trim();
    const donationNeedle = String(donationId || "").trim();
    const actionNeedle = String(actionType || "").trim();
    const senderNeedle = normalizeKey(sender);

    const since = Number(sinceAt);
    const useSince = Number.isFinite(since) && since > 0;

    const out = [];

    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const e = this.events[i];
      if (!e || typeof e !== "object") continue;

      if (typeNeedle && String(e.type || "") !== typeNeedle) continue;
      if (donationNeedle && String(e.donationId || "") !== donationNeedle) continue;
      if (actionNeedle && String(e.actionType || "") !== actionNeedle) continue;
      if (senderNeedle && normalizeKey(e.sender) !== senderNeedle) continue;
      if (useSince && Number(e.at) < since) continue;

      out.push(e);
      if (out.length >= max) break;
    }

    return out;
  }

  summary({ hours = 24 } = {}) {
    const h = Math.max(1, Math.min(24 * 30, Number.parseInt(String(hours), 10) || 24));
    const sinceAt = Date.now() - h * 3_600_000;

    let totalDonations = 0;
    let totalValue = 0;
    let blockedDonations = 0;
    let duplicateDonations = 0;
    let errors = 0;

    const uniqueSenders = new Set();
    let topDonation = null;
    const actionStats = {};

    for (const e of this.events) {
      if (!e || typeof e !== "object") continue;
      if (Number(e.at) < sinceAt) continue;

      if (e.type === "donation.accepted") {
        totalDonations += 1;
        const value = Number(e.value) || 0;
        totalValue += value;

        const sender = normalizeName(e.sender);
        uniqueSenders.add(normalizeKey(sender));

        if (!topDonation || value > topDonation.value) {
          topDonation = {
            donationId: e.donationId || "",
            sender,
            value
          };
        }
      }

      if (e.type === "donation.blocked") blockedDonations += 1;
      if (e.type === "donation.duplicate") duplicateDonations += 1;
      if (e.type === "error") errors += 1;

      if (e.type === "action.executed") {
        const name = String(e.actionType || "unknown");
        if (!actionStats[name]) {
          actionStats[name] = { total: 0, ok: 0, failed: 0, skipped: 0 };
        }
        actionStats[name].total += 1;

        if (e.skipped) actionStats[name].skipped += 1;
        else if (e.ok) actionStats[name].ok += 1;
        else actionStats[name].failed += 1;
      }
    }

    const averageValue = totalDonations > 0 ? totalValue / totalDonations : 0;

    return {
      generatedAt: Date.now(),
      windowHours: h,
      totals: {
        donations: totalDonations,
        value: totalValue,
        averageValue,
        uniqueSenders: uniqueSenders.size,
        blockedDonations,
        duplicateDonations,
        errors
      },
      topDonation,
      actionStats
    };
  }

  topSenders({ hours = 24, limit = 10 } = {}) {
    const h = Math.max(1, Math.min(24 * 30, Number.parseInt(String(hours), 10) || 24));
    const max = asPositiveInt(limit, 10, 100);
    const sinceAt = Date.now() - h * 3_600_000;

    const bySender = new Map();

    for (const e of this.events) {
      if (!e || typeof e !== "object") continue;
      if (e.type !== "donation.accepted") continue;
      if (Number(e.at) < sinceAt) continue;

      const sender = normalizeName(e.sender);
      const key = normalizeKey(sender);
      const value = Number(e.value) || 0;

      const cur = bySender.get(key) || {
        sender,
        donations: 0,
        totalValue: 0,
        lastAt: 0
      };

      cur.sender = sender;
      cur.donations += 1;
      cur.totalValue += value;
      cur.lastAt = Math.max(cur.lastAt, Number(e.at) || 0);

      bySender.set(key, cur);
    }

    return Array.from(bySender.values())
      .sort((a, b) => {
        if (b.totalValue !== a.totalValue) return b.totalValue - a.totalValue;
        if (b.donations !== a.donations) return b.donations - a.donations;
        return b.lastAt - a.lastAt;
      })
      .slice(0, max);
  }
}

module.exports = { AuditLog };
