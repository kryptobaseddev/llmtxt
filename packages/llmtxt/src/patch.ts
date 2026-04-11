/**
 * Patch creation and application.
 *
 * These primitives let clients produce transport-safe unified diffs and
 * apply them deterministically using the same Rust core as native consumers.
 */
export { createPatch, applyPatch, reconstructVersion, squashPatchesWasm } from './wasm.js';
export { multiWayDiff, cherryPickMerge } from './wasm.js';
export type {
  MultiDiffVariant,
  MultiDiffLine,
  MultiDiffStats,
  MultiDiffResult,
  CherryPickProvenance,
  CherryPickStats,
  CherryPickResult,
} from './wasm.js';
