import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { signalingUrl, type RoomSession } from "../lib/api";
import { buildIceServers } from "../lib/ice";
import { playStreamStarted, playViewerJoined } from "../lib/sounds";
import { startDisplayMediaShare } from "../media/displayShare";
import { createShareAudioTrack } from "../media/shareAudio";
import { createVideoSink, decodeShareJpeg } from "../media/shareVideo";

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
  includeAudio: boolean;
  useGpuEncode: boolean;
}

interface ShareFrame {
  seq: number;
  width: number;
  height: number;
}

interface ShareAudio {
  samples: number[];
  sampleRate: number;
  channels: number;
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

const VIDEO_MAX_BITRATE = 16_000_000;
const AUDIO_MAX_BITRATE = 320_000;

export function useTelinhaRoom(session: RoomSession | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const peopleRef = useRef<Map<string, RoomPerson>>(new Map());
  const videoSinkCloseRef = useRef<(() => void) | null>(null);
  const unlistensRef = useRef<UnlistenFn[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioNodeRef = useRef<AudioNode | null>(null);
  const audioPortRef = useRef<MessagePort | null>(null);
  const sharingRef = useRef(false);
  const useGpuEncodeRef = useRef(true);
  const stopShareRef = useRef<() => Promise<void>>(async () => undefined);

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
      const maxBitrate = kind === "video" ? VIDEO_MAX_BITRATE : AUDIO_MAX_BITRATE;
      const params = sender.getParameters();
      params.degradationPreference = "maintain-framerate";
      params.encodings = params.encodings?.length
        ? params.encodings.map((encoding) => ({
            ...encoding,
            maxBitrate,
          }))
        : [{ maxBitrate }];
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
      if (existing && existing.connectionState !== "closed") {
        return existing;
      }

      const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peersRef.current.set(peerId, peer);

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal({ type: "ice", to: peerId, candidate: event.candidate.toJSON() });
        }
      };

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed") {
          setError("Não foi possível conectar direto. A rede pode estar bloqueando o P2P.");
        }
      };

      peer.ontrack = (event) => {
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
    [publishShares, sendSignal],
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
    videoSinkCloseRef.current?.();
    videoSinkCloseRef.current = null;

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
    let reconnectTimer: number | undefined;

    const handleMessage = async (event: MessageEvent) => {
      let message: SignalMessage;
      try {
        message = JSON.parse(String(event.data)) as SignalMessage;
      } catch {
        return;
      }

      if (message.type === "error") {
        fatal = true;
        setConnectionState(ConnectionState.Disconnected);
        setError(message.message ?? "Erro na sala");
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
        if (sharingRef.current) {
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
      socket.addEventListener("open", () => {
        if (!closed) {
          attempts = 0;
          setConnectionState(ConnectionState.Connecting);
        }
      });
      socket.addEventListener("message", (event) => {
        void handleMessage(event);
      });
      socket.addEventListener("close", () => {
        if (closed || fatal) return;
        closeAllPeers();
        if (attempts >= 8) {
          setConnectionState(ConnectionState.Disconnected);
          setError("A conexão caiu e não foi possível reconectar.");
          return;
        }
        setConnectionState(ConnectionState.Reconnecting);
        setError(null);
        const delay = Math.min(1000 * 2 ** attempts, 15_000);
        attempts += 1;
        reconnectTimer = window.setTimeout(() => {
          if (closed) return;
          const next = new WebSocket(signalingUrl(session));
          wsRef.current = next;
          attachSocket(next);
        }, delay);
      });
    };

    const ws = new WebSocket(signalingUrl(session));
    wsRef.current = ws;
    attachSocket(ws);

    return () => {
      closed = true;
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
      }
      void cleanupNativeShare();
      closeAllPeers();
      wsRef.current?.close();
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
    session,
    applyBitrate,
    cleanupNativeShare,
    closeAllPeers,
    closePeer,
    flushIce,
    getOrCreatePeer,
    offerTo,
    publishWatchers,
    offerToEveryone,
    publishPeople,
    publishShares,
    sendSignal,
  ]);

  const startShare = useCallback(
    async (sourceId: string, quality: ShareQuality) => {
      if (!session) return;

      await cleanupNativeShare();
      setError(null);
      useGpuEncodeRef.current = quality.useGpuEncode;

      try {
        const stream =
          (await startDisplayMediaShare(quality, sourceId)) ??
          (await startNativeShare(sourceId, quality, {
            unlistensRef,
            videoSinkCloseRef,
            audioContextRef,
            audioNodeRef,
            audioPortRef,
          }));

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
  refs.unlistensRef.current.push(
    await listen<ShareAudio>("share-audio", (event) => {
      refs.audioPortRef.current?.postMessage(Float32Array.from(event.payload.samples));
    }),
  );
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

async function startNativeShare(
  sourceId: string,
  quality: ShareQuality,
  refs: AudioShareRefs & { videoSinkCloseRef: MutableRefObject<(() => void) | null> },
): Promise<MediaStream> {
  const sink = createVideoSink(quality.fps);
  refs.videoSinkCloseRef.current = sink.close;

  let audioTrack: MediaStreamTrack | null = null;
  if (quality.includeAudio) {
    const audio = await createShareAudioTrack();
    if (audio) {
      audioTrack = audio.track;
      refs.audioContextRef.current = audio.context;
      refs.audioNodeRef.current = audio.node;
      refs.audioPortRef.current = audio.port ?? null;
      refs.unlistensRef.current.push(
        await listen<ShareAudio>("share-audio", (event) => {
          refs.audioPortRef.current?.postMessage(Float32Array.from(event.payload.samples));
        }),
      );
    }
  }

  let sawFirstFrame = false;
  let resolveFirst: (() => void) | undefined;
  let rejectFirst: ((error: Error) => void) | undefined;
  const firstFrame = new Promise<void>((resolve, reject) => {
    resolveFirst = resolve;
    rejectFirst = reject;
  });
  const timeout = window.setTimeout(() => {
    if (!sawFirstFrame) {
      rejectFirst?.(new Error("Nenhum quadro da tela chegou. Tente outra fonte."));
    }
  }, 5000);

  let pumping = false;
  let queued = false;
  const pumpFrame = async () => {
    if (pumping) {
      queued = true;
      return;
    }
    pumping = true;
    try {
      do {
        queued = false;
        try {
          const bytes = await invoke<ArrayBuffer | Uint8Array>("read_share_frame");
          const bitmap = await decodeShareJpeg(bytes);
          await sink.push(bitmap);
          if (!sawFirstFrame) {
            sawFirstFrame = true;
            window.clearTimeout(timeout);
            resolveFirst?.();
          }
        } catch {
        }
      } while (queued);
    } finally {
      pumping = false;
    }
  };

  refs.unlistensRef.current.push(
    await listen<ShareFrame>("share-frame", () => {
      void pumpFrame();
    }),
  );

  await invoke("start_share_capture", {
    id: sourceId,
    fps: quality.fps,
    maxWidth: quality.maxWidth,
    includeAudio: quality.includeAudio,
    includeVideo: true,
  });

  await firstFrame;

  const stream = new MediaStream([sink.track]);
  if (audioTrack) {
    stream.addTrack(audioTrack);
  }
  return stream;
}

function preferVideoCodecs(peer: RTCPeerConnection, useGpuEncode: boolean) {
  const capabilities = RTCRtpSender.getCapabilities("video");
  if (!capabilities) return;
  const wanted = useGpuEncode ? /h264/i : /vp8/i;
  const preferred = [
    ...capabilities.codecs.filter((codec) => wanted.test(codec.mimeType)),
    ...capabilities.codecs.filter(
      (codec) => !wanted.test(codec.mimeType) && !/rtx|red|ulpfec/i.test(codec.mimeType),
    ),
    ...capabilities.codecs.filter((codec) => /rtx|red|ulpfec/i.test(codec.mimeType)),
  ];
  for (const transceiver of peer.getTransceivers()) {
    if (transceiver.sender.track?.kind === "video" || transceiver.receiver.track?.kind === "video") {
      try {
        transceiver.setCodecPreferences(preferred);
      } catch {
      }
    }
  }
}
