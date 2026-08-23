import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";

const envDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(envDir, "../.env") });
dotenv.config();

const PORT = Number(process.env.PORT ?? 3001);
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

interface ClientMessage {
  type: string;
  to?: string;
  sdp?: string;
  candidate?: unknown;
}

interface Participant {
  id: string;
  name: string;
  sharing: boolean;
  ws: WebSocket;
}

interface Room {
  createdAt: number;
  participants: Map<string, Participant>;
}

const rooms = new Map<string, Room>();

function generateCode(): string {
  let code = "";
  const bytes = randomBytes(CODE_LENGTH);
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[bytes[i]! % CODE_CHARS.length];
  }
  if (rooms.has(code)) {
    return generateCode();
  }
  return code;
}

function sanitizeDisplayName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().slice(0, 24) : "";
  return name || "Amigo";
}

function createParticipantId(): string {
  return `user-${randomBytes(4).toString("hex")}`;
}

function publicParticipant(participant: Participant) {
  return {
    id: participant.id,
    name: participant.name,
    sharing: participant.sharing,
  };
}

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(room: Room, payload: unknown, exceptId?: string) {
  for (const participant of room.participants.values()) {
    if (participant.id !== exceptId) {
      send(participant.ws, payload);
    }
  }
}

function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

function removeParticipant(code: string, participantId: string) {
  const room = getRoom(code);
  if (!room) return;
  const participant = room.participants.get(participantId);
  if (!participant) return;
  room.participants.delete(participantId);
  broadcast(room, { type: "participant-left", participantId });
  if (room.participants.size === 0) {
    rooms.delete(code.toUpperCase());
  }
}

function wsUrlFromRequest(req: express.Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? req.protocol;
  const host = req.headers.host ?? `localhost:${PORT}`;
  const wsProto = proto === "https" ? "wss" : "ws";
  return `${wsProto}://${host}/ws`;
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "telinha-server" });
});

app.post("/rooms", (req, res) => {
  const displayName = sanitizeDisplayName(req.body?.displayName);
  const code = generateCode();
  const participantId = createParticipantId();
  rooms.set(code, { createdAt: Date.now(), participants: new Map() });
  res.json({
    code,
    participantId,
    displayName,
    wsUrl: wsUrlFromRequest(req),
  });
});

app.post("/rooms/:code/join", (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    res.status(404).json({ error: "Sala não encontrada. Verifique o código." });
    return;
  }
  const displayName = sanitizeDisplayName(req.body?.displayName);
  const participantId = createParticipantId();
  res.json({
    code,
    participantId,
    displayName,
    wsUrl: wsUrlFromRequest(req),
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/ws", "http://localhost");
  const code = (url.searchParams.get("code") ?? "").toUpperCase();
  const participantId = url.searchParams.get("participantId") ?? "";
  const displayName = sanitizeDisplayName(url.searchParams.get("name"));
  const room = rooms.get(code);

  if (!room || !participantId) {
    send(ws, { type: "error", message: "Sala inválida." });
    ws.close();
    return;
  }

  if (room.participants.has(participantId)) {
    send(ws, { type: "error", message: "Essa sessão já está conectada." });
    ws.close();
    return;
  }

  const participant: Participant = {
    id: participantId,
    name: displayName,
    sharing: false,
    ws,
  };
  room.participants.set(participantId, participant);

  send(ws, {
    type: "hello",
    you: publicParticipant(participant),
    participants: [...room.participants.values()].map(publicParticipant),
  });
  broadcast(room, { type: "participant-joined", participant: publicParticipant(participant) }, participantId);

  ws.on("message", (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return;
    }

    const current = room.participants.get(participantId);
    if (!current) return;

    if (message.type === "share-started") {
      current.sharing = true;
      broadcast(room, { type: "share-started", participantId, name: current.name }, participantId);
      return;
    }

    if (message.type === "share-stopped") {
      current.sharing = false;
      broadcast(room, { type: "share-stopped", participantId }, participantId);
      return;
    }

    if (
      (message.type === "offer" || message.type === "answer" || message.type === "ice") &&
      typeof message.to === "string"
    ) {
      const target = room.participants.get(message.to);
      if (!target) return;
      send(target.ws, {
        type: message.type,
        from: participantId,
        sdp: message.sdp,
        candidate: message.candidate,
      });
    }
  });

  ws.on("close", () => {
    removeParticipant(code, participantId);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL_MS && room.participants.size === 0) {
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Telinha server rodando em http://0.0.0.0:${PORT}`);
});
