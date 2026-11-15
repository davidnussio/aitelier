/**
 * Schema RPC tipizzato tra processo principale (bun) e webview.
 * La chiave API viaggia solo dalla webview al processo principale (quando
 * l'utente la incolla), mai al contrario: la webview vede solo `masked`.
 */
import type { RPCSchema } from "electrobun/main/rpc";
import type {
  EditableSettings,
  JobEvent,
  NewStyleInput,
  SendRequest,
  Settings,
  Slot,
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

      stylesCreateFromBrief: Req<
        { threadId: string; slot: Slot; input: NewStyleInput; brief: string },
        Style
      >;
      /** Apre la finestra nativa di scelta file; `null` se l'utente annulla. */
      stylesCreateFromFile: Req<{ threadId: string; slot: Slot; input: NewStyleInput }, Style | null>;
      stylesUseImage: Req<{ imageId: string; slot: Slot }, Style>;
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
      stylesClear: Req<{ styleId: string }, true>;
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
