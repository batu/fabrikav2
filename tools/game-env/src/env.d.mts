export interface EnvAssignment {
  readonly key: string;
  readonly value: string;
  readonly hasPurposeComment: boolean;
  readonly intentionalBlank: boolean;
}

export interface ParsedEnv {
  readonly assignments: readonly EnvAssignment[];
  readonly values: Map<string, string>;
}

export function parseEnvText(text: string, options?: { fileName?: string }): ParsedEnv;
export function readEnvFile(filePath: string): ParsedEnv;
export function loadGameEnv(options: {
  gameRoot: string;
  environment?: Record<string, string | undefined>;
}): Record<string, string | undefined>;
