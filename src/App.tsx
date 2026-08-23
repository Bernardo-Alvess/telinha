import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RoomSession } from "./api";
import { HomeScreen } from "./components/HomeScreen";
import { RoomScreen } from "./components/RoomScreen";
import "./App.css";

function App() {
  const [session, setSession] = useState<RoomSession | null>(null);

  useEffect(() => {
    if (!session) {
      void invoke("set_window_layout", { layout: "home" }).catch(() => undefined);
    }
  }, [session]);

  if (session) {
    return <RoomScreen session={session} onLeave={() => setSession(null)} />;
  }

  return <HomeScreen onJoin={setSession} />;
}

export default App;
