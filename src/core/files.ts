/**
 * File immagine nella cartella dati:
 *   images/<thread>/<id>.png   immagini generate
 *   thumbs/<thread>/<id>.webp  miniature per la chat
 *   styles/<style>/<ref>.png   àncore degli stili (lato lungo ≤ 1024 px)
 */
import fs from "node:fs";
import path from "node:path";
import type { InputImage } from "./provider";

export const REF_MAX_SIDE = 1024;
export const THUMB_MAX_SIDE = 640;

export class Files {
  constructor(readonly dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  abs(rel: string): string {
    const resolved = path.resolve(this.dataDir, rel);
    if (!resolved.startsWith(path.resolve(this.dataDir) + path.sep)) {
      throw new Error(`Percorso fuori dalla cartella dati: ${rel}`);
    }
    return resolved;
  }

  exists(rel: string): boolean {
    try {
      return fs.statSync(this.abs(rel)).isFile();
    } catch {
      return false;
    }
  }

  async #write(rel: string, bytes: Uint8Array): Promise<string> {
    const abs = this.abs(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    await Bun.write(abs, bytes);
    return rel;
  }

  /** Salva un'immagine generata e la sua miniatura. */
  async saveGenerated(
    threadId: string,
    imageId: string,
    png: Uint8Array,
  ): Promise<{ path: string; thumbPath: string }> {
    const rel = await this.#write(`images/${threadId}/${imageId}.png`, png);
    const thumb = await new Bun.Image(png)
      .resize(THUMB_MAX_SIDE, THUMB_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .bytes();
    const thumbRel = await this.#write(`thumbs/${threadId}/${imageId}.webp`, thumb);
    return { path: rel, thumbPath: thumbRel };
  }

  /** Salva un'àncora di stile ridotta a ≤ 1024 px: si paga a ogni chiamata. */
  async saveRef(styleId: string, refId: string, source: Uint8Array): Promise<string> {
    const png = await new Bun.Image(source, { maxPixels: 80_000_000 })
      .resize(REF_MAX_SIDE, REF_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .png()
      .bytes();
    return this.#write(`styles/${styleId}/${refId}.png`, png);
  }

  async read(rel: string): Promise<Uint8Array> {
    return new Uint8Array(await Bun.file(this.abs(rel)).arrayBuffer());
  }

  async input(rel: string): Promise<InputImage> {
    return { bytes: await this.read(rel), name: path.basename(rel), mime: "image/png" };
  }

  remove(rel: string): void {
    try {
      fs.rmSync(this.abs(rel), { force: true });
    } catch {
      // Un file già assente va bene.
    }
  }

  removeDir(rel: string): void {
    fs.rmSync(this.abs(rel), { recursive: true, force: true });
  }
}
