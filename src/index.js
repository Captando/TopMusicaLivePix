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
const { LivePixApi } = require("./livepixApi");
const { newId } = require("./utils");

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
      default:
        return { ok: false, reason: `unknown_action:${action.type}` };
    }
  }

  async function processDonation({ donation, raw }) {
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
      return;
    }
    io.emit("donation:new", donationEntry);
    if (topRes.newTop) io.emit("donation:top", topRes.topDonation);
    io.emit("state:update", state.snapshot());

    const execResults = [];
    for (const action of actions) {
      try {
        const res = await executeAction({ action, donation: donationEntry, ctx });
        execResults.push({ type: action.type, ...res });
      } catch (e) {
        execResults.push({ type: action.type, ok: false, reason: e.message });
        state.recordError(e.message);
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
      warn(`LivePix webhook ignored: ${extracted.reason || "unrecognized payload"}`);
      return;
    }

    if (!livepixApi.enabled()) {
      warn(
        `LivePix webhook requires API fetch (${ref.type}:${ref.id}) but LIVEPIX_ACCESS_TOKEN or LIVEPIX_CLIENT_ID/SECRET is not configured.`
      );
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
    } catch (e) {
      error(`LivePix API fetch failed (${ref.type}:${ref.id}): ${e.message}`);
      state.recordError(e.message);
      io.emit("state:update", state.snapshot());
    }
  }

  app.post("/webhook/livepix", webhookLimiter, (req, res) => {
    if (!verifyWebhookSecret(req, cfg.webhookSecret)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    handleLivePixWebhookEvent(req.body).catch((e) => {
      error(e);
      state.recordError(e.message);
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
  });

  const shutdown = async () => {
    log("Shutting down...");
    await minecraft.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  error(e);
  process.exit(1);
});
