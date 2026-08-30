import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConnectionBadge, ErrorNotice } from "./ConnectionStatus";

describe("ConnectionStatus", () => {
  it.each([
    ["good", "Conexão boa"],
    ["unstable", "Conexão instável"],
    ["reconnecting", "Reconectando"],
    ["offline", "Sem conexão"],
  ] as const)("renderiza %s", (quality, label) => {
    expect(renderToStaticMarkup(createElement(ConnectionBadge, { quality }))).toContain(label);
  });

  it("oferece diagnóstico junto do erro", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorNotice, {
        error: "Falha de rede",
        copied: false,
        onCopy: vi.fn(),
      }),
    );
    expect(html).toContain("Falha de rede");
    expect(html).toContain("Copiar diagnóstico");
  });
});
