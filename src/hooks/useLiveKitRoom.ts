import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  ConnectionState,
  LocalParticipant,
  RemoteParticipant,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import type { RoomSession } from "../api";

export interface ScreenShareInfo {
  participantIdentity: string;
  participantName: string;
  track: Track;
  audioTrack?: Track;
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

export function useLiveKitRoom(session: RoomSession | null) {
  const roomRef = useRef<Room | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const unlistensRef = useRef<UnlistenFn[]>([]);
  const publishedTrackRef = useRef<MediaStreamTrack | null>(null);
  const publishedAudioRef = useRef<MediaStreamTrack | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.Disconnected,
  );
  const [isSharing, setIsSharing] = useState(false);
  const [screenShares, setScreenShares] = useState<ScreenShareInfo[]>([]);
  const [participants, setParticipants] = useState<RoomPerson[]>([]);
  const [activeShareId, setActiveShareId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshParticipants = useCallback((room: Room) => {
    const people: RoomPerson[] = [];
    const toPerson = (
      participant: LocalParticipant | RemoteParticipant,
      isLocal: boolean,
    ) => {
      const isSharing = [...participant.trackPublications.values()].some(
        (publication) =>
          publication.source === Track.Source.ScreenShare &&
          publication.track &&
          !publication.isMuted,
      );
      people.push({
        identity: participant.identity,
        name: participant.name || participant.identity,
        isSharing,
        isLocal,
      });
    };

    toPerson(room.localParticipant, true);
    room.remoteParticipants.forEach((participant) => toPerson(participant, false));
    setParticipants(people);
  }, []);

  const refreshScreenShares = useCallback((room: Room) => {
    const shares: ScreenShareInfo[] = [];

    const collect = (participant: LocalParticipant | RemoteParticipant) => {
      let video: Track | undefined;
      let audio: Track | undefined;
      for (const publication of participant.trackPublications.values()) {
        if (!publication.track || publication.isMuted) {
          continue;
        }
        if (publication.source === Track.Source.ScreenShare) {
          video = publication.track;
        }
        if (publication.source === Track.Source.ScreenShareAudio) {
          audio = publication.track;
        }
      }
      if (video) {
        shares.push({
          participantIdentity: participant.identity,
          participantName: participant.name ?? participant.identity,
          track: video,
          audioTrack: audio,
        });
      }
    };

    collect(room.localParticipant);
    room.remoteParticipants.forEach(collect);
    setScreenShares(shares);
    refreshParticipants(room);

    setActiveShareId((current) => {
      if (current && shares.some((s) => s.participantIdentity === current)) {
        return current;
      }
      return null;
    });
  }, [refreshParticipants]);

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

    const room = roomRef.current;
    const unpublishMedia = async (mediaTrack: MediaStreamTrack | null) => {
      if (!room || !mediaTrack) return;
      const publication = [...room.localParticipant.trackPublications.values()].find(
        (item) => item.track?.mediaStreamTrack === mediaTrack,
      );
      if (publication?.track) {
        await room.localParticipant.unpublishTrack(publication.track);
      }
      mediaTrack.stop();
    };

    await unpublishMedia(publishedTrackRef.current);
    await unpublishMedia(publishedAudioRef.current);
    publishedTrackRef.current = null;
    publishedAudioRef.current = null;
    canvasRef.current = null;

    audioProcessorRef.current?.disconnect();
    audioProcessorRef.current = null;
    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }

    setIsSharing(false);
    if (room) {
      refreshScreenShares(room);
    }
  }, [refreshScreenShares]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    roomRef.current = room;

    const onConnected = () => {
      setConnectionState(room.state);
      refreshScreenShares(room);
    };

    const onDisconnected = () => {
      setConnectionState(ConnectionState.Disconnected);
    };

    const onReconnecting = () => {
      setConnectionState(ConnectionState.Reconnecting);
    };

    const onTrackChange = () => refreshScreenShares(room);

    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onConnected);
    room.on(RoomEvent.LocalTrackPublished, onTrackChange);
    room.on(RoomEvent.LocalTrackUnpublished, onTrackChange);
    room.on(RoomEvent.TrackSubscribed, onTrackChange);
    room.on(RoomEvent.TrackUnsubscribed, onTrackChange);
    room.on(RoomEvent.ParticipantConnected, onTrackChange);
    room.on(RoomEvent.ParticipantDisconnected, onTrackChange);

    room
      .connect(session.livekitUrl, session.token)
      .then(() => {
        setConnectionState(room.state);
        refreshScreenShares(room);
      })
      .catch((err: Error) => {
        setError(err.message);
      });

    return () => {
      void cleanupNativeShare();
      room.disconnect();
      roomRef.current = null;
      setScreenShares([]);
      setParticipants([]);
      setActiveShareId(null);
    };
  }, [session, refreshScreenShares, cleanupNativeShare]);

  const startShare = useCallback(
    async (sourceId: string, quality: ShareQuality) => {
      const room = roomRef.current;
      if (!room) return;

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
      const mediaTrack = stream.getVideoTracks()[0];
      if (!mediaTrack) {
        throw new Error("Falha ao criar o vídeo da tela");
      }

      await room.localParticipant.publishTrack(mediaTrack, {
        source: Track.Source.ScreenShare,
        name: "screen",
        simulcast: true,
      });
      publishedTrackRef.current = mediaTrack;

      if (quality.includeAudio) {
        const audioTrack = await createShareAudioTrack(
          audioQueueRef,
          audioContextRef,
          audioProcessorRef,
        );
        if (audioTrack) {
          await room.localParticipant.publishTrack(audioTrack, {
            source: Track.Source.ScreenShareAudio,
            name: "screen-audio",
          });
          publishedAudioRef.current = audioTrack;
        }
      }

      setIsSharing(true);
      refreshScreenShares(room);
    },
    [cleanupNativeShare, refreshScreenShares],
  );

  const stopShare = useCallback(async () => {
    await cleanupNativeShare();
  }, [cleanupNativeShare]);

  const activeShare = screenShares.find((s) => s.participantIdentity === activeShareId);

  return {
    connectionState,
    isSharing,
    screenShares,
    participants,
    activeShare,
    activeShareId,
    setActiveShareId,
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
