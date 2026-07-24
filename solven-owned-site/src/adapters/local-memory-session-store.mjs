export class LocalMemorySessionStore {
  name = "local-memory";

  constructor({ nowMs = () => Date.now() } = {}) {
    this.nowMs = nowMs;
    this.sessions = new Map();
  }

  create(id, session) {
    this.sessions.set(id, session);
  }

  get(id) {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expires <= this.nowMs()) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  deleteExpired() {
    for (const [id, session] of this.sessions) if (session.expires <= this.nowMs()) this.sessions.delete(id);
  }
}
