import { describe, expect, it } from "vitest";
import {
  isDiscordRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  resolvePublicWsUrl,
  sanitizeDisplayName,
} from "./codes.js";

describe("normalizeRoomCode", () => {
  it("remove símbolos e deixa maiúsculo", () => {
    expect(normalizeRoomCode(" ab-12 ")).toBe("AB12");
  });
});

describe("isValidRoomCode", () => {
  it("aceita códigos curtos gerados", () => {
    expect(isValidRoomCode("AB12CD")).toBe(true);
    expect(isValidRoomCode("ABCD")).toBe(true);
  });

  it("aceita códigos Discord", () => {
    expect(isDiscordRoomCode("D123456789012345678")).toBe(true);
    expect(isValidRoomCode("D123456789012345678")).toBe(true);
  });

  it("rejeita códigos curtos demais ou com lixo", () => {
    expect(isValidRoomCode("AB")).toBe(false);
    expect(isValidRoomCode("")).toBe(false);
  });
});

describe("sanitizeDisplayName", () => {
  it("corta em 24 caracteres e usa fallback", () => {
    expect(sanitizeDisplayName("   ")).toBe("Amigo");
    expect(sanitizeDisplayName("x".repeat(40))).toHaveLength(24);
  });
});

describe("resolvePublicWsUrl", () => {
  it("normaliza URL pública para o caminho /ws", () => {
    expect(resolvePublicWsUrl("https://telinha-server.onrender.com")).toBe(
      "wss://telinha-server.onrender.com/ws",
    );
    expect(resolvePublicWsUrl("wss://example.com/ws")).toBe("wss://example.com/ws");
    expect(resolvePublicWsUrl("http://localhost:3001")).toBe("ws://localhost:3001/ws");
  });
});
