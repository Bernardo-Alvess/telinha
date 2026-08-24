import type { ShareQuality } from "../hooks/useTelinhaRoom";

export function displayMediaOptions(quality: ShareQuality) {
  const video: Record<string, unknown> = {
    frameRate: { ideal: quality.fps },
    resizeMode: "none",
  };
  if (quality.maxWidth > 0) {
    video.width = { max: quality.maxWidth };
  }
  if (quality.maxHeight && quality.maxHeight > 0) {
    video.height = { max: quality.maxHeight };
  }
  return {
    video,
    audio: false,
    systemAudio: "exclude",
    selfBrowserSurface: "exclude",
    preferCurrentTab: false,
  };
}

export async function startDisplayMediaShare(
  quality: ShareQuality,
  _sourceId: string,
): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("A captura de tela do Windows não está disponível.");
  }

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia(
      displayMediaOptions(quality) as DisplayMediaStreamOptions,
    );
    const track = stream.getVideoTracks()[0];
    if (!track) {
      for (const item of stream.getTracks()) {
        item.stop();
      }
      throw new Error("O Windows não retornou uma faixa de vídeo.");
    }
    track.contentHint = "motion";
    return stream;
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "NotAllowedError" || error.name === "AbortError")
    ) {
      throw Object.assign(new Error("Seleção de tela cancelada."), { cause: error });
    }
    throw error;
  }
}
