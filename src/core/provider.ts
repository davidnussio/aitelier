/**
 * Interfaccia verso il fornitore di immagini. Oggi c'è solo OpenAI (più il
 * fornitore dimostrativo); un altro fornitore implementa la stessa interfaccia.
 */
import type { Quality, StyleDescription, StyleKind } from "../shared/types";

export interface InputImage {
  bytes: Uint8Array;
  name: string;
  mime: string;
}

export interface GenerateRequest {
  model: string;
  prompt: string;
  size: string;
  quality: Quality;
  background: "auto" | "transparent";
  n: number;
}

export interface EditRequest extends GenerateRequest {
  images: InputImage[];
}

export interface Usage {
  inputTextTokens: number;
  inputImageTokens: number;
  outputTokens: number;
}

export interface ProviderResult {
  images: Uint8Array[];
  usage: Usage;
}

export interface DescribeRequest {
  model: string;
  images: InputImage[];
  brief: string;
  kind: StyleKind;
}

export interface ModelList {
  imageModels: string[];
  textModels: string[];
}

export interface ImageProvider {
  generate(req: GenerateRequest, signal?: AbortSignal): Promise<ProviderResult>;
  editWithReferences(req: EditRequest, signal?: AbortSignal): Promise<ProviderResult>;
  describeStyle(req: DescribeRequest, signal?: AbortSignal): Promise<StyleDescription>;
  /** Verifica una chiave (quella passata, o quella salvata) ed elenca i modelli. */
  verify(apiKey?: string): Promise<ModelList>;
}
