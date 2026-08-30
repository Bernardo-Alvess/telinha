import type { RoomSession } from "./api";

const ACTIVE_KEY = "telinha-active-session-v2";
const PENDING_KEY = "telinha-pending-leaves-v2";
const ACTIVE_MAX_AGE_MS = 20 * 60 * 1000;

interface StoredSession {
  savedAt: number;
  session: RoomSession;
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function validSession(value: unknown): value is RoomSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<RoomSession>;
  return Boolean(
    session.code &&
      session.participantId &&
      session.token &&
      session.displayName &&
      session.wsUrl &&
      typeof session.protocolVersion === "number",
  );
}

function readJson(storage: Storage, key: string): unknown {
  try {
    const value = storage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function loadActiveSession(
  storage = browserStorage(),
  now = Date.now(),
): RoomSession | null {
  if (!storage) return null;
  const stored = readJson(storage, ACTIVE_KEY) as Partial<StoredSession> | null;
  if (
    !stored ||
    typeof stored.savedAt !== "number" ||
    now - stored.savedAt > ACTIVE_MAX_AGE_MS ||
    !validSession(stored.session)
  ) {
    storage.removeItem(ACTIVE_KEY);
    return null;
  }
  return stored.session;
}

export function saveActiveSession(
  session: RoomSession,
  storage = browserStorage(),
  now = Date.now(),
): void {
  storage?.setItem(ACTIVE_KEY, JSON.stringify({ savedAt: now, session } satisfies StoredSession));
}

export function clearActiveSession(storage = browserStorage()): void {
  storage?.removeItem(ACTIVE_KEY);
}

export function pendingLeaves(storage = browserStorage()): RoomSession[] {
  if (!storage) return [];
  const parsed = readJson(storage, PENDING_KEY);
  return Array.isArray(parsed) ? parsed.filter(validSession) : [];
}

export function queuePendingLeave(session: RoomSession, storage = browserStorage()): void {
  if (!storage) return;
  const current = pendingLeaves(storage).filter(
    (item) => item.code !== session.code || item.participantId !== session.participantId,
  );
  current.push(session);
  storage.setItem(PENDING_KEY, JSON.stringify(current.slice(-8)));
}

export async function flushPendingLeaves(
  leave: (session: RoomSession) => Promise<void>,
  storage = browserStorage(),
): Promise<void> {
  if (!storage) return;
  const failed: RoomSession[] = [];
  for (const session of pendingLeaves(storage)) {
    try {
      await leave(session);
    } catch {
      failed.push(session);
    }
  }
  if (failed.length) {
    storage.setItem(PENDING_KEY, JSON.stringify(failed));
  } else {
    storage.removeItem(PENDING_KEY);
  }
}
