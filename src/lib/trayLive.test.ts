import { describe, expect, it } from "vitest";
import { parseTelinhaUrl } from "./api";
import { inviteLink } from "./trayLive";

describe("inviteLink", () => {
  it("é telinha://join/CODE, sem query string", () => {
    expect(inviteLink("AB23CD")).toBe("telinha://join/AB23CD");
  });

  it("é lido de volta pelo app como join do mesmo código, sem nome", () => {
    expect(parseTelinhaUrl(inviteLink("AB23CD"))).toEqual({ action: "join", code: "AB23CD" });
  });
});
