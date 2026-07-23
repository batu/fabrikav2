import type { ConfigResponse, HiddennessLevel } from '../types';

export const HIDDENNESS_PROMPTS = {
  easy: [
    'Hidden-object difficulty: EASY.',
    'The animal should be naturally integrated into the background but still readable at phone size.',
    'Keep a clear silhouette, visible face/body cues, and moderate contrast from nearby objects.',
    'Preserve the original background exactly; only add the animal inside the target area.',
    'Do not repaint, replace, redesign, or add new scenery, props, plants, rocks, shadows, paths, water, or texture around the animal.',
  ].join(' '),
  hard: [
    'Hidden-object difficulty: HARD.',
    'The animal should be a genuinely hidden-object target, not a clearly staged character.',
    'Make it slightly smaller than easy mode, low contrast, and strongly camouflaged with the local moss, rocks, leaves, water reflections, wood, or path colors.',
    'Use only already-existing foreground shapes, plants, rocks, bridge posts, vines, flowers, or shadows for camouflage; do not create new cover or repaint the background.',
    'Partially tuck it visually into the existing local scene while leaving at least one readable clue.',
    'Prefer side, back, peeking, crouched, or nestled poses over front-facing mascot poses.',
    'Do not place the animal fully exposed on top of a clear rock or open path unless it is disguised by matching color and partial cover.',
    'Keep it fair: never fully occlude it, never make it microscopic, and leave one readable clue such as an ear, muzzle, tail, paw, or small face detail for careful players.',
    'Preserve the original background exactly; only add the animal inside the target area.',
    'Do not repaint, replace, redesign, or add new scenery, props, plants, rocks, shadows, paths, water, or texture around the animal.',
  ].join(' '),
} as const;

interface StylePromptState {
  config: ConfigResponse | null;
  style: string | null;
}

interface SettingPromptState {
  config: ConfigResponse | null;
  setting: string | null;
  scene: string | null;
}

interface InpaintPromptState extends StylePromptState, SettingPromptState {
  dogPrompt: string;
  includeStyleInInpaintPrompt: boolean;
  hiddennessLevel: HiddennessLevel;
}

export function backgroundStylePrompt(state: StylePromptState): string {
  if (!state.config || !state.style) return '';
  return state.config.styles[state.style] ?? '';
}

function summarizeLevelDescription(text: string, maxLength: number = 280): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  const sentenceEnd = normalized.search(/[.!?](?:\s|$)/);
  const firstSentence = sentenceEnd >= 0 ? normalized.slice(0, sentenceEnd + 1) : normalized;
  if (firstSentence.length <= maxLength) return firstSentence;
  return `${firstSentence.slice(0, maxLength - 3).trimEnd()}...`;
}

export function levelDescriptionPrompt(state: SettingPromptState): string {
  if (!state.config || !state.setting || !state.scene) return '';
  const description = state.config.settings[state.setting]?.scenes[state.scene];
  const summary = summarizeLevelDescription(description ?? '');
  return summary ? `Level description to respect: ${summary}` : '';
}

export function settingContextPrompt(state: SettingPromptState): string {
  if (!state.config || !state.setting) return '';
  const settingLabel = state.config.settings[state.setting]?.label ?? state.setting.replace(/_/g, ' ');
  const sceneLabel = state.scene
    ? state.scene.replace(`${state.setting}_`, '').replace(/_/g, ' ')
    : '';
  const settingText = sceneLabel ? `${settingLabel} / ${sceneLabel}` : settingLabel;
  const sceneDescription = state.scene
    ? state.config.settings[state.setting]?.shortDescriptions?.[state.scene]
    : '';
  const parts = [
    `Scene setting to respect: ${settingText}.`,
  ];
  if (sceneDescription) {
    parts.push(`Short level description: ${sceneDescription}`);
  }
  parts.push(
    'Choose details, accessories, body language, and local interaction that feel native to this place.',
    'Do not add new landmarks, signage, scenery, or props outside the animal itself.',
  );
  return parts.join(' ');
}

export function effectiveInpaintPrompt(
  state: InpaintPromptState,
  hiddennessLevel: HiddennessLevel = state.hiddennessLevel,
): string {
  const parts = [state.dogPrompt.trim()];

  const settingPrompt = settingContextPrompt(state).trim();
  if (settingPrompt) {
    parts.push(settingPrompt);
  }

  if (state.includeStyleInInpaintPrompt) {
    const stylePrompt = backgroundStylePrompt(state).trim();
    if (stylePrompt) {
      parts.push('Background style to match exactly:', stylePrompt);
    }
  }

  parts.push(HIDDENNESS_PROMPTS[hiddennessLevel]);
  return parts.join('\n\n');
}
