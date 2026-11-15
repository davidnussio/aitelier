/**
 * Tipi di dominio condivisi tra processo principale, core e webview.
 * Nessun import da Electrobun: il core resta indipendente dal guscio desktop.
 */

export type Format = "square" | "landscape" | "portrait";
export type Quality = "low" | "medium" | "high";
export type StyleKind = "illustrazione" | "infografica";
/** "veloce" = modello Flare del thread, "preciso" = modello Sunburst del thread. */
export type ModelChoice = "veloce" | "preciso";

export const FORMAT_LABEL: Record<Format, string> = {
  square: "Quadrato",
  landscape: "Orizzontale",
  portrait: "Verticale",
};

export const FORMAT_SIZE: Record<Format, string> = {
  square: "1024x1024",
  landscape: "1536x1024",
  portrait: "1024x1536",
};

export const QUALITY_LABEL: Record<Quality, string> = {
  low: "Bozza",
  medium: "Normale",
  high: "Alta",
};

/** Descrizione dello stile in campi fissi: è l'àncora testuale di ogni generazione. */
export interface StyleDescription {
  tecnica: string;
  palette: string;
  tratto: string;
  luce: string;
  composizione: string;
  tipografia: string;
  /** Solo per le infografiche: griglia, icone, gerarchia dei titoli, colori dei dati. */
  impaginazione: string;
  daEvitare: string;
}

export const DESCRIPTION_FIELDS: { key: keyof StyleDescription; label: string }[] = [
  { key: "tecnica", label: "Tecnica" },
  { key: "palette", label: "Palette" },
  { key: "tratto", label: "Tratto" },
  { key: "luce", label: "Luce" },
  { key: "composizione", label: "Composizione" },
  { key: "tipografia", label: "Tipografia" },
  { key: "impaginazione", label: "Impaginazione" },
  { key: "daEvitare", label: "Da evitare" },
];

export interface StyleParams {
  format: Format;
  quality: Quality;
  transparent: boolean;
  model: ModelChoice;
  kind: StyleKind;
}

export const DEFAULT_STYLE_PARAMS: StyleParams = {
  format: "landscape",
  quality: "medium",
  transparent: false,
  model: "veloce",
  kind: "illustrazione",
};

export const INFOGRAPHIC_STYLE_PARAMS: StyleParams = {
  format: "portrait",
  quality: "high",
  transparent: false,
  model: "preciso",
  kind: "infografica",
};

export interface StyleTrial {
  id: string;
  styleId: string;
  path: string | null;
  thumbPath: string | null;
  size: string;
  status: ImageStatus;
  error: UserError | null;
}

export interface StyleRef {
  id: string;
  /** Relativo alla cartella dati. */
  path: string;
  position: number;
}

/** Uno stile della libreria: lo stesso stile può servire a più progetti. */
export interface Style {
  id: string;
  name: string;
  color: string;
  /** Il testo con cui l'utente ha chiesto lo stile ("acquerello morbido…"). */
  brief: string;
  description: StyleDescription | null;
  /** La descrizione è in preparazione (modello di testo con visione). */
  describing: boolean;
  describeError: UserError | null;
  params: StyleParams;
  locked: boolean;
  refs: StyleRef[];
  /** In quanti progetti è usato. */
  projectCount: number;
  /** Prove generate dalla descrizione, tra cui scegliere l'àncora (fuori da un progetto). */
  trials: StyleTrial[];
  updatedAt: string;
}

/** Fotografia dello stile al momento del messaggio: resta anche se lo stile cambia o sparisce. */
export interface StyleLabel {
  name: string;
  color: string;
}

export interface Thread {
  id: string;
  title: string;
  contextNotes: string;
  textLanguage: string;
  /** Modelli fissati alla creazione: un aggiornamento non cambia un progetto in corso. */
  imageModel: string;
  preciseModel: string;
  lastStyleId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ImageStatus = "queued" | "running" | "done" | "failed";

export interface UserError {
  title: string;
  detail: string;
  action: string;
}

export interface ImageParams {
  endpoint: "generations" | "edits";
  size: string;
  quality: Quality;
  background: "auto" | "transparent";
  /** File inviati come immagini di input (relativi alla cartella dati), nell'ordine. */
  inputPaths: string[];
}

export interface GeneratedImage {
  id: string;
  messageId: string;
  threadId: string;
  styleId: string | null;
  parentImageId: string | null;
  path: string | null;
  thumbPath: string | null;
  finalPrompt: string;
  params: ImageParams;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  status: ImageStatus;
  error: UserError | null;
  createdAt: string;
}

export type MessageKind = "request" | "edit" | "trial";

export interface MessageOptions {
  /** null = formato predefinito dello stile. */
  format: Format | null;
  variants: 1 | 2 | 4;
}

export interface Message {
  id: string;
  threadId: string;
  kind: MessageKind;
  text: string;
  styleId: string | null;
  styleLabel: StyleLabel | null;
  parentImageId: string | null;
  options: MessageOptions;
  createdAt: string;
  images: GeneratedImage[];
}

export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  imageCount: number;
  styleColors: string[];
}

export interface ThreadDetail {
  thread: Thread;
  styles: Style[];
  messages: Message[];
}

export interface ApiKeyStatus {
  set: boolean;
  /** `sk-...abcd`: l'unica forma in cui la chiave arriva alla webview. */
  masked: string | null;
  storage: "keychain" | "file" | null;
}

export interface Settings {
  imageModel: string;
  preciseModel: string;
  describeModel: string;
  textLanguage: string;
  apiKey: ApiKeyStatus;
  monthCostUsd: number;
  demo: boolean;
}

export type EditableSettings = Pick<
  Settings,
  "imageModel" | "preciseModel" | "describeModel" | "textLanguage"
>;

export interface VerifyResult {
  ok: boolean;
  error?: UserError;
  imageModels: string[];
  textModels: string[];
}

export interface JobEvent {
  /** null per i lavori sugli stili, che non appartengono a un progetto. */
  threadId: string | null;
  kind: "image" | "describe" | "trial";
  status: ImageStatus;
  imageId?: string;
  styleId?: string;
  trialId?: string;
  error?: UserError;
}

export interface SendRequest {
  threadId: string;
  text: string;
  styleId: string | null;
  format: Format | null;
  variants: 1 | 2 | 4;
  /** Presente quando si risponde a un'immagine: nasce una nuova versione. */
  parentImageId?: string | null;
}

export interface NewStyleInput {
  name: string;
  color: string;
  kind: StyleKind;
}

export const STYLE_COLORS = [
  "#2f6db5",
  "#e07a1f",
  "#3f8f5a",
  "#b0417a",
  "#7a5cc2",
  "#c2532b",
  "#1f8a8a",
  "#6b6b6b",
];

export type BackupReason = "automatico" | "manuale" | "prima-della-migrazione" | "prima-del-ripristino";

export const BACKUP_REASON_LABEL: Record<BackupReason, string> = {
  automatico: "Automatico",
  manuale: "Manuale",
  "prima-della-migrazione": "Prima di un aggiornamento",
  "prima-del-ripristino": "Prima di un ripristino",
};

export interface BackupInfo {
  name: string;
  createdAt: string;
  reason: BackupReason;
  threads: number;
  styles: number;
  images: number;
}

export interface BackupState {
  folder: string;
  backups: BackupInfo[];
  /** Nome del backup da ripristinare al prossimo avvio. */
  pendingRestore: string | null;
}
