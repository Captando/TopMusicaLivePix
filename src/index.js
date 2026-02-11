const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const { Server } = require("socket.io");

const { getConfig } = require("./config");
const { Cooldowns } = require("./cooldowns");
const {
  extractDonation,
  extractExternalId,
  extractWebhookRef,
  verifyWebhookSecret
} = require("./livepix");
const { log, warn, error } = require("./logger");
const { decideActions, parseDonationContext } = require("./rules");
const { AppState } = require("./state");
const { MinecraftRcon } = require("./actions/minecraft");
const { MusicManager } = require("./actions/music");
const { ObsController } = require("./actions/obs");
const { postJson: postOutboundWebhook } = require("./actions/outboundWebhook");
const { LivePixApi } = require("./livepixApi");
const { formatBRL, newId, renderTemplate } = require("./utils");
const { createVersionService } = require("./version");
const { AuditLog } = require("./audit");
const { ModerationStore } = require("./moderation");

function openUrl(url) {
  if (!url) return;
  const u = String(url);

  const platform = process.platform;
  if (platform === "darwin") {
    spawn("open", [u], { stdio: "ignore", detached: true }).unref();
    return;
  }
  if (platform === "win32") {
    // cmd.exe start needs a title argument.
    spawn("cmd", ["/c", "start", "", u], { stdio: "ignore", detached: true }).unref();
    return;
  }

  spawn("xdg-open", [u], { stdio: "ignore", detached: true }).unref();
}

function parseIntParam(value, fallback, { min = 1, max = 1000 } = {}) {
  const n = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseHoursParam(value, fallback = 24) {
  return parseIntParam(value, fallback, { min: 1, max: 24 * 30 });
}

async function main() {
  const cfg = getConfig();

  let rulesBundle = cfg.loadRules(cfg.rulesPath);
  const getRules = () => rulesBundle.data;

  const state = new AppState();
  const cooldowns = new Cooldowns();

  const livepixApi = new LivePixApi(cfg.livepixApi);

  const app = express();
  // We sit behind ngrok/cloudflared; this makes req.ip use X-Forwarded-For.
  app.set("trust proxy", 1);
  const server = http.createServer(app);
  const io = new Server(server);

  const music = new MusicManager({
    io,
    state,
    interruptBehavior: cfg.music.interruptBehavior
  });

  const minecraft = new MinecraftRcon(cfg.minecraft);
  const obs = new ObsController(cfg.obs);
  const version = createVersionService({
    owner: "Captando",
    repo: "TopMusicaLivePix",
    branch: "main",
    cacheTtlMs: 60_000,
    rootDir: path.join(__dirname, "..")
  });
  const audit = new AuditLog({
    filePath: cfg.storage.auditLogPath,
    maxEvents: cfg.storage.auditMaxEvents
  });
  const moderation = new ModerationStore({
    filePath: cfg.storage.moderationPath
  });

  app.use(
    helmet({
      // YouTube iframe + socket.io in local pages; keep it simple.
      contentSecurityPolicy: false
    })
  );
  app.use(express.json({ limit: "1mb" }));

  const webhookLimiter = rateLimit({
    windowMs: cfg.webhookRateLimit.windowMs,
    max: cfg.webhookRateLimit.max,
    standardHeaders: true,
    legacyHeaders: false
  });

  const publicDir = path.join(__dirname, "..", "public");
  app.use(express.static(publicDir));

  app.get("/player", (req, res) => res.sendFile(path.join(publicDir, "player.html")));
  app.get("/overlay", (req, res) => res.sendFile(path.join(publicDir, "overlay.html")));

  app.get("/health", (req, res) => res.json({ ok: true, at: Date.now() }));

  app.get("/api/state", (req, res) => res.json({ ok: true, state: state.snapshot() }));

  app.get("/api/version", async (req, res) => {
    try {
      const info = await version.getVersionInfo();
      res.json(info);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/music/skip", (req, res) => {
    music.skip();
    res.json({ ok: true });
  });

  app.post("/api/music/clear", (req, res) => {
    music.clearQueue();
    res.json({ ok: true });
  });

  app.post("/api/rules/reload", (req, res) => {
    rulesBundle = cfg.loadRules(cfg.rulesPath);
    io.emit("rules:reloaded", {
      at: Date.now(),
      path: rulesBundle.absPath
    });
    res.json({ ok: true, path: rulesBundle.absPath });
  });

  app.get("/api/audit", (req, res) => {
    const limit = parseIntParam(req.query.limit, 100, { min: 1, max: 1000 });
    const hoursRaw = Number.parseInt(String(req.query.hours || ""), 10);
    const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? hoursRaw : 0;
    const sinceAt = hours > 0 ? Date.now() - hours * 3_600_000 : undefined;

    const events = audit.query({
      limit,
      type: req.query.type,
      sender: req.query.sender,
      donationId: req.query.donationId,
      actionType: req.query.actionType,
      sinceAt
    });

    res.json({
      ok: true,
      filters: {
        limit,
        hours: hours || null,
        type: req.query.type || null,
        sender: req.query.sender || null,
        donationId: req.query.donationId || null,
        actionType: req.query.actionType || null
      },
      events
    });
  });

  app.get("/api/reports/summary", (req, res) => {
    const hours = parseHoursParam(req.query.hours, 24);
    const summary = audit.summary({ hours });
    res.json({ ok: true, ...summary });
  });

  app.get("/api/reports/top-senders", (req, res) => {
    const hours = parseHoursParam(req.query.hours, 24);
    const limit = parseIntParam(req.query.limit, 10, { min: 1, max: 100 });
    const list = audit.topSenders({ hours, limit });
    res.json({ ok: true, windowHours: hours, limit, senders: list });
  });

  app.get("/api/moderation", (req, res) => {
    res.json({ ok: true, data: moderation.snapshot() });
  });

  app.post("/api/moderation/senders/block", (req, res) => {
    const sender = String(req.body?.sender || "").trim();
    const reason = String(req.body?.reason || "").trim();
    const out = moderation.blockSender(sender, reason);

    if (!out.ok) {
      return res.status(400).json({ ok: false, error: out.reason });
    }

    audit.append({
      type: "moderation.sender.blocked",
      sender: out.entry.label,
      reason: out.entry.reason || "",
      source: "api"
    });

    return res.json({ ok: true, entry: out.entry, data: moderation.snapshot() });
  });

  app.post("/api/moderation/senders/unblock", (req, res) => {
    const sender = String(req.body?.sender || "").trim();
    const out = moderation.unblockSender(sender);

    if (!out.ok) {
      return res.status(400).json({ ok: false, error: out.reason });
    }

    audit.append({
      type: "moderation.sender.unblocked",
      sender,
      source: "api"
    });

    return res.json({ ok: true, data: moderation.snapshot() });
  });

  app.post("/api/moderation/keywords/block", (req, res) => {
    const keyword = String(req.body?.keyword || "").trim();
    const reason = String(req.body?.reason || "").trim();
    const out = moderation.blockKeyword(keyword, reason);

    if (!out.ok) {
      return res.status(400).json({ ok: false, error: out.reason });
    }

    audit.append({
      type: "moderation.keyword.blocked",
      keyword: out.entry.label,
      reason: out.entry.reason || "",
      source: "api"
    });

    return res.json({ ok: true, entry: out.entry, data: moderation.snapshot() });
  });

  app.post("/api/moderation/keywords/unblock", (req, res) => {
    const keyword = String(req.body?.keyword || "").trim();
    const out = moderation.unblockKeyword(keyword);

    if (!out.ok) {
      return res.status(400).json({ ok: false, error: out.reason });
    }

    audit.append({
      type: "moderation.keyword.unblocked",
      keyword,
      source: "api"
    });

    return res.json({ ok: true, data: moderation.snapshot() });
  });

  async function executeAction({ action, donation, ctx }) {
    const rules = getRules();
    const cdKey = action.cooldownKey || action.type;
    const cdMs =
      typeof action.cooldownMs === "number"
        ? action.cooldownMs
        : Number(rules?.cooldowns?.[action.type]) || 0;

    if (!cooldowns.canRun(cdKey, cdMs)) {
      return { ok: false, skipped: true, reason: "cooldown" };
    }
    cooldowns.markRan(cdKey);

    switch (action.type) {
      case "music.playNow": {
        const track = music.buildTrack({ donation, ctx, vip: Boolean(action.vip) });
        if (!track) return { ok: false, reason: "track_not_supported" };
        music.playNow(track);
        return { ok: true };
      }
      case "music.enqueue": {
        const track = music.buildTrack({ donation, ctx, vip: false });
        if (!track) return { ok: false, reason: "track_not_supported" };
        music.enqueue(track);
        return { ok: true };
      }
      case "minecraft.rcon": {
        return minecraft.send(action.command);
      }
      case "minecraft.rconMulti": {
        return minecraft.sendMulti(action.command, action.count, action.intervalMs);
      }
      case "system.openUrl": {
        if (!ctx.url) return { ok: false, reason: "missing_url" };
        openUrl(ctx.url);
        return { ok: true };
      }
      case "sfx.play": {
        const src = String(action.src || "").trim();
        if (!src) return { ok: false, reason: "missing_src" };
        io.emit("sfx:play", { src, volume: action.volume });
        return { ok: true };
      }
      case "obs.setCurrentProgramScene": {
        return obs.setCurrentProgramScene(action.sceneName);
      }
      case "obs.setSceneItemEnabled": {
        return obs.setSceneItemEnabled(action.sceneName, action.sourceName, action.enabled);
      }
      case "obs.enableSourceForMs": {
        return obs.enableSourceForMs(action.sceneName, action.sourceName, action.durationMs);
      }
      case "obs.setText": {
        const inputName = action.inputName;
        const tpl = String(action.text || "");
        const text = renderTemplate(tpl, {
          sender: donation.sender,
          value: donation.value,
          valueBRL: formatBRL(donation.value),
          message: donation.message,
          url: ctx.url || "",
          videoId: ctx.videoId || "",
          isNewTop: ctx.isNewTop ? "true" : "false"
        });
        return obs.setText(inputName, text, { overlay: action.overlay !== false });
      }
      case "obs.mediaRestart": {
        return obs.triggerMediaRestart(action.inputName);
      }
      case "obs.setInputMute": {
        return obs.setInputMute(action.inputName, action.mute);
      }
      case "obs.setInputVolume": {
        return obs.setInputVolumeMul(action.inputName, action.volumeMul);
      }
      case "webhook.request": {
        const url = String(action.url || "").trim();
        const payloadTemplate =
          action.payload && typeof action.payload === "object" ? action.payload : {};

        const vars = {
          sender: donation.sender,
          value: donation.value,
          valueBRL: formatBRL(donation.value),
          message: donation.message,
          url: ctx.url || "",
          videoId: ctx.videoId || "",
          donationId: donation.id,
          isNewTop: ctx.isNewTop ? "true" : "false"
        };

        // Render string fields recursively with {{vars}} templates.
        const renderAny = (x) => {
          if (typeof x === "string") return renderTemplate(x, vars);
          if (Array.isArray(x)) return x.map(renderAny);
          if (x && typeof x === "object") {
            const out = {};
            for (const [k, v] of Object.entries(x)) out[k] = renderAny(v);
            return out;
          }
          return x;
        };

        const body = renderAny(payloadTemplate);
        const headers = renderAny(action.headers || {});

        return postOutboundWebhook({
          url,
          body,
          headers,
          timeoutMs: action.timeoutMs || cfg.outboundWebhook.timeoutMs,
          allowHosts: cfg.outboundWebhook.allowHosts
        });
      }
      default:
        return { ok: false, reason: `unknown_action:${action.type}` };
    }
  }

  async function processDonation({ donation, raw }) {
    const blockedSender = moderation.isSenderBlocked(donation.sender);
    if (blockedSender) {
      audit.append({
        type: "donation.blocked",
        donationId: donation.id,
        sender: donation.sender,
        value: donation.value,
        reason: "blocked_sender",
        blockMatch: blockedSender.label || blockedSender.value
      });
      warn(`Donation blocked by sender moderation: ${donation.sender} (${donation.id})`);
      return;
    }

    const blockedKeyword = moderation.findBlockedKeyword(donation.message);
    if (blockedKeyword) {
      audit.append({
        type: "donation.blocked",
        donationId: donation.id,
        sender: donation.sender,
        value: donation.value,
        reason: "blocked_keyword",
        blockMatch: blockedKeyword.label || blockedKeyword.value
      });
      warn(
        `Donation blocked by keyword moderation: ${blockedKeyword.label || blockedKeyword.value} (${donation.id})`
      );
      return;
    }

    const rules = getRules();
    const ctx = parseDonationContext(donation, rules);
    ctx.isNewTop = !state.topDonation || donation.value > state.topDonation.value;
    const actions = decideActions(donation, ctx, rules);

    const donationEntry = {
      id: donation.id,
      at: donation.at,
      value: donation.value,
      sender: donation.sender,
      message: donation.message,
      status: donation.status || "",
      url: ctx.url,
      actions: actions.map((a) => ({
        type: a.type,
        ruleId: a._ruleId,
        priority: a._rulePriority
      }))
    };

    const topRes = state.addDonation(donationEntry);
    if (topRes.duplicate) {
      warn(`Duplicate donation ignored: ${donationEntry.id}`);
      audit.append({
        type: "donation.duplicate",
        donationId: donationEntry.id,
        sender: donationEntry.sender,
        value: donationEntry.value
      });
      return;
    }

    audit.append({
      type: "donation.accepted",
      donationId: donationEntry.id,
      sender: donationEntry.sender,
      value: donationEntry.value,
      status: donationEntry.status,
      message: donationEntry.message,
      actions: donationEntry.actions.map((a) => a.type),
      isNewTop: topRes.newTop,
      hasRawWebhook: Boolean(raw)
    });

    io.emit("donation:new", donationEntry);
    if (topRes.newTop) io.emit("donation:top", topRes.topDonation);
    io.emit("state:update", state.snapshot());

    const execResults = [];
    for (const action of actions) {
      try {
        const res = await executeAction({ action, donation: donationEntry, ctx });
        const out = { type: action.type, ...res };
        execResults.push(out);
        audit.append({
          type: "action.executed",
          donationId: donationEntry.id,
          sender: donationEntry.sender,
          actionType: action.type,
          ok: Boolean(out.ok),
          skipped: Boolean(out.skipped),
          reason: out.reason || "",
          status: out.status
        });
      } catch (e) {
        const message = String(e?.message || e);
        execResults.push({ type: action.type, ok: false, reason: message });
        state.recordError(message);
        audit.append({
          type: "action.executed",
          donationId: donationEntry.id,
          sender: donationEntry.sender,
          actionType: action.type,
          ok: false,
          skipped: false,
          reason: message
        });
        audit.append({
          type: "error",
          where: "processDonation.executeAction",
          message
        });
      }
    }

    io.emit("donation:actions", {
      donationId: donationEntry.id,
      at: Date.now(),
      results: execResults
    });
  }

  async function handleLivePixWebhookEvent(body) {
    const extracted = extractDonation(body || {}, cfg.livepix);
    if (extracted.ok) {
      const d = extracted.donation;
      const ref = extractWebhookRef(body || {});
      const externalId = extractExternalId(body || {});

      const safe = (s) => String(s || "").replace(/[^a-z0-9_-]+/gi, "_");
      const stableId = ref
        ? `lp_${safe(ref.type)}_${safe(ref.id)}`
        : externalId
          ? `lp_${safe(externalId)}`
          : null;

      const donation = {
        id: stableId || newId("don"),
        at: Date.now(),
        value: d.value,
        message: d.message,
        sender: d.sender,
        status: d.status || ""
      };
      await processDonation({ donation, raw: body });
      return;
    }

    const ref = extractWebhookRef(body || {});
    if (!ref) {
      const reason = extracted.reason || "unrecognized payload";
      warn(`LivePix webhook ignored: ${reason}`);
      audit.append({
        type: "webhook.ignored",
        reason
      });
      return;
    }

    if (!livepixApi.enabled()) {
      const reason = `LivePix webhook requires API fetch (${ref.type}:${ref.id}) but LIVEPIX_ACCESS_TOKEN or LIVEPIX_CLIENT_ID/SECRET is not configured.`;
      warn(reason);
      audit.append({
        type: "webhook.ignored",
        reason: "livepix_api_not_configured",
        resourceType: ref.type,
        resourceId: ref.id
      });
      return;
    }

    try {
      const safe = (s) => String(s || "").replace(/[^a-z0-9_-]+/gi, "_");
      const baseId = `lp_${safe(ref.type)}_${safe(ref.id)}`;

      if (ref.type.includes("message") || ref.type.includes("payment")) {
        const msg = ref.type.includes("payment")
          ? (await livepixApi.fetchPayment(ref.id)) || (await livepixApi.fetchMessage(ref.id))
          : await livepixApi.fetchMessage(ref.id);
        if (!msg) throw new Error("message_not_found");

        const amountRaw = msg.amount ?? msg.value ?? msg.valor;
        const amountNum = Number(amountRaw);
        const value = Number.isFinite(amountNum)
          ? Number.isInteger(amountNum)
            ? amountNum / 100
            : amountNum
          : 0;

        const donation = {
          id: baseId,
          at: Date.now(),
          value,
          message: String(msg.message || msg.text || msg.comment || "").trim(),
          sender: String(msg.username || msg.tipper || msg.name || "Anon").trim(),
          status: "paid"
        };
        await processDonation({ donation, raw: body });
        return;
      }

      if (ref.type.includes("subscription")) {
        const sub = await livepixApi.fetchSubscription(ref.id);
        if (!sub) throw new Error("subscription_not_found");

        const amountRaw = sub.amount ?? sub.value ?? sub.valor;
        const amountNum = Number(amountRaw);
        const value = Number.isFinite(amountNum)
          ? Number.isInteger(amountNum)
            ? amountNum / 100
            : amountNum
          : 0;

        const donation = {
          id: baseId,
          at: Date.now(),
          value,
          message: `subscription (${Number(sub.months) || 1}m)`,
          sender: String(sub.username || sub.subscriber || sub.name || "Anon").trim(),
          status: "paid"
        };
        await processDonation({ donation, raw: body });
        return;
      }

      warn(`LivePix webhook type not supported: ${ref.type}`);
      audit.append({
        type: "webhook.ignored",
        reason: "unsupported_type",
        resourceType: ref.type,
        resourceId: ref.id
      });
    } catch (e) {
      const message = String(e?.message || e);
      error(`LivePix API fetch failed (${ref.type}:${ref.id}): ${message}`);
      state.recordError(message);
      audit.append({
        type: "error",
        where: "handleLivePixWebhookEvent",
        message,
        resourceType: ref.type,
        resourceId: ref.id
      });
      io.emit("state:update", state.snapshot());
    }
  }

  app.post("/webhook/livepix", webhookLimiter, (req, res) => {
    if (!verifyWebhookSecret(req, cfg.webhookSecret)) {
      audit.append({
        type: "webhook.unauthorized",
        ip: req.ip || ""
      });
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    handleLivePixWebhookEvent(req.body).catch((e) => {
      const message = String(e?.message || e);
      error(e);
      state.recordError(message);
      audit.append({
        type: "error",
        where: "webhook.livepix.catch",
        message
      });
      io.emit("state:update", state.snapshot());
    });

    return res.json({ ok: true });
  });

  io.on("connection", (socket) => {
    const role = socket.handshake?.query?.role || "";

    socket.emit("state:init", state.snapshot());
    socket.emit("rules:loaded", {
      at: Date.now(),
      path: rulesBundle.absPath
    });

    if (role === "player") {
      music.onPlayerConnected();
      socket.on("player:ready", () => music.onPlayerReady());
      socket.on("player:ended", () => music.playNext());
      socket.on("disconnect", () => music.onPlayerDisconnected());
      return;
    }

    // Dashboard helpers (optional)
    socket.on("music:skip", () => music.skip());
    socket.on("music:clearQueue", () => music.clearQueue());
  });

  server.listen(cfg.port, cfg.host, () => {
    const base = `http://${cfg.host}:${cfg.port}`;
    log(`Server listening on ${base}`);
    if (!cfg.webhookSecret) {
      warn(
        "WEBHOOK_SECRET is empty. Recommended: set a strong token in .env and include it in the LivePix webhook URL (?token=...)."
      );
    }
    if (cfg.host !== "127.0.0.1" && cfg.host !== "localhost") {
      warn(
        `HOST is ${cfg.host}. For maximum safety, prefer HOST=127.0.0.1 (use ngrok/cloudflared to expose).`
      );
    }
    log(`Dashboard: ${base}/`);
    log(`Player: ${base}/player`);
    log(`Overlay: ${base}/overlay`);
    log(
      `Webhook: POST /webhook/livepix  (token via header x-webhook-secret or ?token=...)`
    );
    log(`Rules: ${rulesBundle.absPath}`);
    log(`Audit log: ${cfg.storage.auditLogPath}`);
    log(`Moderation store: ${cfg.storage.moderationPath}`);
  });

  const shutdown = async () => {
    log("Shutting down...");
    await minecraft.close();
    await obs.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  error(e);
  process.exit(1);
});
