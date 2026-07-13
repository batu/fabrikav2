// Public surface of the reusable real-Editor provenance/session seam (P6 §6).
// `captureProvenance` runs the full protocol; the sub-modules are exported so the
// deterministic, GUI-free parts (path guards, graph declaration/hashing, evidence
// scrubbing) can be unit-tested without an editor.
export { captureProvenance, type CaptureOptions, type CaptureResult } from './provenance.ts';
export {
  SCENE_ORDER,
  SCENE_FILES,
  GENERATED_GRAPH,
  SCENE_AUTHORITY,
  hashGraph,
  allExist,
  deleteGraph,
  type GraphHash,
} from './graph.ts';
export { resolveScratch, resolveOutput, isInside, REPO_ROOT, PathBlocked, type ScratchLayout } from './paths.ts';
export {
  scrubText,
  assertNoLeaks,
  writeEvidence,
  type ProvenanceEvidence,
  type ServerMode,
} from './evidence.ts';
export { getServerMode, resolveServerBin, DEFAULT_SERVER_BIN } from './editorServer.ts';
