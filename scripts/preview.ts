/**
 * Anteprima dell'interfaccia nel browser con dati demo: stesso core, stesso
 * fornitore dimostrativo, nessuna chiave né rete. Serve per provare la UI e
 * per le schermate (ADR 0004 di dev-commons).
 *
 *   bun run preview            → http://localhost:5292
 *   BOTTEGA_HOME=… per scegliere la cartella dati (predefinita: una temporanea)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Db } from "../src/core/db";
import { FakeProvider, fakeImage } from "../src/core/fake-provider";
import { Files } from "../src/core/files";
import { Studio } from "../src/core/studio";
import { createHandlers, type Handlers } from "../src/bun/handlers";
import { startMediaServer } from "../src/bun/media-server";
import type { JobEvent } from "../src/shared/types";
import pkg from "../package.json";

const PORT = Number(process.env.PORT ?? 5292);
const dataDir = process.env.BOTTEGA_HOME || fs.mkdtempSync(path.join(os.tmpdir(), "bottega-preview-"));
const dist = path.resolve(import.meta.dir, "../dist-preview");

const clients = new Set<ReadableStreamDefaultController<string>>();
const emit = (event: JobEvent) => {
  for (const c of clients) c.enqueue(`data: ${JSON.stringify(event)}\n\n`);
};

const db = new Db(path.join(dataDir, "app.db"));
const files = new Files(dataDir);
const provider = new FakeProvider(900);
const studio = new Studio({ db, files, provider, emit, log: (m, e) => console.warn(m, e) });
studio.recoverInterrupted();
const media = startMediaServer(dataDir);

let picks = 0;
const handlers = createHandlers({
  studio,
  files,
  provider,
  secrets: {
    get: async () => null,
    set: async () => {},
    remove: async () => {},
    status: async () => ({ set: true, masked: "demo", storage: null }),
  },
  demo: true,
  info: () => ({ version: pkg.version, mediaBase: media.url, mediaToken: media.token, demo: true, dataDir }),
  picturesDir: path.join(dataDir, "export"),
  // Niente finestra nativa nel browser: un'immagine demo al posto del file scelto.
  pickImage: async () => fakeImage(`STILE:\nimmagine caricata ${++picks}\n\n`, "1024x1024", picks),
  showItemInFolder: (p) => console.log("Mostra nel Finder:", p),
  openExternal: (url) => console.log("Apri:", url),
  log: { error: (m, e) => console.error(m, e) },
});

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/events") {
      let ctrl: ReadableStreamDefaultController<string>;
      const stream = new ReadableStream<string>({
        start(c) {
          ctrl = c;
          clients.add(c);
        },
        cancel() {
          clients.delete(ctrl);
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
      });
    }
    if (url.pathname.startsWith("/rpc/") && req.method === "POST") {
      const name = url.pathname.slice(5) as keyof Handlers;
      const handler = handlers[name] as ((p: unknown) => Promise<unknown>) | undefined;
      if (!handler)
        return Response.json({ ok: false, error: `Richiesta sconosciuta: ${name}` }, { status: 404 });
      return Response.json(await handler(await req.json()));
    }
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = Bun.file(path.join(dist, path.normalize(rel)));
    return (await file.exists()) ? new Response(file) : new Response(Bun.file(path.join(dist, "index.html")));
  },
});

console.log(`Anteprima Bottega su http://localhost:${PORT} (dati: ${dataDir})`);
