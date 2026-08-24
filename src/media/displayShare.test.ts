import { describe, expect, it } from "vitest";
import { displayMediaOptions } from "./displayShare";

const quality = {
  fps: 60,
  maxWidth: 2560,
  includeAudio: true,
  useGpuEncode: true,
};

describe("display media options", () => {
  it("asks Chromium for a monitor when the picker chose a screen", () => {
    const options = displayMediaOptions(quality, "screen:1");
    expect(options.video).toMatchObject({
      displaySurface: "monitor",
      frameRate: { ideal: 60, max: 60 },
      width: { ideal: 2560, max: 2560 },
    });
    expect(options.audio).toBeTruthy();
    expect(options.systemAudio).toBe("include");
  });

  it("asks Chromium for a window and can skip system audio", () => {
    const options = displayMediaOptions({ ...quality, includeAudio: false, maxWidth: 0 }, "window:9");
    expect(options.video).toMatchObject({
      displaySurface: "window",
      frameRate: { ideal: 60, max: 60 },
    });
    expect(options.video).not.toHaveProperty("width");
    expect(options.audio).toBe(false);
    expect(options.systemAudio).toBe("exclude");
  });
});
