/**
 * Composizione del prompt: è il punto tecnico centrale della coerenza.
 * Ordine fisso: ruolo delle immagini, descrizione dello stile, contesto del
 * thread, richiesta dell'utente così come l'ha scritta, vincoli.
 * La cronologia della chat non entra mai.
 */
import {
  DESCRIPTION_FIELDS,
  FORMAT_LABEL,
  type Format,
  type StyleDescription,
  type StyleKind,
} from "../shared/types";

export interface PromptStyle {
  brief: string;
  description: StyleDescription | null;
  kind: StyleKind;
}

export interface PromptInput {
  mode: "generate" | "edit";
  style: PromptStyle | null;
  /** Numero di immagini di riferimento dello stile inviate con la richiesta. */
  refCount: number;
  contextNotes: string;
  userText: string;
  format: Format;
  textLanguage: string;
  transparent: boolean;
}

export function renderDescription(style: PromptStyle): string {
  if (!style.description) return style.brief.trim();
  const lines = DESCRIPTION_FIELDS.filter(
    ({ key }) => key !== "impaginazione" || style.kind === "infografica",
  )
    .map(({ key, label }) => [label, style.description?.[key]?.trim()] as const)
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => `- ${label}: ${value}`);
  return lines.join("\n");
}

function imageRoles(mode: PromptInput["mode"], refCount: number): string | null {
  if (mode === "edit") {
    const refs =
      refCount === 0
        ? ""
        : refCount === 1
          ? " L'immagine 2 è solo un riferimento di stile: copia tecnica, palette, tratto e composizione, non soggetti né testi."
          : ` Le immagini 2-${refCount + 1} sono solo riferimenti di stile: copia tecnica, palette, tratto e composizione, non soggetti né testi.`;
    return `L'immagine 1 è l'immagine da modificare.${refs} Cambia solo ciò che chiede la richiesta e lascia invariato tutto il resto.`;
  }
  if (refCount === 0) return null;
  const range =
    refCount === 1 ? "L'immagine 1 è solo un riferimento" : `Le immagini 1-${refCount} sono solo riferimenti`;
  return `${range} di stile. Copia tecnica, palette, tratto e composizione. Non copiare soggetti né testi.`;
}

export function composePrompt(input: PromptInput): string {
  const sections: string[] = [];
  const roles = imageRoles(input.mode, input.refCount);
  if (roles) sections.push(roles);

  if (input.style) {
    const description = renderDescription(input.style);
    if (description) sections.push(`STILE:\n${description}`);
    if (input.style.kind === "infografica") {
      sections.push(
        "TIPO: infografica. Testi nitidi e leggibili, gerarchia chiara dei titoli, icone coerenti, dati ordinati in una griglia.",
      );
    }
  }

  const notes = input.contextNotes.trim();
  if (notes) sections.push(`CONTESTO DEL PROGETTO:\n${notes}`);

  sections.push(`${input.mode === "edit" ? "MODIFICA RICHIESTA" : "RICHIESTA"}:\n${input.userText.trim()}`);

  const constraints = [
    `- Formato: ${FORMAT_LABEL[input.format].toLowerCase()}.`,
    `- Eventuali testi nell'immagine in ${input.textLanguage}, scritti correttamente.`,
  ];
  if (input.transparent) constraints.push("- Sfondo trasparente, soggetto isolato.");
  sections.push(`VINCOLI:\n${constraints.join("\n")}`);

  return sections.join("\n\n");
}

/** Prompt delle prove per creare uno stile da una descrizione. */
export function trialPrompt(
  brief: string,
  kind: StyleKind,
  contextNotes: string,
  textLanguage: string,
): string {
  const subject =
    kind === "infografica"
      ? "un'infografica di esempio con titolo, tre blocchi di testo brevi, icone e un piccolo grafico a barre"
      : contextNotes.trim()
        ? `una scena semplice e rappresentativa di questo progetto: ${contextNotes.trim()}`
        : "una casa in collina con un albero, un sentiero e qualche nuvola";
  return [
    "Immagine di prova per definire uno stile visivo che verrà riusato per molte immagini diverse.",
    `STILE:\n${brief.trim()}`,
    `SOGGETTO:\n${subject}.`,
    `VINCOLI:\n- Lo stile deve essere netto e riconoscibile.\n- Eventuali testi in ${textLanguage}.`,
  ].join("\n\n");
}
