import { describe, expect, it } from "vitest";
import { compareVersions, decideUpdate } from "./updates";

describe("decideUpdate", () => {
  it("não pede update quando a versão atual já basta", () => {
    expect(compareVersions("0.3.0", "0.2.0")).toBeGreaterThan(0);
    expect(decideUpdate({ current: "0.3.0", minimum: "0.2.0", available: "0.3.0" })).toBeNull();
  });

  it("mostra um aviso opcional quando existe versão mais nova", () => {
    expect(decideUpdate({ current: "0.3.0", minimum: "0.2.0", available: "0.4.0" })).toEqual({
      required: false,
      version: "0.4.0",
    });
  });

  it("bloqueia quando a versão instalada está abaixo do mínimo", () => {
    expect(decideUpdate({ current: "0.3.0", minimum: "0.4.0", available: "0.4.1" })).toEqual({
      required: true,
      version: "0.4.1",
    });
    expect(decideUpdate({ current: "0.3.0", minimum: "0.4.0", available: null })).toEqual({
      required: true,
      version: "0.4.0",
    });
  });
});
