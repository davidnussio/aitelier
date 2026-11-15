import type { AppInfo } from "../../shared/rpc";

let info: AppInfo | null = null;

export function setAppInfo(value: AppInfo) {
  info = value;
}

/** URL di un file della cartella dati, servito dal processo principale. */
export function mediaUrl(path: string | null | undefined): string | undefined {
  if (!path || !info) return undefined;
  return `${info.mediaBase}/f/${path}?t=${info.mediaToken}`;
}
