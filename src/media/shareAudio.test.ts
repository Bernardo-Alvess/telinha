import { describe, expect, it } from "vitest";
import { pcmBytesToFloat32 } from "./shareAudio";

describe("pcmBytesToFloat32", () => {
  it("reads little-endian floats without copying when aligned", () => {
    const samples = new Float32Array([0.5, -0.25, 1]);
    const decoded = pcmBytesToFloat32(new Uint8Array(samples.buffer));
    expect(Array.from(decoded)).toEqual([0.5, -0.25, 1]);
  });

  it("copies when the view is unaligned", () => {
    const padded = new Uint8Array(13);
    const samples = new Float32Array([0.125, 0.25]);
    padded.set(new Uint8Array(samples.buffer), 1);
    const decoded = pcmBytesToFloat32(padded.subarray(1, 9));
    expect(Array.from(decoded)).toEqual([0.125, 0.25]);
  });
});
