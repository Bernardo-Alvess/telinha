export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface RoomSession {
  code: string;
  participantId: string;
  token: string;
  displayName: string;
  wsUrl: string;
}

export class RoomNotFoundError extends Error {
  constructor(message = "Sala não encontrada.") {
    super(message);
    this.name = "RoomNotFoundError";
  }
}

export function isDiscordRoomCode(code: string): boolean {
  return /^D\d{16,22}$/.test(code);
}

export function signalingUrl(session: RoomSession): string {
  const url = new URL(session.wsUrl);
  url.searchParams.set("code", session.code);
  url.searchParams.set("participantId", session.participantId);
  url.searchParams.set("token", session.token);
  return url.toString();
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { error: text.slice(0, 120) };
  }
}

function parseRoomSession(data: Record<string, unknown>): RoomSession {
  const { code, participantId, token, displayName, wsUrl } = data;
  if (
    typeof code !== "string" ||
    typeof participantId !== "string" ||
    typeof token !== "string" ||
    typeof displayName !== "string" ||
    typeof wsUrl !== "string" ||
    !code ||
    !participantId ||
    !token ||
    !wsUrl
  ) {
    throw new Error("Resposta inválida do servidor");
  }
  return { code, participantId, token, displayName, wsUrl };
}

async function roomRequest(path: string, body: Record<string, string>): Promise<RoomSession> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readJson(response);
  if (response.status === 404) {
    throw new RoomNotFoundError(typeof data.error === "string" ? data.error : undefined);
  }
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Falha ao falar com o servidor");
  }
  return parseRoomSession(data);
}

export async function createRoom(
  displayName: string,
  options?: { code?: string },
): Promise<RoomSession> {
  const body: Record<string, string> = { displayName };
  if (options?.code) {
    body.code = options.code;
  }
  return roomRequest("/rooms", body);
}

export async function joinRoom(code: string, displayName: string): Promise<RoomSession> {
  return roomRequest(`/rooms/${encodeURIComponent(code)}/join`, { displayName });
}

export async function pingHealth(): Promise<void> {
  await fetch(`${API_URL}/health`, { method: "GET", cache: "no-store" });
}

export async function enterRoom(code: string, displayName: string): Promise<RoomSession> {
  try {
    return await joinRoom(code, displayName);
  } catch (error) {
    if (error instanceof RoomNotFoundError && isDiscordRoomCode(code)) {
      return createRoom(displayName, { code });
    }
    throw error;
  }
}

export function parseTelinhaUrl(raw: string): { action: "join" | "open" | "share"; code?: string; name?: string } | null {
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
      const name = url.searchParams.get("name")?.trim() || undefined;
      return code ? { action: "join", code, name } : { action: "open" };
    }
    if (host === "share" || rest.startsWith("share")) {
      return { action: "share" };
    }
    return { action: "open" };
  } catch {
    return null;
  }
}
