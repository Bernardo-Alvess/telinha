import { describe, expect, it } from "vitest";
import { ConnectionState } from "../hooks/connectionState";
import { classifyConnectionQuality, connectionQualityLabel } from "./connectionQuality";

describe("qualidade de conexão", () => {
  it("prioriza estados de transporte", () => {
    expect(classifyConnectionQuality(ConnectionState.Disconnected, [])).toBe("offline");
    expect(classifyConnectionQuality(ConnectionState.Reconnecting, [])).toBe("reconnecting");
  });

  it("detecta perda e latência", () => {
    expect(
      classifyConnectionQuality(ConnectionState.Connected, [{ peerId: "p", packetLossPercent: 6 }]),
    ).toBe("unstable");
    expect(
      classifyConnectionQuality(ConnectionState.Connected, [{ peerId: "p", roundTripTimeMs: 401 }]),
    ).toBe("unstable");
    expect(classifyConnectionQuality(ConnectionState.Connected, [])).toBe("good");
    expect(connectionQualityLabel("good")).toBe("Conexão boa");
  });

  it("não chama um peer preso na negociação de conexão boa", () => {
    expect(
      classifyConnectionQuality(ConnectionState.Connected, [
        { peerId: "p", connectionState: "connecting" },
      ]),
    ).toBe("reconnecting");
    expect(
      classifyConnectionQuality(ConnectionState.Connected, [
        { peerId: "p", connectionState: "failed" },
      ]),
    ).toBe("offline");
  });
});
