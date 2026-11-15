/**
 * Fornitore dimostrativo (AITELIER_FAKE_OPENAI=1): disegna immagini astratte
 * in locale, senza rete né chiave. Serve per i test, le prove dell'interfaccia
 * e le schermate con dati demo. Lo stesso stile produce la stessa palette.
 */
import { deflateSync } from "node:zlib";
import type { StyleDescription } from "../shared/types";
import type {
  DescribeRequest,
  EditRequest,
  GenerateRequest,
  ImageProvider,
  ModelList,
  ProviderResult,
} from "./provider";

function crc32(bytes: Uint8Array): number {
  return Bun.hash.crc32(bytes) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** PNG RGB minimale (senza dipendenze). */
export function encodePng(
  width: number,
  height: number,
  rgb: (x: number, y: number) => [number, number, number],
) {
  const raw = new Uint8Array((width * 3 + 1) * height);
  let i = 0;
  for (let y = 0; y < height; y++) {
    raw[i++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rgb(x, y);
      raw[i++] = r;
      raw[i++] = g;
      raw[i++] = b;
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function seeded(text: string) {
  let s = Number(Bun.hash.wyhash(text) % 2_147_483_647n) || 1;
  return () => {
    s = (s * 48_271) % 2_147_483_647;
    return s / 2_147_483_647;
  };
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** Il blocco STILE del prompt decide la palette, il resto la composizione. */
function styleSeed(prompt: string): string {
  const match = /STILE:\n([\s\S]*?)(\n\n|$)/.exec(prompt);
  return match?.[1] ?? prompt.slice(0, 200);
}

export function fakeImage(prompt: string, size: string, variant: number): Uint8Array {
  const [w, h] = size.split("x").map(Number) as [number, number];
  const scale = 4;
  const width = Math.round(w / scale);
  const height = Math.round(h / scale);
  const paletteRand = seeded(styleSeed(prompt));
  const hue = paletteRand() * 360;
  const spread = 20 + paletteRand() * 60;
  const colors = [0, 1, 2, 3].map((i) =>
    hsl((hue + i * spread) % 360, 0.45 + paletteRand() * 0.3, 0.35 + i * 0.12),
  );
  const bg = hsl(hue, 0.25, 0.92);
  const rand = seeded(`${prompt}#${variant}`);
  const shapes = Array.from({ length: 7 }, () => ({
    x: rand() * width,
    y: rand() * height,
    r: (0.08 + rand() * 0.22) * Math.min(width, height),
    c: colors[Math.floor(rand() * colors.length)] as [number, number, number],
  }));
  const horizon = height * (0.55 + rand() * 0.2);
  return encodePng(width, height, (x, y) => {
    let px: [number, number, number] = y > horizon ? (colors[0] as [number, number, number]) : bg;
    for (const s of shapes) {
      const d = Math.hypot(x - s.x, y - s.y);
      if (d < s.r) px = d > s.r - 2 ? [40, 34, 30] : s.c;
    }
    return px;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FakeProvider implements ImageProvider {
  constructor(private readonly delayMs = 1200) {}

  async #images(req: GenerateRequest): Promise<ProviderResult> {
    await sleep(this.delayMs);
    if (/\bvietat[oa]\b/i.test(req.prompt)) {
      const { fromHttp } = await import("./errors");
      throw fromHttp(400, { error: { code: "moderation_blocked", message: "blocked" } });
    }
    const images = await Promise.all(
      Array.from({ length: req.n }, async (_, i) => {
        const small = fakeImage(req.prompt, req.size, i);
        const [w, h] = req.size.split("x").map(Number) as [number, number];
        return new Bun.Image(small).resize(w, h).png().bytes();
      }),
    );
    return {
      images,
      usage: {
        inputTextTokens: Math.ceil(req.prompt.length / 4),
        inputImageTokens: 0,
        outputTokens: 1056 * req.n,
      },
    };
  }

  generate(req: GenerateRequest) {
    return this.#images(req);
  }

  async editWithReferences(req: EditRequest) {
    const result = await this.#images(req);
    result.usage.inputImageTokens = 765 * req.images.length;
    return result;
  }

  async describeStyle(req: DescribeRequest): Promise<StyleDescription> {
    await sleep(this.delayMs / 2);
    const brief = req.brief || "illustrazione morbida";
    return {
      tecnica: `${brief}; resa uniforme, senza fotorealismo.`,
      palette:
        "#2F6DB5 blu profondo, #E07A1F arancio caldo, #F4EBDD carta, #3F8F5A verde salvia, #2B2420 inchiostro.",
      tratto: "Contorni morbidi a spessore costante, texture leggera della carta.",
      luce: "Luce diffusa da sinistra, ombre brevi e poco contrastate.",
      composizione: "Soggetto centrale, molto spazio vuoto attorno, orizzonte basso.",
      tipografia: "Titoli in un sans-serif arrotondato, maiuscole solo all'inizio.",
      impaginazione:
        req.kind === "infografica"
          ? "Griglia a 3 colonne, icone lineari a tratto pieno, titolo grande in alto, dati evidenziati in arancio."
          : "",
      daEvitare: "Fotorealismo, gradienti al neon, testo deformato.",
    };
  }

  async verify(apiKey?: string): Promise<ModelList> {
    await sleep(200);
    if (apiKey !== undefined && !apiKey.startsWith("sk-")) {
      const { fromHttp } = await import("./errors");
      throw fromHttp(401, null);
    }
    return {
      imageModels: [
        "gpt-image-2.5-flare",
        "gpt-image-2.5-sunburst",
        "gpt-image-2.6-flare",
        "gpt-image-2.6-sunburst",
      ],
      textModels: ["gpt-5-mini", "gpt-5.1"],
    };
  }
}
