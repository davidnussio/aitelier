/**
 * Lo studio: thread, stili, messaggi e lavori di generazione. Tutta la
 * logica dell'app sta qui, senza import di Electrobun; il guscio desktop
 * (src/bun) si limita a esporla via RPC.
 */
import fs from "node:fs";
import {
  DEFAULT_STYLE_PARAMS,
  FORMAT_SIZE,
  INFOGRAPHIC_STYLE_PARAMS,
  SLOT_LETTER,
  STYLE_COLORS,
  type EditableSettings,
  type GeneratedImage,
  type ImageParams,
  type JobEvent,
  type MessageKind,
  type MessageOptions,
  type NewStyleInput,
  type SendRequest,
  type Slot,
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

export interface StudioDeps {
  db: Db;
  files: Files;
  provider: ImageProvider;
  emit: (event: JobEvent) => void;
  concurrency?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string, error?: unknown) => void;
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

  constructor(deps: StudioDeps) {
    this.db = deps.db;
    this.files = deps.files;
    this.#provider = deps.provider;
    this.#emit = deps.emit;
    this.#sleep = deps.sleep;
    this.#log = deps.log ?? (() => {});
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

  deleteThread(id: string): void {
    const styles = this.db.listStyles(id);
    this.db.deleteThread(id);
    this.files.removeDir(`images/${id}`);
    this.files.removeDir(`thumbs/${id}`);
    for (const s of styles) this.files.removeDir(`styles/${s.id}`);
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

  #freeSlot(threadId: string, slot: Slot): void {
    const existing = this.db.getStyleBySlot(threadId, slot);
    if (existing) {
      throw new AppError(
        `Lo slot ${SLOT_LETTER[slot]} è già occupato da «${existing.name}». Svuotalo prima, oppure apri un nuovo progetto.`,
      );
    }
  }

  // --- Stili ---

  #newStyle(threadId: string, slot: Slot, input: Partial<NewStyleInput>, brief: string): Style {
    this.#thread(threadId);
    this.#freeSlot(threadId, slot);
    const kind = input.kind ?? "illustrazione";
    const params: StyleParams =
      kind === "infografica" ? { ...INFOGRAPHIC_STYLE_PARAMS } : { ...DEFAULT_STYLE_PARAMS };
    return this.db.createStyle({
      threadId,
      slot,
      name: input.name?.trim() || `Stile ${SLOT_LETTER[slot]}`,
      color: input.color || STYLE_COLORS[slot - 1]!,
      brief: brief.trim(),
      params,
    });
  }

  /** Stile da descrizione: lo crea e chiede 3 prove; l'utente sceglie l'àncora in chat. */
  createStyleFromBrief(
    threadId: string,
    slot: Slot,
    input: NewStyleInput,
    brief: string,
  ): { style: Style; messageId: string } {
    if (!brief.trim())
      throw new AppError(
        "Descrivi lo stile in poche parole, per esempio «acquerello morbido, colori pastello».",
      );
    const thread = this.#thread(threadId);
    const style = this.#newStyle(threadId, slot, input, brief);
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

  async createStyleFromFile(
    threadId: string,
    slot: Slot,
    input: NewStyleInput,
    bytes: Uint8Array,
  ): Promise<Style> {
    const style = this.#newStyle(threadId, slot, input, "");
    try {
      await this.#addRef(style.id, bytes);
    } catch (error) {
      this.db.deleteStyle(style.id);
      throw this.#unreadable(error);
    }
    this.#describe(style.id);
    return this.#style(style.id);
  }

  /** «Usa come stile»: nuova àncora di uno stile esistente o primo riferimento di uno nuovo. */
  async useImageAsStyle(imageId: string, slot: Slot, input?: Partial<NewStyleInput>): Promise<Style> {
    const image = this.db.getImage(imageId);
    if (!image?.path || image.status !== "done") throw new AppError("L'immagine non è ancora pronta.");
    const bytes = await this.files.read(image.path);
    let style = this.db.getStyleBySlot(image.threadId, slot);
    if (!style) {
      const message = this.db.getMessage(image.messageId);
      style = this.#newStyle(
        image.threadId,
        slot,
        input ?? {},
        message?.kind === "trial" ? message.text : "",
      );
    }
    this.#unlocked(style);
    if (style.refs.length >= MAX_REFS) {
      throw new AppError(
        `Lo stile «${style.name}» ha già ${MAX_REFS} immagini di riferimento. Togline una prima.`,
      );
    }
    await this.#addRef(style.id, bytes);
    if (!style.description) this.#describe(style.id);
    return this.#style(style.id);
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
    this.db.deleteRef(refId);
    this.files.remove(ref.path);
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
    return this.#style(styleId);
  }

  clearStyle(styleId: string): void {
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
    const style = this.#style(styleId);
    this.db.updateStyle(styleId, { describing: true, describeError: null });
    this.#emit({ threadId: style.threadId, kind: "describe", status: "queued", styleId });
    this.queue.push(async () => {
      const current = this.db.getStyle(styleId);
      if (!current) return;
      this.#emit({ threadId: current.threadId, kind: "describe", status: "running", styleId });
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
        this.#emit({ threadId: current.threadId, kind: "describe", status: "done", styleId });
      } catch (error) {
        this.#log("Descrizione dello stile non riuscita", error);
        const userError = toUserError(error);
        if (this.db.getStyle(styleId))
          this.db.updateStyle(styleId, { describing: false, describeError: userError });
        this.#emit({
          threadId: current.threadId,
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
    return style ? { slot: style.slot, name: style.name, color: style.color } : null;
  }

  /** Invia una richiesta: crea il messaggio, mette in coda il lavoro, risponde subito. */
  send(req: SendRequest): { messageId: string; imageIds: string[] } {
    const thread = this.#thread(req.threadId);
    const text = req.text.trim();
    if (!text) throw new AppError("Scrivi cosa vuoi nell'immagine.");
    const style = req.slot ? this.db.getStyleBySlot(thread.id, req.slot) : null;
    if (req.slot && !style)
      throw new AppError(`Lo slot ${SLOT_LETTER[req.slot]} è vuoto. Crea prima lo stile.`);
    if (style?.describing && !style.description && style.refs.length === 0) {
      throw new AppError(`Lo stile «${style.name}» non è ancora pronto.`);
    }
    const variants = ([1, 2, 4] as const).includes(req.variants) ? req.variants : 1;
    const parent = req.parentImageId ? this.db.getImage(req.parentImageId) : null;
    if (req.parentImageId && (!parent?.path || parent.status !== "done")) {
      throw new AppError("L'immagine da modificare non è disponibile.");
    }
    this.db.updateThread(thread.id, { lastSlot: req.slot });

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
      if (!(error instanceof ProviderError)) this.#log("Generazione non riuscita", error);
      this.#failAll(job, toUserError(error));
      return;
    }

    const n = job.imageIds.length;
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

  /** Copia un'immagine in una cartella dell'utente con un nome leggibile. */
  exportImage(imageId: string, targetDir: string): string {
    const image = this.image(imageId);
    if (!image.path) throw new AppError("L'immagine non è ancora pronta.");
    const thread = this.#thread(image.threadId);
    const safe =
      thread.title
        .replace(/[^\p{L}\p{N} _-]+/gu, "")
        .trim()
        .slice(0, 60) || "bottega";
    fs.mkdirSync(targetDir, { recursive: true });
    const stamp = image.createdAt.slice(0, 19).replace(/[:T]/g, "-");
    let target = `${targetDir}/${safe} ${stamp}.png`;
    for (let i = 2; fs.existsSync(target); i++) target = `${targetDir}/${safe} ${stamp} (${i}).png`;
    fs.copyFileSync(this.files.abs(image.path), target);
    return target;
  }
}
