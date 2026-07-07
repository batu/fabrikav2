/**
 * `@fabrikav2/testkit/harness` — the in-game harness contract + witnesses.
 *
 * Playwright-free by construction (games import this without pulling
 * `@playwright/test`). The runner-side helpers (SharedShellDriver, collectRun)
 * live in `@fabrikav2/testkit/playwright` and import FROM here.
 */
export type {
  AnalyticsEventLike,
  CaptureResult,
  ClientPoint,
  GameHarness,
  GameVerbHandler,
  HarnessSaveProfile,
  PerfBucket,
  PerfSample,
  SnapshotEnvelope,
  VerbNamesOf,
} from './contract.ts';

export { monotonicNow, wrapSnapshot, type WrapSnapshotOptions } from './envelope.ts';
export {
  seedStatesFromConfig,
  type ScreensConfigLike,
  type ScreensOf,
} from './seedFromConfig.ts';
export { driveInputAt, type DriveInputResult } from './inputDriver.ts';
export {
  captureCanvasPng,
  captureToDeviceDocuments,
  type DeviceCaptureRequest,
} from './capture.ts';
export { createPerfRecorder, type PerfRecorder } from './perf.ts';
export {
  buildRunLayout,
  type BuildRunLayoutOptions,
  type RunArtifacts,
  type RunFile,
  type RunLayout,
} from './runLayout.ts';
export {
  buildFidelityGrid,
  type FidelityPair,
  type FidelityGridOptions,
} from './fidelityGrid.ts';
