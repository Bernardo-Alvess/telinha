import { PLAYOUT_DELAY_MS } from "./playout";

const WORKLET_SOURCE = `
class ShareAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.offset = 0;
    this.buffered = 0;
    this.primed = false;
    this.preroll = 48000 * 2 * ${PLAYOUT_DELAY_MS / 1000};
    this.port.onmessage = (event) => {
      this.chunks.push(event.data);
      this.buffered += event.data.length;
      let samples = this.buffered;
      while (samples > 48000 * 2 * 0.4 && this.chunks.length > 2) {
        samples -= this.chunks[0].length;
        this.buffered -= this.chunks[0].length;
        this.chunks.shift();
        this.offset = 0;
      }
      if (!this.primed && this.buffered >= this.preroll) {
        this.primed = true;
      }
    };
  }

  process(_inputs, outputs) {
    const left = outputs[0][0];
    const right = outputs[0][1] || outputs[0][0];
    if (!this.primed) {
      left.fill(0);
      right.fill(0);
      return true;
    }
    for (let i = 0; i < left.length; i++) {
      if (this.chunks.length === 0) {
        left[i] = 0;
        right[i] = 0;
        continue;
      }
      const chunk = this.chunks[0];
      left[i] = chunk[this.offset] ?? 0;
      right[i] = chunk[this.offset + 1] ?? chunk[this.offset] ?? 0;
      this.offset += 2;
      if (this.offset >= chunk.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("share-audio-processor", ShareAudioProcessor);
`;

export async function createShareAudioTrack(): Promise<{
  track: MediaStreamTrack;
  context: AudioContext;
  node: AudioNode;
  port?: MessagePort;
} | null> {
  const context = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
  await context.resume();
  const destination = context.createMediaStreamDestination();

  try {
    const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    await context.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(context, "share-audio-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    node.connect(destination);
    const track = destination.stream.getAudioTracks()[0];
    if (!track) return null;
    await disableAudioProcessing(track);
    return { track, context, node, port: node.port };
  } catch {
    const processor = context.createScriptProcessor(4096, 2, 2);
    const queue: Float32Array[] = [];
    processor.onaudioprocess = (event) => {
      const frames = event.outputBuffer.length;
      const left = event.outputBuffer.getChannelData(0);
      const right = event.outputBuffer.getChannelData(1);
      const interleaved = pullInterleaved(queue, frames * 2);
      for (let i = 0; i < frames; i += 1) {
        left[i] = interleaved[i * 2] ?? 0;
        right[i] = interleaved[i * 2 + 1] ?? 0;
      }
    };
    const mute = context.createGain();
    mute.gain.value = 0;
    processor.connect(destination);
    processor.connect(mute);
    mute.connect(context.destination);
    const track = destination.stream.getAudioTracks()[0];
    if (!track) return null;
    await disableAudioProcessing(track);
    const port = {
      postMessage(samples: Float32Array) {
        queue.push(samples);
        if (queue.length > 20) {
          queue.splice(0, queue.length - 12);
        }
      },
    } as MessagePort;
    return { track, context, node: processor, port };
  }
}

async function disableAudioProcessing(track: MediaStreamTrack) {
  try {
    await track.applyConstraints({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
    } as MediaTrackConstraints);
  } catch {
  }
}

function pullInterleaved(queue: Float32Array[], needed: number): Float32Array {
  const out = new Float32Array(needed);
  let offset = 0;
  while (offset < needed && queue.length > 0) {
    const next = queue[0]!;
    const take = Math.min(next.length, needed - offset);
    out.set(next.subarray(0, take), offset);
    if (take === next.length) {
      queue.shift();
    } else {
      queue[0] = next.subarray(take);
    }
    offset += take;
  }
  return out;
}
