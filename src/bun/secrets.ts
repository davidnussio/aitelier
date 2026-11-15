/**
 * Chiave API OpenAI nel portachiavi del sistema tramite Bun.secrets
 * (Portachiavi macOS, Credential Manager di Windows, libsecret su Linux).
 * Ripiego: secrets.json nella cartella dati con permessi 600. Mai nel
 * database, così una copia di app.db non porta con sé la chiave.
 */
import { secrets } from "bun";
import fs from "node:fs";
import path from "node:path";
import type { ApiKeyStatus } from "../shared/types";

const NAME = "openai-api-key";

export class SecretStore {
  readonly #service: string;
  readonly #fallbackPath: string;
  #storeUnavailable = false;
  #cache: string | null | undefined;
  #log: (message: string, error?: unknown) => void;

  constructor(options: {
    service: string;
    dataDir: string;
    log?: (message: string, error?: unknown) => void;
  }) {
    this.#service = options.service;
    this.#fallbackPath = path.join(options.dataDir, "secrets.json");
    this.#log = options.log ?? (() => {});
  }

  #disable(error: unknown) {
    if (!this.#storeUnavailable) this.#log("Portachiavi non disponibile, uso secrets.json", error);
    this.#storeUnavailable = true;
  }

  #readFile(): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(this.#fallbackPath, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  }

  #writeFile(data: Record<string, string>) {
    if (Object.keys(data).length === 0) {
      fs.rmSync(this.#fallbackPath, { force: true });
      return;
    }
    fs.writeFileSync(this.#fallbackPath, JSON.stringify(data), { mode: 0o600 });
    fs.chmodSync(this.#fallbackPath, 0o600);
  }

  async get(): Promise<string | null> {
    if (this.#cache !== undefined) return this.#cache;
    let value: string | null = null;
    if (!this.#storeUnavailable) {
      try {
        value = await secrets.get({ service: this.#service, name: NAME });
      } catch (error) {
        this.#disable(error);
      }
    }
    value ??= this.#readFile()[NAME] ?? null;
    this.#cache = value;
    return value;
  }

  async set(value: string): Promise<void> {
    if (!this.#storeUnavailable) {
      try {
        await secrets.set({ service: this.#service, name: NAME, value });
        const data = this.#readFile();
        delete data[NAME];
        this.#writeFile(data);
        this.#cache = value;
        return;
      } catch (error) {
        this.#disable(error);
      }
    }
    this.#writeFile({ ...this.#readFile(), [NAME]: value });
    this.#cache = value;
  }

  async remove(): Promise<void> {
    if (!this.#storeUnavailable) {
      try {
        await secrets.delete({ service: this.#service, name: NAME });
      } catch (error) {
        this.#disable(error);
      }
    }
    const data = this.#readFile();
    delete data[NAME];
    this.#writeFile(data);
    this.#cache = null;
  }

  async status(): Promise<ApiKeyStatus> {
    const key = await this.get();
    if (!key) return { set: false, masked: null, storage: null };
    return { set: true, masked: maskKey(key), storage: this.#storeUnavailable ? "file" : "keychain" };
  }
}

export function maskKey(key: string): string {
  const prefix = key.startsWith("sk-") ? "sk-" : "";
  return `${prefix}...${key.slice(-4)}`;
}
