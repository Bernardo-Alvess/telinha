# Telinha

Complemento de compartilhamento de tela para usar junto com o Discord no Windows. A voz e o chat ficam no Discord; o Telinha cuida só do vídeo da tela em uma janela flutuante.

## Como funciona

1. Todo mundo fica na call do Discord.
2. Alguém abre o Telinha e clica **Criar sala**.
3. Copia o código e cola no chat do Discord.
4. Os outros abrem o Telinha, colam o código e entram.
5. Qualquer pessoa pode clicar **Compartilhar tela** (ou `Ctrl+Shift+S`).

No seletor dá para incluir áudio e, se houver GPU, ligar o envio por H.264 (NVENC na NVIDIA). A captura da tela continua na CPU.

O vídeo vai do PC de quem compartilha direto para os amigos (WebRTC). O servidor só troca o código da sala e o handshake.

Opcional: **Colocar no Vencord** instala um botão no Discord que abre `telinha://` na sala do canal. Isso altera o cliente do Discord.

## Pré-requisitos

- Windows
- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/)

## Configuração

```bash
cp .env.example .env
cp server/.env.example server/.env
```

No `.env` do app, `VITE_API_URL=http://localhost:3001` serve para desenvolver. O `tauri build` usa `.env.production` (servidor público). Para um `.exe` apontando para localhost, `VITE_ALLOW_LOCAL_API=1`.

TURN é opcional (`VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`). Sem isso o WebRTC usa só STUN e pode falhar em redes restritas.

No servidor, `WS_PUBLIC_URL` fixa a URL pública do WebSocket. `TRUST_PROXY=1` só se estiver atrás de um proxy.

Não commite `.env` com credenciais.

## Desenvolvimento

Terminal 1 — servidor de salas:

```bash
cd server && npm install && npm run dev
```

Terminal 2 — app desktop:

```bash
npm install && npm run tauri dev
```

Ou tudo junto:

```bash
npm install && cd server && npm install && cd .. && npm run dev:all
```

## Testes

```bash
npm test
npm run lint
cd server && npm test && npm run lint
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

O CI do PR só roda `cargo fmt --check` no Rust. Compilar Tauri + Clippy no Windows passava de 10 minutos; o compile de verdade fica no `tauri build` local e no **Release Windows**.

## Build Windows

```bash
npm run tauri build
```

O instalador `.msi` / `.exe` fica em `src-tauri/target/release/bundle/`.

Para gerar o instalador no GitHub sem commitar um release automático: **Actions → Release Windows → Run workflow**. O `.msi` e o `.exe` ficam nos artifacts do run e também num draft em Releases.

## Atalhos

- `Ctrl+Shift+S` — iniciar/parar compartilhamento de tela
- Ícone na bandeja — mostrar a janela ou sair do app
