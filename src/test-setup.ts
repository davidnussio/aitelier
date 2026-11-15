/**
 * Caricato da `bun test` prima di ogni file: i test non toccano mai la
 * cartella dati reale né il portachiavi del sistema.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.AITELIER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "aitelier-test-"));
process.env.AITELIER_SECRETS_SERVICE = "ch.dambox.bottega.test";
