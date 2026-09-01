import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const ownedProcesses = [];
let cleanupPromise;

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function isReachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function startProcess(label, arguments_, environment = {}) {
  const child = spawn(process.execPath, arguments_, {
    cwd: projectRoot,
    env: { ...process.env, ...environment },
    stdio: "inherit",
    windowsHide: true,
  });

  ownedProcesses.push({ child, label });
  return child;
}

async function waitUntilReady(label, url, child) {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`${label} encerrou antes de ficar pronto.`);
    }

    if (await isReachable(url)) return;
    await delay(250);
  }

  throw new Error(`Tempo esgotado aguardando ${label} em ${url}.`);
}

async function ensureService({ label, url, arguments_, environment }) {
  if (await isReachable(url)) {
    console.log(`[e2e] Reutilizando ${label} em ${url}`);
    return;
  }

  console.log(`[e2e] Iniciando ${label}`);
  const child = startProcess(label, arguments_, environment);
  await waitUntilReady(label, url, child);
}

function waitForExit(child, timeout) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeout);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };

    child.once("exit", onExit);
  });
}

async function stopProcess({ child, label }) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;

  console.log(`[e2e] Encerrando ${label}`);
  child.kill();
  if (await waitForExit(child, 1_500)) return;

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGKILL");
  }

  await waitForExit(child, 1_500);
}

function cleanup() {
  cleanupPromise ??= Promise.all(
    [...ownedProcesses].reverse().map((process_) => stopProcess(process_)),
  );
  return cleanupPromise;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await cleanup();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

try {
  await ensureService({
    label: "servidor de sinalização",
    url: "http://127.0.0.1:3001/health",
    arguments_: [path.join(projectRoot, "server", "dist", "index.js")],
  });
  await ensureService({
    label: "servidor Vite",
    url: "http://127.0.0.1:1420",
    arguments_: [
      path.join(projectRoot, "node_modules", "vite", "bin", "vite.js"),
      "--host",
      "127.0.0.1",
    ],
    environment: {
      VITE_API_URL: "http://127.0.0.1:3001",
      VITE_E2E_MEDIA: "1",
    },
  });

  const playwright = spawn(
    process.execPath,
    [
      path.join(projectRoot, "node_modules", "@playwright", "test", "cli.js"),
      "test",
      ...process.argv.slice(2),
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, PLAYWRIGHT_EXTERNAL_SERVERS: "1" },
      stdio: "inherit",
      windowsHide: true,
    },
  );

  const exitCode = await new Promise((resolve, reject) => {
    playwright.once("error", reject);
    playwright.once("exit", (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
  process.exitCode = exitCode;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await cleanup();
}
