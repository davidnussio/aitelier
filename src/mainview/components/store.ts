import { useSyncExternalStore } from "react";

/** Piccolo store globale per stato condiviso (avvisi, impostazioni). */
export function create<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T | ((prev: T) => T)) {
      value = typeof next === "function" ? (next as (prev: T) => T)(value) : next;
      for (const l of listeners) l();
    },
    use(): T {
      return useSyncExternalStore(
        (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        () => value,
      );
    },
  };
}
