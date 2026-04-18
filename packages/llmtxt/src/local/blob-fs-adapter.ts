/**
 * LocalBackend blob adapter — re-export bridge.
 *
 * All blob implementation now lives in packages/llmtxt/src/blob/.
 * This file re-exports from there to preserve backward-compat imports
 * within the local/ subpath (e.g. from blob-changeset.ts and local-backend.ts).
 *
 * Consumers outside this package SHOULD import from 'llmtxt/blob' directly.
 *
 * @module
 */

export {
	BlobAccessDeniedError,
	BlobCorruptError,
	BlobFsAdapter,
	BlobNameInvalidError,
	BlobNotFoundError,
	BlobTooLargeError,
} from "../blob/fs-adapter.js";
