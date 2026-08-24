# Revisão de código — Telinha

**Data:** 23 de agosto de 2026  
**Escopo:** cliente Tauri/React (`src/`, `src-tauri/`), servidor de sinalização (`server/`), plugin Vencord (`vencord-plugin/`)  
**Objetivo:** mapear riscos de segurança, qualidade, desempenho e DX, com recomendações práticas e priorizadas.

Este documento é uma revisão estática do código atual. Não inclui pentest, fuzzing nem testes em runtime.

---

## Resumo executivo

O Telinha está bem encaminhado como produto: a divisão Discord (voz/chat) vs. Telinha (vídeo P2P) é clara, a captura nativa no Windows é um caminho sólido, e há sanitização básica de códigos e nomes. O que mais falta é **endurecimento do servidor de salas**, **confiança no pipeline Vencord** e **higiene de engenharia** (testes, lint, CI).

Os riscos mais graves não estão no WebRTC em si, e sim no fato de **qualquer pessoa na internet poder criar/entrar em salas e reler SDP/ICE sem autenticação**, com códigos curtos ou previsíveis (`D` + ID do canal do Discord).

| Severidade | Quantidade | Foco |
|---|---|---|
| Alta | 5 | Autenticação de sala, brute-force, instalador Vencord, deep link |
| Média | 8 | CSP, permissões do WebView, privacidade, TURN, supply chain |
| Baixa | 9 | Bugs de UX, código morto, robustez, performance local |
| Melhoria | 6 | Testes, lint, CI, organização do frontend |

---

## O que está bom

- Códigos de sala e nomes passam por sanitização (`normalizeRoomCode`, `sanitizeDisplayName`, `parseTelinhaUrl`).
- Não há segredos hardcoded. O Discord App ID vem de `TELINHA_DISCORD_APP_ID`.
- A captura ignora janelas do próprio Telinha e limita FPS entre 5 e 60.
- Capabilities do Tauri 2 estão declaradas (clipboard, atalho, janela, deep link).
- Profile de release do Rust usa LTO, strip e `panic = abort`.
- Áudio de janela tenta loopback por PID, em vez de sempre capturar o sistema inteiro.
- Plugin Vencord usa SVG estático e `openExternal` para o protocolo `telinha://`.

---

## Achados — segurança

### [ALT-1] Servidor de sinalização sem autenticação

**Onde:** `server/src/index.ts` (join HTTP ~145–159, WebSocket ~165–190)

O `POST /rooms/:code/join` devolve um `participantId`, mas **esse ID não é persistido na sala**. Na conexão WebSocket, qualquer `participantId` é aceito se a sala existir. O HTTP e o WS não estão ligados.

**Impacto:** um atacante que conheça o código entra na sala, recebe a lista de participantes e relê offer/answer/ICE. Em mesh P2P isso abre caminho para impersonation e, em alguns cenários, para se posicionar no handshake.

**Recomendação:**

1. Ao criar/entrar via HTTP, guardar `{ participantId, token, displayName, expiresAt }` na sala.
2. Exigir o token no WebSocket (`?token=` ou header).
3. Recusar IDs que não tenham vindo do HTTP.
4. Invalidar o token após o primeiro uso (ou rotacionar).

### [ALT-2] Códigos de 4 caracteres sem rate limit

**Onde:** `server/src/index.ts` (`CODE_LENGTH = 4`, `CODE_CHARS` ~32 símbolos, CORS aberto, sem limiter)

O espaço é ~1 milhão de códigos. Sem autenticação, sem CAPTCHA e sem rate limit, enumerar salas ocupadas é viável.

**Recomendação:** códigos de 6–8 caracteres; rate limit por IP em `/rooms` e `/rooms/:code/join`; backoff no WS; opcionalmente um “segredo” curto além do código.

### [ALT-3] `join` cria a sala e códigos Discord são públicos

**Onde:** `server/src/index.ts` (`getOrCreateRoom` no join); `vencord-plugin/telinha/index.tsx` (`D${voiceId}`)

Qualquer um que conheça o snowflake do canal (visível no Discord) entra ou **cria** a sala `D{channelId}` antes dos participantes reais.

**Recomendação:** só criar sala em `POST /rooms`. Join em sala inexistente deve retornar 404. Para salas Discord, exigir prova de presença (token assinado pelo plugin, ou um host que “abra” a sala).

### [ALT-4] Download e execução do instalador Vencord sem integridade

**Onde:** `src-tauri/src/vencord.rs`

O app baixa `VencordInstallerCli.exe` do GitHub (`/latest/`), aceita qualquer arquivo > 500 KB, reutiliza cache local e executa oculto (`CREATE_NO_WINDOW`). Fallback via PowerShell com `-ExecutionPolicy Bypass`. Depois escreve em `%APPDATA%\Vencord` e desliga `autoUpdate`.

**Impacto:** supply-chain e execução de binário não verificado com privilégios do usuário. Também modifica o cliente Discord (risco de ToS e de persistência).

**Recomendação:**

- Fixar URL de release + hash SHA-256 (ou assinatura).
- Não reutilizar cache sem verificar o hash.
- Pedir confirmação explícita na UI (o que será baixado, o que será alterado).
- Preferir bundle local auditado em vez de `/latest/`.
- Evitar `ExecutionPolicy Bypass` se o `curl` falhar — falhe de forma visível.

### [ALT-5] Deep link entra na sala sem confirmação

**Onde:** `src/App.tsx` (~29–38, 90–108); `src/deepLink.ts`; `src/api.ts`

Qualquer processo local (ou página que abra `telinha://join/...`) força o app a entrar na sala e pode gravar o `name` no `localStorage`.

**Recomendação:** confirmar na UI (“Entrar na sala AB12 como Fulano?”). Não aplicar `share` automaticamente se o usuário não estiver em uma sala. Validar origem quando possível.

---

## Achados — segurança / configuração (média)

### [MED-1] CSP desligado

**Onde:** `src-tauri/tauri.conf.json` (`"csp": null`)

Sem Content Security Policy, um XSS no webview vira RCE de IPC (todos os commands Tauri ficam alcançáveis).

**Recomendação:** CSP restritiva (`default-src 'self'`; `connect-src` só no API/WS de produção; sem `unsafe-eval` se possível).

### [MED-2] WebView libera permissões desconhecidas

**Onde:** `src-tauri/src/webview_permissions.rs`

```rs
kind == MICROPHONE || kind == CAMERA || kind.0 > 12
```

O `> 12` trata tipos futuros/desconhecidos como mídia e **autoriza automaticamente**.

**Recomendação:** allowlist explícita só de microfone/câmera. Negar o resto.

### [MED-3] Superfície HTTP do servidor aberta demais

**Onde:** `server/src/index.ts`

- `cors()` sem origem
- `listen(PORT, "0.0.0.0")`
- `wsUrlFromRequest` confia em `X-Forwarded-Proto` e `Host`

Fora de um proxy que sobrescreva esses headers, um cliente pode receber `wsUrl` apontando para um host atacante.

**Recomendação:** CORS allowlist; `trust proxy` só atrás do Render; `WS_PUBLIC_URL` fixa em produção; bind em `127.0.0.1` no dev.

### [MED-4] Thumbnails de todas as janelas

**Onde:** `src-tauri/src/capture.rs` (`list_share_sources`); `src/components/ScreenSharePicker.tsx` (poll a cada 3s)

Cada refresh captura JPEG de **todas** as janelas visíveis (banco, senhas, e-mail) e manda em base64 para o webview.

**Recomendação:** thumbnails sob demanda ou só da aba ativa; intervalo maior; blur/baixa resolução; pausar o poll quando a janela não está visível.

### [MED-5] WebRTC só com STUN público

**Onde:** `src/hooks/useTelinhaRoom.ts` (`stun.l.google.com`)

Sem TURN, redes simétricas/corporativas falham. O app até mostra um erro, mas a experiência quebra.

**Recomendação:** TURN próprio (coturn) ou serviço gerenciado; fallback de qualidade; não depender só do STUN do Google.

### [MED-6] Dist do Vencord commitado e difícil de auditar

**Onde:** `src-tauri/resources/vencord-dist/`

JS minificado de terceiro no instalador. A conformidade GPL depende de `SOURCE.txt` / `LICENSE-VENCORD.txt`. Não há build reproduzível no CI.

**Recomendação:** gerar o bundle no CI a partir de um commit pinado; publicar source tarball; documentar a versão.

### [MED-7] Modificar o Discord viola os Termos de Serviço

O fluxo Vencord injeta UI no cliente oficial. Isso é risco de produto (ban), não só técnico.

**Recomendação:** deixar o plugin **opcional e explícito**, com aviso claro. Manter o fluxo “código no chat” como caminho principal.

### [MED-8] Commands Tauri sem validação de domínio

`start_share_capture`, `list_share_sources`, `install_vencord_plugin` e `set_window_layout` são invocáveis pelo webview sem checagem extra. Com CSP nula, XSS = captura de tela + instalação de binário.

**Recomendação:** CSP (MED-1) + validar `id` (`screen:`/`window:` + número), `layout` (enum) e confirmar ações destrutivas.

---

## Achados — qualidade e bugs

### [BAI-1] Campo de código corta salas Discord

**Onde:** `src/components/HomeScreen.tsx` (`maxLength={6}`)

O servidor aceita `D` + 16–22 dígitos (até ~23 caracteres) e códigos 4–8. O input da home só deixa 6. Quem tentar colar um código `D…` pela UI falha.

**Recomendação:** `maxLength={24}` alinhado a `isValidRoomCode`.

### [BAI-2] WebSocket não reconecta

**Onde:** `src/hooks/useTelinhaRoom.ts`

Existe `ConnectionState.Reconnecting`, mas nunca é usado. No `close`, o estado vai direto para `Disconnected`. Queda curta de rede encerra a sessão.

**Recomendação:** backoff (1s, 2s, 4s…), rejoin com o mesmo token, e só então mostrar erro definitivo.

### [BAI-3] `createRoom` / `joinRoom` não validam o JSON

**Onde:** `src/api.ts`

`response.json()` roda antes de checar `ok`. Resposta HTML (proxy, 502) vira erro opaco. O tipo `RoomSession` é assumido sem guarda.

**Recomendação:** checar status, `Content-Type` e um type guard (`code`, `participantId`, `wsUrl`).

### [BAI-4] Código morto e naming legado

- `src/displayCapture.ts` não é importado.
- `startLegacyEncodedShare` é o **único** caminho de share.

**Recomendação:** remover o morto ou reativar de propósito; renomear a função.

### [BAI-5] Hook de sala grande demais

`useTelinhaRoom.ts` (~650 linhas) mistura sinalização, mesh WebRTC, captura nativa e bitrate. `ConnectionState`, `ShareSource` e `NAME_KEY` se repetem em outros arquivos.

**Recomendação:** quebrar em `useSignaling`, `usePeerMesh`, `useNativeShare`; tipos em `src/types.ts`.

### [BAI-6] Deep link só registra em debug

**Onde:** `src-tauri/src/lib.rs` (`register_all` só com `debug_assertions`)

Em release, o esquema depende do instalador. Vale um teste do MSI e um fallback documentado.

### [BAI-7] `always_on_top` no foco

**Onde:** `src-tauri/src/lib.rs` (`WindowEvent::Focused`)

Toda vez que a janela ganha foco ela vai para frente de tudo; ao perder, o flag é desligado. Comporta-se de forma estranha no modo watch em janela.

**Recomendação:** always-on-top só como opção explícita, ou só no layout `watch`.

### [BAI-8] `unwrap` no ícone da bandeja

**Onde:** `src-tauri/src/lib.rs`

`app.default_window_icon().unwrap()` derruba o processo se o ícone faltar. Preferir `ok()` + ícone padrão.

### [BAI-9] Plugin Vencord frágil contra mudanças de DOM

`vencord-plugin/telinha/index.tsx` clona nós do Discord e observa o `document.body`. Qualquer redesign quebra o botão.

**Recomendação:** selectors mais estáveis, feature detection e falha silenciosa com toast.

---

## Achados — desempenho

### [PERF-1] JPEG em base64 no IPC a 60 fps

**Onde:** `capture.rs` (`encode_jpeg` + `emit`); `shareVideo.ts` (`atob` byte a byte)

O caminho é: RGBA → clone → RGB → JPEG → base64 → evento Tauri → `atob` em JS → `ImageBitmap` → WebRTC. Em 1440p/60 isso é CPU e memória altos, com latência extra.

**Recomendação (nessa ordem):**

1. Enviar bytes binários (não base64).
2. Evitar `img.clone()` em `encode_jpeg`.
3. Considerar frames raw/NV12 ou encoder de hardware depois.

### [PERF-2] Drain de áudio byte a byte

**Onde:** `src-tauri/src/audio.rs` (`drain_chunks`)

`pop_front()` por byte em `VecDeque<u8>` é desnecessário. Drene um chunk com `drain(..chunk_bytes)`.

### [PERF-3] Picker recaptura tudo a cada 3s

Já citado em MED-4. Além da privacidade, é caro com muitas janelas.

### [PERF-4] Mesh WebRTC O(n²)

Cada sharer oferece para todos. Para 2–4 amigos está ok; para um grupo maior, não escala.

**Recomendação:** documentar o limite; no futuro, SFU.

---

## Engenharia, testes e DX

| Item | Estado | Ação |
|---|---|---|
| Testes automatizados | Nenhum (TS, Rust ou servidor) | Começar por `parseTelinhaUrl`, `normalizeRoomCode`, `isValidRoomCode`, `actionFromUrls` |
| ESLint / rustfmt no CI | Ausente | ESLint + `clippy` + `fmt` no PR |
| CI | Sem `.github/workflows` | lint, `tsc`, `cargo check`, teste do server |
| Logging | `console.log` no server; erros engolidos no cliente | logger com nível; não silenciar `catch {}` sem métrica |
| Observabilidade | Só `GET /health` | métricas de salas, WS, erros de signaling |
| Variáveis de ambiente | `VITE_API_URL` fácil de esquecer no build do `.exe` | falhar o build se a URL de prod não estiver definida |

---

## Plano sugerido

### Agora (segurança)

1. Não criar sala no `join`; exigir token no WebSocket.
2. Rate limit + códigos mais longos.
3. Hash do instalador Vencord + confirmação na UI.
4. Confirmar deep link antes de entrar.
5. Allowlist de permissões no WebView e CSP mínima.

### Em seguida (qualidade)

6. Corrigir `maxLength` do código.
7. Reconnect do WebSocket.
8. Type guards na API HTTP.
9. Remover `displayCapture.ts` / renomear `startLegacyEncodedShare`.
10. Pausar thumbnails quando o picker não está visível.

### Depois (base)

11. Vitest nos parsers; um teste de integração do server com `ws`.
12. ESLint + clippy + CI.
13. TURN e URL pública fixa.
14. IPC binário no pipeline de frames.

---

## Referência rápida de commands Tauri

| Command | Risco se abusado |
|---|---|
| `list_share_sources` | Thumbnails de todas as janelas |
| `start_share_capture` / `stop_share_capture` | Captura contínua de tela/áudio |
| `resolve_share_source` | Match por título de janela |
| `install_vencord_plugin` | Download + exec + escrita em AppData |
| `set_window_layout` | Fullscreen / always-on-top |
| `copy_to_clipboard` | Texto arbitrário na área de transferência |
| `set_discord_presence` | Expõe o código da sala no Discord |
| `show_main_window` | Traz a janela para frente |

---

## Fora desta revisão

- Teste do instalador MSI em máquina limpa.
- Análise jurídica completa do Vencord / Discord ToS (só o risco foi registrado).
- Benchmark de CPU/GPU da captura em 1440p/60.
- Revisão linha a linha do JS minificado em `vencord-dist/`.
