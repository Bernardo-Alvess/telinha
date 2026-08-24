import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createRoom, enterRoom, type RoomSession } from "../lib/api";

const NAME_KEY = "telinha-display-name";

interface HomeScreenProps {
  onJoin: (session: RoomSession) => void;
  error?: string | null;
  invite?: ReactNode;
  joining?: boolean;
}

export function HomeScreen({ onJoin, error: incomingError, invite, joining }: HomeScreenProps) {
  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem(NAME_KEY) ?? "",
  );
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [vencordBusy, setVencordBusy] = useState(false);
  const [vencordConfirm, setVencordConfirm] = useState(false);
  const [vencordMessage, setVencordMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(incomingError ?? null);
  const nickname = displayName.trim();

  useEffect(() => {
    if (incomingError) {
      setError(incomingError);
    }
  }, [incomingError]);

  function persistName() {
    localStorage.setItem(NAME_KEY, nickname);
    return nickname;
  }

  async function handleCreate() {
    if (!nickname) {
      setError("Escolha um apelido para os outros te verem.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const session = await createRoom(persistName());
      onJoin(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar sala");
    } finally {
      setLoading(false);
    }
  }

  async function installVencord() {
    setVencordBusy(true);
    setVencordMessage("Isso pode levar alguns minutos na primeira vez...");
    try {
      const result = await invoke<{ message: string }>("install_vencord_plugin");
      setVencordConfirm(false);
      setVencordMessage(result.message);
    } catch (err) {
      setVencordMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setVencordBusy(false);
    }
  }

  async function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    if (!nickname) {
      setError("Escolha um apelido para os outros te verem.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const session = await enterRoom(trimmed, persistName());
      onJoin(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao entrar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen home-screen">
      <header className="header">
        <h1>Telinha</h1>
        <p>A voz fica no Discord. Aqui é só a tela.</p>
      </header>

      <div className="actions">
        <label className="name-field">
          Como você quer aparecer
          <input
            type="text"
            placeholder="Seu apelido"
            value={displayName}
            maxLength={24}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={loading || joining}
          />
        </label>

        <button
          type="button"
          className="btn btn-primary"
          onClick={handleCreate}
          disabled={loading || joining || !nickname}
        >
          {loading ? "Abrindo sala..." : "Criar sala"}
        </button>

        <form className="join-form" onSubmit={handleJoin}>
          <input
            type="text"
            className={code.trim().startsWith("D") ? "is-discord-code" : ""}
            placeholder="Código da sala"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={24}
            disabled={loading || joining}
          />
          <button
            type="submit"
            className="btn btn-secondary"
            disabled={loading || joining || !code.trim() || !nickname}
          >
            {joining ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>

      {invite}

      {joining && <p className="hint">Entrando na sala...</p>}
      {error && <p className="error">{error}</p>}

      <footer className="vencord-setup">
        {vencordConfirm ? (
          <div className="notice">
            <strong>Instalar o botão no Discord?</strong>
            <p>
              Isso baixa o instalador oficial do Vencord (v1.4.0, com hash verificado), altera a
              pasta do Vencord no AppData e modifica o cliente do Discord. Pode violar os termos
              do Discord.
            </p>
            <div className="notice-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={vencordBusy}
                onClick={() => setVencordConfirm(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={loading || vencordBusy}
                onClick={() => void installVencord()}
              >
                {vencordBusy ? "Instalando..." : "Entendi, instalar"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p>Quer um botão Telinha no Discord?</p>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={loading || vencordBusy}
              onClick={() => {
                setVencordMessage(null);
                setVencordConfirm(true);
              }}
            >
              Colocar no Vencord
            </button>
          </>
        )}
        {vencordMessage && <p className="vencord-status">{vencordMessage}</p>}
      </footer>
    </div>
  );
}
