import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { signalingUrl, type RoomSession } from "../api";

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
}

interface ShareFrame {
  dataUrl: string;
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

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const VIDEO_MAX_BITRATE = 2_500_000;

export function useTelinhaRoom(session: RoomSession | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const peopleRef = useRef<Map<string, RoomPerson>>(new Map());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const unlistensRef = useRef<UnlistenFn[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const sharingRef = useRef(false);

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.Disconnected,
  );
  const [isSharing, setIsSharing] = useState(false);
  const [screenShares, setScreenShares] = useState<ScreenShareInfo[]>([]);
  const [participants, setParticipants] = useState<RoomPerson[]>([]);
  const [error, setError] = useState<string | null>(null);

  const publishPeople = useCallback(() => {
    setParticipants([...peopleRef.current.values()]);
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
    for (const sender of peer.getSenders()) {
      if (sender.track?.kind !== "video") continue;
      const params = sender.getParameters();
      params.encodings = params.encodings?.length
        ? params.encodings.map((encoding) => ({
            ...encoding,
            maxBitrate: VIDEO_MAX_BITRATE,
          }))
        : [{ maxBitrate: VIDEO_MAX_BITRATE }];
      try {
        await sender.setParameters(params);
      } catch {
        // Some WebViews reject encodings before negotiation finishes.
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
        // Candidate arrived for a discarded description.
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
    audioQueueRef.current = [];
    try {
      await invoke("stop_share_capture");
    } catch {
      // Running outside Tauri.
    }

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
    }
    localStreamRef.current = null;
    canvasRef.current = null;

    audioProcessorRef.current?.disconnect();
    audioProcessorRef.current = null;
    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }

    for (const peer of peersRef.current.values()) {
      for (const sender of peer.getSenders()) {
        try {
          peer.removeTrack(sender);
        } catch {
          // Peer already tearing down.
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

    const ws = new WebSocket(signalingUrl(session));
    wsRef.current = ws;

    const handleMessage = async (event: MessageEvent) => {
      let message: SignalMessage;
      try {
        message = JSON.parse(String(event.data)) as SignalMessage;
      } catch {
        return;
      }

      if (message.type === "error") {
        setError(message.message ?? "Erro na sala");
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
        publishPeople();
        setConnectionState(ConnectionState.Connected);
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
        return;
      }

      if (message.type === "share-stopped" && message.participantId) {
        const person = peopleRef.current.get(message.participantId);
        if (person) {
          person.isSharing = false;
        }
        remoteStreamsRef.current.delete(message.participantId);
        if (!sharingRef.current) {
          closePeer(message.participantId);
        }
        publishPeople();
        publishShares(localId, localName);
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
          // Stale candidate.
        }
      }
    };

    ws.addEventListener("open", () => {
      if (!closed) {
        setConnectionState(ConnectionState.Connecting);
      }
    });
    ws.addEventListener("message", (event) => {
      void handleMessage(event);
    });
    ws.addEventListener("close", () => {
      if (closed) return;
      setConnectionState(ConnectionState.Disconnected);
    });
    ws.addEventListener("error", () => {
      if (!closed) {
        setError("Falha ao conectar no servidor de salas.");
      }
    });

    return () => {
      closed = true;
      void cleanupNativeShare();
      closeAllPeers();
      ws.close();
      wsRef.current = null;
      remoteStreamsRef.current.clear();
      peopleRef.current.clear();
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
    publishPeople,
    publishShares,
    sendSignal,
  ]);

  const startShare = useCallback(
    async (sourceId: string, quality: ShareQuality) => {
      if (!session) return;

      await cleanupNativeShare();
      setError(null);

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Não foi possível iniciar a captura");
      }
      canvasRef.current = canvas;

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

      unlistensRef.current.push(
        await listen<ShareFrame>("share-frame", (event) => {
          if (canvas.width !== event.payload.width || canvas.height !== event.payload.height) {
            canvas.width = event.payload.width;
            canvas.height = event.payload.height;
          }
          const image = new Image();
          image.onload = () => {
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            if (!sawFirstFrame) {
              sawFirstFrame = true;
              window.clearTimeout(timeout);
              resolveFirst?.();
            }
          };
          image.src = event.payload.dataUrl;
        }),
      );

      if (quality.includeAudio) {
        unlistensRef.current.push(
          await listen<ShareAudio>("share-audio", (event) => {
            audioQueueRef.current.push(Float32Array.from(event.payload.samples));
            if (audioQueueRef.current.length > 25) {
              audioQueueRef.current.splice(0, audioQueueRef.current.length - 16);
            }
          }),
        );
      }

      await invoke("start_share_capture", {
        id: sourceId,
        fps: quality.fps,
        maxWidth: quality.maxWidth,
        includeAudio: quality.includeAudio,
      });

      await firstFrame;

      const stream = canvas.captureStream(quality.fps);
      if (quality.includeAudio) {
        const audioTrack = await createShareAudioTrack(
          audioQueueRef,
          audioContextRef,
          audioProcessorRef,
        );
        if (audioTrack) {
          stream.addTrack(audioTrack);
        }
      }

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

  const stopShare = useCallback(async () => {
    if (!session) {
      await cleanupNativeShare();
      return;
    }
    sendSignal({ type: "share-stopped" });
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
  }, [cleanupNativeShare, closePeer, publishPeople, publishShares, sendSignal, session]);

  return {
    connectionState,
    isSharing,
    screenShares,
    participants,
    startShare,
    stopShare,
    error,
  };
}

async function createShareAudioTrack(
  queueRef: MutableRefObject<Float32Array[]>,
  contextRef: MutableRefObject<AudioContext | null>,
  processorRef: MutableRefObject<ScriptProcessorNode | null>,
): Promise<MediaStreamTrack | null> {
  const context = new AudioContext({ sampleRate: 48000 });
  await context.resume();
  const destination = context.createMediaStreamDestination();
  const processor = context.createScriptProcessor(1024, 2, 2);
  const mute = context.createGain();
  mute.gain.value = 0;

  processor.onaudioprocess = (event) => {
    const frames = event.outputBuffer.length;
    const left = event.outputBuffer.getChannelData(0);
    const right = event.outputBuffer.getChannelData(1);
    const interleaved = pullInterleaved(queueRef.current, frames * 2);
    for (let i = 0; i < frames; i += 1) {
      left[i] = interleaved[i * 2] ?? 0;
      right[i] = interleaved[i * 2 + 1] ?? 0;
    }
  };

  processor.connect(destination);
  processor.connect(mute);
  mute.connect(context.destination);
  contextRef.current = context;
  processorRef.current = processor;
  return destination.stream.getAudioTracks()[0] ?? null;
}

function pullInterleaved(queue: Float32Array[], needed: number): Float32Array {
  const out = new Float32Array(needed);
  let offset = 0;
  while (offset < needed && queue.length > 0) {
    const next = queue[0]!;
    const take = Math.min(next.length, needed - offset);
    out.set(next.subarray(0, take), offset);
    if (take === next.length) {
      queue.shift();
    } else {
      queue[0] = next.subarray(take);
    }
    offset += take;
  }
  return out;
}
