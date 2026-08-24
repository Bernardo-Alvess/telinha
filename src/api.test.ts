import { describe, expect, it } from "vitest";
import { isDiscordRoomCode, parseTelinhaUrl, signalingUrl } from "./api";

describe("parseTelinhaUrl", () => {
  it("lê join com código e nome", () => {
    expect(parseTelinhaUrl("telinha://join/AB12CD?name=Ana")).toEqual({
      action: "join",
      code: "AB12CD",
      name: "Ana",
    });
  });

  it("sanitiza o código e reconhece share", () => {
    expect(parseTelinhaUrl("telinha://join/ab-12")).toEqual({
      action: "join",
      code: "AB12",
      name: undefined,
    });
    expect(parseTelinhaUrl("telinha://share")).toEqual({ action: "share" });
  });

  it("ignora protocolos estranhos", () => {
    expect(parseTelinhaUrl("https://example.com")).toBeNull();
  });
});

describe("isDiscordRoomCode", () => {
  it("distingue snowflake de código curto", () => {
    expect(isDiscordRoomCode("D123456789012345678")).toBe(true);
    expect(isDiscordRoomCode("AB12CD")).toBe(false);
  });
});

describe("signalingUrl", () => {
  it("coloca token e id na query", () => {
    const url = signalingUrl({
      code: "AB12CD",
      participantId: "user-1",
      token: "secret",
      displayName: "Ana",
      wsUrl: "ws://localhost:3001/ws",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("token")).toBe("secret");
    expect(parsed.searchParams.get("code")).toBe("AB12CD");
    expect(parsed.searchParams.has("name")).toBe(false);
  });
});
