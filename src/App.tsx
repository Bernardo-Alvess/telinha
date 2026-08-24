import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { enterRoom, type RoomSession } from "./api";
import { HomeScreen } from "./components/HomeScreen";
import { RoomScreen } from "./components/RoomScreen";
import { actionFromUrls } from "./deepLink";
import "./App.css";

const NAME_KEY = "telinha-display-name";

interface PendingInvite {
  code: string;
  name?: string;
}

function displayName(override?: string): string {
  return override?.trim() || localStorage.getItem(NAME_KEY)?.trim() || "Amigo";
}

function App() {
  const [session, setSession] = useState<RoomSession | null>(null);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);
  const [pendingShare, setPendingShare] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!session) {
      void invoke("set_window_layout", { layout: "home" }).catch(() => undefined);
    }
  }, [session]);

  useEffect(() => {
    function applyUrls(urls: string[]) {
      const action = actionFromUrls(urls);
      if (!action) return;
      if (action.action === "join") {
        setJoinError(null);
        setPendingInvite({ code: action.code, name: action.name });
        void invoke("show_main_window").catch(() => undefined);
      }
      if (action.action === "share") {
        if (sessionRef.current) {
          setPendingShare(true);
        }
        void invoke("show_main_window").catch(() => undefined);
      }
      if (action.action === "open") {
        void invoke("show_main_window").catch(() => undefined);
      }
    }

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen<string[]>("telinha-open-url", (event) => {
      applyUrls(event.payload);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => undefined);

    void import("@tauri-apps/plugin-deep-link")
      .then(async (deepLink) => {
        if (cancelled) return;
        const current = await deepLink.getCurrent();
        if (current?.length) {
          applyUrls(current);
        }
        const stop = await deepLink.onOpenUrl((urls) => applyUrls(urls));
        if (cancelled) {
          stop();
          return;
        }
        const previous = unlisten;
        unlisten = () => {
          stop();
          previous?.();
        };
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!pendingCode) return;
    let cancelled = false;
    void enterRoom(pendingCode, displayName())
      .then((next) => {
        if (!cancelled) {
          setSession(next);
          setPendingCode(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setJoinError(err.message);
          setPendingCode(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pendingCode]);

  function acceptInvite(invite: PendingInvite) {
    if (invite.name) {
      localStorage.setItem(NAME_KEY, invite.name.slice(0, 24));
    }
    setPendingInvite(null);
    setJoinError(null);
    setSession(null);
    setPendingShare(false);
    setPendingCode(invite.code);
  }

  const inviteBanner = pendingInvite ? (
    <div className="notice">
      <strong>Entrar na sala {pendingInvite.code}?</strong>
      <p>
        {session
          ? `Você já está em ${session.code}. Confirmar troca para a sala ${pendingInvite.code} como ${displayName(pendingInvite.name)}.`
          : `Abrir a Telinha como ${displayName(pendingInvite.name)}.`}
      </p>
      <div className="notice-actions">
        <button type="button" className="btn btn-secondary" onClick={() => setPendingInvite(null)}>
          Agora não
        </button>
        <button type="button" className="btn btn-primary" onClick={() => acceptInvite(pendingInvite)}>
          Entrar
        </button>
      </div>
    </div>
  ) : null;

  if (session) {
    return (
      <div className="app-shell">
        {inviteBanner ? <div className="notice-overlay">{inviteBanner}</div> : null}
        <RoomScreen
          session={session}
          onLeave={() => {
            setSession(null);
            setPendingShare(false);
          }}
          openPicker={pendingShare}
          onPickerOpened={() => setPendingShare(false)}
        />
      </div>
    );
  }

  return (
    <HomeScreen onJoin={setSession} error={joinError} invite={inviteBanner} />
  );
}

export default App;
