# Telinha

Aplicativo leve de compartilhamento de tela para Windows. Crie uma sala por código, compartilhe uma tela e assista em uma janela separada, sem precisar criar conta.

O Telinha pode acompanhar a chamada que você já usa. Quando o áudio da tela está ativo, ele exclui o processo do Discord para impedir que a voz da chamada volte na transmissão.

## Como funciona

1. Alguém abre o Telinha e clica **Criar sala**.
2. Copia o código e envia para as outras pessoas.
3. Cada pessoa abre o Telinha, cola o código e entra.
4. Qualquer pessoa pode clicar **Compartilhar tela** (ou `Ctrl+Shift+S`).

O Telinha abre diretamente o seletor seguro do Windows uma única vez. O vídeo usa `getDisplayMedia` do Chromium para capturar e codificar pela GPU, sem passar pelo pipeline JPEG. O áudio usa o loopback por processo do Windows para excluir a árvore do Discord e evitar que a call volte na live.

O vídeo vai do PC de quem compartilha direto para os amigos (WebRTC). O servidor só troca o código da sala e o handshake.

O Telinha não modifica o Discord nem instala builds customizadas do Vencord.

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

TURN próprio é opcional (`VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`). Enquanto
ele não estiver configurado, o app usa STUN e um relay público apenas como tentativa. Redes com CGNAT,
firewall corporativo ou UDP bloqueado ainda podem impedir a live; nesse caso o app mostra a falha e
permite copiar as métricas em vez de permanecer indefinidamente em uma tela preta.

No servidor, `WS_PUBLIC_URL` fixa a URL pública do WebSocket. `TRUST_PROXY=1` só se estiver atrás de um proxy.
`MIN_PROTOCOL_VERSION` controla a versão mínima aceita pelo HTTP e WebSocket e usa `2` por padrão.

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

### Teste solo com dois usuários

Execute `npm run dev:solo`, abra `http://127.0.0.1:1420` em duas janelas anônimas separadas e use
um nome em cada uma. Também é possível usar o app Tauri como o primeiro usuário e o navegador como
o segundo. No navegador, deixe o áudio do sistema desativado; o loopback que exclui o Discord só
existe no aplicativo Windows.

Para executar o fluxo automatizado com mídia sintética:

```bash
npm run test:e2e
```

## Testes

```bash
npm test
npm run test:e2e
npm run lint
cd server && npm test && npm run lint
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

O CI sempre roda `cargo fmt --check`. Quando arquivos do Tauri mudam, um job Windows adicional
executa os testes Rust e `cargo clippy --all-targets -- -D warnings`.

## Conexão e diagnóstico

A sala mostra um estado simples de conexão: boa, instável, reconectando ou sem conexão. Em caso
de erro, **Copiar diagnóstico** gera um relatório local com estados e métricas WebRTC. O relatório
não inclui token, código da sala, nomes, SDP, candidatos ICE nem endereços de rede.
O relatório inclui versão do app, codec, bytes, frames decodificados e o tipo de rota ICE, sem expor IPs.

## Build Windows

```bash
npm run tauri build
```

O instalador `.msi` / `.exe` fica em `src-tauri/target/release/bundle/`.

Para gerar o instalador no GitHub sem commitar um release automático: **Actions → Release Windows → Run workflow**. O `.msi` e o `.exe` ficam nos artifacts do run e também num draft em Releases.

## Atalhos

- `Ctrl+Shift+S` — iniciar/parar compartilhamento de tela
- Ícone na bandeja — mostrar a janela ou sair do app
