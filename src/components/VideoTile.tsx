import { useEffect, useRef } from "react";

interface VideoTileProps {
  stream: MediaStream;
  active?: boolean;
}

export function VideoTile({ stream, active }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;

    let cancelled = false;
    let retryTimer: number | undefined;
    const play = () => {
      if (cancelled) return;
      void element.play().catch(() => {
        if (!cancelled) retryTimer = window.setTimeout(play, 300);
      });
    };

    element.srcObject = stream;
    element.defaultMuted = true;
    element.muted = true;
    element.addEventListener("loadedmetadata", play);
    element.addEventListener("canplay", play);
    play();

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      element.removeEventListener("loadedmetadata", play);
      element.removeEventListener("canplay", play);
      element.srcObject = null;
    };
  }, [stream]);

  return (
    <div className={`video-tile ${active ? "active" : ""}`}>
      <video ref={videoRef} autoPlay playsInline muted />
    </div>
  );
}
