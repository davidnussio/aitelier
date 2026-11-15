/**
 * Coda di lavori in memoria: al massimo `concurrency` lavori insieme.
 * I nuovi tentativi valgono solo per errori temporanei (rete, 429, 5xx).
 */
import { ProviderError } from "./errors";

export class JobQueue {
  #running = 0;
  readonly #pending: (() => Promise<void>)[] = [];
  #idleWaiters: (() => void)[] = [];

  constructor(private readonly concurrency = 2) {}

  push(task: () => Promise<void>): void {
    this.#pending.push(task);
    this.#next();
  }

  get size(): number {
    return this.#running + this.#pending.length;
  }

  /** Si risolve quando non ci sono più lavori (usato nei test). */
  idle(): Promise<void> {
    if (this.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.push(resolve));
  }

  #next(): void {
    while (this.#running < this.concurrency && this.#pending.length > 0) {
      const task = this.#pending.shift()!;
      this.#running++;
      void task()
        .catch(() => {
          // Ogni lavoro gestisce e registra i propri errori.
        })
        .finally(() => {
          this.#running--;
          this.#next();
          if (this.size === 0) {
            const waiters = this.#idleWaiters;
            this.#idleWaiters = [];
            for (const w of waiters) w();
          }
        });
    }
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const retries = options.retries ?? 2;
  const base = options.baseDelayMs ?? 2000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const retryable = error instanceof ProviderError && error.retryable;
      if (!retryable || attempt >= retries) throw error;
      await sleep(base * 3 ** attempt);
    }
  }
}
