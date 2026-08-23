import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ShareQuality } from "../hooks/useTelinhaRoom";

export interface ShareSource {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
}

interface ScreenSharePickerProps {
  onCancel: () => void;
  onShare: (sourceId: string, quality: ShareQuality) => Promise<void>;
}

const QUALITY_PRESETS = [
  {
    id: "standard",
    name: "Padrão",
    hint: "Melhor equilíbrio · 720p · 30fps",
    fps: 30,
    maxWidth: 1280,
  },
  {
    id: "smooth",
    name: "Vídeo mais suave",
    hint: "Vídeo mais suave · 1080p · 30fps",
    fps: 30,
    maxWidth: 1920,
  },
  {
    id: "games",
    name: "Jogos",
    hint: "Mais nítido · 1080p · 60fps",
    fps: 60,
    maxWidth: 1920,
  },
] as const;

export function ScreenSharePicker({ onCancel, onShare }: ScreenSharePickerProps) {
  const [tab, setTab] = useState<"window" | "screen" | "device">("window");
  const [sources, setSources] = useState<ShareSource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [qualityIndex, setQualityIndex] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [includeAudio, setIncludeAudio] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadSources() {
    try {
      const next = await invoke<ShareSource[]>("list_share_sources");
      setSources(next);
      setSelectedId((current) => {
        if (current && next.some((source) => source.id === current)) {
          return current;
        }
        const preferred =
          next.find((source) => source.kind === (tab === "device" ? "window" : tab)) ?? next[0];
        return preferred?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível listar telas e janelas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSources();
    const timer = window.setInterval(() => {
      void loadSources();
    }, 2500);
    return () => window.clearInterval(timer);
  }, []);

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
        <button
          type="button"
          role="tab"
          className={tab === "device" ? "active" : ""}
          onClick={() => setTab("device")}
        >
          Dispositivos
        </button>
      </div>

      <div className="discord-grid">
        {tab === "device" && (
          <p className="discord-empty">Câmeras e outros dispositivos entram numa próxima versão.</p>
        )}
        {tab !== "device" && loading && <p className="discord-empty">Procurando fontes...</p>}
        {tab !== "device" && !loading && visibleSources.length === 0 && (
          <p className="discord-empty">
            Nenhum {tab === "screen" ? "monitor" : "aplicativo"} encontrado.
          </p>
        )}
        {tab !== "device" &&
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

        {tab !== "device" && (
          <label className="share-audio-toggle">
            <input
              type="checkbox"
              checked={includeAudio}
              onChange={(event) => setIncludeAudio(event.target.checked)}
            />
            {tab === "screen"
              ? "Compartilhar áudio do sistema"
              : "Compartilhar áudio deste aplicativo"}
          </label>
        )}

        <div className="discord-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={sharing}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-go-live"
            onClick={() => void handleShare()}
            disabled={!selectedId || sharing || tab === "device"}
          >
            {sharing ? "Transmitindo..." : "Ao vivo"}
          </button>
        </div>
      </footer>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
