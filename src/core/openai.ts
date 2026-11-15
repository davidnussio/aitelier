/**
 * Fornitore OpenAI: Image API per generare e modificare, Responses API per
 * ricavare la descrizione dello stile da un'immagine. Nessuno stato di
 * conversazione lato OpenAI: ogni chiamata porta con sé le sue àncore.
 */
import type { StyleDescription } from "../shared/types";
import { fromHttp, missingKeyError, networkError, ProviderError, timeoutError } from "./errors";
import type {
  DescribeRequest,
  EditRequest,
  GenerateRequest,
  ImageProvider,
  ModelList,
  ProviderResult,
  Usage,
} from "./provider";

const API = "https://api.openai.com/v1";
const IMAGE_TIMEOUT_MS = 5 * 60_000;
const TEXT_TIMEOUT_MS = 2 * 60_000;

export interface OpenAIProviderOptions {
  getApiKey: () => Promise<string | null>;
  fetch?: typeof fetch;
  baseUrl?: string;
}

interface ImagesResponse {
  data?: { b64_json?: string }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { text_tokens?: number; image_tokens?: number };
  };
}

export function parseUsage(usage: ImagesResponse["usage"]): Usage {
  const input = usage?.input_tokens ?? 0;
  const text = usage?.input_tokens_details?.text_tokens;
  const image = usage?.input_tokens_details?.image_tokens;
  return {
    inputTextTokens: text ?? (image === undefined ? input : Math.max(0, input - image)),
    inputImageTokens: image ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  };
}

const DESCRIPTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "tecnica",
    "palette",
    "tratto",
    "luce",
    "composizione",
    "tipografia",
    "impaginazione",
    "daEvitare",
  ],
  properties: {
    tecnica: {
      type: "string",
      description: "Mezzo e tecnica (es. acquerello su carta ruvida, vettoriale piatto).",
    },
    palette: { type: "string", description: "5-8 colori dominanti con codici esadecimali e il loro ruolo." },
    tratto: { type: "string", description: "Linee, contorni, spessori, texture." },
    luce: { type: "string", description: "Illuminazione, ombre, contrasto." },
    composizione: {
      type: "string",
      description: "Inquadratura, prospettiva, densità, uso dello spazio vuoto.",
    },
    tipografia: {
      type: "string",
      description: "Caratteri e resa dei testi, se presenti; altrimenti indicazioni coerenti con lo stile.",
    },
    impaginazione: {
      type: "string",
      description:
        "Solo per infografiche: griglia, stile delle icone, gerarchia dei titoli, colori per i dati. Stringa vuota per le illustrazioni.",
    },
    daEvitare: { type: "string", description: "Cosa non deve comparire per non tradire lo stile." },
  },
} as const;

export function describeInstructions(kind: DescribeRequest["kind"], brief: string): string {
  return [
    "Sei un direttore artistico. Analizza le immagini di riferimento e descrivi SOLO lo stile visivo, mai i soggetti.",
    "La descrizione servirà a un modello di generazione di immagini per produrre nuove immagini dello stesso stile, riconoscibili come della stessa mano.",
    "Scrivi in italiano, frasi brevi e concrete. Nella palette indica i colori con codici esadecimali.",
    kind === "infografica"
      ? "È uno stile per infografiche: compila con cura «impaginazione» (griglia, icone, carattere, gerarchia dei titoli, colori per i dati) e «tipografia»."
      : "È uno stile per illustrazioni: lascia «impaginazione» come stringa vuota.",
    brief
      ? `L'utente ha descritto lo stile così: «${brief}». Usalo come guida dove l'immagine è ambigua.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export class OpenAIProvider implements ImageProvider {
  readonly #getApiKey: () => Promise<string | null>;
  readonly #fetch: typeof fetch;
  readonly #base: string;

  constructor(options: OpenAIProviderOptions) {
    this.#getApiKey = options.getApiKey;
    this.#fetch = options.fetch ?? fetch;
    this.#base = options.baseUrl ?? API;
  }

  async #key(explicit?: string): Promise<string> {
    const key = explicit ?? (await this.#getApiKey());
    if (!key) throw missingKeyError();
    return key;
  }

  async #request(
    path: string,
    init: {
      method?: string;
      body?: BodyInit;
      json?: unknown;
      apiKey?: string;
      timeoutMs: number;
      model?: string;
    },
    signal?: AbortSignal,
  ): Promise<unknown> {
    const key = await this.#key(init.apiKey);
    const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
    let body = init.body;
    if (init.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.json);
    }
    const timeout = AbortSignal.timeout(init.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let res: Response;
    try {
      res = await this.#fetch(`${this.#base}${path}`, {
        method: init.method ?? (body ? "POST" : "GET"),
        headers,
        body,
        signal: combined,
      });
    } catch (error) {
      if (timeout.aborted) throw timeoutError();
      if (signal?.aborted) throw error;
      throw networkError(error);
    }

    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) throw fromHttp(res.status, parsed, init.model);
    return parsed;
  }

  #toResult(json: unknown): ProviderResult {
    const response = json as ImagesResponse;
    const images = (response.data ?? [])
      .map((d) => d.b64_json)
      .filter((b): b is string => Boolean(b))
      .map((b) => new Uint8Array(Buffer.from(b, "base64")));
    if (images.length === 0) {
      throw new ProviderError({
        title: "Nessuna immagine ricevuta",
        detail: "OpenAI ha risposto senza immagini.",
        action: "Riprova; se succede ancora, cambia modello nelle Impostazioni › Avanzate.",
      });
    }
    return { images, usage: parseUsage(response.usage) };
  }

  async generate(req: GenerateRequest, signal?: AbortSignal): Promise<ProviderResult> {
    const json = await this.#request(
      "/images/generations",
      {
        json: {
          model: req.model,
          prompt: req.prompt,
          size: req.size,
          quality: req.quality,
          background: req.background,
          output_format: "png",
          n: req.n,
        },
        timeoutMs: IMAGE_TIMEOUT_MS,
        model: req.model,
      },
      signal,
    );
    return this.#toResult(json);
  }

  async editWithReferences(req: EditRequest, signal?: AbortSignal): Promise<ProviderResult> {
    const form = new FormData();
    form.append("model", req.model);
    form.append("prompt", req.prompt);
    form.append("size", req.size);
    form.append("quality", req.quality);
    form.append("background", req.background);
    form.append("output_format", "png");
    form.append("n", String(req.n));
    for (const image of req.images) {
      form.append(
        "image[]",
        new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type: image.mime }),
        image.name,
      );
    }
    const json = await this.#request(
      "/images/edits",
      { body: form, timeoutMs: IMAGE_TIMEOUT_MS, model: req.model },
      signal,
    );
    return this.#toResult(json);
  }

  async describeStyle(req: DescribeRequest, signal?: AbortSignal): Promise<StyleDescription> {
    const json = (await this.#request(
      "/responses",
      {
        json: {
          model: req.model,
          instructions: describeInstructions(req.kind, req.brief),
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: "Ecco le immagini di riferimento dello stile." },
                ...req.images.map((image) => ({
                  type: "input_image",
                  image_url: `data:${image.mime};base64,${base64(image.bytes)}`,
                })),
              ],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "descrizione_stile",
              strict: true,
              schema: DESCRIPTION_SCHEMA,
            },
          },
        },
        timeoutMs: TEXT_TIMEOUT_MS,
        model: req.model,
      },
      signal,
    )) as { output?: { type?: string; content?: { type?: string; text?: string }[] }[] };

    const text = (json.output ?? [])
      .flatMap((item) => item.content ?? [])
      .find((c) => c.type === "output_text")?.text;
    try {
      return normalizeDescription(JSON.parse(text ?? ""));
    } catch {
      throw new ProviderError({
        title: "Descrizione non riuscita",
        detail: "Il modello non ha restituito una descrizione leggibile dello stile.",
        action: "Premi «Rigenera descrizione» oppure scrivila a mano.",
      });
    }
  }

  async verify(apiKey?: string): Promise<ModelList> {
    const json = (await this.#request("/models", { apiKey, timeoutMs: 20_000 })) as {
      data?: { id: string }[];
    };
    return splitModels((json.data ?? []).map((m) => m.id));
  }
}

export function normalizeDescription(value: unknown): StyleDescription {
  const v = (value ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof v[k] === "string" ? (v[k] as string).trim() : "");
  const description: StyleDescription = {
    tecnica: s("tecnica"),
    palette: s("palette"),
    tratto: s("tratto"),
    luce: s("luce"),
    composizione: s("composizione"),
    tipografia: s("tipografia"),
    impaginazione: s("impaginazione"),
    daEvitare: s("daEvitare"),
  };
  if (!description.tecnica && !description.palette) throw new Error("descrizione vuota");
  return description;
}

const NOT_TEXT =
  /(image|dall-e|tts|whisper|audio|realtime|transcribe|embedding|moderation|search|codex|sora|computer)/;

export function splitModels(ids: string[]): ModelList {
  const sorted = [...new Set(ids)].toSorted();
  return {
    imageModels: sorted.filter((id) => id.includes("image")),
    textModels: sorted.filter((id) => /^(gpt-|o\d)/.test(id) && !NOT_TEXT.test(id)),
  };
}
