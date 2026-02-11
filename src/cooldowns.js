class Cooldowns {
  constructor() {
    this._last = new Map();
  }

  /**
   * Returns true if the action should run now, false if it's still cooling down.
   */
  canRun(key, cooldownMs) {
    const ms = Number(cooldownMs) || 0;
    if (ms <= 0) return true;

    const now = Date.now();
    const last = this._last.get(key) || 0;
    return now - last >= ms;
  }

  markRan(key) {
    this._last.set(key, Date.now());
  }
}

module.exports = { Cooldowns };

