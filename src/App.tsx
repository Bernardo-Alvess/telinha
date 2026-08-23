import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { joinRoom, type RoomSession } from "./api";
import { HomeScreen } from "./components/HomeScreen";
import { RoomScreen } from "./components/RoomScreen";
import { actionFromUrls } from "./deepLink";
import "./App.css";

const NAME_KEY = "telinha-display-name";

function displayName(): string {
  return localStorage.getItem(NAME_KEY)?.trim() || "Amigo";
}

function App() {
  const [session, setSession] = useState<RoomSession | null>(null);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [pendingShare, setPendingShare] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

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
        setPendingCode(action.code);
        void invoke("show_main_window").catch(() => undefined);
      }
      if (action.action === "share") {
        setPendingShare(true);
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
    void joinRoom(pendingCode, displayName())
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

  if (session) {
    return (
      <RoomScreen
        session={session}
        onLeave={() => {
          setSession(null);
          setPendingShare(false);
        }}
        openPicker={pendingShare}
        onPickerOpened={() => setPendingShare(false)}
      />
    );
  }

  return <HomeScreen onJoin={setSession} error={joinError} />;
}

export default App;
