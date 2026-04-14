/**
 * 3-way merge primitives for conflict-aware document collaboration.
 *
 * Re-exports the WASM-backed three-way merge function and its associated
 * types from the wasm bridge module.
 */
export { threeWayMerge } from './wasm.js';
export type { Conflict, MergeStats, ThreeWayMergeResult } from './wasm.js';
