import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { RoomSession } from "../lib/api";
import { ConnectionState, useTelinhaRoom } from "../hooks/useTelinhaRoom";
import { areSoundsEnabled, setSoundsEnabled } from "../lib/sounds";
import { addWatching, mosaicColumns, pruneWatching, removeWatching } from "../lib/watch";
import { ScreenSharePicker } from "../components/ScreenSharePicker";
import { VideoTile } from "../components/VideoTile";
import { VolumeControl } from "../components/VolumeControl";

interface RoomScreenProps {
  session: RoomSession;
  onLeave: () => void;
  onSessionRefresh?: (session: RoomSession) => void;
  onSharingChange?: (sharing: boolean) => void;
  openPicker?: boolean;
  onPickerOpened?: () => void;
}

interface RoomToast {
  id: number;
  kind: "live" | "ended";
  name: string;
  shareId?: string;
}

export function RoomScreen({
  session,
  onLeave,
  onSessionRefresh,
  onSharingChange,
  openPicker,
  onPickerOpened,
}: RoomScreenProps) {
  const [copied, setCopied] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [watchingIds, setWatchingIds] = useState<string[]>([]);
  const [volume, setVolume] = useState(() => {
    const stored = Number(localStorage.getItem("telinha-watch-volume"));
    return Number.isFinite(stored) ? Math.min(100, Math.max(0, stored)) : 100;
  });
  const [chromeVisible, setChromeVisible] = useState(true);
  const [watchFullscreen, setWatchFullscreen] = useState(() => {
    return localStorage.getItem("telinha-watch-fullscreen") === "1";
  });
  const [mutedIds, setMutedIds] = useState<string[]>([]);
  const [roomSounds, setRoomSounds] = useState(areSoundsEnabled);
  const [toasts, setToasts] = useState<RoomToast[]>([]);
  const knownLives = useRef<Map<string, string>>(new Map());
  const toastSeq = useRef(0);
  const hideTimer = useRef<number | null>(null);
  const {
    connectionState,
    isSharing,
    screenShares,
    participants,
    watcherCounts,
    watcherNames,
    startShare,
    stopShare,
    setWatchingShare,
    error,
  } = useTelinhaRoom(session, { onSessionRefresh });

  useEffect(() => {
    onSharingChange?.(isSharing);
  }, [isSharing, onSharingChange]);

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
  const watchingShares = watchingIds
    .map((id) => remoteShares.find((share) => share.participantIdentity === id))
    .filter((share): share is NonNullable<typeof share> => Boolean(share));
  const watching = watchingShares.length > 0 && !pickerOpen;
  const hosting = isSharing && !watching && !pickerOpen;
  const multiWatch = watchingShares.length > 1;
  const remoteShareKey = remoteShares
    .map((share) => `${share.participantIdentity}\t${share.participantName}`)
    .join("\0");

  useEffect(() => {
    if (openPicker) {
      onPickerOpened?.();
      setPickerOpen(true);
    }
  }, [openPicker, onPickerOpened]);

  useEffect(() => {
    const available = remoteShareKey
      ? remoteShareKey.split("\0").map((entry) => entry.split("\t")[0] ?? "")
      : [];
    setWatchingIds((current) => {
      const next = pruneWatching(current, available);
      return next.length === current.length && next.every((id, index) => id === current[index])
        ? current
        : next;
    });
  }, [remoteShareKey]);

  useEffect(() => {
    const next = new Map<string, string>();
    if (remoteShareKey) {
      for (const entry of remoteShareKey.split("\0")) {
        const [id, name] = entry.split("\t");
        if (id) next.set(id, name || "Alguém");
      }
    }
    const previous = knownLives.current;
    if (previous.size > 0) {
      for (const [id, name] of next) {
        if (!previous.has(id)) {
          toastSeq.current += 1;
          const idn = toastSeq.current;
          setToasts((current) => [...current, { id: idn, kind: "live", name, shareId: id }]);
          window.setTimeout(() => {
            setToasts((current) => current.filter((toast) => toast.id !== idn));
          }, 6000);
        }
      }
      for (const [id, name] of previous) {
        if (!next.has(id)) {
          toastSeq.current += 1;
          const idn = toastSeq.current;
          setToasts((current) => [...current, { id: idn, kind: "ended", name }]);
          window.setTimeout(() => {
            setToasts((current) => current.filter((toast) => toast.id !== idn));
          }, 4000);
        }
      }
    }
    knownLives.current = next;
  }, [remoteShareKey]);

  useEffect(() => {
    const layout = pickerOpen
      ? "picker"
      : watching
        ? watchFullscreen
          ? "watch"
          : multiWatch
            ? "watch-dual"
            : "watch-window"
        : hosting
          ? "host"
          : "lobby";
    void invoke("set_window_layout", { layout }).catch(() => undefined);
  }, [pickerOpen, watching, hosting, watchFullscreen, multiWatch]);

  useEffect(() => {
    localStorage.setItem("telinha-watch-fullscreen", watchFullscreen ? "1" : "0");
  }, [watchFullscreen]);

  useEffect(() => {
    localStorage.setItem("telinha-watch-volume", String(volume));
  }, [volume]);

  const watchedRef = useRef<string[]>([]);
  useEffect(() => {
    const previous = watchedRef.current;
    for (const id of watchingIds) {
      if (!previous.includes(id)) {
        setWatchingShare(id, true);
      }
    }
    for (const id of previous) {
      if (!watchingIds.includes(id)) {
        setWatchingShare(id, false);
      }
    }
    watchedRef.current = watchingIds;
  }, [setWatchingShare, watchingIds]);

  useEffect(() => {
    return () => {
      for (const id of watchedRef.current) {
        setWatchingShare(id, false);
      }
    };
  }, [setWatchingShare]);

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
          setWatchingIds([]);
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
  const localViewers = watcherCounts[localId] ?? 0;

  function watchShare(id: string) {
    setWatchingIds((current) =>
      current.includes(id) ? removeWatching(current, id) : addWatching(current, id),
    );
  }

  function stopWatching(id?: string) {
    if (!id) {
      setWatchingIds([]);
      return;
    }
    setWatchingIds((current) => removeWatching(current, id));
  }

  function watchLabel(id: string) {
    if (watchingIds.includes(id)) return "Assistindo";
    return watchingIds.length > 0 ? "Assistir junto" : "Assistir";
  }

  function watchAll() {
    setWatchingIds(remoteShares.map((share) => share.participantIdentity));
  }

  function toggleMute(id: string) {
    setMutedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function toggleRoomSounds() {
    const next = !roomSounds;
    setRoomSounds(next);
    setSoundsEnabled(next);
  }

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

  if (watching) {
    return (
      <div
        className={`screen room-screen watching ${watchFullscreen ? "watching-full" : "watching-window"} ${multiWatch ? "watching-mosaic" : ""} ${chromeVisible ? "chrome-on" : "chrome-off"}`}
      >
        {watchingShares.map((share) => (
          <WatchAudio
            key={share.participantIdentity}
            stream={share.stream}
            volume={volume}
            muted={mutedIds.includes(share.participantIdentity)}
          />
        ))}
        {isSharing && (
          <div className="host-live-bar">
            <span>Você está no ar · {localViewers} assistindo</span>
            <button type="button" className="btn btn-danger" onClick={() => void stopShare()}>
              Parar
            </button>
          </div>
        )}
        <header className="watch-chrome top">
          <div className="live-badges">
            {watchingShares.map((share) => (
              <div key={share.participantIdentity} className="live-badge">
                {share.participantName} · {watcherCounts[share.participantIdentity] ?? 0} assistindo
              </div>
            ))}
          </div>
        </header>

        <div
          className={`video-area ${multiWatch ? "mosaic" : ""}`}
          data-count={watchingShares.length}
          style={
            multiWatch
              ? { gridTemplateColumns: `repeat(${mosaicColumns(watchingShares.length)}, minmax(0, 1fr))` }
              : undefined
          }
        >
          {watchingShares.map((share) => (
            <div key={share.participantIdentity} className="watch-pane">
              <VideoTile stream={share.stream} active />
              {multiWatch && <span className="watch-pane-name">{share.participantName}</span>}
              <div className="watch-pane-actions">
                <button
                  type="button"
                  className="watch-pane-close"
                  onClick={() => toggleMute(share.participantIdentity)}
                >
                  {mutedIds.includes(share.participantIdentity) ? "Som" : "Mudo"}
                </button>
                {multiWatch && (
                  <button
                    type="button"
                    className="watch-pane-close"
                    onClick={() => stopWatching(share.participantIdentity)}
                  >
                    Fechar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {remoteShares.length > 1 && (
          <div className="share-tabs overlay-tabs">
            {remoteShares.map((share) => (
              <button
                key={share.participantIdentity}
                type="button"
                className={`share-tab ${watchingIds.includes(share.participantIdentity) ? "active" : ""}`}
                onClick={() => watchShare(share.participantIdentity)}
              >
                {share.participantName}
                {watchingIds.includes(share.participantIdentity) || watchingIds.length === 0
                  ? ""
                  : " · junto"}
              </button>
            ))}
            {watchingIds.length < remoteShares.length && (
              <button type="button" className="share-tab" onClick={watchAll}>
                Assistir todas
              </button>
            )}
          </div>
        )}

        <footer className="watch-chrome bottom">
          <VolumeControl
            volume={volume}
            onChange={setVolume}
            onInteract={() => setChromeVisible(true)}
          />
          <div className="watch-actions">
            <button type="button" className="btn btn-ghost" onClick={toggleRoomSounds}>
              {roomSounds ? "Sons ligados" : "Sons mudos"}
            </button>
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
            <button type="button" className="btn btn-secondary" onClick={() => stopWatching()}>
              Parar de assistir
            </button>
          </div>
          <button type="button" className="btn btn-ghost watch-leave" onClick={onLeave}>
            Sair da sala
          </button>
        </footer>

        {error && <p className="error overlay-error">{error}</p>}
        <ToastStack
          toasts={toasts}
          onWatch={(id) => {
            watchShare(id);
            setToasts((current) => current.filter((toast) => toast.shareId !== id));
          }}
        />
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

        {remoteShares.length > 0 && (
          <div className="watch-list host-watch-list">
            {remoteShares.map((share) => (
              <div key={share.participantIdentity} className="watch-row">
                <span>{share.participantName} está no ar</span>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => watchShare(share.participantIdentity)}
                >
                  {watchLabel(share.participantIdentity)}
                </button>
              </div>
            ))}
            {remoteShares.length > 1 && (
              <button type="button" className="btn btn-secondary" onClick={watchAll}>
                Assistir todas
              </button>
            )}
          </div>
        )}

        <div className="sharing-bar">
          <span>
            {localViewers} assistindo
            {watcherNames[localId]?.length ? ` · ${watcherNames[localId]!.join(", ")}` : ""}
          </span>
          <div className="host-bar-actions">
            <button type="button" className="btn btn-danger" onClick={() => void stopShare()}>
              Parar
            </button>
            <button type="button" className="btn btn-ghost" onClick={onLeave}>
              Sair da sala
            </button>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <ToastStack toasts={toasts} onWatch={watchShare} />
      </div>
    );
  }

  return (
    <div className="screen room-screen lobby-screen">
      <header className="room-header">
        <span className={`status ${connected ? "online" : ""}`}>
          {connected ? displayName : reconnecting ? "Reconectando..." : "Conectando..."}
        </span>
        <button type="button" className="btn btn-ghost" onClick={toggleRoomSounds}>
          {roomSounds ? "Sons ligados" : "Sons mudos"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onLeave}>
          Sair
        </button>
      </header>

      {reconnecting && <p className="reconnect-banner">A conexão caiu. Tentando de novo...</p>}

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
                onClick={() => watchShare(share.participantIdentity)}
              >
                {watchLabel(share.participantIdentity)}
              </button>
            </div>
          ))}
          {remoteShares.length > 1 && (
            <button type="button" className="btn btn-secondary" onClick={watchAll}>
              Assistir todas
            </button>
          )}
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
        <span className="shortcut-hint">Ctrl+Shift+S</span>
      </footer>

      {error && <p className="error">{error}</p>}
      <ToastStack toasts={toasts} onWatch={watchShare} />
    </div>
  );
}

function ToastStack({
  toasts,
  onWatch,
}: {
  toasts: RoomToast[];
  onWatch: (shareId: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="room-toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`room-toast ${toast.kind}`}>
          <span>
            {toast.kind === "live" ? `${toast.name} começou a transmitir` : `${toast.name} encerrou`}
          </span>
          {toast.kind === "live" && toast.shareId && (
            <button type="button" className="btn btn-primary" onClick={() => onWatch(toast.shareId!)}>
              Assistir
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function WatchAudio({
  stream,
  volume,
  muted,
}: {
  stream: MediaStream;
  volume: number;
  muted?: boolean;
}) {
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(muted);
  volumeRef.current = volume;
  mutedRef.current = muted;

  useEffect(() => {
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) return;
    const element = document.createElement("audio");
    element.autoplay = true;
    element.setAttribute("playsinline", "true");
    element.srcObject = new MediaStream(tracks);
    element.volume = volumeRef.current / 100;
    element.muted = Boolean(mutedRef.current);
    document.body.appendChild(element);
    elementRef.current = element;
    return () => {
      element.srcObject = null;
      element.remove();
      if (elementRef.current === element) {
        elementRef.current = null;
      }
    };
  }, [stream]);

  useEffect(() => {
    if (elementRef.current) {
      elementRef.current.volume = volume / 100;
      elementRef.current.muted = Boolean(muted);
    }
  }, [muted, volume]);

  return null;
}
