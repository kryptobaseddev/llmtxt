/**
 * Blob primitives — thin TypeScript wrappers around the Rust WASM core.
 *
 * All cryptographic and validation logic delegates to crates/llmtxt-core to
 * enforce the SSoT rule (docs/SSOT.md). No blob validation or hashing logic
 * is implemented here directly.
 *
 * @module
 */

import * as wasmModule from "../../wasm/llmtxt_core.js";
import { BlobNameInvalidError } from "../core/errors.js";

/**
 * Validate a blob attachment name using the Rust WASM primitive.
 *
 * Throws {@link BlobNameInvalidError} when any of the following are true:
 *   - name is empty or exceeds 255 bytes (UTF-8)
 *   - name contains path traversal sequences (`..`)
 *   - name contains path separators (`/` or `\`)
 *   - name contains null bytes (`\0`)
 *   - name has leading or trailing whitespace
 *
 * Delegates to crates/llmtxt-core::blob_name_validate via WASM.
 *
 * @param name - The attachment name to validate (e.g. "diagram.png")
 * @throws {@link BlobNameInvalidError} on violation
 */
export function validateBlobName(name: string): void {
	try {
		wasmModule.blobNameValidate(name);
	} catch (err: unknown) {
		const reason = err instanceof Error ? err.message : String(err);
		throw new BlobNameInvalidError(name, reason);
	}
}
