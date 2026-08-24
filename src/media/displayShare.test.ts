import { describe, expect, it } from "vitest";
import { displayMediaOptions } from "./displayShare";

const quality = {
  fps: 60,
  maxWidth: 2560,
  maxHeight: 1440,
  maxBitrate: 24_000_000,
  includeAudio: true,
  useGpuEncode: true,
};

describe("display media options", () => {
  it("asks Chromium for a smooth 60fps stream", () => {
    const options = displayMediaOptions(quality);
    expect(options.video).toMatchObject({
      frameRate: { ideal: 60 },
      width: { max: 2560 },
      height: { max: 1440 },
      resizeMode: "none",
    });
    expect(options.video).not.toHaveProperty("displaySurface");
    expect(options.audio).toBe(false);
    expect(options.systemAudio).toBe("exclude");
  });

  it("can skip system audio and keep native resolution", () => {
    const options = displayMediaOptions({ ...quality, includeAudio: false, maxWidth: 0 });
    expect(options.video).toMatchObject({
      frameRate: { ideal: 60 },
    });
    expect(options.video).not.toHaveProperty("width");
    expect(options.audio).toBe(false);
    expect(options.systemAudio).toBe("exclude");
  });
});
