/**
 * Finestra «Salva» per scaricare un'immagine. Electrobun 2.0 ha solo la
 * finestra di apertura: su macOS si usa il pannello di salvataggio di sistema
 * tramite AppleScript (`choose file name`: nome, cartella e pulsante Salva);
 * altrove si sceglie una cartella con la finestra di apertura.
 */
import path from "node:path";

/** Testo sicuro dentro una stringa AppleScript tra virgolette. */
export function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function saveDialogScript(defaultName: string, defaultDir: string): string[] {
  return [
    "tell me to activate",
    `set f to choose file name with prompt "Salva l'immagine" default name ${appleScriptString(defaultName)} default location (POSIX file ${appleScriptString(defaultDir)})`,
    "return POSIX path of f",
  ];
}

/** Aggiunge .png se manca: il file salvato è sempre un PNG. */
export function withPngExtension(target: string): string {
  return /\.png$/i.test(target) ? target : `${target}.png`;
}

export interface SaveDialogDeps {
  platform: NodeJS.Platform;
  /** Ripiego fuori da macOS: sceglie una cartella. */
  chooseFolder: (startingFolder: string) => Promise<string | null>;
}

/** Restituisce il percorso scelto, oppure null se l'utente annulla. */
export async function chooseSavePath(
  defaultName: string,
  defaultDir: string,
  deps: SaveDialogDeps,
): Promise<string | null> {
  if (deps.platform === "darwin") {
    const args = saveDialogScript(defaultName, defaultDir).flatMap((line) => ["-e", line]);
    const proc = Bun.spawn(["osascript", ...args], { stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) {
      // -128 = l'utente ha premuto Annulla.
      if (err.includes("-128")) return null;
      throw new Error(`Finestra di salvataggio non disponibile: ${err.trim()}`);
    }
    const chosen = out.trim();
    return chosen ? withPngExtension(chosen) : null;
  }
  const folder = await deps.chooseFolder(defaultDir);
  return folder ? path.join(folder, defaultName) : null;
}
