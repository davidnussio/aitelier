import { describe, expect, test } from "bun:test";
import { composePrompt, renderDescription, trialPrompt } from "./prompt";
import type { StyleDescription } from "../shared/types";

const description: StyleDescription = {
  tecnica: "Acquerello su carta ruvida",
  palette: "#2F6DB5 blu, #F4EBDD carta",
  tratto: "Contorni morbidi",
  luce: "Diffusa",
  composizione: "Soggetto centrale",
  tipografia: "Sans-serif arrotondato",
  impaginazione: "Griglia a 3 colonne",
  daEvitare: "Fotorealismo",
};

describe("composePrompt", () => {
  test("segue l'ordine fisso: ruolo, stile, contesto, richiesta, vincoli", () => {
    const prompt = composePrompt({
      mode: "generate",
      style: { brief: "acquerello", description, kind: "illustrazione" },
      refCount: 2,
      contextNotes: "Ricerca di terza media sui vulcani",
      userText: "Il cratere dell'Etna al tramonto",
      format: "landscape",
      textLanguage: "italiano",
      transparent: false,
    });
    const order = [
      "Le immagini 1-2 sono solo riferimenti di stile",
      "STILE:",
      "CONTESTO DEL PROGETTO:",
      "RICHIESTA:",
      "VINCOLI:",
    ];
    const positions = order.map((s) => prompt.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions.toSorted((a, b) => a - b)).toEqual(positions);
    expect(prompt).toContain("Non copiare soggetti né testi");
    expect(prompt).toContain("Il cratere dell'Etna al tramonto");
    expect(prompt).toContain("in italiano");
    // L'impaginazione entra solo per le infografiche.
    expect(prompt).not.toContain("Griglia a 3 colonne");
  });

  test("senza riferimenti non parla di immagini di input", () => {
    const prompt = composePrompt({
      mode: "generate",
      style: null,
      refCount: 0,
      contextNotes: "",
      userText: "Un gatto",
      format: "square",
      textLanguage: "italiano",
      transparent: true,
    });
    expect(prompt).not.toContain("immagini");
    expect(prompt).not.toContain("STILE");
    expect(prompt).toContain("Sfondo trasparente");
  });

  test("in modifica l'immagine 1 è quella da modificare, le altre sono àncore", () => {
    const prompt = composePrompt({
      mode: "edit",
      style: { brief: "", description, kind: "infografica" },
      refCount: 2,
      contextNotes: "",
      userText: "Cambia il titolo",
      format: "portrait",
      textLanguage: "italiano",
      transparent: false,
    });
    expect(prompt).toContain("L'immagine 1 è l'immagine da modificare");
    expect(prompt).toContain("Le immagini 2-3 sono solo riferimenti di stile");
    expect(prompt).toContain("MODIFICA RICHIESTA:\nCambia il titolo");
    expect(prompt).toContain("Griglia a 3 colonne");
    expect(prompt).toContain("TIPO: infografica");
  });

  test("senza descrizione usa la richiesta originale dello stile", () => {
    expect(
      renderDescription({ brief: " acquerello morbido ", description: null, kind: "illustrazione" }),
    ).toBe("acquerello morbido");
  });

  test("le prove usano il contesto del thread come soggetto", () => {
    expect(trialPrompt("pastello", "illustrazione", "vulcani", "italiano")).toContain("progetto: vulcani");
    expect(trialPrompt("pastello", "infografica", "", "italiano")).toContain("infografica di esempio");
  });
});
