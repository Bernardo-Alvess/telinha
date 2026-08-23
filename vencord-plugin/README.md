# Plugin Telinha para Vencord

O instalador do Telinha **não** escreve na pasta do Discord. Este plugin só funciona se o Vencord foi compilado da source.

## Instalar

1. Tenha o Vencord clonado e já injetado (`pnpm build` + `pnpm inject`).
2. Copie a pasta `telinha` para `Vencord/src/userplugins/telinha`.
3. No diretório do Vencord:

```
pnpm build
pnpm inject
```

4. Reinicie o Discord e ative **Telinha** em Ajustes → Plugins.

## Uso

- Botão **Telinha** no canto do Discord abre o app (`telinha://open`).
- Em Ajustes do plugin, coloque o código da sala para o botão entrar direto.
- Comando `/telinha` ou `/telinha AB12`.

O amigo ainda precisa ter o Telinha instalado no PC. O plugin só abre o app.
