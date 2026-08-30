import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { createTelinhaServer, type TelinhaServer } from "./app.js";
import { CURRENT_PROTOCOL_VERSION } from "./protocol.js";

interface RoomSession {
  code: string;
  participantId: string;
  token: string;
  displayName: string;
  wsUrl: string;
  protocolVersion?: number;
}

async function listen(publicWsUrl?: string): Promise<{ server: TelinhaServer; base: string }> {
  const server = createTelinhaServer({ disableRateLimit: true, publicWsUrl });
  await new Promise<void>((resolve) => {
    server.http.listen(0, "127.0.0.1", resolve);
  });
  const address = server.http.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function postJson(url: string, body: unknown, includeProtocol = true) {
  const requestBody =
    includeProtocol && body && typeof body === "object" && !Array.isArray(body)
      ? { protocolVersion: CURRENT_PROTOCOL_VERSION, ...body }
      : body;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  const data = (await response.json()) as Record<string, unknown>;
  return { response, data };
}

function signalingUrl(session: RoomSession): string {
  const url = new URL(session.wsUrl);
  url.searchParams.set("code", session.code);
  url.searchParams.set("participantId", session.participantId);
  url.searchParams.set("token", session.token);
  if (session.protocolVersion) {
    url.searchParams.set("protocolVersion", String(session.protocolVersion));
  }
  return url.toString();
}

function waitMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 3000);
    ws.once("message", (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(raw)) as Record<string, unknown>);
    });
    ws.once("error", reject);
  });
}

function waitForType(ws: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting ${type}`)), 3000);
    function onMessage(raw: WebSocket.RawData) {
      const data = JSON.parse(String(raw)) as Record<string, unknown>;
      if (data.type !== type) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(data);
    }
    ws.on("message", onMessage);
    ws.once("error", reject);
  });
}

function waitClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting close")), 3000);
    ws.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    ws.once("error", () => undefined);
  });
}

describe("telinha server", () => {
  let running: TelinhaServer | undefined;

  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  it("cria sala com token e rejeita join inexistente", async () => {
    const { server, base } = await listen();
    running = server;

    const created = await postJson(`${base}/rooms`, { displayName: "Ana" });
    expect(created.response.status).toBe(200);
    expect(created.data.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(created.data.token).toEqual(expect.any(String));

    const missing = await postJson(`${base}/rooms/ZZZZZZ/join`, { displayName: "Bia" });
    expect(missing.response.status).toBe(404);

    const joined = await postJson(`${base}/rooms/${created.data.code}/join`, { displayName: "Bia" });
    expect(joined.response.status).toBe(200);
    expect(joined.data.token).not.toBe(created.data.token);
  });

  it("rejeita código personalizado na criação", async () => {
    const { server, base } = await listen();
    running = server;

    const custom = await postJson(`${base}/rooms`, {
      displayName: "Ana",
      code: "D1198789764279717921",
    });
    expect(custom.response.status).toBe(400);
    expect(custom.data.error).toBe("Código personalizado não é suportado.");
  });

  it("usa WS_PUBLIC_URL fixa quando configurada", async () => {
    const { server, base } = await listen("https://telinha-server.onrender.com");
    running = server;
    const created = await postJson(`${base}/rooms`, { displayName: "Ana" });
    expect(created.data.wsUrl).toBe("wss://telinha-server.onrender.com/ws");
  });

  it("rejeita cliente sem protocolo e aceita a versão atual", async () => {
    const server = createTelinhaServer({ disableRateLimit: true, minProtocolVersion: 2 });
    running = server;
    await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
    const address = server.http.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;

    const legacy = await postJson(`${base}/rooms`, { displayName: "Ana" }, false);
    expect(legacy.response.status).toBe(426);
    expect(legacy.data.code).toBe("UPDATE_REQUIRED");

    const current = await postJson(`${base}/rooms`, { displayName: "Ana", protocolVersion: 2 });
    expect(current.response.status).toBe(200);
    expect(current.data.protocolVersion).toBe(2);

    const session = current.data as unknown as RoomSession;
    const legacyUrl = new URL(signalingUrl(session));
    legacyUrl.searchParams.delete("protocolVersion");
    const legacySocket = new WebSocket(legacyUrl);
    await expect(waitMessage(legacySocket)).resolves.toMatchObject({
      type: "error",
      code: "update-required",
    });
    legacySocket.close();
  });

  it("recusa WebSocket sem token e aceita o assento HTTP", async () => {
    const { server, base } = await listen();
    running = server;
    const { data } = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const session = data as unknown as RoomSession;

    const bad = new WebSocket(`${session.wsUrl}?code=${session.code}&participantId=${session.participantId}`);
    const denied = await waitMessage(bad);
    expect(denied.type).toBe("error");
    bad.close();

    const good = new WebSocket(signalingUrl(session));
    const hello = await waitMessage(good);
    expect(hello.type).toBe("hello");
    good.close();
  });

  it("remove participante por HTTP com token e mantém a saída idempotente", async () => {
    const { server, base } = await listen();
    running = server;
    const hostHttp = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const hostSession = hostHttp.data as unknown as RoomSession;
    const viewerHttp = await postJson(`${base}/rooms/${hostSession.code}/join`, {
      displayName: "Bia",
    });
    const viewerSession = viewerHttp.data as unknown as RoomSession;
    const host = new WebSocket(signalingUrl(hostSession));
    const viewer = new WebSocket(signalingUrl(viewerSession));
    await Promise.all([waitForType(host, "hello"), waitForType(viewer, "hello")]);

    const denied = await fetch(
      `${base}/rooms/${viewerSession.code}/participants/${viewerSession.participantId}`,
      { method: "DELETE", headers: { Authorization: "Bearer errado" } },
    );
    expect(denied.status).toBe(403);

    const leftMessage = waitForType(host, "participant-left");
    const removed = await fetch(
      `${base}/rooms/${viewerSession.code}/participants/${viewerSession.participantId}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${viewerSession.token}` } },
    );
    expect(removed.status).toBe(204);
    await expect(leftMessage).resolves.toMatchObject({
      participantId: viewerSession.participantId,
    });

    const repeated = await fetch(
      `${base}/rooms/${viewerSession.code}/participants/${viewerSession.participantId}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${viewerSession.token}` } },
    );
    expect(repeated.status).toBe(204);
    host.close();
  });

  it("remove também uma identidade estacionada após queda do WebSocket", async () => {
    const { server, base } = await listen();
    running = server;
    const hostHttp = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const hostSession = hostHttp.data as unknown as RoomSession;
    const viewerHttp = await postJson(`${base}/rooms/${hostSession.code}/join`, {
      displayName: "Bia",
    });
    const viewerSession = viewerHttp.data as unknown as RoomSession;
    const host = new WebSocket(signalingUrl(hostSession));
    const viewer = new WebSocket(signalingUrl(viewerSession));
    await Promise.all([waitForType(host, "hello"), waitForType(viewer, "hello")]);
    const offline = waitForType(host, "participant-presence");
    viewer.close();
    await offline;

    const leftMessage = waitForType(host, "participant-left");
    const removed = await fetch(
      `${base}/rooms/${viewerSession.code}/participants/${viewerSession.participantId}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${viewerSession.token}` } },
    );
    expect(removed.status).toBe(204);
    await expect(leftMessage).resolves.toMatchObject({
      participantId: viewerSession.participantId,
    });
    host.close();
  });

  it("avisa o host quando alguém começa a assistir", async () => {
    const { server, base } = await listen();
    running = server;
    const hostHttp = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const hostSession = hostHttp.data as unknown as RoomSession;
    const viewerHttp = await postJson(`${base}/rooms/${hostSession.code}/join`, { displayName: "Bia" });
    const viewerSession = viewerHttp.data as unknown as RoomSession;

    const host = new WebSocket(signalingUrl(hostSession));
    const viewer = new WebSocket(signalingUrl(viewerSession));
    await waitForType(host, "hello");
    await waitForType(viewer, "hello");

    host.send(JSON.stringify({ type: "share-started" }));
    const live = await waitForType(viewer, "share-started");
    expect(live.type).toBe("share-started");

    const noticed = waitForType(host, "watch-started");
    viewer.send(JSON.stringify({ type: "watch-started", to: hostSession.participantId }));
    const payload = await noticed;
    expect(payload.from).toBe(viewerSession.participantId);
    expect(payload.to).toBe(hostSession.participantId);

    host.close();
    viewer.close();
  });

  it("encerra WebSocket que excede o limite de sinalização", async () => {
    const { server, base } = await listen();
    running = server;
    const { data } = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const session = data as unknown as RoomSession;
    const socket = new WebSocket(signalingUrl(session));
    await waitForType(socket, "hello");
    const closing = waitClose(socket);
    socket.send("x".repeat(64 * 1024 + 1));
    await expect(closing).resolves.toBe(1009);
  });

  it("não divulga espectadores para terceiros", async () => {
    const { server, base } = await listen();
    running = server;
    const hostHttp = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const hostSession = hostHttp.data as unknown as RoomSession;
    const viewerHttp = await postJson(`${base}/rooms/${hostSession.code}/join`, { displayName: "Bia" });
    const viewerSession = viewerHttp.data as unknown as RoomSession;
    const thirdHttp = await postJson(`${base}/rooms/${hostSession.code}/join`, { displayName: "Cris" });
    const thirdSession = thirdHttp.data as unknown as RoomSession;
    const host = new WebSocket(signalingUrl(hostSession));
    const viewer = new WebSocket(signalingUrl(viewerSession));
    const third = new WebSocket(signalingUrl(thirdSession));
    await Promise.all([
      waitForType(host, "hello"),
      waitForType(viewer, "hello"),
      waitForType(third, "hello"),
    ]);
    host.send(JSON.stringify({ type: "share-started" }));
    await waitForType(viewer, "share-started");

    let leaked = false;
    third.on("message", (raw) => {
      const data = JSON.parse(String(raw)) as Record<string, unknown>;
      if (data.type === "watch-started") leaked = true;
    });
    const noticed = waitForType(host, "watch-started");
    viewer.send(JSON.stringify({ type: "watch-started", to: hostSession.participantId }));
    await noticed;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(leaked).toBe(false);
    host.close();
    viewer.close();
    third.close();
  });

  it("substitui o WebSocket se o mesmo participante reconectar ainda admitido", async () => {
    const { server, base } = await listen();
    running = server;
    const hostHttp = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const hostSession = hostHttp.data as unknown as RoomSession;
    const viewerHttp = await postJson(`${base}/rooms/${hostSession.code}/join`, { displayName: "Bia" });
    const viewerSession = viewerHttp.data as unknown as RoomSession;

    const host = new WebSocket(signalingUrl(hostSession));
    const first = new WebSocket(signalingUrl(viewerSession));
    await waitForType(host, "hello");
    await waitForType(first, "hello");

    host.send(JSON.stringify({ type: "share-started" }));
    await waitForType(first, "share-started");

    let viewerLeft = false;
    host.on("message", (raw) => {
      const data = JSON.parse(String(raw)) as Record<string, unknown>;
      if (data.type === "participant-left") {
        viewerLeft = true;
      }
    });

    const second = new WebSocket(signalingUrl(viewerSession));
    await waitForType(second, "hello");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(viewerLeft).toBe(false);

    const noticed = waitForType(host, "watch-started");
    second.send(JSON.stringify({ type: "watch-started", to: hostSession.participantId }));
    const payload = await noticed;
    expect(payload.from).toBe(viewerSession.participantId);

    first.close();
    second.close();
    host.close();
  });

  it("mantém a sala e o viewer depois de uma queda curta do WebSocket", async () => {
    const { server, base } = await listen();
    running = server;
    const hostHttp = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const hostSession = hostHttp.data as unknown as RoomSession;
    const viewerHttp = await postJson(`${base}/rooms/${hostSession.code}/join`, { displayName: "Bia" });
    const viewerSession = viewerHttp.data as unknown as RoomSession;

    const host = new WebSocket(signalingUrl(hostSession));
    const viewer = new WebSocket(signalingUrl(viewerSession));
    await waitForType(host, "hello");
    await waitForType(viewer, "hello");
    host.send(JSON.stringify({ type: "share-started" }));
    await waitForType(viewer, "share-started");

    let viewerLeft = false;
    host.on("message", (raw) => {
      const data = JSON.parse(String(raw)) as Record<string, unknown>;
      if (data.type === "participant-left") {
        viewerLeft = true;
      }
    });

    const disconnecting = waitForType(host, "participant-presence");
    viewer.close();
    const disconnected = await disconnecting;
    expect(disconnected).toMatchObject({
      participantId: viewerSession.participantId,
      connected: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(viewerLeft).toBe(false);

    const presence = waitForType(host, "participant-presence");
    const again = new WebSocket(signalingUrl(viewerSession));
    const hello = await waitForType(again, "hello");
    expect(hello.type).toBe("hello");
    await expect(presence).resolves.toMatchObject({
      participantId: viewerSession.participantId,
      connected: true,
    });
    expect(viewerLeft).toBe(false);

    const rejoined = await postJson(`${base}/rooms/${hostSession.code}/join`, { displayName: "Cris" });
    expect(rejoined.response.status).toBe(200);

    again.close();
    host.close();
  });

  it("avisa saída só depois da graça de reconexão", async () => {
    const server = createTelinhaServer({
      disableRateLimit: true,
      reconnectGraceMs: 80,
      cleanupIntervalMs: 20,
    });
    running = server;
    await new Promise<void>((resolve) => {
      server.http.listen(0, "127.0.0.1", resolve);
    });
    const address = server.http.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;

    const hostHttp = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const hostSession = hostHttp.data as unknown as RoomSession;
    const viewerHttp = await postJson(`${base}/rooms/${hostSession.code}/join`, { displayName: "Bia" });
    const viewerSession = viewerHttp.data as unknown as RoomSession;

    const host = new WebSocket(signalingUrl(hostSession));
    const viewer = new WebSocket(signalingUrl(viewerSession));
    await waitForType(host, "hello");
    await waitForType(viewer, "hello");

    viewer.close();
    const left = await waitForType(host, "participant-left");
    expect(left.participantId).toBe(viewerSession.participantId);
    host.close();
  });

  it("preserva o share do host durante uma reconexão", async () => {
    const { server, base } = await listen();
    running = server;
    const created = await postJson(`${base}/rooms`, { displayName: "Ana" });
    expect(created.response.status).toBe(200);
    const hostSession = created.data as unknown as RoomSession;

    const host = new WebSocket(signalingUrl(hostSession));
    await waitForType(host, "hello");
    host.send(JSON.stringify({ type: "share-started" }));
    host.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const again = new WebSocket(signalingUrl(hostSession));
    const hello = await waitForType(again, "hello") as { you?: { sharing?: boolean } };
    expect(hello.you?.sharing).toBe(true);
    again.close();

  });
});
