import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { JobEvent } from "../shared/types";
import { Db } from "./db";
import { FakeProvider } from "./fake-provider";
import { Files } from "./files";
import type { EditRequest, GenerateRequest } from "./provider";
import { Studio } from "./studio";

class RecordingProvider extends FakeProvider {
  edits: EditRequest[] = [];
  generations: GenerateRequest[] = [];
  failures: unknown[] = [];
  constructor() {
    super(0);
  }
  override async generate(req: GenerateRequest) {
    this.generations.push(req);
    const failure = this.failures.shift();
    if (failure) throw failure;
    return super.generate(req);
  }
  override async editWithReferences(req: EditRequest) {
    this.edits.push(req);
    const failure = this.failures.shift();
    if (failure) throw failure;
    return super.editWithReferences(req);
  }
}

let dir: string;
let db: Db;
let provider: RecordingProvider;
let events: JobEvent[];
let studio: Studio;

function open() {
  db = new Db(path.join(dir, "app.db"));
  studio = new Studio({
    db,
    files: new Files(dir),
    provider,
    emit: (e) => events.push(e),
    sleep: async () => {},
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bottega-studio-"));
  provider = new RecordingProvider();
  events = [];
  open();
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function threadWithStyle() {
  const thread = studio.createThread({
    title: "Vulcani",
    contextNotes: "ricerca di terza media sui vulcani",
  });
  const { style } = studio.createStyleFromBrief(
    thread.id,
    { name: "Sezioni", color: "#2f6db5", kind: "illustrazione" },
    "acquerello morbido",
  );
  await studio.queue.idle();
  const trial = studio.getThread(thread.id).messages[0]!;
  await studio.useImageAsStyle(trial.images[0]!.id, style.id);
  await studio.queue.idle();
  return { thread, style: studio.db.getStyle(style.id)! };
}

describe("Studio", () => {
  test("il thread fissa i modelli delle impostazioni al momento della creazione", () => {
    const thread = studio.createThread({ title: "  " });
    expect(thread.title).toBe("Nuovo progetto");
    expect(thread.imageModel).toBe("gpt-image-2.6-flare");
    studio.saveSettings({ imageModel: "gpt-image-2.7-flare" });
    expect(studio.db.getThread(thread.id)!.imageModel).toBe("gpt-image-2.6-flare");
  });

  test("stile da descrizione: 3 prove, scelta dell'àncora, descrizione automatica", async () => {
    const { thread, style } = await threadWithStyle();
    expect(provider.generations[0]!.n).toBe(3);
    expect(provider.generations[0]!.quality).toBe("low");
    const detail = studio.getThread(thread.id);
    expect(detail.messages[0]!.kind).toBe("trial");
    expect(detail.messages[0]!.images.every((i) => i.status === "done" && i.path)).toBe(true);
    expect(style.refs).toHaveLength(1);
    expect(style.description?.tecnica).toContain("acquerello morbido");
    expect(style.describing).toBe(false);
    // L'àncora è ridotta a ≤ 1024 px.
    const meta = await new Bun.Image(await studio.files.read(style.refs[0]!.path)).metadata();
    expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(1024);
  });

  test("ogni generazione nello stile manda sempre l'àncora, mai l'ultima immagine", async () => {
    const { thread, style } = await threadWithStyle();
    studio.send({
      threadId: thread.id,
      text: "Il cratere dell'Etna",
      styleId: style.id,
      format: null,
      variants: 2,
    });
    await studio.queue.idle();
    studio.send({
      threadId: thread.id,
      text: "Una colata di lava",
      styleId: style.id,
      format: "square",
      variants: 1,
    });
    await studio.queue.idle();

    expect(provider.edits).toHaveLength(2);
    for (const edit of provider.edits) {
      expect(edit.images).toHaveLength(1);
      expect(edit.images[0]!.name).toBe(path.basename(style.refs[0]!.path));
      expect(edit.prompt).toContain("L'immagine 1 è solo un riferimento di stile");
      expect(edit.prompt).toContain("ricerca di terza media sui vulcani");
      expect(edit.model).toBe(thread.imageModel);
    }
    expect(provider.edits[0]!.n).toBe(2);
    expect(provider.edits[0]!.size).toBe("1536x1024");
    expect(provider.edits[1]!.size).toBe("1024x1024");

    const messages = studio.getThread(thread.id).messages;
    const last = messages.at(-1)!;
    expect(last.styleLabel).toEqual({ name: "Sezioni", color: "#2f6db5" });
    expect(last.images[0]!.costUsd).toBeGreaterThan(0);
    expect(studio.db.getThread(thread.id)!.lastStyleId).toBe(style.id);
  });

  test("senza stile usa generations", async () => {
    const thread = studio.createThread({ title: "Libero" });
    studio.send({ threadId: thread.id, text: "Un faro", styleId: null, format: "portrait", variants: 1 });
    await studio.queue.idle();
    expect(provider.generations[0]!.size).toBe("1024x1536");
    expect(provider.generations[0]!.prompt).not.toContain("STILE");
  });

  test("una modifica manda l'immagine madre più le àncore, con il modello preciso", async () => {
    const { thread, style } = await threadWithStyle();
    const { imageIds } = studio.send({
      threadId: thread.id,
      text: "Un vulcano",
      styleId: style.id,
      format: null,
      variants: 1,
    });
    await studio.queue.idle();
    studio.send({
      threadId: thread.id,
      text: "Rendi il cielo più scuro",
      styleId: style.id,
      format: null,
      variants: 1,
      parentImageId: imageIds[0],
    });
    await studio.queue.idle();
    const edit = provider.edits.at(-1)!;
    expect(edit.images).toHaveLength(2);
    expect(edit.images[0]!.name).toBe(`${imageIds[0]}.png`);
    expect(edit.model).toBe(thread.preciseModel);
    expect(edit.prompt).toContain("L'immagine 1 è l'immagine da modificare");
    expect(edit.prompt).toContain("L'immagine 2 è solo un riferimento di stile");
    const last = studio.getThread(thread.id).messages.at(-1)!;
    expect(last.kind).toBe("edit");
    expect(last.images[0]!.parentImageId).toBe(imageIds[0]!);
  });

  test("rigenerare riusa prompt, modello e riferimenti salvati", async () => {
    const { thread, style } = await threadWithStyle();
    const { imageIds } = studio.send({
      threadId: thread.id,
      text: "Un vulcano",
      styleId: style.id,
      format: null,
      variants: 1,
    });
    await studio.queue.idle();
    studio.regenerate(imageIds[0]!);
    await studio.queue.idle();
    const [first, second] = provider.edits.slice(-2);
    expect(second!.prompt).toBe(first!.prompt);
    expect(second!.model).toBe(first!.model);
    expect(second!.images.map((i) => i.name)).toEqual(first!.images.map((i) => i.name));
  });

  test("uno stile bloccato non cambia per errore", async () => {
    const { style } = await threadWithStyle();
    studio.updateStyle(style.id, { locked: true });
    expect(() => studio.updateStyle(style.id, { name: "Altro" })).toThrow("bloccato");
    expect(() => studio.deleteStyle(style.id)).toThrow("bloccato");
    expect(() => studio.removeRef(style.refs[0]!.id)).toThrow("bloccato");
    studio.updateStyle(style.id, { locked: false });
    expect(studio.updateStyle(style.id, { name: "Altro" }).name).toBe("Altro");
  });

  test("stili senza limite, condivisi tra progetti e conservati nella libreria", async () => {
    const { thread, style } = await threadWithStyle();
    for (const name of ["Infografiche", "Mappe", "Ritratti", "Copertine"]) {
      studio.createStyleFromBrief(thread.id, { name, color: "#000", kind: "illustrazione" }, `stile ${name}`);
    }
    await studio.queue.idle();
    expect(studio.getThread(thread.id).styles.map((s) => s.name)).toEqual([
      "Sezioni",
      "Infografiche",
      "Mappe",
      "Ritratti",
      "Copertine",
    ]);

    // Un altro progetto usa lo stesso stile, non una copia.
    const other = studio.createThread({ title: "Ricerca sui fiumi" });
    studio.attachStyle(other.id, style.id);
    studio.send({ threadId: other.id, text: "Il Ticino", styleId: style.id, format: null, variants: 1 });
    await studio.queue.idle();
    expect(provider.edits.at(-1)!.images[0]!.name).toBe(path.basename(style.refs[0]!.path));
    expect(studio.db.getStyle(style.id)!.projectCount).toBe(2);

    // Togliere dal progetto non elimina dalla libreria.
    studio.detachStyle(thread.id, style.id);
    expect(studio.getThread(thread.id).styles.map((s) => s.id)).not.toContain(style.id);
    expect(studio.listStyles().map((s) => s.id)).toContain(style.id);

    // La copia è indipendente.
    const copy = await studio.duplicateStyle(style.id);
    studio.updateStyle(copy.id, { name: "Sezioni scure" });
    expect(studio.db.getStyle(style.id)!.name).toBe("Sezioni");
    expect(copy.refs).toHaveLength(1);
    expect(copy.refs[0]!.path).not.toBe(style.refs[0]!.path);
  });

  test("stile da descrizione nella libreria: prove nella scheda, àncora, altre prove", async () => {
    const { style } = studio.createStyleFromBrief(
      null,
      { name: "Matita", color: "#000", kind: "illustrazione" },
      "matita colorata su carta ruvida",
    );
    expect(style.trials).toHaveLength(3);
    expect(studio.db.getStyle(style.id)!.projectCount).toBe(0);
    await studio.queue.idle();

    let current = studio.db.getStyle(style.id)!;
    expect(current.trials.every((t) => t.status === "done" && t.path && studio.files.exists(t.path))).toBe(
      true,
    );
    expect(provider.generations.at(-1)!.quality).toBe("low");
    expect(provider.generations.at(-1)!.prompt).toContain("matita colorata su carta ruvida");
    // Nessun progetto coinvolto: nessun messaggio, ma il costo conta nel mese.
    expect(studio.listThreads()).toHaveLength(0);
    expect(studio.monthCostUsd()).toBeGreaterThan(0);

    await studio.useTrialAsAnchor(current.trials[1]!.id);
    await studio.queue.idle();
    current = studio.db.getStyle(style.id)!;
    expect(current.refs).toHaveLength(1);
    expect(current.description?.tecnica).toContain("matita colorata");

    studio.generateTrials(style.id);
    await studio.queue.idle();
    current = studio.db.getStyle(style.id)!;
    expect(current.trials).toHaveLength(6);

    const removed = current.trials[0]!;
    studio.deleteTrial(removed.id);
    expect(studio.files.exists(removed.path!)).toBe(false);
    expect(studio.db.getStyle(style.id)!.trials).toHaveLength(5);

    studio.updateStyle(style.id, { locked: true });
    expect(() => studio.generateTrials(style.id)).toThrow("bloccato");
    expect(studio.useTrialAsAnchor(current.trials[2]!.id)).rejects.toThrow("bloccato");
  });

  test("filtri e errori temporanei: nessun nuovo tentativo sul rifiuto, 2 sui temporanei", async () => {
    const { fromHttp } = await import("./errors");
    const thread = studio.createThread({ title: "Errori" });
    provider.failures.push(fromHttp(400, { error: { code: "moderation_blocked" } }));
    studio.send({ threadId: thread.id, text: "x", styleId: null, format: null, variants: 1 });
    await studio.queue.idle();
    expect(provider.generations).toHaveLength(1);
    const failed = studio.getThread(thread.id).messages[0]!.images[0]!;
    expect(failed.status).toBe("failed");
    expect(failed.error?.title).toBe("Richiesta rifiutata dai filtri");

    provider.failures.push(fromHttp(503, null), fromHttp(429, null));
    studio.send({ threadId: thread.id, text: "y", styleId: null, format: null, variants: 1 });
    await studio.queue.idle();
    expect(provider.generations).toHaveLength(4);
    expect(studio.getThread(thread.id).messages[1]!.images[0]!.status).toBe("done");
    expect(
      events.some((e) => e.status === "failed" && e.error?.title === "Richiesta rifiutata dai filtri"),
    ).toBe(true);
  });

  test("chiudendo e riaprendo: thread, stili e immagini intatti, lavori interrotti segnalati", async () => {
    const { thread, style } = await threadWithStyle();
    studio.send({ threadId: thread.id, text: "Un vulcano", styleId: style.id, format: null, variants: 1 });
    await studio.queue.idle();
    // Un lavoro rimasto in coda alla chiusura
    const messageId = db.createMessage({
      threadId: thread.id,
      kind: "request",
      text: "z",
      styleId: null,
      styleLabel: null,
      parentImageId: null,
      options: { format: null, variants: 1 },
    });
    db.createImage({
      messageId,
      threadId: thread.id,
      styleId: null,
      parentImageId: null,
      variant: 0,
      finalPrompt: "z",
      params: {
        endpoint: "generations",
        size: "1024x1024",
        quality: "low",
        background: "auto",
        inputPaths: [],
      },
      model: "m",
    });
    db.close();

    open();
    studio.recoverInterrupted();
    const detail = studio.getThread(thread.id);
    expect(detail.styles).toHaveLength(1);
    expect(detail.styles[0]!.description).not.toBeNull();
    const images = detail.messages.flatMap((m) => m.images);
    expect(images.filter((i) => i.status === "done").every((i) => studio.files.exists(i.path!))).toBe(true);
    expect(images.at(-1)!.error?.title).toBe("Generazione interrotta");
    expect(studio.monthCostUsd()).toBeGreaterThan(0);
  });

  test("eliminare un thread toglie le sue immagini ma non gli stili", async () => {
    const { thread, style } = await threadWithStyle();
    studio.deleteThread(thread.id);
    expect(fs.existsSync(path.join(dir, "images", thread.id))).toBe(false);
    expect(fs.existsSync(path.join(dir, "styles", style.id))).toBe(true);
    expect(studio.listStyles()[0]!.projectCount).toBe(0);
    studio.deleteStyle(style.id);
    expect(fs.existsSync(path.join(dir, "styles", style.id))).toBe(false);
    expect(studio.listThreads()).toHaveLength(0);
  });
});
