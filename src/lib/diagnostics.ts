import { APP_VERSION, PROTOCOL_VERSION } from "./protocol";

export type DiagnosticDetails = Record<string, string | number | boolean | null | undefined>;

interface DiagnosticEvent {
  at: string;
  event: string;
  details?: Record<string, string | number | boolean | null>;
}

const MAX_EVENTS = 100;
const events: DiagnosticEvent[] = [];
const SENSITIVE_KEY = /^(token|sdp|candidate|code|name|url|ip|address)$/i;

export function recordDiagnostic(event: string, details?: DiagnosticDetails): void {
  const safeDetails = details ? sanitizeDiagnosticDetails(details) : undefined;
  events.push({ at: new Date().toISOString(), event: event.slice(0, 80), details: safeDetails });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export function buildDiagnostics(): string {
  return JSON.stringify(
    {
      appVersion: APP_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      generatedAt: new Date().toISOString(),
      events,
    },
    null,
    2,
  );
}

export function clearDiagnostics(): void {
  events.length = 0;
}

export function sanitizeDiagnosticDetails(
  details: DiagnosticDetails,
): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SENSITIVE_KEY.test(key) || value === undefined) continue;
    safe[key] = typeof value === "string" ? value.slice(0, 240) : value;
  }
  return safe;
}
