// Structured server-owned prompt intents (U7). The UI never composes prompt
// text: it names frozen catalog entries and the backend resolves them through
// its single composition authority. Sending free text ('prompt', 'dogPrompt',
// 'magentaPromptOverride') is rejected server-side.

export interface FtdSceneIntent {
  scene: string;
  view?: string;
  style?: string;
}

export interface FtdDogIntent {
  style: string;
  entity?: string;
}
