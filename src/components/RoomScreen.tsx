import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { RoomSession } from "../api";
import { ConnectionState, useTelinhaRoom } from "../hooks/useTelinhaRoom";
import { ScreenSharePicker } from "./ScreenSharePicker";
import { VideoTile } from "./VideoTile";
import { VolumeControl } from "./VolumeControl";

interface RoomScreenProps {
  session: RoomSession;
  onLeave: () => void;
  openPicker?: boolean;
  onPickerOpened?: () => void;
}

export function RoomScreen({ session, onLeave, openPicker, onPickerOpened }: RoomScreenProps) {
  const [copied, setCopied] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [watchingId, setWatchingId] = useState<string | null>(null);
  const [volume, setVolume] = useState(() => {
    const stored = Number(localStorage.getItem("telinha-watch-volume"));
    return Number.isFinite(stored) ? Math.min(100, Math.max(0, stored)) : 100;
  });
  const [chromeVisible, setChromeVisible] = useState(true);
  const [watchFullscreen, setWatchFullscreen] = useState(() => {
    return localStorage.getItem("telinha-watch-fullscreen") !== "0";
  });
  const hideTimer = useRef<number | null>(null);
  const watchAudioRef = useRef<HTMLMediaElement | null>(null);
  const {
    connectionState,
    isSharing,
    screenShares,
    participants,
    startShare,
    stopShare,
    error,
  } = useTelinhaRoom(session);

  useEffect(() => {
    void invoke("set_discord_presence", { code: session.code }).catch(() => undefined);
    return () => {
      void invoke("set_discord_presence", { code: null }).catch(() => undefined);
    };
  }, [session.code]);

  const displayName = session.displayName;
  const localId = session.participantId;
  const remoteShares = screenShares.filter((share) => share.participantIdentity !== localId);
  const localShare = screenShares.find((share) => share.participantIdentity === localId);
  const watchingShare = remoteShares.find((share) => share.participantIdentity === watchingId) ?? null;
  const watching = Boolean(watchingShare) && !pickerOpen;
  const hosting = isSharing && !watching && !pickerOpen;

  useEffect(() => {
    if (openPicker) {
      onPickerOpened?.();
      setPickerOpen(true);
    }
  }, [openPicker, onPickerOpened]);

  useEffect(() => {
    if (
      watchingId &&
      !screenShares.some(
        (share) => share.participantIdentity === watchingId && share.participantIdentity !== localId,
      )
    ) {
      setWatchingId(null);
    }
  }, [watchingId, screenShares, localId]);

  useEffect(() => {
    const layout = pickerOpen
      ? "picker"
      : watching
      ? watchFullscreen
        ? "watch"
        : "watch-window"
      : hosting
        ? "host"
        : "lobby";
    void invoke("set_window_layout", { layout }).catch(() => undefined);
  }, [pickerOpen, watching, hosting, watchFullscreen]);

  useEffect(() => {
    localStorage.setItem("telinha-watch-fullscreen", watchFullscreen ? "1" : "0");
  }, [watchFullscreen]);

  useEffect(() => {
    const stream = watchingShare?.stream;
    const audioTracks = stream?.getAudioTracks() ?? [];
    if (!watching || audioTracks.length === 0) {
      return;
    }
    const element = document.createElement("audio");
    element.autoplay = true;
    element.setAttribute("playsinline", "true");
    element.srcObject = new MediaStream(audioTracks);
    element.volume = volume / 100;
    document.body.appendChild(element);
    watchAudioRef.current = element;
    return () => {
      element.srcObject = null;
      element.remove();
      if (watchAudioRef.current === element) {
        watchAudioRef.current = null;
      }
    };
  }, [watching, watchingShare?.stream]);

  useEffect(() => {
    localStorage.setItem("telinha-watch-volume", String(volume));
    if (watchAudioRef.current) {
      watchAudioRef.current.volume = volume / 100;
    }
  }, [volume, watchingShare?.stream]);

  useEffect(() => {
    if (!watching) {
      setChromeVisible(true);
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
      }
      return;
    }

    function scheduleHide() {
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
      }
      hideTimer.current = window.setTimeout(() => {
        setChromeVisible(false);
      }, 2000);
    }

    function onMove() {
      setChromeVisible(true);
      scheduleHide();
    }

    scheduleHide();
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
      }
    };
  }, [watching]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (pickerOpen) {
          setPickerOpen(false);
          return;
        }
        if (watching && watchFullscreen) {
          setWatchFullscreen(false);
          return;
        }
        if (watching) {
          setWatchingId(null);
        }
      }
      if (event.key === "F11" && watching) {
        event.preventDefault();
        setWatchFullscreen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerOpen, watching, watchFullscreen]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listen("toggle-share", () => {
      if (isSharing) {
        void stopShare();
        return;
      }
      setPickerOpen(true);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isSharing, stopShare]);

  async function copyCode() {
    try {
      await invoke("copy_to_clipboard", { text: session.code });
    } catch {
      await navigator.clipboard.writeText(session.code);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const connected = connectionState === ConnectionState.Connected;
  const reconnecting = connectionState === ConnectionState.Reconnecting;
  const viewers = participants.filter((person) => !person.isSharing).length;

  if (pickerOpen) {
    return (
      <ScreenSharePicker
        onCancel={() => setPickerOpen(false)}
        onShare={async (sourceId, quality) => {
          await startShare(sourceId, quality);
          setPickerOpen(false);
        }}
      />
    );
  }

  if (watching && watchingShare) {
    return (
      <div
        className={`screen room-screen watching ${watchFullscreen ? "watching-full" : "watching-window"} ${chromeVisible ? "chrome-on" : "chrome-off"}`}
      >
        <header className="watch-chrome top">
          <div className="live-badge">Ao vivo · {watchingShare.participantName}</div>
          <span className="watchers">{viewers} assistindo</span>
        </header>

        <div className="video-area">
          <VideoTile stream={watchingShare.stream} active />
        </div>

        {remoteShares.length > 1 && (
          <div className="share-tabs overlay-tabs">
            {remoteShares.map((share) => (
              <button
                key={share.participantIdentity}
                type="button"
                className={`share-tab ${share.participantIdentity === watchingId ? "active" : ""}`}
                onClick={() => setWatchingId(share.participantIdentity)}
              >
                {share.participantName}
              </button>
            ))}
          </div>
        )}

        <footer className="watch-chrome bottom">
          <VolumeControl
            volume={volume}
            onChange={setVolume}
            onInteract={() => setChromeVisible(true)}
          />
          <div className="watch-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setWatchFullscreen((open) => !open)}
            >
              {watchFullscreen ? "Diminuir tela" : "Tela cheia"}
            </button>
            <button
              type="button"
              className="btn btn-share"
              onClick={() => setPickerOpen(true)}
              disabled={!connected}
            >
              Compartilhar também
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setWatchingId(null)}>
              Parar de assistir
            </button>
            <button type="button" className="btn btn-ghost" onClick={onLeave}>
              Sair da sala
            </button>
          </div>
        </footer>

        {error && <p className="error overlay-error">{error}</p>}
      </div>
    );
  }

  if (hosting) {
    return (
      <div className="screen room-screen host-screen">
        <header className="room-header">
          <div className="room-code-block">
            <span className="room-code">{session.code}</span>
            <button type="button" className="btn btn-ghost" onClick={copyCode}>
              {copied ? "Copiado!" : "Copiar"}
            </button>
          </div>
          <span className="status online">No ar</span>
        </header>

        <div className="host-preview">
          {localShare ? (
            <VideoTile stream={localShare.stream} active />
          ) : (
            <div className="video-placeholder">
              <p>Preparando preview...</p>
            </div>
          )}
        </div>

        <div className="sharing-bar">
          <span>{viewers} assistindo</span>
          <button type="button" className="btn btn-danger" onClick={() => void stopShare()}>
            Parar
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="screen room-screen lobby-screen">
      <header className="room-header">
        <span className={`status ${connected ? "online" : ""}`}>
          {connected ? displayName : reconnecting ? "Reconectando..." : "Conectando..."}
        </span>
        <button type="button" className="btn btn-ghost" onClick={onLeave}>
          Sair
        </button>
      </header>

      <div className="lobby-code">
        <p>Cole no Discord</p>
        <strong>{session.code}</strong>
        <button type="button" className="btn btn-primary" onClick={copyCode}>
          {copied ? "Copiado!" : "Copiar código"}
        </button>
      </div>

      <div className="people-list">
        <p>Na sala</p>
        {participants.length === 0 && <span className="muted">Conectando pessoas...</span>}
        {participants.map((person) => (
          <span key={person.identity} className="person-chip">
            {person.name}
            {person.isLocal ? " (você)" : ""}
            {person.isSharing ? " · no ar" : ""}
          </span>
        ))}
      </div>

      {remoteShares.length > 0 ? (
        <div className="watch-list">
          <p>Telas disponíveis</p>
          {remoteShares.map((share) => (
            <div key={share.participantIdentity} className="watch-row">
              <span>{share.participantName} está no ar</span>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setWatchingId(share.participantIdentity)}
              >
                Assistir
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">Esperando alguém transmitir a tela</p>
      )}

      <footer className="room-footer">
        <button
          type="button"
          className="btn btn-share"
          onClick={() => setPickerOpen(true)}
          disabled={!connected}
        >
          Compartilhar tela
        </button>
      </footer>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
