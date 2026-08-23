import { useEffect, useRef } from "react";
import type { Track } from "livekit-client";

interface VideoTileProps {
  track: Track;
  label: string;
  active?: boolean;
  expandable?: boolean;
  onSelect?: () => void;
}

export function VideoTile({ track, label, active, expandable, onSelect }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;

    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  return (
    <button
      type="button"
      className={`video-tile ${active ? "active" : ""} ${expandable ? "expandable" : ""}`}
      onClick={onSelect}
      title={label}
    >
      <video ref={videoRef} autoPlay playsInline muted />
      <span className="video-label">{label}</span>
    </button>
  );
}
