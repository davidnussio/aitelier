/**
 * Errori del fornitore tradotti in linguaggio comune, sempre con cosa fare dopo.
 */
import type { UserError } from "../shared/types";

export class ProviderError extends Error {
  readonly userError: UserError;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(
    userError: UserError,
    options: { retryable?: boolean; status?: number | null; cause?: unknown } = {},
  ) {
    super(`${userError.title}: ${userError.detail}`, { cause: options.cause });
    this.name = "ProviderError";
    this.userError = userError;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? null;
  }
}

export const missingKeyError = () =>
  new ProviderError({
    title: "Manca la chiave API",
    detail: "Per creare immagini serve una chiave API di OpenAI.",
    action: "Apri le Impostazioni (icona a ingranaggio), incolla la chiave e premi «Verifica».",
  });

export const networkError = (cause: unknown) =>
  new ProviderError(
    {
      title: "Rete assente",
      detail: "Non riesco a raggiungere OpenAI.",
      action: "Controlla la connessione a internet e riprova.",
    },
    { retryable: true, cause },
  );

export const timeoutError = () =>
  new ProviderError(
    {
      title: "OpenAI ci mette troppo",
      detail: "La richiesta non ha avuto risposta in tempo.",
      action: "Riprova tra qualche minuto, magari con meno varianti.",
    },
    { retryable: true },
  );

interface OpenAIErrorBody {
  error?: { message?: string; type?: string; code?: string | null; param?: string | null };
}

/** Traduce una risposta HTTP non riuscita di OpenAI. */
export function fromHttp(status: number, body: unknown, model?: string): ProviderError {
  const err = (body as OpenAIErrorBody | null)?.error ?? {};
  const message = err.message ?? "";
  const code = err.code ?? "";
  const type = err.type ?? "";
  const lower = `${message} ${code} ${type}`.toLowerCase();

  if (status === 401) {
    return new ProviderError(
      {
        title: "Chiave API non valida",
        detail: "OpenAI non riconosce la chiave salvata.",
        action: "Apri le Impostazioni e incolla una chiave valida, poi premi «Verifica».",
      },
      { status },
    );
  }

  if (code === "insufficient_quota" || lower.includes("billing") || lower.includes("quota")) {
    return new ProviderError(
      {
        title: "Credito esaurito",
        detail: "L'account OpenAI non ha più credito disponibile.",
        action: "Aggiungi credito su platform.openai.com › Billing, poi riprova.",
      },
      { status },
    );
  }

  if (status === 429) {
    return new ProviderError(
      {
        title: "Troppe richieste",
        detail: "OpenAI chiede di rallentare un momento.",
        action: "Aspetta qualche secondo e riprova.",
      },
      { status, retryable: true },
    );
  }

  if (
    code === "moderation_blocked" ||
    code === "content_policy_violation" ||
    lower.includes("safety system") ||
    lower.includes("moderation")
  ) {
    return new ProviderError(
      {
        title: "Richiesta rifiutata dai filtri",
        detail: "I filtri di sicurezza di OpenAI hanno bloccato questa richiesta.",
        action:
          "Riformula la descrizione evitando persone reali, violenza o contenuti per adulti, poi invia di nuovo.",
      },
      { status },
    );
  }

  if (status === 403 && lower.includes("verif")) {
    return new ProviderError(
      {
        title: "Organizzazione da verificare",
        detail: "OpenAI chiede di verificare l'organizzazione prima di usare i modelli di immagini.",
        action:
          "Su platform.openai.com › Settings › Organization › General completa la verifica, poi riprova.",
      },
      { status },
    );
  }

  if (
    status === 404 ||
    code === "model_not_found" ||
    (lower.includes("model") && lower.includes("not exist"))
  ) {
    return new ProviderError(
      {
        title: "Modello non disponibile",
        detail: `Il modello ${model ?? "richiesto"} non è disponibile per questa chiave.`,
        action: "Nelle Impostazioni › Avanzate premi «Verifica» e scegli un modello dall'elenco.",
      },
      { status },
    );
  }

  if (status === 403) {
    return new ProviderError(
      {
        title: "Accesso negato",
        detail: "La chiave non ha il permesso di usare questa funzione.",
        action: "Controlla i permessi della chiave su platform.openai.com › API keys.",
      },
      { status },
    );
  }

  if (status >= 500) {
    return new ProviderError(
      {
        title: "OpenAI non risponde",
        detail: "Il servizio di OpenAI ha un problema temporaneo.",
        action: "Riprova tra qualche minuto.",
      },
      { status, retryable: true },
    );
  }

  return new ProviderError(
    {
      title: "Richiesta non accettata",
      detail: message ? `OpenAI risponde: ${message}` : `OpenAI ha risposto con l'errore ${status}.`,
      action: "Prova a cambiare formato, qualità o modello dello stile e invia di nuovo.",
    },
    { status },
  );
}

export function toUserError(error: unknown): UserError {
  if (error instanceof ProviderError) return error.userError;
  return {
    title: "Qualcosa è andato storto",
    detail: error instanceof Error ? error.message : String(error),
    action: "Riprova. Se l'errore si ripete, riavvia l'app.",
  };
}

/** Errore di un'operazione dell'utente (non del fornitore), mostrato così com'è. */
export class AppError extends Error {
  override name = "AppError";
}
