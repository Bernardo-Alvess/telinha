import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTelinhaServer } from "./app.js";

const envDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(envDir, "../.env") });
dotenv.config();

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";

const { http } = createTelinhaServer({
  publicWsUrl: process.env.WS_PUBLIC_URL,
  trustProxy: Boolean(process.env.RENDER || process.env.TRUST_PROXY === "1"),
});

http.listen(PORT, HOST, () => {
  console.log(`Telinha server rodando em http://${HOST}:${PORT}`);
});
