const { Rcon } = require("rcon-client");

const { error, log, warn } = require("../logger");
const { clampInt, sleep } = require("../utils");

class MinecraftRcon {
  constructor({ host, port, password } = {}) {
    this.host = host;
    this.port = port;
    this.password = password;

    this._client = null;
    this._connecting = null;
  }

  enabled() {
    return Boolean(this.password);
  }

  async _connect() {
    if (!this.enabled()) return null;
    if (this._client) return this._client;
    if (this._connecting) return this._connecting;

    this._connecting = (async () => {
      try {
        log(`RCON connecting to ${this.host}:${this.port}...`);
        const c = await Rcon.connect({
          host: this.host,
          port: this.port,
          password: this.password
        });
        this._client = c;
        log("RCON connected.");
        return c;
      } finally {
        this._connecting = null;
      }
    })();

    return this._connecting;
  }

  async send(command) {
    if (!this.enabled()) {
      warn("RCON disabled (missing RCON_PASSWORD).");
      return { ok: false, reason: "RCON disabled" };
    }

    const cmd = String(command || "").trim();
    if (!cmd) return { ok: false, reason: "Empty command" };

    const client = await this._connect();
    if (!client) return { ok: false, reason: "No client" };

    try {
      const resp = await client.send(cmd);
      return { ok: true, response: resp };
    } catch (e) {
      error(`RCON send failed (${cmd}): ${e.message}`);
      // Drop client so we reconnect next time.
      try {
        await this._client?.end?.();
      } catch {}
      this._client = null;
      return { ok: false, reason: e.message };
    }
  }

  async sendMulti(command, count, intervalMs) {
    const c = clampInt(count, { min: 1, max: 50, fallback: 1 });
    const interval = clampInt(intervalMs, { min: 50, max: 5000, fallback: 150 });

    for (let i = 0; i < c; i++) {
      // Stop early if send() fails repeatedly? Keep it simple for now.
      await this.send(command);
      if (i < c - 1) await sleep(interval);
    }

    return { ok: true };
  }

  async close() {
    try {
      await this._client?.end?.();
    } catch {}
    this._client = null;
  }
}

module.exports = { MinecraftRcon };

