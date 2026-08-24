import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ShareQuality } from "../hooks/useTelinhaRoom";

export interface ShareSource {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
  pid?: number;
}

interface ScreenSharePickerProps {
  onCancel: () => void;
  onShare: (sourceId: string, quality: ShareQuality) => Promise<void>;
}

const QUALITY_PRESETS = [
  {
    id: "standard",
    name: "Padrão",
    hint: "Alta · 1440p · 60fps",
    fps: 60,
    maxWidth: 2560,
  },
  {
    id: "max",
    name: "Máxima",
    hint: "Resolução nativa · 60fps",
    fps: 60,
    maxWidth: 0,
  },
  {
    id: "data",
    name: "Leve",
    hint: "Menos dados · 1080p · 30fps",
    fps: 30,
    maxWidth: 1920,
  },
] as const;

const QUALITY_KEY = "telinha-share-quality";
const AUDIO_KEY = "telinha-share-audio";
const GPU_KEY = "telinha-share-gpu";

interface GpuEncodeInfo {
  available: boolean;
  vendor: string;
  name: string;
}

function gpuEncodeLabel(info: GpuEncodeInfo | null): string {
  if (!info) return "Detectando GPU...";
  if (!info.available) {
    return "GPU de vídeo não encontrada — envio pela CPU";
  }
  if (info.vendor === "nvidia") {
    return info.name ? `Usar NVENC no envio (${info.name})` : "Usar NVENC no envio (H.264 na GPU)";
  }
  if (info.vendor === "amd") {
    return "Usar encoder da GPU no envio (AMF / H.264)";
  }
  if (info.vendor === "intel") {
    return "Usar encoder da GPU no envio (Quick Sync / H.264)";
  }
  return "Usar encoder da GPU no envio (H.264)";
}

function storedQualityIndex(): number {
  const value = Number(localStorage.getItem(QUALITY_KEY));
  return Number.isInteger(value) && value >= 0 && value < QUALITY_PRESETS.length ? value : 0;
}

export function ScreenSharePicker({ onCancel, onShare }: ScreenSharePickerProps) {
  const [tab, setTab] = useState<"window" | "screen">("window");
  const [sources, setSources] = useState<ShareSource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [qualityIndex, setQualityIndex] = useState(storedQualityIndex);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [includeAudio, setIncludeAudio] = useState(
    () => localStorage.getItem(AUDIO_KEY) !== "0",
  );
  const [gpuInfo, setGpuInfo] = useState<GpuEncodeInfo | null>(null);
  const [useGpuEncode, setUseGpuEncode] = useState(
    () => localStorage.getItem(GPU_KEY) !== "0",
  );
  const [error, setError] = useState<string | null>(null);

  async function loadSources() {
    try {
      const next = await invoke<ShareSource[]>("list_share_sources");
      setSources(next);
      setSelectedId((current) => {
        if (current && next.some((source) => source.id === current)) return current;
        return next.find((source) => source.kind === tab)?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível listar telas e janelas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void invoke<GpuEncodeInfo>("gpu_encode_info")
      .then((info) => {
        setGpuInfo(info);
        if (!info.available) {
          setUseGpuEncode(false);
        }
      })
      .catch(() => {
        setGpuInfo({ available: false, vendor: "none", name: "" });
        setUseGpuEncode(false);
      });
  }, []);

  useEffect(() => {
    function refresh() {
      if (document.hidden) return;
      void loadSources();
    }
    refresh();
    const timer = window.setInterval(refresh, 4000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  useEffect(() => {
    const first = sources.find((source) => source.kind === tab);
    if (!sources.some((source) => source.id === selectedId && source.kind === tab)) {
      setSelectedId(first?.id ?? null);
    }
  }, [sources, tab, selectedId]);

  const visibleSources = useMemo(
    () => sources.filter((source) => source.kind === tab),
    [sources, tab],
  );
  const quality = QUALITY_PRESETS[qualityIndex]!;

  async function handleShare() {
    if (!selectedId) return;
    setSharing(true);
    setError(null);
    try {
      await onShare(selectedId, {
        fps: quality.fps,
        maxWidth: quality.maxWidth,
        includeAudio,
        useGpuEncode: Boolean(gpuInfo?.available && useGpuEncode),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível compartilhar");
      setSharing(false);
    }
  }

  return (
    <div className="discord-picker">
      <div className="discord-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={tab === "window" ? "active" : ""}
          onClick={() => setTab("window")}
        >
          Aplicativos
        </button>
        <button
          type="button"
          role="tab"
          className={tab === "screen" ? "active" : ""}
          onClick={() => setTab("screen")}
        >
          Tela inteira
        </button>
      </div>

      <div className="discord-grid">
        {loading && <p className="discord-empty">Procurando fontes...</p>}
        {!loading && visibleSources.length === 0 && (
          <p className="discord-empty">
            Nenhum {tab === "screen" ? "monitor" : "aplicativo"} encontrado.
          </p>
        )}
        {!loading &&
          visibleSources.map((source) => (
            <button
              key={source.id}
              type="button"
              className={`discord-card ${selectedId === source.id ? "selected" : ""}`}
              onClick={() => setSelectedId(source.id)}
              onDoubleClick={() => void handleShare()}
            >
              <div className="discord-thumb">
                {source.thumbnail ? <img src={source.thumbnail} alt="" /> : <span>Sem preview</span>}
              </div>
              <span className="discord-card-name">{source.name}</span>
            </button>
          ))}
      </div>

      <footer className="discord-picker-footer">
        <div className="quality-cluster">
          <button
            type="button"
            className="quality-summary"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <strong>{quality.name}</strong>
            <span>{quality.hint}</span>
          </button>
          <button
            type="button"
            className="quality-gear"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label="Configurações de qualidade"
          >
            ⚙
          </button>
          {settingsOpen && (
            <div className="quality-popover">
              <p>Altera resolução e fps da captura</p>
              {QUALITY_PRESETS.map((preset, index) => (
                <button
                  key={preset.id}
                  type="button"
                  className={index === qualityIndex ? "active" : ""}
                  onClick={() => {
                    setQualityIndex(index);
                    localStorage.setItem(QUALITY_KEY, String(index));
                    setSettingsOpen(false);
                  }}
                >
                  <strong>{preset.name}</strong>
                  <span>{preset.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <label className="share-audio-toggle">
          <input
            type="checkbox"
            checked={includeAudio}
            onChange={(event) => {
              setIncludeAudio(event.target.checked);
              localStorage.setItem(AUDIO_KEY, event.target.checked ? "1" : "0");
            }}
          />
          {tab === "screen"
            ? "Compartilhar áudio do sistema"
            : "Compartilhar somente o áudio deste aplicativo"}
        </label>

        <label
          className={`share-audio-toggle ${gpuInfo && !gpuInfo.available ? "is-disabled" : ""}`}
          title="A captura usa a GPU do Chromium quando o Windows deixar. Isto escolhe H.264 (GPU) ou VP8 (CPU) no envio."
        >
          <input
            type="checkbox"
            checked={Boolean(gpuInfo?.available && useGpuEncode)}
            disabled={!gpuInfo?.available}
            onChange={(event) => {
              setUseGpuEncode(event.target.checked);
              localStorage.setItem(GPU_KEY, event.target.checked ? "1" : "0");
            }}
          />
          {gpuEncodeLabel(gpuInfo)}
        </label>

        <div className="discord-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={sharing}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-go-live"
            onClick={() => void handleShare()}
            disabled={!selectedId || sharing}
          >
            {sharing ? "Transmitindo..." : "Ao vivo"}
          </button>
        </div>
      </footer>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
