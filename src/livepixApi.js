const { error, log, warn } = require("./logger");

function asBearer(token) {
  const t = String(token || "").trim();
  if (!t) return "";
  if (/^bearer\s+/i.test(t)) return t;
  return `Bearer ${t}`;
}

class LivePixApi {
  constructor({ accessToken, clientId, clientSecret, scope, apiBaseUrl, oauthTokenUrl } = {}) {
    this.accessToken = accessToken || "";
    this.clientId = clientId || "";
    this.clientSecret = clientSecret || "";
    this.scope = scope || "messages:read subscriptions:read";
    this.apiBaseUrl = apiBaseUrl || "https://api.livepix.gg";
    this.oauthTokenUrl = oauthTokenUrl || "https://oauth.livepix.gg/oauth2/token";

    this._cachedToken = null;
  }

  enabled() {
    return Boolean(this.accessToken || (this.clientId && this.clientSecret));
  }

  async _fetchClientCredentialsToken() {
    const body = new URLSearchParams();
    body.set("grant_type", "client_credentials");
    body.set("client_id", this.clientId);
    body.set("client_secret", this.clientSecret);
    body.set("scope", this.scope);

    const resp = await fetch(this.oauthTokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`OAuth token failed: HTTP ${resp.status} ${txt}`.trim());
    }

    const json = await resp.json();
    const token = json?.access_token;
    const expiresIn = Number(json?.expires_in) || 3600;
    if (!token) throw new Error("OAuth token missing access_token");

    const expiresAt = Date.now() + expiresIn * 1000 - 30_000; // refresh a bit earlier
    return { token, expiresAt };
  }

  async getAccessToken() {
    if (this.accessToken) return { token: this.accessToken, kind: "static" };

    if (!this.clientId || !this.clientSecret) {
      throw new Error("Missing LIVEPIX_ACCESS_TOKEN or LIVEPIX_CLIENT_ID/SECRET");
    }

    if (this._cachedToken && Date.now() < this._cachedToken.expiresAt) {
      return { token: this._cachedToken.token, kind: "oauth" };
    }

    const tok = await this._fetchClientCredentialsToken();
    this._cachedToken = tok;
    return { token: tok.token, kind: "oauth" };
  }

  async _apiFetchJson(urlPath) {
    const url = `${this.apiBaseUrl}${urlPath}`;
    const { token } = await this.getAccessToken();

    // Try Bearer first; if 401, try raw token (some APIs use apiKey-style tokens).
    const headers1 = { accept: "application/json", authorization: asBearer(token) };
    let resp = await fetch(url, { headers: headers1 });
    if (resp.status === 401) {
      const headers2 = { accept: "application/json", authorization: String(token) };
      resp = await fetch(url, { headers: headers2 });
    }

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`LivePix API failed ${urlPath}: HTTP ${resp.status} ${txt}`.trim());
    }

    return resp.json();
  }

  async fetchMessage(messageId) {
    const id = String(messageId || "").trim();
    if (!id) throw new Error("Missing messageId");
    const json = await this._apiFetchJson(`/v1/messages/${encodeURIComponent(id)}`);
    return json?.data || null;
  }

  async fetchSubscription(subscriptionId) {
    const id = String(subscriptionId || "").trim();
    if (!id) throw new Error("Missing subscriptionId");
    const json = await this._apiFetchJson(`/v1/subscriptions/${encodeURIComponent(id)}`);
    return json?.data || null;
  }
}

module.exports = { LivePixApi };

