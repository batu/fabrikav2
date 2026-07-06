/**
 * Marble Run board engine: headless tap-to-sort marble puzzle
 * (EventEngine-discipline change descriptors), exact greedy-peel
 * solver, and a seeded constructive level generator. Extracted from
 * the five marble_run variants after they shipped byte-identical
 * copies (PR #295); consumed via re-export shims in each variant.
 */
export * from './types';
export { BoardEngine } from './board';
export { analyzeDifficulty, solveLevel } from './solver';
export { generateLevel } from './generate';
export type { DifficultyReport, SolveResult } from './solver';
export type { GenerateParams } from './generate';
