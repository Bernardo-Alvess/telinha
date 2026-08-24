import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { createTelinhaServer, type TelinhaServer } from "./app.js";

interface RoomSession {
  code: string;
  participantId: string;
  token: string;
  displayName: string;
  wsUrl: string;
}

async function listen(publicWsUrl?: string): Promise<{ server: TelinhaServer; base: string }> {
  const server = createTelinhaServer({ disableRateLimit: true, publicWsUrl });
  await new Promise<void>((resolve) => {
    server.http.listen(0, "127.0.0.1", resolve);
  });
  const address = server.http.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as Record<string, unknown>;
  return { response, data };
}

function signalingUrl(session: RoomSession): string {
  const url = new URL(session.wsUrl);
  url.searchParams.set("code", session.code);
  url.searchParams.set("participantId", session.participantId);
  url.searchParams.set("token", session.token);
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

  it("usa WS_PUBLIC_URL fixa quando configurada", async () => {
    const { server, base } = await listen("https://telinha-server.onrender.com");
    running = server;
    const created = await postJson(`${base}/rooms`, { displayName: "Ana" });
    expect(created.data.wsUrl).toBe("wss://telinha-server.onrender.com/ws");
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
});
