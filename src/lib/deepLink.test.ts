import { describe, expect, it } from "vitest";
import { actionFromUrls } from "./deepLink";

describe("actionFromUrls", () => {
  it("escolhe o primeiro deep link válido", () => {
    expect(actionFromUrls(["https://x", "telinha://join/AB23CD?name=Bia"])).toEqual({
      action: "join",
      code: "AB23CD",
      name: "Bia",
    });
  });

  it("reconhece share e open", () => {
    expect(actionFromUrls(["telinha://share"])).toEqual({ action: "share" });
    expect(actionFromUrls(["telinha://"])).toEqual({ action: "open" });
  });

  it("volta null se não houver URL da Telinha", () => {
    expect(actionFromUrls(["https://discord.com"])).toBeNull();
  });
});
