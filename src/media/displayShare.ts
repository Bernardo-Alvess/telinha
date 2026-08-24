import type { ShareQuality } from "../hooks/useTelinhaRoom";

export function displayMediaOptions(quality: ShareQuality, sourceId: string) {
  const displaySurface = sourceId.startsWith("screen:") ? "monitor" : "window";
  const video: Record<string, unknown> = {
    frameRate: { ideal: quality.fps, max: quality.fps },
    displaySurface,
  };
  if (quality.maxWidth > 0) {
    video.width = { ideal: quality.maxWidth, max: quality.maxWidth };
  }
  return {
    video,
    audio: quality.includeAudio
      ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      : false,
    systemAudio: quality.includeAudio ? "include" : "exclude",
    selfBrowserSurface: "exclude",
    preferCurrentTab: false,
  };
}

export async function startDisplayMediaShare(
  quality: ShareQuality,
  sourceId: string,
): Promise<MediaStream | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    return null;
  }

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia(
      displayMediaOptions(quality, sourceId) as DisplayMediaStreamOptions,
    );
    const track = stream.getVideoTracks()[0];
    if (!track) {
      for (const item of stream.getTracks()) {
        item.stop();
      }
      return null;
    }
    track.contentHint = "detail";
    try {
      await track.applyConstraints({
        frameRate: { ideal: quality.fps, max: quality.fps },
        ...(quality.maxWidth > 0 ? { width: { ideal: quality.maxWidth } } : {}),
      });
    } catch {
    }
    return stream;
  } catch {
    return null;
  }
}
