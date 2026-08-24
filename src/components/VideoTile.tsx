import { useEffect, useRef } from "react";

interface VideoTileProps {
  stream: MediaStream;
  active?: boolean;
  expandable?: boolean;
  onSelect?: () => void;
}

export function VideoTile({ stream, active, expandable, onSelect }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.srcObject = stream;
    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  return (
    <button
      type="button"
      className={`video-tile ${active ? "active" : ""} ${expandable ? "expandable" : ""}`}
      onClick={onSelect}
    >
      <video ref={videoRef} autoPlay playsInline muted />
    </button>
  );
}
