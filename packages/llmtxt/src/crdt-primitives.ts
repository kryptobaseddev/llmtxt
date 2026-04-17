/**
 * CRDT low-level primitives — T391 / Loro migration / SSoT.
 *
 * These six functions implement the core Loro sync protocol at the binary
 * level. They are the single source of truth for CRDT operations in the
 * backend. All callers (apps/backend) MUST import from this module via the
 * `llmtxt/crdt-primitives` subpath rather than importing `yjs` or `loro-crdt`
 * directly.
 *
 * Every section is modelled as a single Loro Doc with a root LoroText named
 * "content". State is stored as Loro binary snapshot bytes (Buffer), exactly
 * matching the `crdt_state` column in section_crdt_states.
 *
 * Binary format: Loro binary (magic header 0x6c 0x6f 0x72 0x6f "loro" + 4-byte
 * version + 16-byte checksum + payload). This format is bitwise INCOMPATIBLE
 * with the previous Yrs lib0 v1 format.
 *
 * All six core functions delegate to the Rust/WASM implementation in
 * crates/llmtxt-core (built with --features crdt). The crdt_get_text helper
 * and test-construction helpers use the loro-crdt npm package for client-side
 * LoroText extraction (crdt_get_text is not exported from WASM).
 *
 * All six functions are synchronous and pure (no side effects).
 */

import { Loro } from "loro-crdt";
import * as wasmModule from "../wasm/llmtxt_core.js";

// ── Internal helper ────────────────────────────────────────────────────────────

/**
 * Pack an array of update Buffers into the flat packed format expected by
 * crdt_merge_updates_wasm: `[len1:u32le][bytes1][len2:u32le][bytes2]...`
 */
function packUpdates(updates: Buffer[]): Uint8Array {
	let totalLen = 0;
	for (const u of updates) {
		totalLen += 4 + u.length;
	}
	const packed = new Uint8Array(totalLen);
	let offset = 0;
	for (const u of updates) {
		const view = new DataView(packed.buffer, offset, 4);
		view.setUint32(0, u.length, true /* little-endian */);
		offset += 4;
		packed.set(u, offset);
		offset += u.length;
	}
	return packed;
}

// ── 1. crdt_new_doc ──────────────────────────────────────────────────────────

/**
 * Create an empty Loro Doc and return its initial snapshot bytes.
 *
 * NOTE: Unlike the previous Yrs implementation, this returns a full Loro
 * snapshot blob — NOT a Y.js state vector. The returned bytes are an opaque
 * Loro state blob. Callers MUST treat the return value as a state blob and
 * pass it to crdt_state_vector() to get the VersionVector bytes for SyncStep1.
 *
 * The magic header bytes are 0x6c 0x6f 0x72 0x6f ("loro").
 */
export function crdt_new_doc(): Buffer {
	return Buffer.from(wasmModule.crdt_new_doc());
}

// ── 2. crdt_encode_state_as_update ──────────────────────────────────────────

/**
 * Encode the full doc state as a Loro snapshot blob.
 *
 * Used to bootstrap a new client: send them the full state so they can import
 * it locally and arrive at the current document content.
 *
 * In Loro, a snapshot serves as the bootstrap update — there is no separate
 * "state-as-update" format; snapshot == full state transfer.
 *
 * @param state - bytes from section_crdt_states.crdt_state (Loro snapshot).
 *   May be empty for a new section; returns the canonical empty-doc snapshot.
 */
export function crdt_encode_state_as_update(state: Buffer): Buffer {
	return Buffer.from(
		wasmModule.crdt_encode_state_as_update(new Uint8Array(state)),
	);
}

// ── 3. crdt_apply_update ────────────────────────────────────────────────────

/**
 * Apply a Loro update or snapshot to a state snapshot, returning the new state.
 *
 * Core persistence operation: called before writing to section_crdt_states.
 * Loro import is idempotent — applying the same update twice yields the same
 * result (CRDT property).
 *
 * @param state  - current state bytes (may be empty for a new section).
 *   Empty state is treated as an empty Loro Doc.
 * @param update - incoming Loro update or snapshot bytes from a client.
 * @returns New Loro snapshot bytes ready for section_crdt_states.crdt_state.
 */
export function crdt_apply_update(state: Buffer, update: Buffer): Buffer {
	return Buffer.from(
		wasmModule.crdt_apply_update(new Uint8Array(state), new Uint8Array(update)),
	);
}

// ── 4. crdt_merge_updates ───────────────────────────────────────────────────

/**
 * Merge multiple Loro update blobs into a single consolidated snapshot.
 *
 * Used by the compaction job to fold section_crdt_updates into
 * section_crdt_states. Convergence is guaranteed by CRDT invariants.
 *
 * The WASM function expects a packed buffer: `[len1:u32le][bytes1][len2:u32le]...`
 *
 * @param updates - array of Loro update Buffers from section_crdt_updates.
 * @returns Single Loro snapshot encoding the merged state.
 */
export function crdt_merge_updates(updates: Buffer[]): Buffer {
	if (updates.length === 0) {
		return crdt_new_doc();
	}
	const packed = packUpdates(updates);
	return Buffer.from(wasmModule.crdt_merge_updates_wasm(packed));
}

// ── 5. crdt_state_vector ────────────────────────────────────────────────────

/**
 * Extract the Loro VersionVector from a state snapshot.
 *
 * Sent as SyncStep1 (0x01 prefix) so the remote can compute the diff update.
 *
 * IMPORTANT: The returned bytes are Loro VersionVector bytes encoded via
 * VersionVector::encode() — they are NOT Y.js state vector bytes and are
 * bitwise INCOMPATIBLE with lib0 v1 state vector encoding. Remote peers MUST
 * call VersionVector::decode() (or the equivalent) on received SyncStep1
 * payloads — they MUST NOT pass these bytes to any Yrs / lib0 decoder.
 *
 * @param state - bytes from section_crdt_states.crdt_state (may be empty).
 *   Empty state gives the VersionVector of an empty Loro Doc.
 */
export function crdt_state_vector(state: Buffer): Buffer {
	return Buffer.from(wasmModule.crdt_state_vector(new Uint8Array(state)));
}

// ── 6. crdt_diff_update ─────────────────────────────────────────────────────

/**
 * Compute the diff update between server state and a remote Loro VersionVector.
 *
 * SyncStep2: returns only the Loro operations the remote is missing.
 *
 * @param state    - server state bytes from section_crdt_states.crdt_state.
 * @param remoteSv - the client's Loro VersionVector bytes (from crdt_state_vector).
 *   Empty remoteSv means "give me everything" (full snapshot).
 *
 * NOTE: `remoteSv` MUST be Loro VersionVector bytes (from crdt_state_vector or
 * sent via SyncStep1 0x01 framing). Do NOT pass Y.js state vector bytes here.
 */
export function crdt_diff_update(state: Buffer, remoteSv: Buffer): Buffer {
	return Buffer.from(
		wasmModule.crdt_diff_update(
			new Uint8Array(state),
			new Uint8Array(remoteSv),
		),
	);
}

// ── 7. crdt_get_text ────────────────────────────────────────────────────────

/**
 * Extract the plain text string from a Loro state snapshot.
 *
 * Used by HTTP fallback endpoints and tests. Delegates to the loro-crdt npm
 * package (crdt_get_text is not available in the WASM build — it is marked
 * #[cfg(not(target_arch = "wasm32"))] in Rust).
 *
 * @param state - Loro snapshot bytes from section_crdt_states.crdt_state (may be empty).
 * @returns Plain text string from the "content" LoroText root.
 */
export function crdt_get_text(state: Buffer): string {
	if (state.length === 0) {
		return "";
	}
	const doc = new Loro();
	doc.import(new Uint8Array(state));
	return doc.getText("content").toString();
}

// ── Helpers re-exported for test construction ────────────────────────────────

/**
 * Create a new Loro Doc, insert `content` into the "content" LoroText root,
 * and return its full state as a Loro snapshot Buffer.
 *
 * This helper exists so that test files can construct seed states without
 * importing `loro-crdt` directly.
 */
export function crdt_make_state(content: string): Buffer {
	const doc = new Loro();
	const text = doc.getText("content");
	text.insert(0, content);
	doc.commit();
	const snap = doc.export({ mode: "snapshot" });
	return Buffer.from(snap);
}

/**
 * Append `content` to an existing Loro Doc represented as a state Buffer,
 * then return an incremental update Buffer (the delta only, not a full state).
 *
 * Useful in tests to generate realistic incremental updates.
 *
 * @param state   - current Loro snapshot bytes.
 * @param content - string to append.
 * @returns       - incremental Loro update bytes (NOT full snapshot).
 */
export function crdt_make_incremental_update(
	state: Buffer,
	content: string,
): Buffer {
	const doc = new Loro();
	if (state.length > 0) {
		doc.import(new Uint8Array(state));
	}
	// Capture current version before change
	const prevVersion = doc.version();
	const text = doc.getText("content");
	const currentLen = text.length;
	text.insert(currentLen, content);
	doc.commit();
	// Export only the new operations since prevVersion
	const update = doc.export({ mode: "update", from: prevVersion });
	return Buffer.from(update);
}

/**
 * Apply a Loro update directly to a local Loro Doc and return the resulting
 * full state. Used by tests that need to simulate a client-side doc receiving
 * a server diff.
 *
 * @param docState - current full Loro snapshot bytes of the local doc.
 * @param update   - incoming Loro update bytes.
 * @returns        - new full Loro snapshot bytes after applying the update.
 */
export function crdt_apply_to_local_doc(
	docState: Buffer,
	update: Buffer,
): Buffer {
	return crdt_apply_update(docState, update);
}
