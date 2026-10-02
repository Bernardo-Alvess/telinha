import { describe, expect, it } from "vitest";
import { buildIceServers } from "./ice";

describe("buildIceServers", () => {
  it("sempre inclui STUN público e não usa relay aberto", () => {
    const servers = buildIceServers();
    expect(servers.some((server) => String(server.urls).includes("stun.l.google.com"))).toBe(true);
    expect(servers.some((server) => String(server.urls).includes("openrelay.metered.ca"))).toBe(false);
  });

  it("acrescenta os servidores ICE entregues pela sessão", () => {
    const servers = buildIceServers({}, [
      { urls: "turn:turn.example.com:3478", username: "user", credential: "pass" },
    ]);
    expect(servers[servers.length - 1]).toEqual({
      urls: "turn:turn.example.com:3478",
      username: "user",
      credential: "pass",
    });
  });

  it("prioriza o TURN local de desenvolvimento", () => {
    const servers = buildIceServers(
      {
        VITE_TURN_URL: "turn:turn.example.com:3478",
        VITE_TURN_USERNAME: "user",
        VITE_TURN_CREDENTIAL: "pass",
      },
      [{ urls: "turn:session.example.com:3478", username: "session", credential: "nope" }],
    );
    expect(servers[servers.length - 1]).toEqual({
      urls: "turn:turn.example.com:3478",
      username: "user",
      credential: "pass",
    });
    expect(servers.some((server) => String(server.urls).includes("session.example.com"))).toBe(false);
  });
});
