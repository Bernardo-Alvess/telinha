import { describe, expect, it } from "vitest";
import { STREAM_STARTED_TONES, VIEWER_JOINED_TONES } from "./sounds";

describe("room chimes", () => {
  it("uses a rising live-started phrase", () => {
    expect(STREAM_STARTED_TONES.length).toBeGreaterThanOrEqual(2);
    expect(STREAM_STARTED_TONES[0]!.freq).toBeLessThan(STREAM_STARTED_TONES[STREAM_STARTED_TONES.length - 1]!.freq);
  });

  it("uses a shorter higher viewer-joined phrase", () => {
    const liveEnd = STREAM_STARTED_TONES[STREAM_STARTED_TONES.length - 1]!;
    const joinEnd = VIEWER_JOINED_TONES[VIEWER_JOINED_TONES.length - 1]!;
    const liveLen = liveEnd.start + liveEnd.dur;
    const joinLen = joinEnd.start + joinEnd.dur;
    expect(joinLen).toBeLessThan(liveLen);
    expect(joinEnd.freq).toBeGreaterThan(liveEnd.freq);
  });
});
