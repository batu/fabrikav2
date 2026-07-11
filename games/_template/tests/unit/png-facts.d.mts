import type { Buffer } from "node:buffer";

export interface PngFacts {
  readonly width: number;
  readonly height: number;
  readonly hasAlpha: boolean;
}

export function pngFacts(bytes: Buffer): PngFacts;
