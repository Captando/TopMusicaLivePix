const fs = require("node:fs");
const path = require("node:path");

const dotenv = require("dotenv");

const { warn } = require("./logger");

dotenv.config();

function env(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === null || v === "") return fallback;
  return v;
}

function envInt(key, fallback) {
  const v = env(key, "");
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(key, fallback) {
  const v = env(key, "");
  if (v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function envCsv(key, fallbackArr) {
  const v = env(key, "");
  if (!v) return fallbackArr;
  return String(v)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function loadRules(rulesPath) {
  const abs = path.isAbsolute(rulesPath)
    ? rulesPath
    : path.join(process.cwd(), rulesPath);

  try {
    const raw = fs.readFileSync(abs, "utf8");
    const json = JSON.parse(raw);

    if (!json || typeof json !== "object") {
      throw new Error("rules.json must be an object");
    }
    if (!Array.isArray(json.rules)) {
      throw new Error("rules.json must contain a 'rules' array");
    }

    return { absPath: abs, data: json };
  } catch (e) {
    warn(`Failed to load rules from ${abs}: ${e.message}`);
    return {
      absPath: abs,
      data: { urlWhitelist: [], cooldowns: {}, rules: [] }
    };
  }
}

function getConfig() {
  const rulesPath = env("RULES_PATH", "config/rules.json");
  const dataDirRaw = env("DATA_DIR", "data");
  const dataDir = path.isAbsolute(dataDirRaw)
    ? dataDirRaw
    : path.join(process.cwd(), dataDirRaw);
  const auditLogPathRaw = env("AUDIT_LOG_PATH", path.join(dataDir, "audit-log.ndjson"));
  const moderationPathRaw = env("MODERATION_PATH", path.join(dataDir, "moderation.json"));
  const auditLogPath = path.isAbsolute(auditLogPathRaw)
    ? auditLogPathRaw
    : path.join(process.cwd(), auditLogPathRaw);
  const moderationPath = path.isAbsolute(moderationPathRaw)
    ? moderationPathRaw
    : path.join(process.cwd(), moderationPathRaw);

  return {
    host: env("HOST", "127.0.0.1"),
    port: envInt("PORT", 3000),
    webhookSecret: env("WEBHOOK_SECRET", ""),
    webhookRateLimit: {
      windowMs: envInt("WEBHOOK_RATE_LIMIT_WINDOW_MS", 60_000),
      max: envInt("WEBHOOK_RATE_LIMIT_MAX", 60)
    },
    outboundWebhook: {
      allowHosts: envCsv("OUT_WEBHOOK_ALLOW_HOSTS", ["127.0.0.1", "localhost"]),
      timeoutMs: envInt("OUT_WEBHOOK_TIMEOUT_MS", 3000)
    },

    livepix: {
      valuePath: env("LIVEPIX_VALUE_PATH", ""),
      messagePath: env("LIVEPIX_MESSAGE_PATH", ""),
      senderPath: env("LIVEPIX_SENDER_PATH", ""),
      statusPath: env("LIVEPIX_STATUS_PATH", ""),
      acceptedStatuses: envCsv("LIVEPIX_ACCEPTED_STATUSES", [
        "paid",
        "confirmed",
        "approved",
        "completed"
      ])
    },

    livepixApi: {
      accessToken: env("LIVEPIX_ACCESS_TOKEN", ""),
      clientId: env("LIVEPIX_CLIENT_ID", ""),
      clientSecret: env("LIVEPIX_CLIENT_SECRET", ""),
      scope: env("LIVEPIX_SCOPE", "messages:read subscriptions:read"),
      apiBaseUrl: env("LIVEPIX_API_BASE_URL", "https://api.livepix.gg"),
      oauthTokenUrl: env("LIVEPIX_OAUTH_TOKEN_URL", "https://oauth.livepix.gg/oauth2/token")
    },

    minecraft: {
      host: env("RCON_HOST", "127.0.0.1"),
      port: envInt("RCON_PORT", 25575),
      password: env("RCON_PASSWORD", "")
    },

    music: {
      interruptBehavior: env("MUSIC_INTERRUPT_BEHAVIOR", "drop")
    },

    obs: {
      enabled: envBool("OBS_WS_ENABLED", false),
      url: env("OBS_WS_URL", "ws://127.0.0.1:4455"),
      password: env("OBS_WS_PASSWORD", "")
    },

    storage: {
      dataDir,
      auditLogPath,
      moderationPath,
      auditMaxEvents: envInt("AUDIT_MAX_EVENTS", 5000)
    },

    rulesPath,
    loadRules
  };
}

module.exports = { getConfig, loadRules };
