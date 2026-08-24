export interface IceEnv {
  VITE_TURN_URL?: string;
  VITE_TURN_USERNAME?: string;
  VITE_TURN_CREDENTIAL?: string;
}

const PUBLIC_STUN: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

const OPEN_RELAY_TURN: RTCIceServer[] = [
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

export function buildIceServers(env: IceEnv = {}): RTCIceServer[] {
  const servers: RTCIceServer[] = [...PUBLIC_STUN];
  const turnUrl = env.VITE_TURN_URL?.trim();
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: env.VITE_TURN_USERNAME?.trim() || undefined,
      credential: env.VITE_TURN_CREDENTIAL?.trim() || undefined,
    });
    return servers;
  }
  servers.push(...OPEN_RELAY_TURN);
  return servers;
}
