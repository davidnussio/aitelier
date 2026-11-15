/**
 * Stima del costo a partire dai token restituiti da OpenAI (`usage`).
 * Tariffe GPT Image 2.5 riportate dalle fonti a novembre 2026, in USD per
 * milione di token: da riverificare sulla pagina prezzi di OpenAI.
 */
import type { Usage } from "./provider";

export const PRICE_PER_MILLION = {
  inputText: 5,
  inputImage: 8,
  output: 30,
};

export function estimateCostUsd(usage: Usage): number {
  const cost =
    (usage.inputTextTokens * PRICE_PER_MILLION.inputText +
      usage.inputImageTokens * PRICE_PER_MILLION.inputImage +
      usage.outputTokens * PRICE_PER_MILLION.output) /
    1_000_000;
  return Math.round(cost * 10_000) / 10_000;
}
