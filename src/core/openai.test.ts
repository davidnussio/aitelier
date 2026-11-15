import { describe, expect, test } from "bun:test";
import { OpenAIProvider, parseUsage, splitModels } from "./openai";
import { ProviderError } from "./errors";

const png = new Uint8Array([137, 80, 78, 71]);
const b64 = Buffer.from(png).toString("base64");

function provider(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  key: string | null = "sk-test",
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const p = new OpenAIProvider({
    getApiKey: async () => key,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init);
    }) as unknown as typeof fetch,
  });
  return { p, calls };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number, error: unknown) => new Response(JSON.stringify({ error }), { status });

describe("OpenAIProvider", () => {
  test("edits invia le àncore come image[] in multipart", async () => {
    const { p, calls } = provider(() =>
      ok({
        data: [{ b64_json: b64 }],
        usage: {
          input_tokens: 900,
          output_tokens: 1000,
          input_tokens_details: { text_tokens: 100, image_tokens: 800 },
        },
      }),
    );
    const result = await p.editWithReferences({
      model: "gpt-image-2.6-flare",
      prompt: "ciao",
      size: "1536x1024",
      quality: "medium",
      background: "auto",
      n: 1,
      images: [
        { bytes: png, name: "a.png", mime: "image/png" },
        { bytes: png, name: "b.png", mime: "image/png" },
      ],
    });
    expect(calls[0]!.url).toEndWith("/images/edits");
    const form = calls[0]!.init.body as FormData;
    expect(form.getAll("image[]")).toHaveLength(2);
    expect(form.get("model")).toBe("gpt-image-2.6-flare");
    expect(form.get("output_format")).toBe("png");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(result.images[0]).toEqual(png);
    expect(result.usage).toEqual({ inputTextTokens: 100, inputImageTokens: 800, outputTokens: 1000 });
  });

  test("generations manda JSON", async () => {
    const { p, calls } = provider(() => ok({ data: [{ b64_json: b64 }, { b64_json: b64 }] }));
    const result = await p.generate({
      model: "m",
      prompt: "x",
      size: "1024x1024",
      quality: "low",
      background: "auto",
      n: 2,
    });
    expect(JSON.parse(calls[0]!.init.body as string).n).toBe(2);
    expect(result.images).toHaveLength(2);
  });

  test("senza chiave l'errore dice dove incollarla", async () => {
    const { p } = provider(() => ok({}), null);
    const error = await p
      .generate({ model: "m", prompt: "x", size: "1024x1024", quality: "low", background: "auto", n: 1 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.userError.title).toBe("Manca la chiave API");
  });

  test.each([
    [401, { message: "bad key" }, "Chiave API non valida", false],
    [
      429,
      { code: "insufficient_quota", message: "You exceeded your current quota" },
      "Credito esaurito",
      false,
    ],
    [429, { message: "Rate limit reached" }, "Troppe richieste", true],
    [
      400,
      { code: "moderation_blocked", message: "Your request was rejected by the safety system" },
      "Richiesta rifiutata dai filtri",
      false,
    ],
    [
      403,
      { message: "Your organization must be verified to use the model" },
      "Organizzazione da verificare",
      false,
    ],
    [404, { code: "model_not_found", message: "The model does not exist" }, "Modello non disponibile", false],
    [503, { message: "overloaded" }, "OpenAI non risponde", true],
  ])("HTTP %d diventa un errore in italiano", async (status, error, title, retryable) => {
    const { p } = provider(() => fail(status, error));
    const e = await p
      .generate({ model: "m", prompt: "x", size: "1024x1024", quality: "low", background: "auto", n: 1 })
      .catch((x) => x);
    expect(e.userError.title).toBe(title);
    expect(e.userError.action.length).toBeGreaterThan(10);
    expect(e.retryable).toBe(retryable);
  });

  test("rete assente", async () => {
    const { p } = provider(() => {
      throw new TypeError("fetch failed");
    });
    const e = await p.verify().catch((x) => x);
    expect(e.userError.title).toBe("Rete assente");
    expect(e.retryable).toBe(true);
  });

  test("describeStyle legge l'output strutturato", async () => {
    const description = {
      tecnica: "acquerello",
      palette: "#fff",
      tratto: "",
      luce: "",
      composizione: "",
      tipografia: "",
      impaginazione: "",
      daEvitare: "",
    };
    const { p, calls } = provider(() =>
      ok({
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(description) }] }],
      }),
    );
    const result = await p.describeStyle({
      model: "gpt-5-mini",
      images: [{ bytes: png, name: "a.png", mime: "image/png" }],
      brief: "",
      kind: "illustrazione",
    });
    expect(result.tecnica).toBe("acquerello");
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.text.format.type).toBe("json_schema");
    expect(body.input[0].content[1].image_url).toStartWith("data:image/png;base64,");
  });

  test("verify usa la chiave candidata e divide i modelli", async () => {
    const { p, calls } = provider(
      () => ok({ data: [{ id: "gpt-image-2.6-flare" }, { id: "gpt-5-mini" }, { id: "whisper-1" }] }),
      null,
    );
    const models = await p.verify("sk-nuova");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-nuova");
    expect(models).toEqual({ imageModels: ["gpt-image-2.6-flare"], textModels: ["gpt-5-mini"] });
  });
});

test("parseUsage senza dettagli conta tutto come testo", () => {
  expect(parseUsage({ input_tokens: 50, output_tokens: 10 })).toEqual({
    inputTextTokens: 50,
    inputImageTokens: 0,
    outputTokens: 10,
  });
  expect(splitModels(["gpt-image-1", "o3", "text-embedding-3"]).textModels).toEqual(["o3"]);
});
