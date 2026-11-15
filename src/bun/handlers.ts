/**
 * Gestori delle richieste RPC, senza import di Electrobun: li usano il guscio
 * desktop (src/bun/index.ts) e il server di anteprima nel browser
 * (scripts/preview.ts). Le funzioni native arrivano come dipendenze.
 */
import fs from "node:fs";
import path from "node:path";
import type { Backups } from "../core/backup";
import { AppError, ProviderError } from "../core/errors";
import type { Files } from "../core/files";
import type { ImageProvider } from "../core/provider";
import type { Studio } from "../core/studio";
import type { AppInfo, AppRPC, Result } from "../shared/rpc";
import type { ApiKeyStatus, BackupState, Settings, VerifyResult } from "../shared/types";
import { readLogTail } from "./log";

type Requests = AppRPC["bun"]["requests"];
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
  backups: Backups;
  demo: boolean;
  info: () => AppInfo;
  /** Cartella proposta la prima volta nella finestra «Salva». */
  picturesDir: string;
  /** Finestra «Salva»: percorso scelto, oppure null se l'utente annulla. */
  chooseSavePath: (defaultName: string, defaultDir: string) => Promise<string | null>;
  pickImage: () => Promise<Uint8Array | null>;
  showItemInFolder: (absPath: string) => void;
  openExternal: (url: string) => void;
  log: {
    file: string;
    info: (message: string) => void;
    error: (message: string, error?: unknown) => void;
  };
}

export function createHandlers(deps: HandlerDeps): Handlers {
  const { studio, files, provider, secrets, backups, demo, pickImage, log } = deps;

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

  // La finestra «Salva» riparte dall'ultima cartella usata.
  let lastSaveDir = deps.picturesDir;

  const backupState = (): BackupState => ({
    folder: backups.dir,
    backups: backups.list(),
    pendingRestore: backups.pendingRestore(),
  });

  return {
    appInfo: async () => handle("appInfo", deps.info),

    threadsList: () => handle("threadsList", () => studio.listThreads()),
    threadsCreate: (p) => handle("threadsCreate", () => studio.createThread(p)),
    threadsUpdate: ({ id, ...patch }) => handle("threadsUpdate", () => studio.updateThread(id, patch)),
    threadsDelete: ({ id }) =>
      handle("threadsDelete", () => {
        studio.deleteThread(id);
        log.info(`Progetto ${id} eliminato`);
        return true as const;
      }),
    threadGet: ({ id }) => handle("threadGet", () => studio.getThread(id)),

    stylesList: () => handle("stylesList", () => studio.listStyles()),
    stylesCreateFromBrief: ({ threadId, input, brief }) =>
      handle("stylesCreateFromBrief", () => studio.createStyleFromBrief(threadId, input, brief).style),
    stylesCreateFromFile: ({ threadId, input }) =>
      handle("stylesCreateFromFile", async () => {
        const bytes = await pickImage();
        return bytes ? studio.createStyleFromFile(threadId, input, bytes) : null;
      }),
    stylesGenerateTrials: ({ styleId }) =>
      handle("stylesGenerateTrials", () => studio.generateTrials(styleId)),
    stylesUseTrial: ({ trialId }) => handle("stylesUseTrial", () => studio.useTrialAsAnchor(trialId)),
    stylesDeleteTrial: ({ trialId }) => handle("stylesDeleteTrial", () => studio.deleteTrial(trialId)),
    stylesUseImage: ({ imageId, styleId }) =>
      handle("stylesUseImage", () => studio.useImageAsStyle(imageId, styleId)),
    stylesAttach: ({ threadId, styleId }) =>
      handle("stylesAttach", () => studio.attachStyle(threadId, styleId)),
    stylesDetach: ({ threadId, styleId }) =>
      handle("stylesDetach", () => {
        studio.detachStyle(threadId, styleId);
        return true as const;
      }),
    stylesDuplicate: ({ styleId, threadId }) =>
      handle("stylesDuplicate", () => studio.duplicateStyle(styleId, threadId ?? null)),
    stylesAddRefFromFile: ({ styleId }) =>
      handle("stylesAddRefFromFile", async () => {
        const bytes = await pickImage();
        return bytes ? studio.addRefFromFile(styleId, bytes) : null;
      }),
    stylesRemoveRef: ({ refId }) => handle("stylesRemoveRef", () => studio.removeRef(refId)),
    stylesUpdate: ({ styleId, patch }) => handle("stylesUpdate", () => studio.updateStyle(styleId, patch)),
    stylesDelete: ({ styleId }) =>
      handle("stylesDelete", () => {
        studio.deleteStyle(styleId);
        log.info(`Stile ${styleId} eliminato dalla libreria`);
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
      handle("imagesExport", async () => {
        if (!studio.image(imageId).path) throw new AppError("L'immagine non è ancora pronta.");
        const target = await deps.chooseSavePath(studio.exportFileName(imageId), lastSaveDir);
        if (!target) return null;
        studio.exportImage(imageId, target);
        lastSaveDir = path.dirname(target);
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
        log.info("Chiave API salvata");
        return settings();
      }),
    apiKeyRemove: () =>
      handle("apiKeyRemove", async () => {
        await secrets.remove();
        log.info("Chiave API rimossa");
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

    backupsGet: () => handle("backupsGet", backupState),
    backupsCreate: () =>
      handle("backupsCreate", () => {
        const info = backups.create("manuale");
        log.info(`Backup manuale creato: ${info.name}`);
        return backupState();
      }),
    backupsRestore: ({ name }) =>
      handle("backupsRestore", () => {
        backups.requestRestore(name);
        log.info(`Ripristino prenotato per il prossimo avvio: ${name}`);
        return backupState();
      }),
    backupsCancelRestore: () =>
      handle("backupsCancelRestore", () => {
        backups.cancelRestore();
        log.info("Ripristino annullato");
        return backupState();
      }),
    backupsReveal: () =>
      handle("backupsReveal", () => {
        fs.mkdirSync(backups.dir, { recursive: true });
        deps.showItemInFolder(backups.dir);
        return true as const;
      }),
    logsRead: () => handle("logsRead", () => ({ file: log.file, text: readLogTail(log.file) })),
    logsReveal: () =>
      handle("logsReveal", () => {
        deps.showItemInFolder(log.file);
        return true as const;
      }),
  };
}
