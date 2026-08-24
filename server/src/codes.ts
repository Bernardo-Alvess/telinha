export const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

export function normalizeRoomCode(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function isDiscordRoomCode(code: string): boolean {
  return /^D\d{16,22}$/.test(code);
}

export function isValidRoomCode(code: string): boolean {
  return isDiscordRoomCode(code) || /^[A-Z0-9]{4,8}$/.test(code);
}

export function sanitizeDisplayName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().slice(0, 24) : "";
  return name || "Amigo";
}

export function resolvePublicWsUrl(configured: string | undefined): string | undefined {
  if (!configured) {
    return undefined;
  }
  const raw = configured.trim().replace(/\/$/, "");
  if (!raw) {
    return undefined;
  }
  if (raw.endsWith("/ws")) {
    return raw;
  }
  if (raw.startsWith("ws://") || raw.startsWith("wss://")) {
    return `${raw}/ws`;
  }
  if (raw.startsWith("https://")) {
    return `wss://${raw.slice("https://".length)}/ws`;
  }
  if (raw.startsWith("http://")) {
    return `ws://${raw.slice("http://".length)}/ws`;
  }
  return `wss://${raw}/ws`;
}
