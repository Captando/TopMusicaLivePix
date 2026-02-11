const { log, warn } = require("../logger");
const { newId } = require("../utils");

class MusicManager {
  constructor({ io, state, interruptBehavior } = {}) {
    this.io = io;
    this.state = state;
    this.interruptBehavior = interruptBehavior || "drop";
  }

  emitState() {
    this.io.emit("state:update", this.state.snapshot());
  }

  onPlayerConnected() {
    this.state.setPlayerStatus({ connected: true });
    this.emitState();
  }

  onPlayerDisconnected() {
    this.state.setPlayerStatus({ connected: false, ready: false });
    this.emitState();
  }

  onPlayerReady() {
    this.state.setPlayerStatus({ ready: true });
    this.emitState();

    if (this.state.music.current) {
      // Re-send current track (helps on refresh).
      this.io.emit("music:play", this.state.music.current);
      return;
    }

    if (this.state.music.queue.length > 0) {
      this.playNext();
    }
  }

  buildTrack({ donation, ctx, vip = false }) {
    if (!ctx?.url) return null;
    if (!ctx?.videoId) {
      warn(`URL not supported by player (missing videoId): ${ctx.url}`);
      return null;
    }

    return {
      id: newId("trk"),
      at: Date.now(),
      url: ctx.url,
      videoId: ctx.videoId,
      vip,
      requestedBy: donation.sender,
      value: donation.value,
      message: donation.message
    };
  }

  playNow(track) {
    if (!track) return;

    const current = this.state.music.current;
    if (current && this.interruptBehavior === "resume") {
      this.state.music.queue.unshift(current);
    }

    this.state.setMusicCurrent(track);
    this.io.emit("music:play", track);
    this.emitState();
  }

  enqueue(track) {
    if (!track) return;
    this.state.music.queue.push(track);
    this.emitState();

    if (!this.state.music.current && this.state.player.ready) {
      this.playNext();
    }
  }

  playNext() {
    const next = this.state.music.queue.shift() || null;
    this.state.setMusicCurrent(next);
    if (next) {
      this.io.emit("music:play", next);
    } else {
      this.io.emit("music:stop");
    }
    this.emitState();
  }

  skip() {
    log("Music skip requested.");
    this.playNext();
  }

  clearQueue() {
    this.state.setMusicQueue([]);
    this.emitState();
  }
}

module.exports = { MusicManager };

