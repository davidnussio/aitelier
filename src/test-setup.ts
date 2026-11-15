/**
 * Caricato da `bun test` prima di ogni file: i test non toccano mai la
 * cartella dati reale né il portachiavi del sistema.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.BOTTEGA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "bottega-test-"));
process.env.BOTTEGA_SECRETS_SERVICE = "ch.dambox.bottega.test";
