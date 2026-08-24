interface VideoSink {
  track: MediaStreamTrack;
  push: (bitmap: ImageBitmap) => Promise<void>;
  close: () => void;
}

type TrackGeneratorCtor = new (init: { kind: "video" }) => MediaStreamTrack & {
  writable: WritableStream<VideoFrame>;
};

export function createVideoSink(fps: number): VideoSink {
  const Generator = (globalThis as unknown as { MediaStreamTrackGenerator?: TrackGeneratorCtor })
    .MediaStreamTrackGenerator;
  if (typeof Generator === "function" && typeof VideoFrame === "function") {
    const generator = new Generator({ kind: "video" });
    const writer = generator.writable.getWriter();
    const duration = Math.round(1_000_000 / Math.max(fps, 1));
    generator.contentHint = "detail";
    return {
      track: generator,
      async push(bitmap) {
        const frame = new VideoFrame(bitmap, {
          timestamp: Math.round(performance.now() * 1000),
          duration,
          alpha: "discard",
        });
        bitmap.close();
        try {
          await writer.write(frame);
        } finally {
          frame.close();
        }
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
    async push(bitmap) {
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

export async function decodeShareJpeg(bytes: ArrayBuffer | Uint8Array): Promise<ImageBitmap> {
  const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return createImageBitmap(new Blob([payload], { type: "image/jpeg" }), {
    premultiplyAlpha: "none",
  });
}
