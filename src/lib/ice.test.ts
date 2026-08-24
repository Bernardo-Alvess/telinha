import { describe, expect, it } from "vitest";
import { buildIceServers } from "./ice";

describe("buildIceServers", () => {
  it("sempre inclui STUN público", () => {
    const servers = buildIceServers();
    expect(servers.some((server) => String(server.urls).includes("stun.l.google.com"))).toBe(true);
  });

  it("usa TURN público quando não há TURN próprio", () => {
    const servers = buildIceServers();
    expect(servers.some((server) => String(server.urls).includes("openrelay.metered.ca"))).toBe(true);
  });

  it("acrescenta TURN quando a URL existe", () => {
    const servers = buildIceServers({
      VITE_TURN_URL: "turn:turn.example.com:3478",
      VITE_TURN_USERNAME: "user",
      VITE_TURN_CREDENTIAL: "pass",
    });
    expect(servers[servers.length - 1]).toEqual({
      urls: "turn:turn.example.com:3478",
      username: "user",
      credential: "pass",
    });
    expect(servers.some((server) => String(server.urls).includes("openrelay.metered.ca"))).toBe(false);
  });
});
