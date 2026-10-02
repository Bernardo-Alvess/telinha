import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const useDist = existsSync(new URL("../dist/index.js", import.meta.url));
const args = useDist ? ["dist/index.js"] : ["--import", "tsx", "src/index.ts"];
const child = spawn(process.execPath, args, { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
