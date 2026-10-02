import { APP_VERSION } from "./protocol";

export interface UpdateDecision {
  required: boolean;
  version: string;
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string) =>
    value.split(".").map((part) => {
      const match = /^(\d+)/.exec(part);
      return match ? Number(match[1]) : 0;
    });
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function decideUpdate(input: {
  current?: string;
  minimum?: string | null;
  available?: string | null;
}): UpdateDecision | null {
  const current = input.current ?? APP_VERSION;
  const belowMinimum = Boolean(input.minimum) && compareVersions(current, input.minimum!) < 0;
  const availableNewer = Boolean(input.available) && compareVersions(current, input.available!) < 0;
  if (belowMinimum) {
    return { required: true, version: availableNewer ? input.available! : input.minimum! };
  }
  if (availableNewer) return { required: false, version: input.available! };
  return null;
}

export async function findAvailableUpdate(): Promise<string | null> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    return update?.version ?? null;
  } catch {
    return null;
  }
}

export async function installAvailableUpdate(
  onProgress: (ratio: number | null) => void,
): Promise<void> {
  const [{ check }, { relaunch }] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/plugin-process"),
  ]);
  const update = await check();
  if (!update) {
    throw new Error("Nenhuma atualização publicada.");
  }
  let received = 0;
  let total = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
      onProgress(total > 0 ? 0 : null);
    } else if (event.event === "Progress") {
      received += event.data.chunkLength;
      onProgress(total > 0 ? Math.min(1, received / total) : null);
    } else if (event.event === "Finished") {
      onProgress(1);
    }
  });
  await relaunch();
}
