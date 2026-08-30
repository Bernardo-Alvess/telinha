import { useEffect, useState, type ReactNode } from "react";
import {
  ROOM_CODE_LENGTH,
  createRoom,
  enterRoom,
  isValidRoomCode,
  normalizeRoomCode,
  type RoomSession,
} from "../lib/api";

const NAME_KEY = "telinha-display-name";

interface HomeScreenProps {
  onJoin: (session: RoomSession) => void;
  error?: string | null;
  invite?: ReactNode;
  joining?: boolean;
  beforeEnter?: () => Promise<void>;
}

export function HomeScreen({
  onJoin,
  error: incomingError,
  invite,
  joining,
  beforeEnter,
}: HomeScreenProps) {
  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem(NAME_KEY) ?? "",
  );
  const [code, setCode] = useState("");
  const [operation, setOperation] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(incomingError ?? null);
  const nickname = displayName.trim();
  const busy = operation !== null || Boolean(joining);

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
      setError("Digite seu nome para continuar.");
      return;
    }
    setOperation("create");
    setError(null);
    try {
      await beforeEnter?.();
      const session = await createRoom(persistName());
      onJoin(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a sala.");
    } finally {
      setOperation(null);
    }
  }

  async function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = normalizeRoomCode(code);
    if (!isValidRoomCode(trimmed)) {
      setError("Digite o código de 6 caracteres da sala.");
      return;
    }
    if (!nickname) {
      setError("Digite seu nome para continuar.");
      return;
    }

    setOperation("join");
    setError(null);
    try {
      await beforeEnter?.();
      const session = await enterRoom(trimmed, persistName());
      onJoin(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar na sala.");
    } finally {
      setOperation(null);
    }
  }

  return (
    <main className="screen home-screen">
      <div className="home-shell">
        <header className="home-brand">
          <span className="home-brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>Telinha</span>
        </header>

        <section className="home-intro" aria-labelledby="home-title">
          <h1 id="home-title">Sua tela, do jeito simples.</h1>
          <p>Crie uma sala, compartilhe o código e comece a transmitir.</p>
        </section>

        <div className="actions">
          <label className="name-field">
            Seu nome
            <input
              type="text"
              placeholder="Como você quer aparecer"
              value={displayName}
              maxLength={24}
              autoComplete="nickname"
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={busy}
            />
          </label>

          <button
            type="button"
            className="btn btn-primary home-create"
            onClick={handleCreate}
            disabled={busy || !nickname}
          >
            {operation === "create" ? "Abrindo sala..." : "Criar sala"}
          </button>

          <div className="home-divider">
            <span>ou entre em uma sala</span>
          </div>

          <form className="join-form" onSubmit={handleJoin}>
            <input
              type="text"
              aria-label="Código da sala"
              placeholder="Código de 6 caracteres"
              value={code}
              onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
              maxLength={ROOM_CODE_LENGTH}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
            <button
              type="submit"
              className="btn btn-secondary"
              disabled={busy || !isValidRoomCode(code) || !nickname}
            >
              {operation === "join" || joining ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>

        {invite}

        {joining && (
          <p className="hint" aria-live="polite">
            Entrando na sala...
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <p className="home-note">Sem conta. Entre apenas com um código.</p>
      </div>
    </main>
  );
}
