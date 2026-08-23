export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface RoomSession {
  code: string;
  roomName: string;
  participantName: string;
  displayName: string;
  livekitUrl: string;
  token: string;
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
