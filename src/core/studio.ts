/**
 * Lo studio: thread, stili, messaggi e lavori di generazione. Tutta la
 * logica dell'app sta qui, senza import di Electrobun; il guscio desktop
 * (src/bun) si limita a esporla via RPC.
 */
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_STYLE_PARAMS,
  FORMAT_SIZE,
  INFOGRAPHIC_STYLE_PARAMS,
  STYLE_COLORS,
  type EditableSettings,
  type GeneratedImage,
  type ImageParams,
  type JobEvent,
  type MessageKind,
  type MessageOptions,
  type NewStyleInput,
  type SendRequest,
  type Style,
  type StyleDescription,
  type StyleLabel,
  type StyleParams,
  type Thread,
  type ThreadDetail,
  type ThreadSummary,
  type UserError,
} from "../shared/types";
import { Db, newId } from "./db";
import { AppError, ProviderError, toUserError } from "./errors";
import { Files } from "./files";
import { estimateCostUsd } from "./pricing";
import { composePrompt, trialPrompt } from "./prompt";
import type { ImageProvider, ProviderResult } from "./provider";
import { JobQueue, withRetry } from "./queue";

export const DEFAULT_SETTINGS: EditableSettings = {
  imageModel: "gpt-image-2.6-flare",
  preciseModel: "gpt-image-2.6-sunburst",
  describeModel: "gpt-5-mini",
  textLanguage: "italiano",
};

const SETTING_KEYS: Record<keyof EditableSettings, string> = {
  imageModel: "image_model",
  preciseModel: "precise_model",
  describeModel: "describe_model",
  textLanguage: "text_language",
};

export const MAX_REFS = 3;
const TRIAL_VARIANTS = 3;

const pad = (n: number) => String(n).padStart(2, "0");

export interface StudioDeps {
  db: Db;
  files: Files;
  provider: ImageProvider;
  emit: (event: JobEvent) => void;
  concurrency?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string, error?: unknown) => void;
  /** Eventi normali (lavori iniziati e finiti) per il registro. */
  info?: (message: string) => void;
}

interface ImageJob {
  threadId: string;
  imageIds: string[];
  endpoint: ImageParams["endpoint"];
  model: string;
  prompt: string;
  size: string;
  quality: ImageParams["quality"];
  background: ImageParams["background"];
  inputPaths: string[];
}

export class Studio {
  readonly db: Db;
  readonly files: Files;
  readonly queue: JobQueue;
  readonly #provider: ImageProvider;
  readonly #emit: (event: JobEvent) => void;
  readonly #sleep?: (ms: number) => Promise<void>;
  readonly #log: (message: string, error?: unknown) => void;
  readonly #info: (message: string) => void;

  constructor(deps: StudioDeps) {
    this.db = deps.db;
    this.files = deps.files;
    this.#provider = deps.provider;
    this.#emit = deps.emit;
    this.#sleep = deps.sleep;
    this.#log = deps.log ?? (() => {});
    this.#info = deps.info ?? (() => {});
    this.queue = new JobQueue(deps.concurrency ?? 2);
  }

  /** All'avvio: i lavori interrotti dalla chiusura dell'app diventano errori leggibili. */
  recoverInterrupted(): void {
    const n = this.db.failInterrupted({
      title: "Generazione interrotta",
      detail: "L'app è stata chiusa mentre l'immagine era in preparazione.",
      action: "Premi «Rigenera» per riprovare.",
    });
    this.db.resetDescribing();
    if (n > 0) this.#log(`${n} immagini interrotte segnate come non riuscite`);
  }

  // --- Impostazioni ---

  settings(): EditableSettings {
    const out = { ...DEFAULT_SETTINGS };
    for (const [key, column] of Object.entries(SETTING_KEYS) as [keyof EditableSettings, string][]) {
      const value = this.db.getSetting(column);
      if (value) out[key] = value;
    }
    return out;
  }

  saveSettings(patch: Partial<EditableSettings>): EditableSettings {
    for (const [key, value] of Object.entries(patch) as [keyof EditableSettings, string | undefined][]) {
      if (!(key in SETTING_KEYS) || typeof value !== "string") continue;
      const trimmed = value.trim();
      if (!trimmed) throw new AppError("Il valore non può essere vuoto.");
      this.db.setSetting(SETTING_KEYS[key], trimmed);
    }
    return this.settings();
  }

  monthCostUsd(): number {
    return this.db.monthCostUsd();
  }

  // --- Thread ---

  listThreads(): ThreadSummary[] {
    return this.db.listThreads();
  }

  createThread(input: { title: string; contextNotes?: string }): Thread {
    const settings = this.settings();
    return this.db.createThread({
      title: input.title.trim() || "Nuovo progetto",
      contextNotes: (input.contextNotes ?? "").trim(),
      textLanguage: settings.textLanguage,
      imageModel: settings.imageModel,
      preciseModel: settings.preciseModel,
    });
  }

  updateThread(
    id: string,
    patch: Partial<Pick<Thread, "title" | "contextNotes" | "textLanguage" | "imageModel" | "preciseModel">>,
  ): Thread {
    this.#thread(id);
    if (patch.title !== undefined) patch.title = patch.title.trim() || "Senza titolo";
    this.db.updateThread(id, patch);
    return this.#thread(id);
  }

  /** Gli stili restano nella libreria: servono anche ad altri progetti. */
  deleteThread(id: string): void {
    this.db.deleteThread(id);
    this.files.removeDir(`images/${id}`);
    this.files.removeDir(`thumbs/${id}`);
  }

  getThread(id: string): ThreadDetail {
    return { thread: this.#thread(id), styles: this.db.listStyles(id), messages: this.db.listMessages(id) };
  }

  #thread(id: string): Thread {
    const thread = this.db.getThread(id);
    if (!thread) throw new AppError("Questo progetto non esiste più.");
    return thread;
  }

  #style(id: string): Style {
    const style = this.db.getStyle(id);
    if (!style) throw new AppError("Questo stile non esiste più.");
    return style;
  }

  #unlocked(style: Style): void {
    if (style.locked) throw new AppError(`Lo stile «${style.name}» è bloccato. Sbloccalo per modificarlo.`);
  }

  // --- Stili (libreria globale, senza limite di numero) ---

  listStyles(): Style[] {
    return this.db.listAllStyles();
  }

  #newStyle(input: Partial<NewStyleInput>, brief: string, threadId: string | null): Style {
    if (threadId) this.#thread(threadId);
    const kind = input.kind ?? "illustrazione";
    const params: StyleParams =
      kind === "infografica" ? { ...INFOGRAPHIC_STYLE_PARAMS } : { ...DEFAULT_STYLE_PARAMS };
    const count = this.db.listAllStyles().length;
    const style = this.db.createStyle({
      name: input.name?.trim() || (kind === "infografica" ? "Infografiche" : `Stile ${count + 1}`),
      color: input.color || STYLE_COLORS[count % STYLE_COLORS.length]!,
      brief: brief.trim(),
      params,
    });
    if (threadId) this.db.attachStyle(threadId, style.id);
    return style;
  }

  /**
   * Stile da descrizione con 3 prove. Dentro un progetto le prove arrivano
   * nella sua chat; dalla libreria (`threadId` null) stanno nella scheda dello
   * stile.
   */
  createStyleFromBrief(
    threadId: string | null,
    input: NewStyleInput,
    brief: string,
  ): { style: Style; messageId: string | null } {
    if (!brief.trim())
      throw new AppError(
        "Descrivi lo stile in poche parole, per esempio «acquerello morbido, colori pastello».",
      );
    if (!threadId) {
      const style = this.#newStyle(input, brief, null);
      this.#enqueueTrials(style);
      return { style: this.#style(style.id), messageId: null };
    }
    const thread = this.#thread(threadId);
    const style = this.#newStyle(input, brief, threadId);
    const size = FORMAT_SIZE[style.params.format];
    const prompt = trialPrompt(brief, style.params.kind, thread.contextNotes, thread.textLanguage);
    const { messageId } = this.#enqueue({
      threadId,
      kind: "trial",
      text: brief.trim(),
      style,
      parentImageId: null,
      options: { format: style.params.format, variants: 1 },
      count: TRIAL_VARIANTS,
      job: {
        threadId,
        endpoint: "generations",
        model: thread.imageModel,
        prompt,
        size,
        quality: "low",
        background: "auto",
        inputPaths: [],
      },
    });
    return { style, messageId };
  }

  /** Altre prove per uno stile della libreria, dalla stessa descrizione. */
  generateTrials(styleId: string): Style {
    const style = this.#style(styleId);
    this.#unlocked(style);
    if (!style.brief.trim()) {
      throw new AppError(
        "Questo stile non ha una descrizione da cui partire: aggiungi un'immagine di riferimento.",
      );
    }
    this.#enqueueTrials(style);
    return this.#style(styleId);
  }

  /** La prova scelta diventa un'immagine di riferimento (àncora) dello stile. */
  async useTrialAsAnchor(trialId: string): Promise<Style> {
    const trial = this.db.getTrial(trialId);
    if (!trial?.path || trial.status !== "done") throw new AppError("La prova non è ancora pronta.");
    const style = this.#style(trial.styleId);
    this.#unlocked(style);
    if (style.refs.length >= MAX_REFS) {
      throw new AppError(
        `Lo stile «${style.name}» ha già ${MAX_REFS} immagini di riferimento. Togline una prima.`,
      );
    }
    await this.#addRef(style.id, await this.files.read(trial.path));
    this.db.touchStyle(style.id);
    if (!style.description) this.#describe(style.id);
    return this.#style(style.id);
  }

  deleteTrial(trialId: string): Style {
    const trial = this.db.getTrial(trialId);
    if (!trial) throw new AppError("Prova non trovata.");
    if (trial.status === "queued" || trial.status === "running") {
      throw new AppError("Questa prova è ancora in preparazione.");
    }
    this.db.deleteTrial(trialId);
    if (trial.path) this.files.remove(trial.path);
    if (trial.thumbPath) this.files.remove(trial.thumbPath);
    return this.#style(trial.styleId);
  }

  #enqueueTrials(style: Style): void {
    const settings = this.settings();
    const size = FORMAT_SIZE[style.params.format];
    const prompt = trialPrompt(style.brief, style.params.kind, "", settings.textLanguage);
    const model = settings.imageModel;
    const ids = Array.from({ length: TRIAL_VARIANTS }, () => this.db.createTrial(style.id, size, model));
    for (const trialId of ids) {
      this.#emit({ threadId: null, kind: "trial", status: "queued", styleId: style.id, trialId });
    }
    this.queue.push(async () => {
      for (const trialId of ids) {
        this.db.setTrialStatus(trialId, "running");
        this.#emit({ threadId: null, kind: "trial", status: "running", styleId: style.id, trialId });
      }
      this.#info(`Prove dello stile «${style.name}»: ${model}, ${size}, ${ids.length} varianti`);
      const fail = (error: UserError) => {
        for (const trialId of ids) {
          if (this.db.getTrial(trialId)?.status === "done") continue;
          this.db.setTrialStatus(trialId, "failed", error);
          this.#emit({ threadId: null, kind: "trial", status: "failed", styleId: style.id, trialId, error });
        }
      };
      let result: ProviderResult;
      try {
        result = await withRetry(
          () =>
            this.#provider.generate({
              model,
              prompt,
              size,
              quality: "low",
              background: "auto",
              n: ids.length,
            }),
          { sleep: this.#sleep },
        );
      } catch (error) {
        if (!(error instanceof ProviderError)) this.#log("Prove dello stile non riuscite", error);
        fail(toUserError(error));
        return;
      }
      const cost = estimateCostUsd(result.usage) / ids.length;
      for (const [i, trialId] of ids.entries()) {
        const bytes = result.images[i];
        // Lo stile può essere stato eliminato nel frattempo.
        if (!bytes || !this.db.getTrial(trialId)) continue;
        try {
          const saved = await this.files.saveTrial(style.id, trialId, bytes);
          this.db.completeTrial(trialId, {
            ...saved,
            inputTokens: Math.round(
              (result.usage.inputTextTokens + result.usage.inputImageTokens) / ids.length,
            ),
            outputTokens: Math.round(result.usage.outputTokens / ids.length),
            costUsd: Math.round(cost * 10_000) / 10_000,
          });
          this.#emit({ threadId: null, kind: "trial", status: "done", styleId: style.id, trialId });
        } catch (error) {
          this.#log("Salvataggio della prova non riuscito", error);
        }
      }
      fail({
        title: "Prova mancante",
        detail: "OpenAI ha restituito meno prove di quelle chieste.",
        action: "Premi «Altre 3 prove».",
      });
    });
  }

  /** Stile da un'immagine del computer; `threadId` lo aggiunge anche a un progetto. */
  async createStyleFromFile(
    threadId: string | null,
    input: NewStyleInput,
    bytes: Uint8Array,
  ): Promise<Style> {
    const style = this.#newStyle(input, "", threadId);
    try {
      await this.#addRef(style.id, bytes);
    } catch (error) {
      this.db.deleteStyle(style.id);
      throw this.#unreadable(error);
    }
    this.#describe(style.id);
    return this.#style(style.id);
  }

  /**
   * «Usa come stile»: l'immagine diventa un riferimento di uno stile esistente
   * (`styleId`) oppure il primo riferimento di uno stile nuovo, aggiunto al
   * progetto dell'immagine.
   */
  async useImageAsStyle(
    imageId: string,
    styleId: string | null,
    input?: Partial<NewStyleInput>,
  ): Promise<Style> {
    const image = this.db.getImage(imageId);
    if (!image?.path || image.status !== "done") throw new AppError("L'immagine non è ancora pronta.");
    const bytes = await this.files.read(image.path);
    let style: Style;
    if (styleId) {
      style = this.#style(styleId);
      this.#unlocked(style);
      if (style.refs.length >= MAX_REFS) {
        throw new AppError(
          `Lo stile «${style.name}» ha già ${MAX_REFS} immagini di riferimento. Togline una prima.`,
        );
      }
      this.db.attachStyle(image.threadId, style.id);
    } else {
      const message = this.db.getMessage(image.messageId);
      style = this.#newStyle(input ?? {}, message?.kind === "trial" ? message.text : "", image.threadId);
    }
    await this.#addRef(style.id, bytes);
    this.db.touchStyle(style.id);
    if (!style.description) this.#describe(style.id);
    return this.#style(style.id);
  }

  /** Aggiunge al progetto uno stile della libreria (lo stesso, non una copia). */
  attachStyle(threadId: string, styleId: string): Style {
    this.#thread(threadId);
    this.#style(styleId);
    this.db.attachStyle(threadId, styleId);
    this.db.touchThread(threadId);
    return this.#style(styleId);
  }

  /** Toglie lo stile dal progetto; resta nella libreria. */
  detachStyle(threadId: string, styleId: string): void {
    this.db.detachStyle(threadId, styleId);
    this.db.touchThread(threadId);
  }

  /** Copia indipendente: modificarla non tocca l'originale. */
  async duplicateStyle(styleId: string, threadId: string | null = null): Promise<Style> {
    const original = this.#style(styleId);
    const copy = this.db.createStyle({
      name: `${original.name} (copia)`,
      color: original.color,
      brief: original.brief,
      params: { ...original.params },
    });
    this.db.updateStyle(copy.id, { description: original.description });
    for (const ref of original.refs) {
      if (this.files.exists(ref.path)) await this.#addRef(copy.id, await this.files.read(ref.path));
    }
    if (threadId) this.db.attachStyle(threadId, copy.id);
    return this.#style(copy.id);
  }

  async addRefFromFile(styleId: string, bytes: Uint8Array): Promise<Style> {
    const style = this.#style(styleId);
    this.#unlocked(style);
    if (style.refs.length >= MAX_REFS)
      throw new AppError(`Al massimo ${MAX_REFS} immagini di riferimento per stile.`);
    try {
      await this.#addRef(styleId, bytes);
    } catch (error) {
      throw this.#unreadable(error);
    }
    if (!style.description) this.#describe(styleId);
    return this.#style(styleId);
  }

  #unreadable(error: unknown): AppError {
    this.#log("Immagine non leggibile", error);
    return new AppError("Non riesco a leggere questa immagine. Usa un file PNG, JPEG o WebP.");
  }

  async #addRef(styleId: string, bytes: Uint8Array): Promise<void> {
    const refId = newId();
    const rel = await this.files.saveRef(styleId, refId, bytes);
    this.db.addRef(styleId, refId, rel);
  }

  removeRef(refId: string): Style {
    const ref = this.db.getRef(refId);
    if (!ref) throw new AppError("Riferimento non trovato.");
    const style = this.#style(ref.styleId);
    this.#unlocked(style);
    // Il file resta: le immagini già fatte lo usano per «Rigenera».
    this.db.deleteRef(refId);
    return this.#style(style.id);
  }

  updateStyle(
    styleId: string,
    patch: Partial<{
      name: string;
      color: string;
      description: StyleDescription;
      params: StyleParams;
      locked: boolean;
    }>,
  ): Style {
    const style = this.#style(styleId);
    const onlyLockChange = Object.keys(patch).every((k) => k === "locked");
    if (!onlyLockChange) this.#unlocked(style);
    if (patch.name !== undefined) patch.name = patch.name.trim() || style.name;
    this.db.updateStyle(styleId, patch);
    this.db.touchStyle(styleId);
    return this.#style(styleId);
  }

  /** Elimina lo stile dalla libreria e da tutti i progetti. */
  deleteStyle(styleId: string): void {
    const style = this.#style(styleId);
    this.#unlocked(style);
    this.db.deleteStyle(styleId);
    this.files.removeDir(`styles/${styleId}`);
  }

  redescribe(styleId: string): Style {
    const style = this.#style(styleId);
    this.#unlocked(style);
    if (style.refs.length === 0)
      throw new AppError("Serve almeno un'immagine di riferimento per ricavare la descrizione.");
    this.#describe(styleId);
    return this.#style(styleId);
  }

  #describe(styleId: string): void {
    this.#style(styleId);
    this.db.updateStyle(styleId, { describing: true, describeError: null });
    this.#emit({ threadId: null, kind: "describe", status: "queued", styleId });
    this.queue.push(async () => {
      const current = this.db.getStyle(styleId);
      if (!current) return;
      this.#emit({ threadId: null, kind: "describe", status: "running", styleId });
      try {
        const images = await Promise.all(current.refs.map((r) => this.files.input(r.path)));
        const description = await withRetry(
          () =>
            this.#provider.describeStyle({
              model: this.settings().describeModel,
              images,
              brief: current.brief,
              kind: current.params.kind,
            }),
          { sleep: this.#sleep },
        );
        if (!this.db.getStyle(styleId)) return;
        this.db.updateStyle(styleId, { description, describing: false, describeError: null });
        this.#info(`Descrizione dello stile «${current.name}» pronta`);
        this.#emit({ threadId: null, kind: "describe", status: "done", styleId });
      } catch (error) {
        this.#log("Descrizione dello stile non riuscita", error);
        const userError = toUserError(error);
        if (this.db.getStyle(styleId))
          this.db.updateStyle(styleId, { describing: false, describeError: userError });
        this.#emit({
          threadId: null,
          kind: "describe",
          status: "failed",
          styleId,
          error: userError,
        });
      }
    });
  }

  // --- Generazione ---

  #label(style: Style | null): StyleLabel | null {
    return style ? { name: style.name, color: style.color } : null;
  }

  /** Invia una richiesta: crea il messaggio, mette in coda il lavoro, risponde subito. */
  send(req: SendRequest): { messageId: string; imageIds: string[] } {
    const thread = this.#thread(req.threadId);
    const text = req.text.trim();
    if (!text) throw new AppError("Scrivi cosa vuoi nell'immagine.");
    const style = req.styleId ? this.db.getStyle(req.styleId) : null;
    if (req.styleId && !style) throw new AppError("Questo stile non esiste più. Scegline un altro.");
    if (style?.describing && !style.description && style.refs.length === 0) {
      throw new AppError(`Lo stile «${style.name}» non è ancora pronto.`);
    }
    const variants = ([1, 2, 4] as const).includes(req.variants) ? req.variants : 1;
    const parent = req.parentImageId ? this.db.getImage(req.parentImageId) : null;
    if (req.parentImageId && (!parent?.path || parent.status !== "done")) {
      throw new AppError("L'immagine da modificare non è disponibile.");
    }
    if (style) {
      this.db.attachStyle(thread.id, style.id);
      this.db.touchStyle(style.id);
    }
    this.db.updateThread(thread.id, { lastStyleId: style?.id ?? null });

    const params = style?.params ?? DEFAULT_STYLE_PARAMS;
    const format = req.format ?? params.format;
    const refs = (style?.refs ?? []).map((r) => r.path);
    const transparent = params.transparent;
    const isEdit = Boolean(parent);
    const precise = isEdit || params.model === "preciso" || params.kind === "infografica";
    const prompt = composePrompt({
      mode: isEdit ? "edit" : "generate",
      style: style ? { brief: style.brief, description: style.description, kind: params.kind } : null,
      refCount: refs.length,
      contextNotes: thread.contextNotes,
      userText: text,
      format,
      textLanguage: thread.textLanguage,
      transparent,
    });
    const inputPaths = parent?.path ? [parent.path, ...refs] : refs;
    const kind: MessageKind = isEdit ? "edit" : "request";
    const quality = isEdit ? parent!.params.quality : params.kind === "infografica" ? "high" : params.quality;

    const { messageId, imageIds } = this.#enqueue({
      threadId: thread.id,
      kind,
      text,
      style,
      parentImageId: parent?.id ?? null,
      options: { format: req.format, variants },
      count: variants,
      job: {
        threadId: thread.id,
        endpoint: inputPaths.length > 0 ? "edits" : "generations",
        model: precise ? thread.preciseModel : thread.imageModel,
        prompt,
        size: isEdit && !req.format ? parent!.params.size : FORMAT_SIZE[format],
        quality,
        background: transparent ? "transparent" : "auto",
        inputPaths,
      },
    });
    return { messageId, imageIds };
  }

  /** Stessa richiesta, stesso stile, stessi criteri: un nuovo tentativo. */
  regenerate(imageId: string): { messageId: string; imageIds: string[] } {
    const image = this.db.getImage(imageId);
    if (!image) throw new AppError("Immagine non trovata.");
    const message = this.db.getMessage(image.messageId);
    if (!message) throw new AppError("Messaggio non trovato.");
    const missing = image.params.inputPaths.filter((p) => !this.files.exists(p));
    if (missing.length > 0) {
      throw new AppError(
        "Alcune immagini di riferimento non esistono più: invia una nuova richiesta con lo stile attuale.",
      );
    }
    return this.#enqueue({
      threadId: image.threadId,
      kind: message.kind,
      text: message.text,
      style: message.styleId ? this.db.getStyle(message.styleId) : null,
      styleLabel: message.styleLabel,
      parentImageId: message.parentImageId,
      options: { ...message.options, variants: 1 },
      count: 1,
      job: {
        threadId: image.threadId,
        endpoint: image.params.endpoint,
        model: image.model,
        prompt: image.finalPrompt,
        size: image.params.size,
        quality: image.params.quality,
        background: image.params.background,
        inputPaths: image.params.inputPaths,
      },
    });
  }

  #enqueue(input: {
    threadId: string;
    kind: MessageKind;
    text: string;
    style: Style | null;
    styleLabel?: StyleLabel | null;
    parentImageId: string | null;
    options: MessageOptions;
    count: number;
    job: Omit<ImageJob, "imageIds">;
  }): { messageId: string; imageIds: string[] } {
    const messageId = this.db.createMessage({
      threadId: input.threadId,
      kind: input.kind,
      text: input.text,
      styleId: input.style?.id ?? null,
      styleLabel: input.styleLabel !== undefined ? input.styleLabel : this.#label(input.style),
      parentImageId: input.parentImageId,
      options: input.options,
    });
    const params: ImageParams = {
      endpoint: input.job.endpoint,
      size: input.job.size,
      quality: input.job.quality,
      background: input.job.background,
      inputPaths: input.job.inputPaths,
    };
    const imageIds = Array.from({ length: input.count }, (_, variant) =>
      this.db.createImage({
        messageId,
        threadId: input.threadId,
        styleId: input.style?.id ?? null,
        parentImageId: input.parentImageId,
        variant,
        finalPrompt: input.job.prompt,
        params,
        model: input.job.model,
      }),
    );
    const job: ImageJob = { ...input.job, imageIds };
    for (const imageId of imageIds)
      this.#emit({ threadId: input.threadId, kind: "image", status: "queued", imageId });
    this.queue.push(() => this.#run(job));
    return { messageId, imageIds };
  }

  async #run(job: ImageJob): Promise<void> {
    for (const imageId of job.imageIds) {
      this.db.setImageStatus(imageId, "running");
      this.#emit({ threadId: job.threadId, kind: "image", status: "running", imageId });
    }
    let result: ProviderResult;
    const started = Date.now();
    this.#info(
      `Generazione: ${job.endpoint}, ${job.model}, ${job.size}, qualità ${job.quality}, ${job.imageIds.length} varianti, ${job.inputPaths.length} immagini di input`,
    );
    try {
      const images = await Promise.all(job.inputPaths.map((p) => this.files.input(p)));
      const base = {
        model: job.model,
        prompt: job.prompt,
        size: job.size,
        quality: job.quality,
        background: job.background,
        n: job.imageIds.length,
      };
      result = await withRetry(
        () =>
          job.endpoint === "edits"
            ? this.#provider.editWithReferences({ ...base, images })
            : this.#provider.generate(base),
        { sleep: this.#sleep },
      );
    } catch (error) {
      if (error instanceof ProviderError) {
        this.#info(
          `Generazione non riuscita: ${error.userError.title} (HTTP ${error.status ?? "-"}) ${error.message}`,
        );
      } else {
        this.#log("Generazione non riuscita", error);
      }
      this.#failAll(job, toUserError(error));
      return;
    }

    const n = job.imageIds.length;
    this.#info(
      `Generazione riuscita in ${Math.round((Date.now() - started) / 1000)} s: ${result.images.length} immagini, token ${result.usage.inputTextTokens}+${result.usage.inputImageTokens} in, ${result.usage.outputTokens} out, ${estimateCostUsd(result.usage)} USD`,
    );
    const share = (value: number) => Math.round(value / n);
    const cost = estimateCostUsd(result.usage) / n;
    for (const [i, imageId] of job.imageIds.entries()) {
      const bytes = result.images[i];
      if (!bytes) {
        this.#fail(job.threadId, imageId, {
          title: "Variante mancante",
          detail: "OpenAI ha restituito meno varianti di quelle chieste.",
          action: "Premi «Rigenera» per averne un'altra.",
        });
        continue;
      }
      try {
        const saved = await this.files.saveGenerated(job.threadId, imageId, bytes);
        this.db.completeImage(imageId, {
          ...saved,
          inputTokens: share(result.usage.inputTextTokens + result.usage.inputImageTokens),
          outputTokens: share(result.usage.outputTokens),
          costUsd: Math.round(cost * 10_000) / 10_000,
        });
        this.db.touchThread(job.threadId);
        this.#emit({ threadId: job.threadId, kind: "image", status: "done", imageId });
      } catch (error) {
        this.#log("Salvataggio dell'immagine non riuscito", error);
        this.#fail(job.threadId, imageId, {
          title: "Salvataggio non riuscito",
          detail: "L'immagine è arrivata ma non sono riuscito a salvarla sul disco.",
          action: "Controlla lo spazio libero sul disco e premi «Rigenera».",
        });
      }
    }
  }

  #fail(threadId: string, imageId: string, error: UserError): void {
    if (!this.db.getImage(imageId)) return;
    this.db.setImageStatus(imageId, "failed", error);
    this.#emit({ threadId, kind: "image", status: "failed", imageId, error });
  }

  #failAll(job: ImageJob, error: UserError): void {
    for (const imageId of job.imageIds) this.#fail(job.threadId, imageId, error);
  }

  image(imageId: string): GeneratedImage {
    const image = this.db.getImage(imageId);
    if (!image) throw new AppError("Immagine non trovata.");
    return image;
  }

  /** Nome proposto nella finestra «Salva»: titolo del progetto e data dell'immagine. */
  exportFileName(imageId: string): string {
    const image = this.image(imageId);
    const thread = this.#thread(image.threadId);
    const safe =
      thread.title
        .replace(/[^\p{L}\p{N} _-]+/gu, "")
        .trim()
        .slice(0, 60) || "aitelier";
    // Ora locale, non UTC: è quella che l'utente si aspetta di leggere.
    const d = new Date(image.createdAt);
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
    return `${safe} ${stamp}.png`;
  }

  /** Copia l'immagine nel percorso scelto dall'utente (sovrascrive: la finestra «Salva» ha già chiesto). */
  exportImage(imageId: string, target: string): string {
    const image = this.image(imageId);
    if (!image.path) throw new AppError("L'immagine non è ancora pronta.");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(this.files.abs(image.path), target);
    this.#info(`Immagine ${imageId} salvata in ${target}`);
    return target;
  }
}
