const EMPTY = new Set();

/** Hangi kullanıcının hangi WebSocket bağlantılarının açık olduğunu tutar. */
export class Presence {
  constructor() {
    this.sockets = new Map();
  }

  /** Bağlantı eklenir; kullanıcının ilk bağlantısıysa true döner. */
  add(userId, ws) {
    let set = this.sockets.get(userId);
    const first = !set;
    if (!set) {
      set = new Set();
      this.sockets.set(userId, set);
    }
    set.add(ws);
    return first;
  }

  /** Bağlantı çıkarılır; kullanıcının son bağlantısıysa true döner. */
  remove(userId, ws) {
    const set = this.sockets.get(userId);
    if (!set) return false;
    set.delete(ws);
    if (set.size === 0) {
      this.sockets.delete(userId);
      return true;
    }
    return false;
  }

  socketsOf(userId) {
    return this.sockets.get(userId) ?? EMPTY;
  }

  isOnline(userId) {
    return this.sockets.has(userId);
  }

  onlineIds() {
    return [...this.sockets.keys()];
  }
}
