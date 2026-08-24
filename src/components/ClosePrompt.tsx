interface ClosePromptProps {
  inRoom: boolean;
  isSharing: boolean;
  onMinimize: () => void;
  onLeaveRoom: () => void;
  onQuit: () => void;
  onCancel: () => void;
}

export function ClosePrompt({
  inRoom,
  isSharing,
  onMinimize,
  onLeaveRoom,
  onQuit,
  onCancel,
}: ClosePromptProps) {
  return (
    <div className="notice-overlay">
      <div className="notice close-prompt">
        <strong>{isSharing ? "Você ainda está no ar" : "Fechar a Telinha?"}</strong>
        <p>
          {isSharing
            ? "Minimizar esconde a janela, mas a transmissão continua. Encerrar para o app de verdade."
            : inRoom
              ? "Minimizar esconde a janela e você permanece na sala. Encerrar fecha o app."
              : "Minimizar manda para a bandeja. Encerrar fecha o app."}
        </p>
        <div className="notice-actions close-prompt-actions">
          <button type="button" className="btn btn-secondary" onClick={onMinimize}>
            Minimizar
          </button>
          {inRoom && (
            <button type="button" className="btn btn-secondary" onClick={onLeaveRoom}>
              Sair da sala
            </button>
          )}
          <button type="button" className="btn btn-danger" onClick={onQuit}>
            Encerrar
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Voltar
          </button>
        </div>
      </div>
    </div>
  );
}
