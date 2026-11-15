/**
 * Ponte RPC lato webview. `call` restituisce il valore o lancia un Error con
 * il messaggio già scritto per l'utente dal processo principale.
 */
import { Electroview } from "electrobun/view";
import type { BottegaRPC, Result } from "../../shared/rpc";
import type { JobEvent } from "../../shared/types";

type Requests = BottegaRPC["bun"]["requests"];
type Value<R> = Extract<R, { ok: true }> extends { value: infer T } ? T : never;

const jobListeners = new Set<(event: JobEvent) => void>();

export function onJobUpdate(listener: (event: JobEvent) => void): () => void {
  jobListeners.add(listener);
  return () => jobListeners.delete(listener);
}

const rpc = Electroview.defineRPC<BottegaRPC>({
  maxRequestTime: 60_000,
  handlers: {
    requests: {},
    messages: {
      jobUpdate: (event) => {
        for (const listener of jobListeners) listener(event);
      },
    },
  },
});

export const electroview = new Electroview({ rpc });

export async function call<K extends keyof Requests>(
  name: K,
  params: Requests[K]["params"],
): Promise<Value<Requests[K]["response"]>> {
  const request = electroview.rpc?.request as unknown as Record<
    string,
    (p: unknown) => Promise<Result<unknown>>
  >;
  if (!request) throw new Error("L'app non è ancora pronta, riprova tra un momento.");
  const result = await request[name as string]!(params);
  if (!result.ok) throw new Error(result.error);
  return result.value as Value<Requests[K]["response"]>;
}

export function reportError(message: string) {
  try {
    electroview.rpc?.send.webviewLog({ level: "error", message });
  } catch {
    // Il log è un aiuto.
  }
}
