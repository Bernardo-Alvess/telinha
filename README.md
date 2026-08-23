# Telinha

Complemento de compartilhamento de tela para usar junto com o Discord. A voz e o chat ficam no Discord; o Telinha cuida só do vídeo da tela em uma janela flutuante sempre visível.

## Como funciona

1. Todo mundo fica na call do Discord.
2. Alguém abre o Telinha e clica **Criar sala**.
3. Copia o código e cola no chat do Discord.
4. Os outros abrem o Telinha, colam o código e entram.
5. Qualquer pessoa pode clicar **Compartilhar tela** (ou usar `Ctrl+Shift+S`).

O vídeo vai do PC de quem compartilha direto para os amigos (WebRTC). O servidor só troca o código da sala e o handshake.

## Pré-requisitos

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/)

## Configuração

```bash
cp .env.example .env
```

Para desenvolvimento local, `VITE_API_URL=http://localhost:3001`. No `.exe` que vai para os amigos, use a URL pública do servidor (`https://telinha-server.onrender.com`).

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

## Build Windows

```bash
npm run tauri build
```

O instalador `.msi` / `.exe` ficará em `src-tauri/target/release/bundle/`.

## Atalhos

- `Ctrl+Shift+S` — iniciar/parar compartilhamento de tela
- Ícone na bandeja — mostrar ou sair do app
