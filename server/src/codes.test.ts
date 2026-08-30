import { describe, expect, it } from "vitest";
import {
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
  it("aceita códigos de seis caracteres do alfabeto gerado", () => {
    expect(isValidRoomCode("AB23CD")).toBe(true);
  });

  it("rejeita código legado, tamanho incorreto ou caracteres ambíguos", () => {
    expect(isValidRoomCode("D123456789012345678")).toBe(false);
    expect(isValidRoomCode("ABCD")).toBe(false);
    expect(isValidRoomCode("AB12CD")).toBe(false);
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
