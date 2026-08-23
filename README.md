# Telinha

Complemento de compartilhamento de tela para usar junto com o Discord. A voz e o chat ficam no Discord; o Telinha cuida só do vídeo da tela em uma janela flutuante sempre visível.

## Como funciona

1. Todo mundo fica na call do Discord.
2. Alguém abre o Telinha e clica **Criar sala**.
3. Copia o código e cola no chat do Discord.
4. Os outros abrem o Telinha, colam o código e entram.
5. Qualquer pessoa pode clicar **Compartilhar tela** (ou usar `Ctrl+Shift+S`).

## Pré-requisitos

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/)
- Conta free no [LiveKit Cloud](https://cloud.livekit.io)

## Configuração

1. Copie as variáveis de ambiente:

```bash
cp server/.env.example server/.env
cp .env.example .env
```

2. Preencha `server/.env` com suas credenciais LiveKit:

```
LIVEKIT_URL=wss://seu-projeto.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

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
