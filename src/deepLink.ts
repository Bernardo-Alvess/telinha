import { parseTelinhaUrl } from "./api";

export type DeepLinkAction =
  | { action: "join"; code: string; name?: string }
  | { action: "open" }
  | { action: "share" };

export function actionFromUrls(urls: string[]): DeepLinkAction | null {
  for (const raw of urls) {
    const parsed = parseTelinhaUrl(raw);
    if (parsed) {
      return parsed.action === "join" && parsed.code
        ? { action: "join", code: parsed.code, name: parsed.name }
        : { action: parsed.action === "share" ? "share" : "open" };
    }
  }
  return null;
}
