import type { ClientSignal } from "../lib/protocol";
import type { PeerHealthSample } from "./connectionQuality";

const AUDIO_MAX_BITRATE = 320_000;

interface PeerEntry {
  connection: RTCPeerConnection;
  pendingIce: RTCIceCandidateInit[];
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingRemoteAnswer: boolean;
  iceRestarted: boolean;
  remoteVideoAt?: number;
  mediaRecoveryAt?: number;
  mediaFailureReported: boolean;
  forceVp8: boolean;
  lastMediaStatus?: MediaDeliveryStatus;
  localIceCandidates: number;
  remoteIceCandidates: number;
}

export type MediaDeliveryStatus =
  | "receiving"
  | "recovering-network"
  | "recovering-codec"
  | "stalled-network"
  | "stalled-codec";

interface PeerManagerOptions {
  localId: string;
  configuration: RTCConfiguration;
  getLocalStream: () => MediaStream | null;
  getVideoBitrate: () => number;
  preferH264: () => boolean;
  send: (message: ClientSignal) => void;
  onRemoteStream: (peerId: string, stream: MediaStream) => void;
  onConnectionState: (peerId: string, state: RTCPeerConnectionState) => void;
  onMediaStatus: (peerId: string, status: MediaDeliveryStatus) => void;
  onError: (message: string) => void;
}

interface PreviousBytes {
  bytes: number;
  timestamp: number;
}

export class PeerManager {
  private readonly peers = new Map<string, PeerEntry>();
  private readonly previousBytes = new Map<string, PreviousBytes>();

  constructor(private readonly options: PeerManagerOptions) {}

  async offer(peerId: string, iceRestart = false): Promise<void> {
    const entry = this.ensure(peerId);
    this.syncLocalTracks(entry.connection, entry.forceVp8);
    entry.makingOffer = true;
    try {
      const offer = await entry.connection.createOffer({ iceRestart });
      await entry.connection.setLocalDescription(offer);
      if (offer.sdp) this.options.send({ type: "offer", to: peerId, sdp: offer.sdp });
      await this.applyBitrate(entry);
    } finally {
      entry.makingOffer = false;
    }
  }

  async handleDescription(peerId: string, type: "offer" | "answer", sdp: string): Promise<void> {
    const entry = this.ensure(peerId);
    const peer = entry.connection;
    const readyForOffer =
      !entry.makingOffer && (peer.signalingState === "stable" || entry.settingRemoteAnswer);
    const offerCollision = type === "offer" && !readyForOffer;
    const polite = this.options.localId.localeCompare(peerId) > 0;
    entry.ignoreOffer = !polite && offerCollision;
    if (entry.ignoreOffer) return;

    entry.settingRemoteAnswer = type === "answer";
    try {
      if (offerCollision) await peer.setLocalDescription({ type: "rollback" });
      await peer.setRemoteDescription({ type, sdp });
    } finally {
      entry.settingRemoteAnswer = false;
    }
    await this.flushIce(entry);
    for (const receiver of peer.getReceivers()) markVideoMotion(receiver.track);

    if (type === "offer") {
      this.syncLocalTracks(peer, entry.forceVp8);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      if (answer.sdp) this.options.send({ type: "answer", to: peerId, sdp: answer.sdp });
    } else {
      await this.applyBitrate(entry);
    }
  }

  async handleIce(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const entry = this.peers.get(peerId);
    if (!entry || !entry.connection.remoteDescription) {
      const pending = entry ?? this.ensure(peerId);
      pending.pendingIce.push(candidate);
      pending.remoteIceCandidates += 1;
      return;
    }
    if (entry.ignoreOffer) return;
    try {
      await entry.connection.addIceCandidate(candidate);
      entry.remoteIceCandidates += 1;
    } catch {
      if (!entry.ignoreOffer) this.options.onError("Falha ao aplicar candidato de rede.");
    }
  }

  removeLocalTracks(): void {
    for (const { connection } of this.peers.values()) {
      for (const sender of connection.getSenders()) {
        if (!sender.track) continue;
        try {
          connection.removeTrack(sender);
        } catch {
          // A conexão pode fechar entre getSenders e removeTrack.
        }
      }
    }
  }

  close(peerId: string): void {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    entry.connection.onicecandidate = null;
    entry.connection.ontrack = null;
    entry.connection.onconnectionstatechange = null;
    entry.connection.close();
    this.peers.delete(peerId);
    this.previousBytes.delete(peerId);
  }

  closeAll(): void {
    for (const peerId of [...this.peers.keys()]) this.close(peerId);
  }

  async retryAll(): Promise<void> {
    await Promise.all(
      [...this.peers].map(async ([peerId, entry]) => {
        entry.mediaRecoveryAt = undefined;
        entry.mediaFailureReported = false;
        entry.remoteVideoAt = Date.now();
        await this.offer(peerId, true);
      }),
    );
  }

  async collectHealth(): Promise<PeerHealthSample[]> {
    const samples = await Promise.all(
      [...this.peers].map(async ([peerId, entry]) => {
        if (entry.connection.connectionState === "closed") return null;
        const reports = await entry.connection.getStats();
        const sample = this.readHealth(peerId, reports);
        sample.connectionState = entry.connection.connectionState;
        sample.localIceCandidates = entry.localIceCandidates;
        sample.remoteIceCandidates = entry.remoteIceCandidates;
        this.evaluateMedia(peerId, entry, sample);
        return sample;
      }),
    );
    return samples.filter((sample): sample is PeerHealthSample => sample !== null);
  }

  private ensure(peerId: string): PeerEntry {
    const current = this.peers.get(peerId);
    if (
      current &&
      current.connection.connectionState !== "closed" &&
      current.connection.connectionState !== "failed"
    ) {
      return current;
    }
    if (current) this.close(peerId);

    const connection = new RTCPeerConnection(this.options.configuration);
    const entry: PeerEntry = {
      connection,
      pendingIce: [],
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      iceRestarted: false,
      mediaFailureReported: false,
      forceVp8: false,
      localIceCandidates: 0,
      remoteIceCandidates: 0,
    };
    this.peers.set(peerId, entry);

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        entry.localIceCandidates += 1;
        this.options.send({ type: "ice", to: peerId, candidate: event.candidate.toJSON() });
      }
    };
    connection.onconnectionstatechange = () => {
      this.options.onConnectionState(peerId, connection.connectionState);
      if (connection.connectionState === "connected") {
        entry.iceRestarted = false;
      } else if (
        connection.connectionState === "failed" &&
        !entry.iceRestarted &&
        connection.signalingState !== "closed"
      ) {
        entry.iceRestarted = true;
        void this.offer(peerId, true).catch(() => {
          this.options.onError("Não foi possível recuperar a conexão P2P.");
        });
      }
    };
    connection.ontrack = (event) => {
      markVideoMotion(event.track);
      if (event.track.kind === "video") {
        entry.remoteVideoAt = Date.now();
        entry.mediaRecoveryAt = undefined;
        entry.mediaFailureReported = false;
      }
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.options.onRemoteStream(peerId, stream);
    };
    this.syncLocalTracks(connection, entry.forceVp8);
    return entry;
  }

  private syncLocalTracks(peer: RTCPeerConnection, forceVp8: boolean): void {
    const stream = this.options.getLocalStream();
    if (!stream) return;
    for (const track of stream.getTracks()) {
      if (!peer.getSenders().some((sender) => sender.track === track)) peer.addTrack(track, stream);
    }
    preferVideoCodecs(peer, forceVp8 ? false : this.options.preferH264());
  }

  private async flushIce(entry: PeerEntry): Promise<void> {
    const queued = entry.pendingIce.splice(0);
    for (const candidate of queued) {
      try {
        await entry.connection.addIceCandidate(candidate);
      } catch {
        if (!entry.ignoreOffer) this.options.onError("Falha ao aplicar candidato de rede.");
      }
    }
  }

  private async applyBitrate(entry: PeerEntry): Promise<void> {
    const peer = entry.connection;
    preferVideoCodecs(peer, entry.forceVp8 ? false : this.options.preferH264());
    for (const sender of peer.getSenders()) {
      const kind = sender.track?.kind;
      if (kind !== "video" && kind !== "audio") continue;
      const maxBitrate = kind === "video" ? this.options.getVideoBitrate() : AUDIO_MAX_BITRATE;
      const params = sender.getParameters();
      params.degradationPreference = "maintain-framerate";
      const encoding = { maxBitrate, ...(kind === "video" ? { priority: "high" as const } : {}) };
      params.encodings = params.encodings?.length
        ? params.encodings.map((current) => ({ ...current, ...encoding }))
        : [encoding];
      try {
        await sender.setParameters(params);
      } catch {
        this.options.onError("O navegador não aplicou o limite de bitrate.");
      }
    }
  }

  private readHealth(peerId: string, reports: RTCStatsReport): PeerHealthSample {
    const sample: PeerHealthSample = { peerId };
    reports.forEach((report) => {
      if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
        if (typeof report.currentRoundTripTime === "number") {
          sample.roundTripTimeMs = Math.round(report.currentRoundTripTime * 1000);
        }
        const localCandidate =
          typeof report.localCandidateId === "string" ? reports.get(report.localCandidateId) : null;
        const remoteCandidate =
          typeof report.remoteCandidateId === "string" ? reports.get(report.remoteCandidateId) : null;
        const candidate = localCandidate ?? remoteCandidate;
        if (candidate?.candidateType) sample.candidateType = String(candidate.candidateType);
        if (candidate?.protocol) sample.transport = String(candidate.protocol);
      }
      if (report.type === "inbound-rtp" && report.kind === "video") {
        sample.bytesReceived = Number(report.bytesReceived ?? 0);
        sample.framesDecoded = Number(report.framesDecoded ?? 0);
        const received = Number(report.packetsReceived ?? 0);
        const lost = Number(report.packetsLost ?? 0);
        if (received + lost > 0) sample.packetLossPercent = (lost / (received + lost)) * 100;
        if (typeof report.codecId === "string") {
          const codec = reports.get(report.codecId);
          if (codec?.mimeType) sample.codec = String(codec.mimeType);
        }
      }
      if (report.type === "outbound-rtp" && report.kind === "video") {
        const bytes = Number(report.bytesSent ?? 0);
        sample.bytesSent = bytes;
        const timestamp = Number(report.timestamp ?? 0);
        const previous = this.previousBytes.get(peerId);
        if (previous && timestamp > previous.timestamp) {
          sample.bitrateKbps = Math.round(
            ((bytes - previous.bytes) * 8) / (timestamp - previous.timestamp),
          );
        }
        this.previousBytes.set(peerId, { bytes, timestamp });
      }
    });
    return sample;
  }

  private evaluateMedia(peerId: string, entry: PeerEntry, sample: PeerHealthSample): void {
    if (!entry.remoteVideoAt) return;
    const frames = sample.framesDecoded ?? 0;
    const bytes = sample.bytesReceived ?? 0;
    if (frames > 0) {
      entry.mediaRecoveryAt = undefined;
      entry.mediaFailureReported = false;
      this.publishMediaStatus(peerId, entry, "receiving");
      return;
    }

    const now = Date.now();
    if (now - entry.remoteVideoAt < 8_000) return;
    const failure: "network" | "codec" = bytes > 0 ? "codec" : "network";
    if (!entry.mediaRecoveryAt) {
      entry.mediaRecoveryAt = now;
      if (failure === "codec") entry.forceVp8 = true;
      this.publishMediaStatus(peerId, entry, `recovering-${failure}`);
      void this.offer(peerId, failure === "network").catch(() => {
        this.options.onError("Não foi possível renegociar a live.");
      });
      return;
    }
    if (!entry.mediaFailureReported && now - entry.mediaRecoveryAt >= 8_000) {
      entry.mediaFailureReported = true;
      this.publishMediaStatus(peerId, entry, `stalled-${failure}`);
    }
  }

  private publishMediaStatus(
    peerId: string,
    entry: PeerEntry,
    status: MediaDeliveryStatus,
  ): void {
    if (entry.lastMediaStatus === status) return;
    entry.lastMediaStatus = status;
    this.options.onMediaStatus(peerId, status);
  }
}

function markVideoMotion(track: MediaStreamTrack | null): void {
  if (track?.kind === "video") track.contentHint = "motion";
}

function codecRank(codec: { mimeType: string; sdpFmtpLine?: string }, wanted: RegExp): number {
  if (wanted.test(codec.mimeType)) {
    const line = codec.sdpFmtpLine ?? "";
    if (/profile-level-id=64/i.test(line)) return 0;
    if (/profile-level-id=4d/i.test(line)) return 1;
    return 2;
  }
  if (/rtx|red|ulpfec/i.test(codec.mimeType)) return 20;
  return 10;
}

function preferVideoCodecs(peer: RTCPeerConnection, preferH264: boolean): void {
  const capabilities = RTCRtpSender.getCapabilities("video");
  if (!capabilities) return;
  const wanted = preferH264 ? /h264/i : /vp8/i;
  const preferred = [...capabilities.codecs].sort(
    (left, right) => codecRank(left, wanted) - codecRank(right, wanted),
  );
  for (const transceiver of peer.getTransceivers()) {
    if (transceiver.sender.track?.kind === "video" || transceiver.receiver.track?.kind === "video") {
      try {
        transceiver.setCodecPreferences(preferred);
      } catch {
        // Alguns WebViews não expõem setCodecPreferences apesar dos tipos.
      }
    }
  }
}
