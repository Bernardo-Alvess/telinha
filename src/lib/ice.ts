export interface IceEnv {
  VITE_TURN_URL?: string;
  VITE_TURN_USERNAME?: string;
  VITE_TURN_CREDENTIAL?: string;
}

export interface SessionIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const PUBLIC_STUN: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

export function buildIceServers(env: IceEnv = {}, sessionServers: SessionIceServer[] = []): RTCIceServer[] {
  const turnUrl = env.VITE_TURN_URL?.trim();
  if (turnUrl) {
    return [
      ...PUBLIC_STUN,
      {
        urls: turnUrl,
        username: env.VITE_TURN_USERNAME?.trim() || undefined,
        credential: env.VITE_TURN_CREDENTIAL?.trim() || undefined,
      },
    ];
  }
  return [...PUBLIC_STUN, ...sessionServers.map(toRtcIceServer)];
}

function toRtcIceServer(server: SessionIceServer): RTCIceServer {
  return {
    urls: server.urls,
    username: server.username,
    credential: server.credential,
  };
}
