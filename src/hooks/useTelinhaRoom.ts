import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { enterRoom, pingHealth, signalingUrl, type RoomSession } from "../lib/api";
import { buildIceServers } from "../lib/ice";
import { playStreamStarted, playViewerJoined } from "../lib/sounds";
import { startDisplayMediaShare } from "../media/displayShare";
import { createShareAudioPump, createShareAudioTrack } from "../media/shareAudio";

export enum ConnectionState {
  Disconnected = "disconnected",
  Connecting = "connecting",
  Connected = "connected",
  Reconnecting = "reconnecting",
}

export interface ScreenShareInfo {
  participantIdentity: string;
  participantName: string;
  stream: MediaStream;
}

export interface RoomPerson {
  identity: string;
  name: string;
  isSharing: boolean;
  isLocal: boolean;
}

export interface ShareQuality {
  fps: number;
  maxWidth: number;
  maxHeight?: number;
  maxBitrate?: number;
  includeAudio: boolean;
  useGpuEncode: boolean;
}

interface SignalMessage {
  type: string;
  from?: string;
  to?: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  message?: string;
  you?: { id: string; name: string; sharing: boolean };
  participant?: { id: string; name: string; sharing: boolean };
  participants?: { id: string; name: string; sharing: boolean }[];
  participantId?: string;
  name?: string;
}

const ICE_SERVERS: RTCIceServer[] = buildIceServers(import.meta.env);
const ICE_CONFIG: RTCConfiguration = {
  iceServers: ICE_SERVERS,
  iceCandidatePoolSize: 4,
};

const VIDEO_MAX_BITRATE = 10_000_000;
const AUDIO_MAX_BITRATE = 320_000;
const P2P_BLOCKED_MESSAGE =
  "Não foi possível conectar direto. A rede pode estar bloqueando o P2P.";
const SIGNAL_PING_MS = 20_000;
const HEALTH_PING_MS = 120_000;
const MAX_RESEATS = 6;

export function useTelinhaRoom(
  session: RoomSession | null,
  options?: { onSessionRefresh?: (next: RoomSession) => void },
) {
  const wsRef = useRef<WebSocket | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const peopleRef = useRef<Map<string, RoomPerson>>(new Map());
  const unlistensRef = useRef<UnlistenFn[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioNodeRef = useRef<AudioNode | null>(null);
  const audioPortRef = useRef<MessagePort | null>(null);
  const sharingRef = useRef(false);
  const useGpuEncodeRef = useRef(true);
  const shareFpsRef = useRef(60);
  const shareBitrateRef = useRef(VIDEO_MAX_BITRATE);
  const stopShareRef = useRef<() => Promise<void>>(async () => undefined);
  const reseatCountRef = useRef(0);
  const onSessionRefresh = options?.onSessionRefresh;

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.Disconnected,
  );
  const [isSharing, setIsSharing] = useState(false);
  const [screenShares, setScreenShares] = useState<ScreenShareInfo[]>([]);
  const [participants, setParticipants] = useState<RoomPerson[]>([]);
  const [watcherCounts, setWatcherCounts] = useState<Record<string, number>>({});
  const [watcherNames, setWatcherNames] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const watchersRef = useRef<Map<string, Map<string, string>>>(new Map());

  const publishPeople = useCallback(() => {
    setParticipants([...peopleRef.current.values()]);
  }, []);

  const publishWatchers = useCallback(() => {
    const counts: Record<string, number> = {};
    const names: Record<string, string[]> = {};
    for (const [shareId, watchers] of watchersRef.current) {
      counts[shareId] = watchers.size;
      names[shareId] = [...watchers.values()];
    }
    setWatcherCounts(counts);
    setWatcherNames(names);
  }, []);

  const publishShares = useCallback((localId: string, localName: string) => {
    const shares: ScreenShareInfo[] = [];
    if (localStreamRef.current && sharingRef.current) {
      shares.push({
        participantIdentity: localId,
        participantName: localName,
        stream: localStreamRef.current,
      });
    }
    for (const [id, stream] of remoteStreamsRef.current) {
      const person = peopleRef.current.get(id);
      shares.push({
        participantIdentity: id,
        participantName: person?.name ?? id,
        stream,
      });
    }
    setScreenShares(shares);
  }, []);

  const sendSignal = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const closePeer = useCallback((peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.close();
      peersRef.current.delete(peerId);
    }
    pendingIceRef.current.delete(peerId);
    remoteStreamsRef.current.delete(peerId);
  }, []);

  const closeAllPeers = useCallback(() => {
    for (const id of [...peersRef.current.keys()]) {
      closePeer(id);
    }
  }, [closePeer]);

  const applyBitrate = useCallback(async (peer: RTCPeerConnection) => {
    preferVideoCodecs(peer, useGpuEncodeRef.current);
    for (const sender of peer.getSenders()) {
      const kind = sender.track?.kind;
      if (kind !== "video" && kind !== "audio") continue;
      const maxBitrate = kind === "video" ? shareBitrateRef.current : AUDIO_MAX_BITRATE;
      const params = sender.getParameters();
      params.degradationPreference = "maintain-framerate";
      const encoding = {
        maxBitrate,
        ...(kind === "video" ? { priority: "high" as const } : {}),
      };
      params.encodings = params.encodings?.length
        ? params.encodings.map((current) => ({
            ...current,
            ...encoding,
          }))
        : [encoding];
      try {
        await sender.setParameters(params);
      } catch {
      }
    }
  }, []);

  const flushIce = useCallback(async (peerId: string, peer: RTCPeerConnection) => {
    const queued = pendingIceRef.current.get(peerId) ?? [];
    pendingIceRef.current.delete(peerId);
    for (const candidate of queued) {
      try {
        await peer.addIceCandidate(candidate);
      } catch {
      }
    }
  }, []);

  const getOrCreatePeer = useCallback(
    (peerId: string, localId: string, localName: string) => {
      const existing = peersRef.current.get(peerId);
      if (existing && existing.connectionState !== "closed" && existing.connectionState !== "failed") {
        return existing;
      }
      if (existing) {
        closePeer(peerId);
      }

      const peer = new RTCPeerConnection(ICE_CONFIG);
      peersRef.current.set(peerId, peer);
      let iceRestarted = false;

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal({ type: "ice", to: peerId, candidate: event.candidate.toJSON() });
        }
      };

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          iceRestarted = false;
          setError((current) => (current === P2P_BLOCKED_MESSAGE ? null : current));
          return;
        }
        if (peer.connectionState !== "failed") {
          return;
        }
        if (!iceRestarted && sharingRef.current) {
          iceRestarted = true;
          void (async () => {
            try {
              const offer = await peer.createOffer({ iceRestart: true });
              await peer.setLocalDescription(offer);
              sendSignal({ type: "offer", to: peerId, sdp: offer.sdp });
            } catch {
              setError(P2P_BLOCKED_MESSAGE);
            }
          })();
          return;
        }
        setError(P2P_BLOCKED_MESSAGE);
      };

      peer.ontrack = (event) => {
        markVideoMotion(event.track);
        const [stream] = event.streams;
        if (stream) {
          remoteStreamsRef.current.set(peerId, stream);
        } else {
          const held = remoteStreamsRef.current.get(peerId) ?? new MediaStream();
          held.addTrack(event.track);
          remoteStreamsRef.current.set(peerId, held);
        }
        publishShares(localId, localName);
      };

      const local = localStreamRef.current;
      if (local) {
        for (const track of local.getTracks()) {
          if (!peer.getSenders().some((sender) => sender.track === track)) {
            peer.addTrack(track, local);
          }
        }
        preferVideoCodecs(peer, useGpuEncodeRef.current);
      }

      return peer;
    },
    [closePeer, publishShares, sendSignal],
  );

  const offerTo = useCallback(
    async (peerId: string, localId: string, localName: string) => {
      const peer = getOrCreatePeer(peerId, localId, localName);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      sendSignal({ type: "offer", to: peerId, sdp: offer.sdp });
      await applyBitrate(peer);
    },
    [applyBitrate, getOrCreatePeer, sendSignal],
  );

  const offerToEveryone = useCallback(
    async (localId: string, localName: string) => {
      const others = [...peopleRef.current.values()].filter((person) => !person.isLocal);
      await Promise.all(others.map((person) => offerTo(person.identity, localId, localName)));
    },
    [offerTo],
  );

  const cleanupNativeShare = useCallback(async () => {
    for (const unlisten of unlistensRef.current) {
      unlisten();
    }
    unlistensRef.current = [];
    audioPortRef.current = null;
    try {
      await invoke("stop_share_capture");
    } catch {
    }

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
    }
    localStreamRef.current = null;

    audioNodeRef.current?.disconnect();
    audioNodeRef.current = null;
    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }

    for (const peer of peersRef.current.values()) {
      for (const sender of peer.getSenders()) {
        try {
          peer.removeTrack(sender);
        } catch {
        }
      }
    }

    sharingRef.current = false;
    setIsSharing(false);
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }

    let closed = false;
    const localId = session.participantId;
    const localName = session.displayName;
    setConnectionState(ConnectionState.Connecting);
    setError(null);
    peopleRef.current = new Map([
      [
        localId,
        { identity: localId, name: localName, isSharing: false, isLocal: true },
      ],
    ]);
    publishPeople();

    let attempts = 0;
    let fatal = false;
    let reseating = false;
    let reconnectTimer: number | undefined;

    const refreshSeat = async () => {
      if (reseating || closed || !onSessionRefresh) {
        return false;
      }
      if (reseatCountRef.current >= MAX_RESEATS) {
        fatal = true;
        setConnectionState(ConnectionState.Disconnected);
        setError("A sala caiu. Saia e peça ao host para abrir de novo, depois entre outra vez.");
        return false;
      }
      reseating = true;
      reseatCountRef.current += 1;
      setConnectionState(ConnectionState.Reconnecting);
      try {
        const next = await enterRoom(session.code, session.displayName);
        if (closed) return false;
        onSessionRefresh(next);
        return true;
      } catch (err) {
        reseating = false;
        setError(err instanceof Error ? err.message : "Não foi possível voltar para a sala.");
        return false;
      }
    };

    const handleMessage = async (event: MessageEvent) => {
      let message: SignalMessage;
      try {
        message = JSON.parse(String(event.data)) as SignalMessage;
      } catch {
        return;
      }

      if (message.type === "pong" || message.type === "ping") {
        return;
      }

      if (message.type === "error") {
        const text = message.message ?? "Erro na sala";
        setError(text);
        if (text.includes("Sala inválida")) {
          const refreshed = await refreshSeat();
          if (refreshed) {
            return;
          }
        } else {
          fatal = true;
          setConnectionState(ConnectionState.Disconnected);
        }
        wsRef.current?.close();
        return;
      }

      if (message.type === "hello" && message.participants) {
        peopleRef.current = new Map(
          message.participants.map((person) => [
            person.id,
            {
              identity: person.id,
              name: person.name,
              isSharing: person.sharing,
              isLocal: person.id === localId,
            },
          ]),
        );
        const local = peopleRef.current.get(localId);
        if (local) {
          local.isSharing = sharingRef.current;
        }
        publishPeople();
        setConnectionState(ConnectionState.Connected);
        setError(null);
        reseatCountRef.current = 0;
        publishShares(localId, localName);
        if (sharingRef.current) {
          sendSignal({ type: "share-started" });
          await offerToEveryone(localId, localName);
        }
        return;
      }

      if (message.type === "participant-joined" && message.participant) {
        peopleRef.current.set(message.participant.id, {
          identity: message.participant.id,
          name: message.participant.name,
          isSharing: message.participant.sharing,
          isLocal: false,
        });
        publishPeople();
        if (sharingRef.current) {
          await offerTo(message.participant.id, localId, localName);
        }
        return;
      }

      if (message.type === "participant-left" && message.participantId) {
        peopleRef.current.delete(message.participantId);
        closePeer(message.participantId);
        watchersRef.current.delete(message.participantId);
        for (const watchers of watchersRef.current.values()) {
          watchers.delete(message.participantId);
        }
        publishWatchers();
        publishPeople();
        publishShares(localId, localName);
        return;
      }

      if (message.type === "share-started" && message.participantId) {
        const person = peopleRef.current.get(message.participantId);
        if (person) {
          person.isSharing = true;
          publishPeople();
        }
        playStreamStarted();
        return;
      }

      if (message.type === "share-stopped" && message.participantId) {
        const person = peopleRef.current.get(message.participantId);
        if (person) {
          person.isSharing = false;
        }
        remoteStreamsRef.current.delete(message.participantId);
        watchersRef.current.delete(message.participantId);
        if (!sharingRef.current) {
          closePeer(message.participantId);
        }
        publishWatchers();
        publishPeople();
        publishShares(localId, localName);
        return;
      }

      if (message.type === "watch-started" && message.from && message.to) {
        const watchers = watchersRef.current.get(message.to) ?? new Map<string, string>();
        watchers.set(
          message.from,
          message.name ?? peopleRef.current.get(message.from)?.name ?? "Alguém",
        );
        watchersRef.current.set(message.to, watchers);
        publishWatchers();
        if (message.to === localId && message.from !== localId) {
          playViewerJoined();
        }
        return;
      }

      if (message.type === "watch-stopped" && message.from && message.to) {
        watchersRef.current.get(message.to)?.delete(message.from);
        publishWatchers();
        return;
      }

      if (message.type === "offer" && message.from && message.sdp) {
        const peer = getOrCreatePeer(message.from, localId, localName);
        await peer.setRemoteDescription({ type: "offer", sdp: message.sdp });
        await flushIce(message.from, peer);
        for (const receiver of peer.getReceivers()) {
          markVideoMotion(receiver.track);
        }
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        sendSignal({ type: "answer", to: message.from, sdp: answer.sdp });
        return;
      }

      if (message.type === "answer" && message.from && message.sdp) {
        const peer = peersRef.current.get(message.from);
        if (!peer) return;
        await peer.setRemoteDescription({ type: "answer", sdp: message.sdp });
        await flushIce(message.from, peer);
        for (const receiver of peer.getReceivers()) {
          markVideoMotion(receiver.track);
        }
        await applyBitrate(peer);
        return;
      }

      if (message.type === "ice" && message.from && message.candidate) {
        const peer = peersRef.current.get(message.from);
        if (!peer || !peer.remoteDescription) {
          const queued = pendingIceRef.current.get(message.from) ?? [];
          queued.push(message.candidate);
          pendingIceRef.current.set(message.from, queued);
          return;
        }
        try {
          await peer.addIceCandidate(message.candidate);
        } catch {
        }
      }
    };

    const attachSocket = (socket: WebSocket) => {
      let pingTimer: number | undefined;
      socket.addEventListener("open", () => {
        if (!closed) {
          attempts = 0;
          setConnectionState(ConnectionState.Connecting);
        }
        pingTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ping" }));
          }
        }, SIGNAL_PING_MS);
      });
      socket.addEventListener("message", (event) => {
        void handleMessage(event);
      });
      socket.addEventListener("close", () => {
        if (pingTimer != null) {
          window.clearInterval(pingTimer);
        }
        if (closed || fatal || reseating) return;
        if (attempts >= 8) {
          void refreshSeat().then((refreshed) => {
            if (!refreshed && !closed) {
              setConnectionState(ConnectionState.Disconnected);
              setError("A conexão caiu e não foi possível reconectar.");
            }
          });
          return;
        }
        setConnectionState(ConnectionState.Reconnecting);
        const delay = Math.min(1000 * 2 ** attempts, 8_000);
        attempts += 1;
        reconnectTimer = window.setTimeout(() => {
          if (closed || reseating) return;
          const next = new WebSocket(signalingUrl(session));
          wsRef.current = next;
          attachSocket(next);
        }, delay);
      });
    };

    const ws = new WebSocket(signalingUrl(session));
    wsRef.current = ws;
    attachSocket(ws);

    const healthTimer = window.setInterval(() => {
      void pingHealth().catch(() => undefined);
    }, HEALTH_PING_MS);
    void pingHealth().catch(() => undefined);

    return () => {
      closed = true;
      window.clearInterval(healthTimer);
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
      }
      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "leave" }));
      }
      closeAllPeers();
      socket?.close();
      wsRef.current = null;
      remoteStreamsRef.current.clear();
      peopleRef.current.clear();
      watchersRef.current.clear();
      setWatcherCounts({});
      setWatcherNames({});
      setScreenShares([]);
      setParticipants([]);
      setConnectionState(ConnectionState.Disconnected);
    };
  }, [
    session?.code,
    session?.participantId,
    session?.token,
    session?.wsUrl,
    session?.displayName,
    applyBitrate,
    closeAllPeers,
    closePeer,
    flushIce,
    getOrCreatePeer,
    offerTo,
    onSessionRefresh,
    publishWatchers,
    offerToEveryone,
    publishPeople,
    publishShares,
    sendSignal,
  ]);

  useEffect(() => {
    return () => {
      void cleanupNativeShare();
    };
  }, [cleanupNativeShare]);

  const startShare = useCallback(
    async (sourceId: string, quality: ShareQuality) => {
      if (!session) return;

      await cleanupNativeShare();
      setError(null);
      useGpuEncodeRef.current = quality.useGpuEncode;
      shareFpsRef.current = quality.fps;
      shareBitrateRef.current = quality.maxBitrate ?? VIDEO_MAX_BITRATE;

      try {
        const stream = await startDisplayMediaShare(quality, sourceId);

        if (quality.includeAudio && stream.getAudioTracks().length === 0) {
          await attachLoopbackAudio(sourceId, {
            unlistensRef,
            audioContextRef,
            audioNodeRef,
            audioPortRef,
          }, stream);
        }

        stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          if (sharingRef.current) {
            void stopShareRef.current();
          }
        });

        localStreamRef.current = stream;
        sharingRef.current = true;
        const local = peopleRef.current.get(session.participantId);
        if (local) {
          local.isSharing = true;
        }
        setIsSharing(true);
        publishPeople();
        publishShares(session.participantId, session.displayName);
        sendSignal({ type: "share-started" });
        await offerToEveryone(session.participantId, session.displayName);
      } catch (error) {
        await cleanupNativeShare();
        setError(error instanceof Error ? error.message : "Não foi possível compartilhar");
        throw error;
      }
    },
    [
      cleanupNativeShare,
      offerToEveryone,
      publishPeople,
      publishShares,
      sendSignal,
      session,
    ],
  );

  const setWatchingShare = useCallback(
    (sharerId: string, watching: boolean) => {
      if (!session || sharerId === session.participantId) return;
      sendSignal({ type: watching ? "watch-started" : "watch-stopped", to: sharerId });
    },
    [sendSignal, session],
  );

  const stopShare = useCallback(async () => {
    if (!session) {
      await cleanupNativeShare();
      return;
    }
    sendSignal({ type: "share-stopped" });
    watchersRef.current.delete(session.participantId);
    publishWatchers();
    await cleanupNativeShare();
    for (const [peerId, person] of peopleRef.current) {
      if (!person.isSharing && !person.isLocal) {
        closePeer(peerId);
      }
    }
    const local = peopleRef.current.get(session.participantId);
    if (local) {
      local.isSharing = false;
    }
    publishPeople();
    publishShares(session.participantId, session.displayName);
  }, [cleanupNativeShare, closePeer, publishPeople, publishShares, publishWatchers, sendSignal, session]);

  stopShareRef.current = stopShare;

  return {
    connectionState,
    isSharing,
    screenShares,
    participants,
    watcherCounts,
    watcherNames,
    startShare,
    stopShare,
    setWatchingShare,
    error,
  };
}

interface AudioShareRefs {
  unlistensRef: MutableRefObject<UnlistenFn[]>;
  audioContextRef: MutableRefObject<AudioContext | null>;
  audioNodeRef: MutableRefObject<AudioNode | null>;
  audioPortRef: MutableRefObject<MessagePort | null>;
}

async function attachLoopbackAudio(
  sourceId: string,
  refs: AudioShareRefs,
  stream: MediaStream,
) {
  const audio = await createShareAudioTrack();
  if (!audio) return;
  refs.audioContextRef.current = audio.context;
  refs.audioNodeRef.current = audio.node;
  refs.audioPortRef.current = audio.port ?? null;
  const pumpAudio = createShareAudioPump(() => refs.audioPortRef.current);
  refs.unlistensRef.current.push(await listen("share-audio", () => {
    void pumpAudio();
  }));
  await invoke("start_share_capture", {
    id: sourceId,
    fps: 15,
    maxWidth: 0,
    includeAudio: true,
    includeVideo: false,
  });
  if (audio.track) {
    stream.addTrack(audio.track);
  }
}

function markVideoMotion(track: MediaStreamTrack | null) {
  if (track && track.kind === "video") {
    track.contentHint = "motion";
  }
}

function codecRank(codec: { mimeType: string; sdpFmtpLine?: string }, wanted: RegExp): number {
  if (wanted.test(codec.mimeType)) {
    const line = `${codec.sdpFmtpLine ?? ""}`;
    if (/profile-level-id=64/i.test(line)) return 0;
    if (/profile-level-id=4d/i.test(line)) return 1;
    return 2;
  }
  if (/rtx|red|ulpfec/i.test(codec.mimeType)) return 20;
  return 10;
}

function preferVideoCodecs(peer: RTCPeerConnection, useGpuEncode: boolean) {
  const capabilities = RTCRtpSender.getCapabilities("video");
  if (!capabilities) return;
  const wanted = useGpuEncode ? /h264/i : /vp8/i;
  const preferred = [...capabilities.codecs].sort(
    (left, right) => codecRank(left, wanted) - codecRank(right, wanted),
  );
  for (const transceiver of peer.getTransceivers()) {
    if (transceiver.sender.track?.kind === "video" || transceiver.receiver.track?.kind === "video") {
      try {
        transceiver.setCodecPreferences(preferred);
      } catch {
      }
    }
  }
}
