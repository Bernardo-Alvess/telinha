interface Tone {
  freq: number;
  start: number;
  dur: number;
  gain: number;
}

export const STREAM_STARTED_TONES: Tone[] = [
  { freq: 523.25, start: 0, dur: 0.11, gain: 0.09 },
  { freq: 659.25, start: 0.1, dur: 0.14, gain: 0.08 },
  { freq: 783.99, start: 0.2, dur: 0.2, gain: 0.07 },
];

export const VIEWER_JOINED_TONES: Tone[] = [
  { freq: 880, start: 0, dur: 0.07, gain: 0.08 },
  { freq: 1174.66, start: 0.06, dur: 0.12, gain: 0.07 },
];

const SOUNDS_KEY = "telinha-room-sounds";

let audioCtx: AudioContext | null = null;

export function areSoundsEnabled(): boolean {
  return localStorage.getItem(SOUNDS_KEY) !== "0";
}

export function setSoundsEnabled(enabled: boolean) {
  localStorage.setItem(SOUNDS_KEY, enabled ? "1" : "0");
}

function context(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  audioCtx ??= new AudioContext();
  return audioCtx;
}

function playTones(tones: Tone[]) {
  const ctx = context();
  if (!ctx) return;
  void ctx.resume();
  const now = ctx.currentTime + 0.01;
  for (const tone of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(tone.freq, now + tone.start);
    gain.gain.setValueAtTime(0.0001, now + tone.start);
    gain.gain.exponentialRampToValueAtTime(tone.gain, now + tone.start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.start + tone.dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + tone.start);
    osc.stop(now + tone.start + tone.dur + 0.02);
  }
}

export function playStreamStarted() {
  if (!areSoundsEnabled()) return;
  playTones(STREAM_STARTED_TONES);
}

export function playViewerJoined() {
  if (!areSoundsEnabled()) return;
  playTones(VIEWER_JOINED_TONES);
}
