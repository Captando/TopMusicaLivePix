function normalizeHeaders(headers) {
  const out = {};
  if (!headers || typeof headers !== "object") return out;

  for (const [k, v] of Object.entries(headers)) {
    const key = String(k || "").trim();
    if (!key) continue;
    if (v === undefined || v === null) continue;
    out[key] = String(v);
  }

  return out;
}

function isHostAllowed(urlString, allowHosts) {
  try {
    const u = new URL(urlString);
    const host = String(u.hostname || "").toLowerCase();
    const list = Array.isArray(allowHosts)
      ? allowHosts.map((h) => String(h || "").trim().toLowerCase()).filter(Boolean)
      : [];

    if (list.includes("*")) return true;
    return list.includes(host);
  } catch {
    return false;
  }
}

async function postJson({ url, body, headers, timeoutMs, allowHosts }) {
  const target = String(url || "").trim();
  if (!target) return { ok: false, reason: "missing_url" };
  if (!isHostAllowed(target, allowHosts)) {
    return { ok: false, reason: "host_not_allowed" };
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(500, Number(timeoutMs) || 3000));

  try {
    const resp = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...normalizeHeaders(headers)
      },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal
    });

    const txt = await resp.text().catch(() => "");
    return {
      ok: resp.ok,
      status: resp.status,
      body: txt.slice(0, 1000)
    };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

module.exports = { postJson };
