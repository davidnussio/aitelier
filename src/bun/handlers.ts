/**
 * Gestori delle richieste RPC, senza import di Electrobun: li usano il guscio
 * desktop (src/bun/index.ts) e il server di anteprima nel browser
 * (scripts/preview.ts). Le funzioni native arrivano come dipendenze.
 */
import path from "node:path";
import { AppError, ProviderError } from "../core/errors";
import type { Files } from "../core/files";
import type { ImageProvider } from "../core/provider";
import type { Studio } from "../core/studio";
import type { AppInfo, BottegaRPC, Result } from "../shared/rpc";
import type { ApiKeyStatus, Settings, VerifyResult } from "../shared/types";

type Requests = BottegaRPC["bun"]["requests"];
export type Handlers = {
  [K in keyof Requests]: (params: Requests[K]["params"]) => Promise<Requests[K]["response"]>;
};

export interface KeyStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
  status(): Promise<ApiKeyStatus>;
}

export interface HandlerDeps {
  studio: Studio;
  files: Files;
  provider: ImageProvider;
  secrets: KeyStore;
  demo: boolean;
  info: () => AppInfo;
  picturesDir: string;
  pickImage: () => Promise<Uint8Array | null>;
  showItemInFolder: (absPath: string) => void;
  openExternal: (url: string) => void;
  log: { error: (message: string, error?: unknown) => void };
}

export function createHandlers(deps: HandlerDeps): Handlers {
  const { studio, files, provider, secrets, demo, pickImage, log } = deps;

  /** Ogni richiesta risponde con un valore o con un messaggio già leggibile. */
  async function handle<T>(name: string, fn: () => T | Promise<T>): Promise<Result<T>> {
    try {
      return { ok: true, value: await fn() };
    } catch (error) {
      if (error instanceof AppError) return { ok: false, error: error.message };
      if (error instanceof ProviderError) {
        const e = error.userError;
        return { ok: false, error: `${e.title}. ${e.detail} ${e.action}` };
      }
      log.error(`${name} non riuscita`, error);
      return { ok: false, error: "Qualcosa è andato storto. Riprova; se succede ancora, riavvia l'app." };
    }
  }

  async function settings(): Promise<Settings> {
    return {
      ...studio.settings(),
      apiKey: demo ? { set: true, masked: "demo", storage: null } : await secrets.status(),
      monthCostUsd: studio.monthCostUsd(),
      demo,
    };
  }

  async function verify(apiKey?: string): Promise<VerifyResult> {
    try {
      const models = await provider.verify(apiKey?.trim() || undefined);
      return { ok: true, ...models };
    } catch (error) {
      if (error instanceof ProviderError)
        return { ok: false, error: error.userError, imageModels: [], textModels: [] };
      throw error;
    }
  }

  return {
    appInfo: async () => handle("appInfo", deps.info),

    threadsList: () => handle("threadsList", () => studio.listThreads()),
    threadsCreate: (p) => handle("threadsCreate", () => studio.createThread(p)),
    threadsUpdate: ({ id, ...patch }) => handle("threadsUpdate", () => studio.updateThread(id, patch)),
    threadsDelete: ({ id }) =>
      handle("threadsDelete", () => {
        studio.deleteThread(id);
        return true as const;
      }),
    threadGet: ({ id }) => handle("threadGet", () => studio.getThread(id)),

    stylesCreateFromBrief: ({ threadId, slot, input, brief }) =>
      handle("stylesCreateFromBrief", () => studio.createStyleFromBrief(threadId, slot, input, brief).style),
    stylesCreateFromFile: ({ threadId, slot, input }) =>
      handle("stylesCreateFromFile", async () => {
        const bytes = await pickImage();
        return bytes ? studio.createStyleFromFile(threadId, slot, input, bytes) : null;
      }),
    stylesUseImage: ({ imageId, slot }) =>
      handle("stylesUseImage", () => studio.useImageAsStyle(imageId, slot)),
    stylesAddRefFromFile: ({ styleId }) =>
      handle("stylesAddRefFromFile", async () => {
        const bytes = await pickImage();
        return bytes ? studio.addRefFromFile(styleId, bytes) : null;
      }),
    stylesRemoveRef: ({ refId }) => handle("stylesRemoveRef", () => studio.removeRef(refId)),
    stylesUpdate: ({ styleId, patch }) => handle("stylesUpdate", () => studio.updateStyle(styleId, patch)),
    stylesClear: ({ styleId }) =>
      handle("stylesClear", () => {
        studio.clearStyle(styleId);
        return true as const;
      }),
    stylesRedescribe: ({ styleId }) => handle("stylesRedescribe", () => studio.redescribe(styleId)),

    messagesSend: (req) => handle("messagesSend", () => studio.send(req)),
    imagesRegenerate: ({ imageId }) => handle("imagesRegenerate", () => studio.regenerate(imageId)),
    imagesReveal: ({ imageId }) =>
      handle("imagesReveal", () => {
        const image = studio.image(imageId);
        if (!image.path) throw new AppError("L'immagine non è ancora pronta.");
        deps.showItemInFolder(files.abs(image.path));
        return true as const;
      }),
    imagesExport: ({ imageId }) =>
      handle("imagesExport", () => {
        const target = studio.exportImage(imageId, path.join(deps.picturesDir, "Bottega"));
        deps.showItemInFolder(target);
        return target;
      }),

    settingsGet: () => handle("settingsGet", settings),
    settingsSet: (patch) =>
      handle("settingsSet", async () => {
        studio.saveSettings(patch);
        return settings();
      }),
    apiKeyVerify: ({ apiKey }) => handle("apiKeyVerify", () => verify(apiKey)),
    apiKeySet: ({ apiKey }) =>
      handle("apiKeySet", async () => {
        const key = apiKey.trim();
        if (!key) throw new AppError("Incolla la chiave API.");
        if (/\s/.test(key)) throw new AppError("La chiave non deve contenere spazi.");
        await secrets.set(key);
        return settings();
      }),
    apiKeyRemove: () =>
      handle("apiKeyRemove", async () => {
        await secrets.remove();
        return settings();
      }),
    openExternal: ({ url }) =>
      handle("openExternal", () => {
        if (!/^https:\/\/(platform\.openai\.com|developers\.openai\.com)\//.test(url)) {
          throw new AppError("Indirizzo non ammesso.");
        }
        deps.openExternal(url);
        return true as const;
      }),
  };
}
