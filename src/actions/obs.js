const { OBSWebSocket } = require("obs-websocket-js");

const { error, log, warn } = require("../logger");
const { clampInt, sleep } = require("../utils");

class ObsController {
  constructor({ enabled, url, password } = {}) {
    this.enabled = Boolean(enabled);
    this.url = String(url || "").trim();
    this.password = String(password || "");

    this._obs = new OBSWebSocket();
    this._connected = false;
    this._connecting = null;

    this._sceneItemIdCache = new Map(); // key: sceneName::sourceName -> sceneItemId

    this._obs.on("ConnectionClosed", () => {
      this._connected = false;
      this._sceneItemIdCache.clear();
    });
  }

  isConfigured() {
    return Boolean(this.enabled && this.url);
  }

  async connect() {
    if (!this.isConfigured()) {
      return { ok: false, reason: "OBS disabled or missing OBS_WS_URL" };
    }
    if (this._connected) return { ok: true };
    if (this._connecting) return this._connecting;

    this._connecting = (async () => {
      try {
        log(`OBS WS connecting to ${this.url}...`);
        await this._obs.connect(this.url, this.password);
        this._connected = true;
        log("OBS WS connected.");
        return { ok: true };
      } catch (e) {
        this._connected = false;
        warn(`OBS WS connect failed: ${e.message}`);
        return { ok: false, reason: e.message };
      } finally {
        this._connecting = null;
      }
    })();

    return this._connecting;
  }

  async call(requestType, args) {
    const conn = await this.connect();
    if (!conn.ok) return conn;

    try {
      const res = await this._obs.call(requestType, args);
      return { ok: true, data: res };
    } catch (e) {
      warn(`OBS WS call failed (${requestType}): ${e.message}`);
      this._connected = false;
      this._sceneItemIdCache.clear();
      try {
        await this._obs.disconnect();
      } catch {}
      return { ok: false, reason: e.message };
    }
  }

  async setCurrentProgramScene(sceneName) {
    const scene = String(sceneName || "").trim();
    if (!scene) return { ok: false, reason: "missing_sceneName" };
    return this.call("SetCurrentProgramScene", { sceneName: scene });
  }

  async _getSceneItemId(sceneName, sourceName) {
    const scene = String(sceneName || "").trim();
    const source = String(sourceName || "").trim();
    if (!scene || !source) return { ok: false, reason: "missing_scene_or_source" };

    const key = `${scene}::${source}`;
    const cached = this._sceneItemIdCache.get(key);
    if (typeof cached === "number") return { ok: true, sceneItemId: cached };

    const res = await this.call("GetSceneItemId", { sceneName: scene, sourceName: source });
    if (!res.ok) return res;

    const id = res.data?.sceneItemId;
    if (typeof id !== "number") return { ok: false, reason: "sceneItemId_not_found" };
    this._sceneItemIdCache.set(key, id);
    return { ok: true, sceneItemId: id };
  }

  async setSceneItemEnabled(sceneName, sourceName, enabled) {
    const scene = String(sceneName || "").trim();
    const source = String(sourceName || "").trim();
    if (!scene) return { ok: false, reason: "missing_sceneName" };
    if (!source) return { ok: false, reason: "missing_sourceName" };

    const idRes = await this._getSceneItemId(scene, source);
    if (!idRes.ok) return idRes;

    return this.call("SetSceneItemEnabled", {
      sceneName: scene,
      sceneItemId: idRes.sceneItemId,
      sceneItemEnabled: Boolean(enabled)
    });
  }

  async enableSourceForMs(sceneName, sourceName, durationMs) {
    const duration = clampInt(durationMs, { min: 100, max: 120_000, fallback: 4000 });
    const onRes = await this.setSceneItemEnabled(sceneName, sourceName, true);
    if (!onRes.ok) return onRes;
    await sleep(duration);
    return this.setSceneItemEnabled(sceneName, sourceName, false);
  }

  async setText(inputName, text, { overlay = true } = {}) {
    const input = String(inputName || "").trim();
    if (!input) return { ok: false, reason: "missing_inputName" };

    return this.call("SetInputSettings", {
      inputName: input,
      inputSettings: { text: String(text || "") },
      overlay: Boolean(overlay)
    });
  }

  async triggerMediaRestart(inputName) {
    const input = String(inputName || "").trim();
    if (!input) return { ok: false, reason: "missing_inputName" };

    return this.call("TriggerMediaInputAction", {
      inputName: input,
      mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART"
    });
  }

  async setInputMute(inputName, mute) {
    const input = String(inputName || "").trim();
    if (!input) return { ok: false, reason: "missing_inputName" };

    return this.call("SetInputMute", { inputName: input, inputMuted: Boolean(mute) });
  }

  async setInputVolumeMul(inputName, volumeMul) {
    const input = String(inputName || "").trim();
    const mul = Number(volumeMul);
    if (!input) return { ok: false, reason: "missing_inputName" };
    if (!Number.isFinite(mul)) return { ok: false, reason: "invalid_volumeMul" };

    // inputVolumeMul: 1.0 is 100%, 0.5 is 50%, 2.0 is 200%
    const safeMul = Math.max(0, Math.min(20, mul));
    return this.call("SetInputVolume", { inputName: input, inputVolumeMul: safeMul });
  }

  async close() {
    try {
      await this._obs.disconnect();
    } catch {}
    this._connected = false;
    this._sceneItemIdCache.clear();
  }
}

module.exports = { ObsController };

