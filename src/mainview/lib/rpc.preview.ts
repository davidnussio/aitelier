/**
 * Ponte per l'anteprima nel browser (scripts/preview.ts): stesse funzioni di
 * rpc.ts, ma via HTTP verso un server locale che usa il core in modalità demo.
 */
import type { BottegaRPC, Result } from "../../shared/rpc";
import type { JobEvent } from "../../shared/types";

type Requests = BottegaRPC["bun"]["requests"];
type Value<R> = Extract<R, { ok: true }> extends { value: infer T } ? T : never;

const jobListeners = new Set<(event: JobEvent) => void>();
new EventSource("/events").addEventListener("message", (e) => {
  const event = JSON.parse((e as MessageEvent<string>).data) as JobEvent;
  for (const listener of jobListeners) listener(event);
});

export function onJobUpdate(listener: (event: JobEvent) => void): () => void {
  jobListeners.add(listener);
  return () => jobListeners.delete(listener);
}

export async function call<K extends keyof Requests>(
  name: K,
  params: Requests[K]["params"],
): Promise<Value<Requests[K]["response"]>> {
  const res = await fetch(`/rpc/${String(name)}`, { method: "POST", body: JSON.stringify(params ?? {}) });
  const result = (await res.json()) as Result<unknown>;
  if (!result.ok) throw new Error(result.error);
  return result.value as Value<Requests[K]["response"]>;
}

export function reportError(message: string) {
  console.error(message);
}
