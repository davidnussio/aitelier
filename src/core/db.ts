/**
 * Database SQLite (bun:sqlite, modalità WAL). Migrazioni numerate eseguite
 * all'avvio. La chiave API non entra mai qui.
 */
import { Database } from "bun:sqlite";
import fs from "node:fs";
import nodePath from "node:path";
import type {
  GeneratedImage,
  ImageParams,
  ImageStatus,
  Message,
  MessageKind,
  MessageOptions,
  Slot,
  Style,
  StyleDescription,
  StyleLabel,
  StyleParams,
  StyleRef,
  Thread,
  ThreadSummary,
  UserError,
} from "../shared/types";

const MIGRATIONS: string[] = [
  // 1. Schema iniziale
  `
  CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    titolo TEXT NOT NULL,
    note_contesto TEXT NOT NULL DEFAULT '',
    lingua_testi TEXT NOT NULL DEFAULT 'italiano',
    modello_fissato TEXT NOT NULL,
    modello_preciso TEXT NOT NULL,
    ultimo_slot INTEGER,
    creato_il TEXT NOT NULL,
    aggiornato_il TEXT NOT NULL,
    archiviato INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE styles (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
    nome TEXT NOT NULL,
    colore TEXT NOT NULL,
    richiesta TEXT NOT NULL DEFAULT '',
    descrizione TEXT,
    in_descrizione INTEGER NOT NULL DEFAULT 0,
    errore_descrizione TEXT,
    parametri TEXT NOT NULL,
    bloccato INTEGER NOT NULL DEFAULT 0,
    creato_il TEXT NOT NULL,
    UNIQUE (thread_id, slot)
  );
  CREATE TABLE style_refs (
    id TEXT PRIMARY KEY,
    style_id TEXT NOT NULL REFERENCES styles(id) ON DELETE CASCADE,
    percorso_file TEXT NOT NULL,
    ordine INTEGER NOT NULL
  );
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL,
    testo TEXT NOT NULL,
    style_id TEXT,
    etichetta_stile TEXT,
    immagine_madre_id TEXT,
    opzioni TEXT NOT NULL,
    creato_il TEXT NOT NULL
  );
  CREATE TABLE images (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    style_id TEXT,
    immagine_madre_id TEXT,
    variante INTEGER NOT NULL DEFAULT 0,
    percorso_file TEXT,
    miniatura TEXT,
    prompt_finale TEXT NOT NULL,
    parametri TEXT NOT NULL,
    modello TEXT NOT NULL,
    token_ingresso INTEGER NOT NULL DEFAULT 0,
    token_uscita INTEGER NOT NULL DEFAULT 0,
    costo_usd REAL NOT NULL DEFAULT 0,
    stato TEXT NOT NULL,
    errore TEXT,
    creato_il TEXT NOT NULL
  );
  CREATE INDEX images_message ON images(message_id);
  CREATE INDEX messages_thread ON messages(thread_id, creato_il);
  CREATE TABLE settings (
    chiave TEXT PRIMARY KEY,
    valore TEXT NOT NULL
  );
  `,
];

export const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function json<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

type Row = Record<string, unknown>;

export class Db {
  readonly sqlite: Database;

  constructor(path: string) {
    if (path !== ":memory:") fs.mkdirSync(nodePath.dirname(path), { recursive: true });
    this.sqlite = new Database(path, { create: true, strict: true });
    this.sqlite.run("PRAGMA journal_mode = WAL");
    this.sqlite.run("PRAGMA foreign_keys = ON");
    this.sqlite.run("PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  migrate(): void {
    const version = (this.sqlite.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    for (let i = version; i < MIGRATIONS.length; i++) {
      this.sqlite.transaction(() => {
        this.sqlite.run(MIGRATIONS[i]!);
        this.sqlite.run(`PRAGMA user_version = ${i + 1}`);
      })();
    }
  }

  close(): void {
    this.sqlite.close();
  }

  // --- Impostazioni ---

  getSetting(key: string): string | null {
    const row = this.sqlite.query("SELECT valore FROM settings WHERE chiave = ?").get(key) as Row | null;
    return (row?.valore as string) ?? null;
  }

  setSetting(key: string, value: string): void {
    this.sqlite
      .query(
        "INSERT INTO settings (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore",
      )
      .run(key, value);
  }

  // --- Thread ---

  #thread(row: Row): Thread {
    return {
      id: row.id as string,
      title: row.titolo as string,
      contextNotes: row.note_contesto as string,
      textLanguage: row.lingua_testi as string,
      imageModel: row.modello_fissato as string,
      preciseModel: row.modello_preciso as string,
      lastSlot: (row.ultimo_slot as Slot | null) ?? null,
      createdAt: row.creato_il as string,
      updatedAt: row.aggiornato_il as string,
    };
  }

  createThread(input: {
    title: string;
    contextNotes: string;
    textLanguage: string;
    imageModel: string;
    preciseModel: string;
  }): Thread {
    const id = newId();
    const t = now();
    this.sqlite
      .query(
        `INSERT INTO threads (id, titolo, note_contesto, lingua_testi, modello_fissato, modello_preciso, creato_il, aggiornato_il)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.contextNotes,
        input.textLanguage,
        input.imageModel,
        input.preciseModel,
        t,
        t,
      );
    return this.getThread(id)!;
  }

  getThread(id: string): Thread | null {
    const row = this.sqlite.query("SELECT * FROM threads WHERE id = ?").get(id) as Row | null;
    return row ? this.#thread(row) : null;
  }

  listThreads(): ThreadSummary[] {
    const rows = this.sqlite
      .query(
        `SELECT t.id, t.titolo, t.aggiornato_il,
           (SELECT COUNT(*) FROM images i WHERE i.thread_id = t.id AND i.stato = 'done') AS n,
           (SELECT GROUP_CONCAT(colore, ',') FROM (SELECT colore FROM styles s WHERE s.thread_id = t.id ORDER BY slot)) AS colori
         FROM threads t WHERE archiviato = 0 ORDER BY t.aggiornato_il DESC`,
      )
      .all() as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      title: r.titolo as string,
      updatedAt: r.aggiornato_il as string,
      imageCount: r.n as number,
      styleColors: r.colori ? (r.colori as string).split(",") : [],
    }));
  }

  updateThread(
    id: string,
    patch: Partial<
      Pick<Thread, "title" | "contextNotes" | "textLanguage" | "imageModel" | "preciseModel" | "lastSlot">
    >,
  ): void {
    const columns: Record<string, string> = {
      title: "titolo",
      contextNotes: "note_contesto",
      textLanguage: "lingua_testi",
      imageModel: "modello_fissato",
      preciseModel: "modello_preciso",
      lastSlot: "ultimo_slot",
    };
    const entries = Object.entries(patch).filter(([k, v]) => k in columns && v !== undefined);
    const sets = [...entries.map(([k]) => `${columns[k]} = ?`), "aggiornato_il = ?"];
    this.sqlite
      .query(`UPDATE threads SET ${sets.join(", ")} WHERE id = ?`)
      .run(...(entries.map(([, v]) => v) as (string | number | null)[]), now(), id);
  }

  touchThread(id: string): void {
    this.sqlite.query("UPDATE threads SET aggiornato_il = ? WHERE id = ?").run(now(), id);
  }

  deleteThread(id: string): void {
    this.sqlite.query("DELETE FROM threads WHERE id = ?").run(id);
  }

  // --- Stili ---

  #style(row: Row): Style {
    return {
      id: row.id as string,
      threadId: row.thread_id as string,
      slot: row.slot as Slot,
      name: row.nome as string,
      color: row.colore as string,
      brief: row.richiesta as string,
      description: json<StyleDescription>(row.descrizione as string | null),
      describing: Boolean(row.in_descrizione),
      describeError: json<UserError>(row.errore_descrizione as string | null),
      params: json<StyleParams>(row.parametri as string)!,
      locked: Boolean(row.bloccato),
      refs: this.listRefs(row.id as string),
    };
  }

  listRefs(styleId: string): StyleRef[] {
    const rows = this.sqlite
      .query("SELECT id, percorso_file, ordine FROM style_refs WHERE style_id = ? ORDER BY ordine")
      .all(styleId) as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      path: r.percorso_file as string,
      position: r.ordine as number,
    }));
  }

  listStyles(threadId: string): Style[] {
    const rows = this.sqlite
      .query("SELECT * FROM styles WHERE thread_id = ? ORDER BY slot")
      .all(threadId) as Row[];
    return rows.map((r) => this.#style(r));
  }

  getStyle(id: string): Style | null {
    const row = this.sqlite.query("SELECT * FROM styles WHERE id = ?").get(id) as Row | null;
    return row ? this.#style(row) : null;
  }

  getStyleBySlot(threadId: string, slot: Slot): Style | null {
    const row = this.sqlite
      .query("SELECT * FROM styles WHERE thread_id = ? AND slot = ?")
      .get(threadId, slot) as Row | null;
    return row ? this.#style(row) : null;
  }

  createStyle(input: {
    threadId: string;
    slot: Slot;
    name: string;
    color: string;
    brief: string;
    params: StyleParams;
  }): Style {
    const id = newId();
    this.sqlite
      .query(
        `INSERT INTO styles (id, thread_id, slot, nome, colore, richiesta, parametri, creato_il) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.threadId,
        input.slot,
        input.name,
        input.color,
        input.brief,
        JSON.stringify(input.params),
        now(),
      );
    return this.getStyle(id)!;
  }

  updateStyle(
    id: string,
    patch: Partial<{
      name: string;
      color: string;
      description: StyleDescription | null;
      describing: boolean;
      describeError: UserError | null;
      params: StyleParams;
      locked: boolean;
    }>,
  ): void {
    const map: Record<string, [string, (v: unknown) => unknown]> = {
      name: ["nome", (v) => v],
      color: ["colore", (v) => v],
      description: ["descrizione", (v) => (v ? JSON.stringify(v) : null)],
      describing: ["in_descrizione", (v) => (v ? 1 : 0)],
      describeError: ["errore_descrizione", (v) => (v ? JSON.stringify(v) : null)],
      params: ["parametri", (v) => JSON.stringify(v)],
      locked: ["bloccato", (v) => (v ? 1 : 0)],
    };
    const entries = Object.entries(patch).filter(([k, v]) => k in map && v !== undefined);
    if (entries.length === 0) return;
    const sets = entries.map(([k]) => `${map[k]![0]} = ?`);
    const values = entries.map(([k, v]) => map[k]![1](v)) as (string | number | null)[];
    this.sqlite.query(`UPDATE styles SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  }

  deleteStyle(id: string): void {
    this.sqlite.query("DELETE FROM styles WHERE id = ?").run(id);
  }

  addRef(styleId: string, refId: string, path: string): StyleRef {
    const max = this.sqlite
      .query("SELECT COALESCE(MAX(ordine), 0) AS m FROM style_refs WHERE style_id = ?")
      .get(styleId) as Row;
    const position = (max.m as number) + 1;
    this.sqlite
      .query("INSERT INTO style_refs (id, style_id, percorso_file, ordine) VALUES (?, ?, ?, ?)")
      .run(refId, styleId, path, position);
    return { id: refId, path, position };
  }

  getRef(refId: string): (StyleRef & { styleId: string }) | null {
    const r = this.sqlite.query("SELECT * FROM style_refs WHERE id = ?").get(refId) as Row | null;
    return r
      ? {
          id: r.id as string,
          styleId: r.style_id as string,
          path: r.percorso_file as string,
          position: r.ordine as number,
        }
      : null;
  }

  deleteRef(refId: string): void {
    this.sqlite.query("DELETE FROM style_refs WHERE id = ?").run(refId);
  }

  /** Stili rimasti "in descrizione" da una sessione interrotta. */
  resetDescribing(): void {
    this.sqlite.run("UPDATE styles SET in_descrizione = 0 WHERE in_descrizione = 1");
  }

  // --- Messaggi e immagini ---

  #image(row: Row): GeneratedImage {
    return {
      id: row.id as string,
      messageId: row.message_id as string,
      threadId: row.thread_id as string,
      styleId: (row.style_id as string | null) ?? null,
      parentImageId: (row.immagine_madre_id as string | null) ?? null,
      path: (row.percorso_file as string | null) ?? null,
      thumbPath: (row.miniatura as string | null) ?? null,
      finalPrompt: row.prompt_finale as string,
      params: json<ImageParams>(row.parametri as string)!,
      model: row.modello as string,
      inputTokens: row.token_ingresso as number,
      outputTokens: row.token_uscita as number,
      costUsd: row.costo_usd as number,
      status: row.stato as ImageStatus,
      error: json<UserError>(row.errore as string | null),
      createdAt: row.creato_il as string,
    };
  }

  createMessage(input: {
    threadId: string;
    kind: MessageKind;
    text: string;
    styleId: string | null;
    styleLabel: StyleLabel | null;
    parentImageId: string | null;
    options: MessageOptions;
  }): string {
    const id = newId();
    this.sqlite
      .query(
        `INSERT INTO messages (id, thread_id, tipo, testo, style_id, etichetta_stile, immagine_madre_id, opzioni, creato_il)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.threadId,
        input.kind,
        input.text,
        input.styleId,
        input.styleLabel ? JSON.stringify(input.styleLabel) : null,
        input.parentImageId,
        JSON.stringify(input.options),
        now(),
      );
    this.touchThread(input.threadId);
    return id;
  }

  createImage(input: {
    messageId: string;
    threadId: string;
    styleId: string | null;
    parentImageId: string | null;
    variant: number;
    finalPrompt: string;
    params: ImageParams;
    model: string;
  }): string {
    const id = newId();
    this.sqlite
      .query(
        `INSERT INTO images (id, message_id, thread_id, style_id, immagine_madre_id, variante, prompt_finale, parametri, modello, stato, creato_il)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
      )
      .run(
        id,
        input.messageId,
        input.threadId,
        input.styleId,
        input.parentImageId,
        input.variant,
        input.finalPrompt,
        JSON.stringify(input.params),
        input.model,
        now(),
      );
    return id;
  }

  getImage(id: string): GeneratedImage | null {
    const row = this.sqlite.query("SELECT * FROM images WHERE id = ?").get(id) as Row | null;
    return row ? this.#image(row) : null;
  }

  setImageStatus(id: string, status: ImageStatus, error: UserError | null = null): void {
    this.sqlite
      .query("UPDATE images SET stato = ?, errore = ? WHERE id = ?")
      .run(status, error ? JSON.stringify(error) : null, id);
  }

  completeImage(
    id: string,
    result: { path: string; thumbPath: string; inputTokens: number; outputTokens: number; costUsd: number },
  ): void {
    this.sqlite
      .query(
        `UPDATE images SET stato = 'done', errore = NULL, percorso_file = ?, miniatura = ?, token_ingresso = ?, token_uscita = ?, costo_usd = ? WHERE id = ?`,
      )
      .run(result.path, result.thumbPath, result.inputTokens, result.outputTokens, result.costUsd, id);
  }

  /** Lavori rimasti a metà quando l'app è stata chiusa. */
  failInterrupted(error: UserError): number {
    return this.sqlite
      .query("UPDATE images SET stato = 'failed', errore = ? WHERE stato IN ('queued', 'running')")
      .run(JSON.stringify(error)).changes;
  }

  listMessages(threadId: string): Message[] {
    const rows = this.sqlite
      .query("SELECT * FROM messages WHERE thread_id = ? ORDER BY creato_il, rowid")
      .all(threadId) as Row[];
    const images = this.sqlite
      .query("SELECT * FROM images WHERE thread_id = ? ORDER BY variante")
      .all(threadId) as Row[];
    const byMessage = new Map<string, GeneratedImage[]>();
    for (const r of images) {
      const img = this.#image(r);
      const list = byMessage.get(img.messageId) ?? [];
      list.push(img);
      byMessage.set(img.messageId, list);
    }
    return rows.map((r) => ({
      id: r.id as string,
      threadId: r.thread_id as string,
      kind: r.tipo as MessageKind,
      text: r.testo as string,
      styleId: (r.style_id as string | null) ?? null,
      styleLabel: json<StyleLabel>(r.etichetta_stile as string | null),
      parentImageId: (r.immagine_madre_id as string | null) ?? null,
      options: json<MessageOptions>(r.opzioni as string)!,
      createdAt: r.creato_il as string,
      images: byMessage.get(r.id as string) ?? [],
    }));
  }

  getMessage(id: string): Message | null {
    const row = this.sqlite.query("SELECT thread_id FROM messages WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return this.listMessages(row.thread_id as string).find((m) => m.id === id) ?? null;
  }

  /** Spesa stimata dal primo giorno del mese corrente (ora locale). */
  monthCostUsd(date = new Date()): number {
    const start = new Date(date.getFullYear(), date.getMonth(), 1).toISOString();
    const row = this.sqlite
      .query("SELECT COALESCE(SUM(costo_usd), 0) AS s FROM images WHERE creato_il >= ?")
      .get(start) as Row;
    return row.s as number;
  }
}
