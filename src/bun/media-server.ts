/**
 * Serve le immagini della cartella dati alla webview, così non passano mai
 * come base64 nell'RPC. Ascolta solo su 127.0.0.1, porta casuale; ogni
 * richiesta porta il token di sessione (`?t=`) e un Host che nomina il server.
 * Electrobun 2.0 non offre ancora uno schema personalizzato per i file
 * dell'utente: questo è l'equivalente locale.
 */
import { timingSafeEqual } from "node:crypto";
import path from "node:path";

const ALLOWED = /^(images|thumbs|styles)\/[\w-]+\/[\w-]+\.(png|webp)$/;

const TYPES: Record<string, string> = { ".png": "image/png", ".webp": "image/webp" };

export interface MediaServer {
  url: string;
  token: string;
  stop(): void;
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function startMediaServer(dataDir: string, options: { port?: number } = {}): MediaServer {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("hex");
  const root = path.resolve(dataDir);

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    async fetch(req) {
      if (req.method !== "GET") return new Response("Metodo non ammesso", { status: 405 });
      const url = new URL(req.url);
      if (req.headers.get("host") !== `127.0.0.1:${server.port}`)
        return new Response("Host non valido", { status: 421 });
      if (!sameToken(url.searchParams.get("t") ?? "", token))
        return new Response("Non autorizzato", { status: 401 });
      const rel = decodeURIComponent(url.pathname.replace(/^\/f\//, ""));
      if (!ALLOWED.test(rel)) return new Response("Non trovato", { status: 404 });
      const abs = path.resolve(root, rel);
      if (!abs.startsWith(root + path.sep)) return new Response("Non trovato", { status: 404 });
      const file = Bun.file(abs);
      if (!(await file.exists())) return new Response("Non trovato", { status: 404 });
      return new Response(file, {
        headers: {
          "Content-Type": TYPES[path.extname(abs)] ?? "application/octet-stream",
          // I file non cambiano mai: ogni immagine ha un id nuovo.
          "Cache-Control": "private, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  });

  return { url: `http://127.0.0.1:${server.port}`, token, stop: () => server.stop(true) };
}
