export interface PerfSample {
  level: number;
  frames: number;
  p50Ms: number;
  p95Ms: number;
  worstMs: number;
  renders: number;
  drawCalls: number;
  triangles: number;
}

export interface TapProbeEntry {
  level: number;
  started: boolean;
  marbles: number;
  offTarget: number;
  offTargetRows: number[];
  topRowY: number | null;
  /** Usable tap span above/below each top-row marble's rendered centre, px. */
  topRowSpans: { up: number; down: number }[];
  bottomRowSpans: { up: number; down: number }[];
}
