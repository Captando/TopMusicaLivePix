const { newId } = require("./utils");

class AppState {
  constructor({ maxDonations = 80 } = {}) {
    this.maxDonations = maxDonations;

    this.donations = [];
    this._donationIds = new Set();
    this.topDonation = null;

    this.music = {
      current: null,
      queue: []
    };

    this.player = {
      connected: false,
      ready: false,
      lastSeenAt: null
    };

    this.lastWebhookAt = null;
    this.lastError = null;
  }

  snapshot() {
    return {
      donations: this.donations,
      topDonation: this.topDonation,
      music: this.music,
      player: this.player,
      lastWebhookAt: this.lastWebhookAt,
      lastError: this.lastError
    };
  }

  recordError(message) {
    this.lastError = { id: newId("err"), at: Date.now(), message: String(message) };
  }

  addDonation(d) {
    if (this._donationIds.has(d.id)) {
      return { duplicate: true, newTop: false, topDonation: this.topDonation };
    }

    this.donations.unshift(d);
    this._donationIds.add(d.id);
    if (this.donations.length > this.maxDonations) {
      while (this.donations.length > this.maxDonations) {
        const removed = this.donations.pop();
        if (removed?.id) this._donationIds.delete(removed.id);
      }
    }

    this.lastWebhookAt = Date.now();

    if (!this.topDonation || d.value > this.topDonation.value) {
      this.topDonation = {
        id: d.id,
        at: d.at,
        value: d.value,
        sender: d.sender,
        message: d.message
      };
      return { newTop: true, topDonation: this.topDonation };
    }

    return { duplicate: false, newTop: false, topDonation: this.topDonation };
  }

  setPlayerStatus({ connected, ready } = {}) {
    if (typeof connected === "boolean") this.player.connected = connected;
    if (typeof ready === "boolean") this.player.ready = ready;
    this.player.lastSeenAt = Date.now();
  }

  setMusicQueue(queue) {
    this.music.queue = queue;
  }

  setMusicCurrent(current) {
    this.music.current = current;
  }
}

module.exports = { AppState };
