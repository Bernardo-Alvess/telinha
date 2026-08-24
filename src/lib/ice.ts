export interface IceEnv {
  VITE_TURN_URL?: string;
  VITE_TURN_USERNAME?: string;
  VITE_TURN_CREDENTIAL?: string;
}

export function buildIceServers(env: IceEnv = {}): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  const turnUrl = env.VITE_TURN_URL?.trim();
  if (!turnUrl) {
    return servers;
  }
  servers.push({
    urls: turnUrl,
    username: env.VITE_TURN_USERNAME?.trim() || undefined,
    credential: env.VITE_TURN_CREDENTIAL?.trim() || undefined,
  });
  return servers;
}
