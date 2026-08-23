export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface RoomSession {
  code: string;
  participantId: string;
  displayName: string;
  wsUrl: string;
}

export function signalingUrl(session: RoomSession): string {
  const url = new URL(session.wsUrl);
  url.searchParams.set("code", session.code);
  url.searchParams.set("participantId", session.participantId);
  url.searchParams.set("name", session.displayName);
  return url.toString();
}

export async function createRoom(displayName: string): Promise<RoomSession> {
  const response = await fetch(`${API_URL}/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Falha ao criar sala");
  }
  return data;
}

export async function joinRoom(code: string, displayName: string): Promise<RoomSession> {
  const response = await fetch(`${API_URL}/rooms/${encodeURIComponent(code)}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Falha ao entrar na sala");
  }
  return data;
}

export function parseTelinhaUrl(raw: string): { action: "join" | "open" | "share"; code?: string } | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "telinha:") {
      return null;
    }
    const host = url.hostname || url.pathname.replace(/^\/+/, "").split("/")[0] || "";
    const rest = url.pathname.replace(/^\/+/, "");
    if (host === "join" || rest.startsWith("join")) {
      const fromPath = host === "join" ? rest : rest.replace(/^join\/?/, "");
      const code = (url.searchParams.get("code") ?? fromPath).replace(/[^A-Z0-9]/gi, "").toUpperCase();
      return code ? { action: "join", code } : { action: "open" };
    }
    if (host === "share" || rest.startsWith("share")) {
      return { action: "share" };
    }
    return { action: "open" };
  } catch {
    return null;
  }
}
