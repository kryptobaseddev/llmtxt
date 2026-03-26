/**
 * Patch creation and application.
 *
 * These primitives let clients produce transport-safe unified diffs and
 * apply them deterministically using the same Rust core as native consumers.
 */
export { createPatch, applyPatch } from './wasm.js';
