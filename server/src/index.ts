import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { AccessToken } from "livekit-server-sdk";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(envDir, "../.env") });
dotenv.config();

const PORT = Number(process.env.PORT ?? 3001);
const LIVEKIT_URL = process.env.LIVEKIT_URL ?? "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? "";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;

interface RoomEntry {
  roomName: string;
  createdAt: number;
}

const rooms = new Map<string, RoomEntry>();

function isPlaceholder(value: string) {
  return /your[_-]?project|your_api_/i.test(value);
}

function requireLiveKitConfig() {
  if (
    !LIVEKIT_URL ||
    !LIVEKIT_API_KEY ||
    !LIVEKIT_API_SECRET ||
    isPlaceholder(LIVEKIT_URL) ||
    isPlaceholder(LIVEKIT_API_KEY) ||
    isPlaceholder(LIVEKIT_API_SECRET)
  ) {
    throw new Error(
      "Configure LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET no arquivo server/.env",
    );
  }
}

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

function createRoomName(code: string): string {
  return `telinha-${code.toLowerCase()}`;
}

function sanitizeDisplayName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().slice(0, 24) : "";
  return name || "Amigo";
}

function createParticipantIdentity(): string {
  return `user-${randomBytes(4).toString("hex")}`;
}

async function createAccessToken(roomName: string, identity: string, displayName: string) {
  requireLiveKitConfig();

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name: displayName,
    ttl: "6h",
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return at.toJwt();
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "telinha-server" });
});

app.post("/rooms", async (req, res) => {
  try {
    requireLiveKitConfig();
    const displayName = sanitizeDisplayName(req.body?.displayName);
    const code = generateCode();
    const roomName = createRoomName(code);
    const participantName = createParticipantIdentity();

    rooms.set(code, { roomName, createdAt: Date.now() });

    const token = await createAccessToken(roomName, participantName, displayName);

    res.json({
      code,
      roomName,
      participantName,
      displayName,
      livekitUrl: LIVEKIT_URL,
      token,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao criar sala";
    res.status(500).json({ error: message });
  }
});

app.post("/rooms/:code/join", async (req, res) => {
  try {
    requireLiveKitConfig();
    const code = req.params.code.toUpperCase();
    const entry = rooms.get(code);

    if (!entry) {
      res.status(404).json({ error: "Sala não encontrada. Verifique o código." });
      return;
    }

    const displayName = sanitizeDisplayName(req.body?.displayName);
    const participantName = createParticipantIdentity();
    const token = await createAccessToken(entry.roomName, participantName, displayName);

    res.json({
      code,
      roomName: entry.roomName,
      participantName,
      displayName,
      livekitUrl: LIVEKIT_URL,
      token,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao entrar na sala";
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Telinha server rodando em http://0.0.0.0:${PORT}`);
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    console.warn(
      "Aviso: LiveKit não configurado. Copie server/.env.example para server/.env",
    );
  }
});
