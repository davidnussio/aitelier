/**
 * Schema RPC tipizzato tra processo principale (bun) e webview.
 * La chiave API viaggia solo dalla webview al processo principale (quando
 * l'utente la incolla), mai al contrario: la webview vede solo `masked`.
 */
import type { RPCSchema } from "electrobun/main/rpc";
import type {
  BackupState,
  EditableSettings,
  JobEvent,
  NewStyleInput,
  SendRequest,
  Settings,
  Style,
  StyleDescription,
  StyleParams,
  Thread,
  ThreadDetail,
  ThreadSummary,
  VerifyResult,
} from "./types";

/** Risposta comune: o il valore, o un errore già scritto per l'utente. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface AppInfo {
  version: string;
  mediaBase: string;
  mediaToken: string;
  demo: boolean;
  dataDir: string;
}

type Req<P, R> = { params: P; response: Result<R> };

export type BottegaRPC = {
  bun: RPCSchema<{
    requests: {
      appInfo: Req<{}, AppInfo>;

      threadsList: Req<{}, ThreadSummary[]>;
      threadsCreate: Req<{ title: string; contextNotes: string }, Thread>;
      threadsUpdate: Req<
        { id: string; title?: string; contextNotes?: string; textLanguage?: string },
        Thread
      >;
      threadsDelete: Req<{ id: string }, true>;
      threadGet: Req<{ id: string }, ThreadDetail>;

      /** La libreria: tutti gli stili, usati o no. */
      stylesList: Req<{}, Style[]>;
      /** `threadId` null = dalla libreria: le prove restano nella scheda dello stile. */
      stylesCreateFromBrief: Req<{ threadId: string | null; input: NewStyleInput; brief: string }, Style>;
      stylesGenerateTrials: Req<{ styleId: string }, Style>;
      stylesUseTrial: Req<{ trialId: string }, Style>;
      stylesDeleteTrial: Req<{ trialId: string }, Style>;
      /** Apre la finestra nativa di scelta file; `null` se l'utente annulla. */
      stylesCreateFromFile: Req<{ threadId: string | null; input: NewStyleInput }, Style | null>;
      /** `styleId` null = nuovo stile da questa immagine. */
      stylesUseImage: Req<{ imageId: string; styleId: string | null }, Style>;
      stylesAttach: Req<{ threadId: string; styleId: string }, Style>;
      stylesDetach: Req<{ threadId: string; styleId: string }, true>;
      stylesDuplicate: Req<{ styleId: string; threadId?: string | null }, Style>;
      stylesAddRefFromFile: Req<{ styleId: string }, Style | null>;
      stylesRemoveRef: Req<{ refId: string }, Style>;
      stylesUpdate: Req<
        {
          styleId: string;
          patch: Partial<{
            name: string;
            color: string;
            description: StyleDescription;
            params: StyleParams;
            locked: boolean;
          }>;
        },
        Style
      >;
      stylesDelete: Req<{ styleId: string }, true>;
      stylesRedescribe: Req<{ styleId: string }, Style>;

      messagesSend: Req<SendRequest, { messageId: string; imageIds: string[] }>;
      imagesRegenerate: Req<{ imageId: string }, { messageId: string; imageIds: string[] }>;
      imagesReveal: Req<{ imageId: string }, true>;
      /** Copia l'immagine nella cartella Immagini/Bottega e la mostra nel Finder. */
      imagesExport: Req<{ imageId: string }, string>;

      settingsGet: Req<{}, Settings>;
      settingsSet: Req<Partial<EditableSettings>, Settings>;
      /** Verifica la chiave passata o, se manca, quella salvata. */
      apiKeyVerify: Req<{ apiKey?: string }, VerifyResult>;
      apiKeySet: Req<{ apiKey: string }, Settings>;
      apiKeyRemove: Req<{}, Settings>;
      openExternal: Req<{ url: string }, true>;

      backupsGet: Req<{}, BackupState>;
      backupsCreate: Req<{}, BackupState>;
      /** Prenota il ripristino: avviene al prossimo avvio dell'app. */
      backupsRestore: Req<{ name: string }, BackupState>;
      backupsCancelRestore: Req<{}, BackupState>;
      backupsReveal: Req<{}, true>;
      logsRead: Req<{}, { file: string; text: string }>;
      logsReveal: Req<{}, true>;
    };
    messages: {
      webviewLog: { level: "warn" | "error"; message: string };
    };
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      jobUpdate: JobEvent;
    };
  }>;
};
