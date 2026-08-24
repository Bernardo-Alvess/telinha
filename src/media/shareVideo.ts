import { PLAYOUT_DELAY_MS } from "./playout";

interface VideoSink {
  track: MediaStreamTrack;
  push: (bitmap: ImageBitmap) => void;
  close: () => void;
}

type TrackGeneratorCtor = new (init: { kind: "video" }) => MediaStreamTrack & {
  writable: WritableStream<VideoFrame>;
};

function createRawVideoSink(fps: number): VideoSink {
  const Generator = (globalThis as unknown as { MediaStreamTrackGenerator?: TrackGeneratorCtor })
    .MediaStreamTrackGenerator;
  if (typeof Generator === "function" && typeof VideoFrame === "function") {
    const generator = new Generator({ kind: "video" });
    const writer = generator.writable.getWriter();
    let timestamp = 0;
    const duration = Math.round(1_000_000 / Math.max(fps, 1));
    generator.contentHint = "detail";
    return {
      track: generator,
      push(bitmap) {
        const frame = new VideoFrame(bitmap, {
          timestamp,
          duration,
          alpha: "discard",
        });
        timestamp += duration;
        void writer.write(frame).finally(() => frame.close());
        bitmap.close();
      },
      close() {
        void writer.close().catch(() => undefined);
        generator.stop();
      },
    };
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!context) {
    throw new Error("Não foi possível iniciar o vídeo");
  }
  const stream = canvas.captureStream(fps);
  const track = stream.getVideoTracks()[0];
  if (!track) {
    throw new Error("Falha ao criar o vídeo da tela");
  }
  track.contentHint = "detail";
  return {
    track,
    push(bitmap) {
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
    },
    close() {
      track.stop();
    },
  };
}

export function createVideoSink(fps: number): VideoSink {
  const inner = createRawVideoSink(fps);
  const queue: ImageBitmap[] = [];
  const interval = 1000 / Math.max(fps, 1);
  const preroll = Math.max(2, Math.round(PLAYOUT_DELAY_MS / interval));
  const maxQueue = preroll + 4;
  let timer: number | null = null;
  let startTimer: number | null = null;
  let nextDue = 0;
  let started = false;
  let closed = false;

  function schedule() {
    if (closed) return;
    const wait = Math.max(1, nextDue - performance.now());
    timer = window.setTimeout(tick, wait);
  }

  function tick() {
    if (closed) return;
    const now = performance.now();
    const frame = queue.shift();
    if (frame) {
      inner.push(frame);
    }
    nextDue += interval;
    if (now - nextDue > interval * 2) {
      nextDue = now + interval;
    }
    schedule();
  }

  function start() {
    if (started || closed) return;
    started = true;
    nextDue = performance.now() + interval;
    schedule();
  }

  return {
    track: inner.track,
    push(bitmap) {
      if (closed) {
        bitmap.close();
        return;
      }
      queue.push(bitmap);
      while (queue.length > maxQueue) {
        queue.shift()?.close();
      }
      if (!started && startTimer == null) {
        startTimer = window.setTimeout(start, PLAYOUT_DELAY_MS);
      }
      if (!started && queue.length >= preroll) {
        start();
      }
    },
    close() {
      closed = true;
      if (timer != null) {
        window.clearTimeout(timer);
      }
      if (startTimer != null) {
        window.clearTimeout(startTimer);
      }
      for (const bitmap of queue) {
        bitmap.close();
      }
      queue.length = 0;
      inner.close();
    },
  };
}

export async function decodeShareJpeg(bytes: ArrayBuffer | Uint8Array): Promise<ImageBitmap> {
  const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return createImageBitmap(new Blob([payload], { type: "image/jpeg" }), {
    premultiplyAlpha: "none",
  });
}
