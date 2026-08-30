import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTelinhaServer } from "./app.js";
import { CURRENT_PROTOCOL_VERSION } from "./protocol.js";

const envDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(envDir, "../.env") });
dotenv.config();

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";
const configuredMinProtocol = Number(
  process.env.MIN_PROTOCOL_VERSION ?? CURRENT_PROTOCOL_VERSION,
);
const minProtocolVersion = Number.isInteger(configuredMinProtocol) && configuredMinProtocol > 0
  ? configuredMinProtocol
  : CURRENT_PROTOCOL_VERSION;

const { http } = createTelinhaServer({
  publicWsUrl: process.env.WS_PUBLIC_URL,
  trustProxy: Boolean(process.env.RENDER || process.env.TRUST_PROXY === "1"),
  minProtocolVersion,
});

http.listen(PORT, HOST, () => {
  console.log(`Telinha server rodando em http://${HOST}:${PORT}`);
});
