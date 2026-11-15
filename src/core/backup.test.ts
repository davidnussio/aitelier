import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Backups } from "./backup";
import { Db, MIGRATIONS, SCHEMA_VERSION } from "./db";
import { FakeProvider } from "./fake-provider";
import { Files } from "./files";
import { Studio } from "./studio";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "aitelier-backup-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function open() {
  const db = new Db(path.join(dir, "app.db"));
  const studio = new Studio({
    db,
    files: new Files(dir),
    provider: new FakeProvider(0),
    emit: () => {},
    sleep: async () => {},
  });
  return { db, studio };
}

test("migrazione 1 → 2: gli stili A/B/C diventano stili della libreria, in ordine", () => {
  const file = path.join(dir, "app.db");
  const v1 = new Database(file, { create: true });
  v1.run(MIGRATIONS[0]!);
  const t = "2026-11-15T10:00:00.000Z";
  v1.run(
    `INSERT INTO threads (id, titolo, modello_fissato, modello_preciso, ultimo_slot, creato_il, aggiornato_il)
     VALUES ('t1', 'Vulcani', 'flare', 'sunburst', 3, '${t}', '${t}')`,
  );
  for (const [id, slot, name] of [
    ["s1", 1, "Sezioni"],
    ["s3", 3, "Infografiche"],
  ] as const) {
    v1.run(
      `INSERT INTO styles (id, thread_id, slot, nome, colore, parametri, bloccato, creato_il)
       VALUES ('${id}', 't1', ${slot}, '${name}', '#000', '{"format":"landscape","quality":"medium","transparent":false,"model":"veloce","kind":"illustrazione"}', ${slot === 3 ? 1 : 0}, '${t}')`,
    );
  }
  v1.run(
    `INSERT INTO style_refs (id, style_id, percorso_file, ordine) VALUES ('r1', 's1', 'styles/s1/r1.png', 1)`,
  );
  v1.run("PRAGMA user_version = 1");
  v1.close();

  expect(Db.versionOf(file)).toBe(1);
  const db = new Db(file);
  expect(Db.versionOf(file)).toBe(SCHEMA_VERSION);
  const styles = db.listStyles("t1");
  expect(styles.map((s) => s.name)).toEqual(["Sezioni", "Infografiche"]);
  expect(styles[0]!.refs.map((r) => r.path)).toEqual(["styles/s1/r1.png"]);
  expect(styles[1]!.locked).toBe(true);
  expect(db.getThread("t1")!.lastStyleId).toBe("s3");
  expect(db.listAllStyles()).toHaveLength(2);
  // Le chiavi esterne sono di nuovo attive.
  expect((db.sqlite.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(1);
  db.close();
});

test("backup e ripristino al prossimo avvio, con backup di sicurezza", async () => {
  let { db, studio } = open();
  const thread = studio.createThread({ title: "Da salvare" });
  studio.send({ threadId: thread.id, text: "Un faro", styleId: null, format: "square", variants: 1 });
  await studio.queue.idle();
  const image = studio.getThread(thread.id).messages[0]!.images[0]!;

  const backups = new Backups(dir);
  const info = backups.create("manuale");
  expect(info).toMatchObject({ reason: "manuale", threads: 1, images: 1 });
  // Le immagini sono collegate, non copiate.
  const original = fs.statSync(path.join(dir, image.path!));
  const saved = fs.statSync(path.join(backups.dir, info.name, image.path!));
  expect(saved.ino).toBe(original.ino);

  studio.deleteThread(thread.id);
  expect(studio.listThreads()).toHaveLength(0);
  backups.requestRestore(info.name);
  expect(backups.pendingRestore()).toBe(info.name);
  db.close();

  expect(backups.applyPendingRestore()?.name).toBe(info.name);
  expect(backups.pendingRestore()).toBeNull();
  ({ db, studio } = open());
  expect(studio.listThreads().map((t) => t.title)).toEqual(["Da salvare"]);
  expect(fs.existsSync(path.join(dir, image.path!))).toBe(true);
  expect(backups.list().map((b) => b.reason)).toContain("prima-del-ripristino");
  db.close();
});

test("backup automatico: uno al giorno, ne restano 10", () => {
  const { db } = open();
  const backups = new Backups(dir);
  const day = 24 * 60 * 60_000;
  const start = new Date("2026-11-01T08:00:00Z").getTime();
  expect(backups.autoIfDue(new Date(start))).not.toBeNull();
  expect(backups.autoIfDue(new Date(start + day / 2))).toBeNull();
  for (let i = 1; i <= 12; i++) backups.autoIfDue(new Date(start + i * day));
  backups.create("manuale");
  const list = backups.list();
  expect(list.filter((b) => b.reason === "automatico")).toHaveLength(10);
  expect(list.filter((b) => b.reason === "manuale")).toHaveLength(1);
  db.close();
});
