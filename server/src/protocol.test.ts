import { describe, expect, it } from "vitest";
import {
  MAX_SIGNAL_PAYLOAD_BYTES,
  isProtocolError,
  parseClientAuthentication,
  parseClientSignal,
  readProtocolVersion,
} from "./protocol.js";

const peer = "user-0123456789abcdef0123456789abcdef";

describe("protocolo de sinalização", () => {
  it("marca cliente sem versão como incompatível", () => {
    expect(readProtocolVersion(undefined)).toBe(0);
    expect(readProtocolVersion(2)).toBe(2);
  });

  it("aceita mensagens conhecidas", () => {
    expect(parseClientSignal(JSON.stringify({ type: "watch-started", to: peer }))).toEqual({
      type: "watch-started",
      to: peer,
    });
    expect(
      parseClientSignal(
        JSON.stringify({ type: "ice", to: peer, candidate: { candidate: "candidate:1" } }),
      ),
    ).toMatchObject({ type: "ice", to: peer });
  });

  it("valida autenticação enviada como primeira mensagem", () => {
    expect(
      parseClientAuthentication(
        JSON.stringify({
          type: "authenticate",
          code: "AB23CD",
          participantId: peer,
          token: "abcdefghijklmnopqrstuvwxyz012345",
          protocolVersion: 2,
          appVersion: "0.2.0",
        }),
      ),
    ).toMatchObject({
      type: "authenticate",
      code: "AB23CD",
      participantId: peer,
      protocolVersion: 2,
    });
    expect(
      isProtocolError(
        parseClientAuthentication(
          JSON.stringify({
            type: "authenticate",
            code: "AB23CD",
            participantId: peer,
            token: "curto",
            protocolVersion: 2,
          }),
        ),
      ),
    ).toBe(true);
  });

  it("rejeita destinatário, JSON e payload excessivo", () => {
    expect(isProtocolError(parseClientSignal("{"))).toBe(true);
    expect(
      isProtocolError(parseClientSignal(JSON.stringify({ type: "offer", to: "peer", sdp: "v=0" }))),
    ).toBe(true);
    expect(
      parseClientSignal("x".repeat(MAX_SIGNAL_PAYLOAD_BYTES + 1)),
    ).toMatchObject({ code: "payload-too-large" });
  });
});
