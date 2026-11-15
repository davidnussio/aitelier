/**
 * Log su file (cartella dati/logs/bottega.log, ruotato a 2 MB). Le chiavi
 * API vengono oscurate anche se finissero per sbaglio in un messaggio.
 */
import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 2 * 1024 * 1024;
const KEY_PATTERN = /sk-[A-Za-z0-9_-]{8,}/g;

export function redact(text: string): string {
  return text.replace(KEY_PATTERN, "sk-***");
}

function describe(error: unknown): string {
  if (error === undefined) return "";
  if (error instanceof Error)
    return ` ${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`;
  try {
    return ` ${JSON.stringify(error)}`;
  } catch {
    return ` ${String(error)}`;
  }
}

export function createLogger(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "bottega.log");

  function write(level: string, message: string, error?: unknown) {
    const line = redact(`${new Date().toISOString()} ${level} ${message}${describe(error)}\n`);
    if (level !== "INFO") console.error(line.trimEnd());
    else console.log(line.trimEnd());
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, line);
    } catch {
      // Il log è un aiuto, non deve mai bloccare l'app.
    }
  }

  return {
    file,
    info: (message: string, error?: unknown) => write("INFO", message, error),
    warn: (message: string, error?: unknown) => write("WARN", message, error),
    error: (message: string, error?: unknown) => write("ERROR", message, error),
  };
}

/** Le ultime righe del registro (già oscurate), per la finestra «Registro». */
export function readLogTail(file: string, maxLines = 400): string {
  try {
    const previous = fs.existsSync(`${file}.1`) ? fs.readFileSync(`${file}.1`, "utf8") : "";
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const lines = (previous + current).split("\n").filter(Boolean);
    return redact(lines.slice(-maxLines).join("\n"));
  } catch {
    return "";
  }
}
