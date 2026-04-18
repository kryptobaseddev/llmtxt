/**
 * Blob changeset integration — re-export bridge.
 *
 * All blob changeset implementation now lives in packages/llmtxt/src/blob/changeset.ts.
 * This file re-exports from there to preserve backward-compat imports within
 * the local/ subpath.
 *
 * Consumers outside this package SHOULD import from 'llmtxt/blob' directly.
 *
 * @module
 */

export type {
	ApplyBlobChangesetResult,
	BlobChangeset,
	BlobRefWithDocSlug,
} from "../blob/changeset.js";
export {
	applyBlobChangeset,
	buildBlobChangeset,
	incomingWinsLWW,
} from "../blob/changeset.js";
