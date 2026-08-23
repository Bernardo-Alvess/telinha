import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createRoom, joinRoom, type RoomSession } from "../api";

const NAME_KEY = "telinha-display-name";

interface HomeScreenProps {
  onJoin: (session: RoomSession) => void;
  error?: string | null;
}

export function HomeScreen({ onJoin, error: incomingError }: HomeScreenProps) {
  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem(NAME_KEY) ?? "",
  );
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(incomingError ?? null);

  useEffect(() => {
    if (incomingError) {
      setError(incomingError);
    }
  }, [incomingError]);

  function persistName() {
    const name = displayName.trim() || "Amigo";
    localStorage.setItem(NAME_KEY, name);
    return name;
  }

  async function handleCreate() {
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

  async function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    try {
      const session = await joinRoom(trimmed, persistName());
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
        <p>Compartilhe a tela enquanto usa o Discord</p>
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
            disabled={loading}
          />
        </label>

        <button
          type="button"
          className="btn btn-primary"
          onClick={handleCreate}
          disabled={loading}
        >
          Criar sala
        </button>

        <form className="join-form" onSubmit={handleJoin}>
          <input
            type="text"
            placeholder="Código da sala"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6}
            disabled={loading}
          />
          <button type="submit" className="btn btn-secondary" disabled={loading || !code.trim()}>
            Entrar
          </button>
        </form>
      </div>

      {error && <p className="error">{error}</p>}

      <footer className="hint">
        Cole o código no Discord, ou use telinha://join/CODIGO. Se você
        compilou o Vencord da source, o plugin pode ir para src/userplugins.
        <button
          type="button"
          className="btn btn-ghost"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            setError(null);
            try {
              const dest = await invoke<string>("install_vencord_plugin");
              setError(`Plugin copiado para ${dest}. Rode pnpm build && pnpm inject no Vencord.`);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setLoading(false);
            }
          }}
        >
          Copiar plugin Vencord
        </button>
      </footer>
    </div>
  );
}
