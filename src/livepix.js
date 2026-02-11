const { asNumber, firstDefined, getByPath } = require("./utils");

function normalizeAmount(value, unit) {
  const n = asNumber(value);
  if (n === undefined) return undefined;

  const u = String(unit || "").toLowerCase();
  if (u === "cents" || u === "centavos") return n / 100;
  if (u === "reais" || u === "brl") return n;

  // auto:
  // If it's a large integer (common in centavos), assume cents.
  if (Number.isInteger(n) && n >= 100) return n / 100;
  return n;
}

function readSecretFromReq(req) {
  const h =
    req.headers["x-webhook-secret"] ||
    req.headers["x-livepix-secret"] ||
    req.headers["x-hook-secret"];
  if (h) return String(h);

  const auth = req.headers["authorization"];
  if (auth && String(auth).toLowerCase().startsWith("bearer ")) {
    return String(auth).slice(7).trim();
  }

  if (req.query && req.query.token) return String(req.query.token);
  if (req.query && req.query.secret) return String(req.query.secret);

  return "";
}

function verifyWebhookSecret(req, webhookSecret) {
  if (!webhookSecret) return true;
  const provided = readSecretFromReq(req);
  return provided === webhookSecret;
}

function normalizeSender(v) {
  if (!v) return "Anon";
  if (typeof v === "string") return v.trim() || "Anon";
  if (typeof v === "object") {
    const name = firstDefined(v.name, v.fullName, v.username);
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return "Anon";
}

function normalizeMessage(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v.trim();
  return String(v).trim();
}

function extractDonation(body, livepixConfig) {
  const cfg = livepixConfig || {};

  const statusRaw = firstDefined(
    cfg.statusPath ? getByPath(body, cfg.statusPath) : undefined,
    body.status,
    body.event_status,
    body?.data?.status,
    body?.payment?.status
  );
  const status = statusRaw ? String(statusRaw).toLowerCase().trim() : "";

  if (status && Array.isArray(cfg.acceptedStatuses) && cfg.acceptedStatuses.length) {
    const ok = cfg.acceptedStatuses.includes(status);
    if (!ok) return { ok: false, reason: `Ignored status=${status}` };
  }

  // LivePix API examples use "amount" in centavos (ex: 1000 => R$ 10,00).
  const candidates = [
    { raw: cfg.valuePath ? getByPath(body, cfg.valuePath) : undefined, unit: "auto" },
    { raw: body.value, unit: "reais" },
    { raw: body.valor, unit: "reais" },
    { raw: body?.data?.value, unit: "reais" },
    { raw: body?.payment?.value, unit: "reais" },

    { raw: body.amount, unit: "cents" },
    { raw: body?.data?.amount, unit: "cents" },
    { raw: body?.payment?.amount, unit: "cents" }
  ];

  let value = undefined;
  for (const c of candidates) {
    if (c.raw === undefined || c.raw === null || c.raw === "") continue;
    value = normalizeAmount(c.raw, c.unit);
    if (value !== undefined) break;
  }

  if (value === undefined) {
    const centsRaw = firstDefined(
      body.value_cents,
      body.amount_cents,
      body?.data?.value_cents,
      body?.data?.amount_cents
    );
    value = normalizeAmount(centsRaw, "cents");
  }

  if (value === undefined) return { ok: false, reason: "Missing value" };

  const messageRaw = firstDefined(
    cfg.messagePath ? getByPath(body, cfg.messagePath) : undefined,
    body.message,
    body.mensagem,
    body.comment,
    body.description,
    body?.data?.message,
    body?.data?.comment,
    body?.payment?.message
  );

  const senderRaw = firstDefined(
    cfg.senderPath ? getByPath(body, cfg.senderPath) : undefined,
    body.sender,
    body.from,
    body.name,
    body.tipper,
    body.subscriber,
    body?.data?.sender,
    body?.data?.from,
    body?.data?.tipper,
    body?.data?.subscriber,
    body?.customer,
    body?.payer
  );

  return {
    ok: true,
    donation: {
      value,
      message: normalizeMessage(messageRaw),
      sender: normalizeSender(senderRaw),
      status
    }
  };
}

function extractWebhookRef(body) {
  const typeRaw = firstDefined(
    body.type,
    body.event,
    body.kind,
    body?.data?.type,
    body?.data?.event
  );

  const idRaw = firstDefined(
    body.messageId,
    body.subscriptionId,
    body.id,
    body?.data?.messageId,
    body?.data?.subscriptionId,
    body?.data?.id
  );

  let type = typeRaw ? String(typeRaw).toLowerCase().trim() : "";
  const id = idRaw ? String(idRaw).trim() : "";

  if (!type) {
    // Infer type from common fields.
    if (body.messageId || body?.data?.messageId) type = "message";
    else if (body.subscriptionId || body?.data?.subscriptionId) type = "subscription";
  }

  if (!type || !id) return null;
  return { type, id };
}

function extractExternalId(body) {
  const idRaw = firstDefined(
    body.messageId,
    body.subscriptionId,
    body.pixId,
    body.reference,
    body.id,
    body?.data?.messageId,
    body?.data?.subscriptionId,
    body?.data?.pixId,
    body?.data?.reference,
    body?.data?.id
  );
  if (!idRaw) return null;
  const id = String(idRaw).trim();
  return id ? id : null;
}

module.exports = {
  extractDonation,
  extractExternalId,
  extractWebhookRef,
  verifyWebhookSecret
};
