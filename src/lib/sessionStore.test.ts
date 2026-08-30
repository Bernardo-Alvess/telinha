import { describe, expect, it, vi } from "vitest";
import type { RoomSession } from "./api";
import {
  clearActiveSession,
  flushPendingLeaves,
  loadActiveSession,
  pendingLeaves,
  queuePendingLeave,
  saveActiveSession,
} from "./sessionStore";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const session: RoomSession = {
  code: "AB12CD",
  participantId: "user-1",
  token: "secret",
  displayName: "Ana",
  wsUrl: "ws://localhost:3001/ws",
  protocolVersion: 2,
};

describe("sessionStore", () => {
  it("retoma uma sessão recente e descarta uma sessão expirada", () => {
    const storage = new MemoryStorage();
    saveActiveSession(session, storage, 1_000);
    expect(loadActiveSession(storage, 2_000)).toEqual(session);
    expect(loadActiveSession(storage, 21 * 60 * 1_000)).toBeNull();
  });

  it("limpa uma sessão após saída explícita", () => {
    const storage = new MemoryStorage();
    saveActiveSession(session, storage);
    clearActiveSession(storage);
    expect(loadActiveSession(storage)).toBeNull();
  });

  it("mantém somente saídas que ainda falharam", async () => {
    const storage = new MemoryStorage();
    const second = { ...session, participantId: "user-2", token: "secret-2" };
    queuePendingLeave(session, storage);
    queuePendingLeave(session, storage);
    queuePendingLeave(second, storage);
    expect(pendingLeaves(storage)).toHaveLength(2);
    const leave = vi.fn(async (current: RoomSession) => {
      if (current.participantId === "user-2") throw new Error("offline");
    });
    await flushPendingLeaves(leave, storage);
    expect(pendingLeaves(storage)).toEqual([second]);
  });
});
