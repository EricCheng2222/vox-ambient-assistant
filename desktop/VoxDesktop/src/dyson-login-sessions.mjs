import { randomUUID } from "node:crypto";

/** Short-lived sign-in challenges are bound to one renderer and one device. */
export function createDysonLoginSessions({ now = Date.now } = {}) {
  const sessions = new Map();
  const active = (id, session) => sessions.get(id) === session && session.expires > now();
  return {
    start(details) {
      for (const [id, session] of sessions) if (session.expires <= now() || (session.deviceId === details.deviceId && session.senderId === details.senderId)) sessions.delete(id);
      if (sessions.size >= 10) throw new Error("Finish or wait for the current Dyson sign-in before starting another.");
      const challengeId = randomUUID();
      sessions.set(challengeId, { ...details, expires: now() + 10 * 60_000, attempts: 0, completing: false });
      return { challengeId };
    },
    acquire(id, senderId) {
      const session = sessions.get(id);
      if (!session || !active(id, session) || session.senderId !== senderId || session.attempts >= 3) throw new Error("Start Dyson sign-in again; this email code session has expired.");
      if (session.completing) throw new Error("Dyson sign-in is already being completed.");
      session.attempts += 1;
      session.completing = true;
      return session;
    },
    assertActive(id, session) {
      if (!active(id, session)) throw new Error("Dyson sign-in was cancelled or expired.");
    },
    release(id, session) { if (active(id, session)) session.completing = false; },
    consume(id, session) { this.assertActive(id, session); sessions.delete(id); },
    cancel(id, senderId) { if (sessions.get(id)?.senderId === senderId) sessions.delete(id); },
    cancelDevice(deviceId) { for (const [id, session] of sessions) if (session.deviceId === deviceId) sessions.delete(id); },
  };
}
