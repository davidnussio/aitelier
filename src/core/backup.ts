/**
 * Backup della cartella dati: copia coerente del database (VACUUM INTO) più
 * le immagini. I file immagine non cambiano mai dopo la scrittura, quindi
 * vengono collegati (hard link) invece che copiati: un backup costa pochi KB
 * finché le immagini restano anche nella cartella dati.
 *
 *   backups/<data>-<motivo>/app.db, images/, thumbs/, styles/, backup.json
 *
 * Il ripristino non avviene mentre l'app usa il database: si prenota e si
 * applica al prossimo avvio, prima di aprire app.db, dopo un backup di
 * sicurezza dello stato attuale.
 */
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { BackupInfo, BackupReason } from "../shared/types";

const FOLDERS = ["images", "thumbs", "styles"] as const;
const MARKER = "ripristino-in-attesa.json";
const AUTO_KEEP = 10;
const DAY_MS = 24 * 60 * 60_000;

/**
 * Copia coerente di un database SQLite, anche aperto da un'altra connessione.
 * Non in sola lettura: un database WAL senza il file -shm non si aprirebbe.
 */
export function snapshotDatabase(source: string, target: string): void {
  const db = new Database(source, { create: false });
  try {
    db.query("VACUUM INTO ?").run(target);
  } finally {
    db.close();
  }
}

function linkTree(from: string, to: string): number {
  if (!fs.existsSync(from)) return 0;
  let count = 0;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      count += linkTree(src, dst);
    } else if (entry.isFile()) {
      try {
        fs.linkSync(src, dst);
      } catch {
        fs.copyFileSync(src, dst);
      }
      count++;
    }
  }
  return count;
}

function counts(dbPath: string): { threads: number; styles: number; images: number } {
  const db = new Database(dbPath, { create: false });
  try {
    const n = (sql: string) => {
      try {
        return (db.query(sql).get() as { n: number }).n;
      } catch {
        return 0;
      }
    };
    return {
      threads: n("SELECT COUNT(*) AS n FROM threads"),
      styles: n("SELECT COUNT(*) AS n FROM styles"),
      images: n("SELECT COUNT(*) AS n FROM images WHERE stato = 'done'"),
    };
  } finally {
    db.close();
  }
}

export class Backups {
  readonly dir: string;
  readonly #dbPath: string;

  constructor(readonly dataDir: string) {
    this.dir = path.join(dataDir, "backups");
    this.#dbPath = path.join(dataDir, "app.db");
  }

  create(reason: BackupReason, now = new Date()): BackupInfo {
    if (!fs.existsSync(this.#dbPath)) throw new Error("Non c'è ancora niente da salvare.");
    const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
    let name = `${stamp}-${reason}`;
    for (let i = 2; fs.existsSync(path.join(this.dir, name)); i++) name = `${stamp}-${reason}-${i}`;
    const target = path.join(this.dir, name);
    const partial = `${target}.parziale`;
    fs.rmSync(partial, { recursive: true, force: true });
    fs.mkdirSync(partial, { recursive: true });
    try {
      snapshotDatabase(this.#dbPath, path.join(partial, "app.db"));
      for (const folder of FOLDERS) linkTree(path.join(this.dataDir, folder), path.join(partial, folder));
      const info: BackupInfo = {
        name,
        createdAt: now.toISOString(),
        reason,
        ...counts(path.join(partial, "app.db")),
      };
      fs.writeFileSync(path.join(partial, "backup.json"), JSON.stringify(info, null, 2));
      // Rinominare per ultimo: un backup a metà non compare mai nell'elenco.
      fs.renameSync(partial, target);
      if (reason === "automatico") this.prune();
      return info;
    } catch (error) {
      fs.rmSync(partial, { recursive: true, force: true });
      throw error;
    }
  }

  list(): BackupInfo[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.endsWith(".parziale"))
      .flatMap((e) => {
        try {
          return [
            JSON.parse(fs.readFileSync(path.join(this.dir, e.name, "backup.json"), "utf8")) as BackupInfo,
          ];
        } catch {
          return [];
        }
      })
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Tiene gli ultimi backup automatici; quelli manuali e di sicurezza restano. */
  prune(keep = AUTO_KEEP): void {
    const auto = this.list().filter((b) => b.reason === "automatico");
    for (const old of auto.slice(keep))
      fs.rmSync(path.join(this.dir, old.name), { recursive: true, force: true });
  }

  /** Un backup automatico al giorno. */
  autoIfDue(now = new Date()): BackupInfo | null {
    const last = this.list().find((b) => b.reason === "automatico");
    if (last && now.getTime() - new Date(last.createdAt).getTime() < DAY_MS) return null;
    return this.create("automatico", now);
  }

  requestRestore(name: string): BackupInfo {
    const info = this.list().find((b) => b.name === name);
    if (!info) throw new Error("Backup non trovato.");
    fs.writeFileSync(path.join(this.dataDir, MARKER), JSON.stringify({ name }));
    return info;
  }

  pendingRestore(): string | null {
    try {
      return (JSON.parse(fs.readFileSync(path.join(this.dataDir, MARKER), "utf8")) as { name: string }).name;
    } catch {
      return null;
    }
  }

  cancelRestore(): void {
    fs.rmSync(path.join(this.dataDir, MARKER), { force: true });
  }

  /**
   * Da chiamare all'avvio, prima di aprire il database. Restituisce il backup
   * ripristinato, oppure null se non c'era niente da fare.
   */
  applyPendingRestore(): BackupInfo | null {
    const name = this.pendingRestore();
    if (!name) return null;
    this.cancelRestore();
    const source = path.join(this.dir, name);
    if (!fs.existsSync(path.join(source, "app.db"))) throw new Error(`Backup ${name} non valido`);
    if (fs.existsSync(this.#dbPath)) this.create("prima-del-ripristino");
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${this.#dbPath}${suffix}`, { force: true });
    fs.copyFileSync(path.join(source, "app.db"), this.#dbPath);
    for (const folder of FOLDERS) {
      fs.rmSync(path.join(this.dataDir, folder), { recursive: true, force: true });
      linkTree(path.join(source, folder), path.join(this.dataDir, folder));
    }
    return this.list().find((b) => b.name === name) ?? null;
  }
}
