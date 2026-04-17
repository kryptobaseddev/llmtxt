/**
 * CRDT collaborative editing SDK — T397 (Loro migration).
 *
 * Provides:
 *  - `subscribeSection(slug, sectionId, callback)` — WebSocket-backed
 *    subscription that emits SectionDelta events as other agents push updates.
 *  - `getSectionText(slug, sectionId)` — HTTP fallback that returns the plain
 *    text content of a section without establishing a WS connection.
 *
 * Architecture:
 *  - WebSocket connection uses the loro-sync-v1 subprotocol.
 *  - Message framing: 1-byte type prefix + Loro binary payload.
 *    Byte values are intentionally shifted from the legacy Yrs/y-sync protocol
 *    to prevent accidental cross-protocol acceptance by stray legacy clients:
 *
 *      0x01 = SyncStep1     (client → server: Loro VersionVector bytes)
 *      0x02 = SyncStep2     (server → client: Loro ExportMode::Updates blob)
 *      0x03 = Update        (client → server: incremental Loro update blob)
 *      0x04 = AwarenessRelay (raw relay, same payload shape as before)
 *
 *    Any stray 0x00 frame (legacy Yjs SyncStep1) MUST be rejected. The server
 *    drops it silently; this client never sends it.
 *
 * Wire-format incompatibility note (migration from Yrs):
 *  - This SDK uses Loro binary format. All previous Yrs/lib0 v1 bytes are
 *    bitwise incompatible and MUST NOT be mixed. If you have clients still
 *    sending the old y-sync protocol (0x00/0x01/0x02 framing with Y.js state
 *    vectors), they will be rejected by the server with a 4400 close code.
 *    Update all clients to use this SDK version.
 *
 * Client maintains a local Loro Doc to apply inbound updates and extract text.
 * On WS open: encode local VersionVector → send as SyncStep1 (0x01).
 * On receive SyncStep2 (0x02): import Loro update blob into local doc.
 * On receive Update (0x03): import Loro incremental update into local doc.
 * On receive AwarenessRelay (0x04): pass payload to awareness callback.
 *
 * Browser + Node.js compatible:
 *  - Uses the native WebSocket global (available in Node.js >= 22 and all
 *    modern browsers). Older Node.js versions must polyfill `WebSocket`.
 *
 * Usage:
 * ```ts
 * import { subscribeSection, getSectionText } from 'llmtxt/crdt';
 *
 * const unsub = subscribeSection('my-doc', 'intro', (delta) => {
 *   console.log('Section updated:', delta.text, 'at seq', delta.seq);
 * });
 *
 * // Later:
 * unsub();
 * ```
 */

import { Loro } from "loro-crdt";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A delta event emitted when the CRDT state for a section changes.
 */
export interface SectionDelta {
	/** Document slug. */
	slug: string;
	/** Section identifier. */
	sectionId: string;
	/** Current plain-text content of the section after applying the delta. */
	text: string;
	/**
	 * Raw Loro update bytes that caused this delta (Uint8Array).
	 * These are Loro binary format bytes — bitwise incompatible with
	 * the previous Yrs lib0 v1 format.
	 */
	updateBytes: Uint8Array;
	/** Wall clock timestamp (ms since epoch) when the update was received. */
	receivedAt: number;
}

/**
 * Function to call to unsubscribe and close the WebSocket connection.
 */
export type Unsubscribe = () => void;

/**
 * Options for `subscribeSection`.
 */
export interface SubscribeSectionOptions {
	/**
	 * Base URL of the llmtxt API.
	 * Defaults to `https://api.llmtxt.my`.
	 */
	baseUrl?: string;
	/**
	 * Bearer token for authentication.
	 * Pass your API key here (llmtxt_... format).
	 */
	token?: string;
	/**
	 * Called when the WebSocket encounters an error.
	 */
	onError?: (err: Event) => void;
	/**
	 * Called when an AwarenessRelay (0x04) message is received.
	 * The payload is the raw awareness bytes relayed from a peer.
	 */
	onAwareness?: (payload: Uint8Array) => void;
}

// ── Message type constants (Loro framing, spec P1 §3.2) ─────────────────────

/** SyncStep1: client → server. Payload: Loro VersionVector bytes. */
const MSG_SYNC_STEP_1 = 0x01;
/** SyncStep2: server → client. Payload: Loro ExportMode::Updates blob. */
const MSG_SYNC_STEP_2 = 0x02;
/** Update: bidirectional incremental Loro update blob. */
const MSG_UPDATE = 0x03;
/** AwarenessRelay: raw relay, same payload shape as before; byte value updated. */
const MSG_AWARENESS_RELAY = 0x04;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Prepend a 1-byte type prefix to a payload. */
function framed(msgType: number, payload: Uint8Array): Uint8Array {
	const out = new Uint8Array(1 + payload.length);
	out[0] = msgType;
	out.set(payload, 1);
	return out;
}

/** Strip the 1-byte prefix from a received frame. */
function unframe(data: Uint8Array): { msgType: number; payload: Uint8Array } {
	return { msgType: data[0], payload: data.subarray(1) };
}

// ── CrdtSection (internal) ───────────────────────────────────────────────────

/**
 * Internal state container for an active CRDT section subscription.
 * Wraps a local Loro Doc and the WebSocket connection.
 */
interface CrdtSection {
	/** Local Loro Doc — receives imported updates and drives text reads. */
	doc: Loro;
	/** Active WebSocket (null before connect completes). */
	ws: WebSocket | null;
	/** Whether unsubscribe() has been called. */
	closed: boolean;
}

// ── subscribeSection ─────────────────────────────────────────────────────────

/**
 * Subscribe to real-time CRDT delta events for a single section.
 *
 * Opens a WebSocket connection using the `loro-sync-v1` subprotocol and
 * performs the Loro sync protocol (SyncStep1 → SyncStep2 exchange).
 * Subsequent updates from other agents are imported into the local Loro Doc
 * and emitted as `SectionDelta` events to `callback`.
 *
 * Wire protocol (spec P1 §3.2):
 *  1. On open: encode local VersionVector → send as 0x01 SyncStep1.
 *  2. On receive 0x02 (SyncStep2): import Loro update blob (full diff from server).
 *  3. On receive 0x03 (Update): import incremental Loro update blob from peer.
 *  4. On receive 0x04 (AwarenessRelay): pass to options.onAwareness if set.
 *  5. Stray 0x00 frames (legacy Yjs SyncStep1) are dropped and never sent.
 *
 * @param slug       - Document slug
 * @param sectionId  - Section identifier
 * @param callback   - Called each time the section changes
 * @param options    - Auth and endpoint configuration
 * @returns          - `Unsubscribe` function; call it to close the WS
 */
export function subscribeSection(
	slug: string,
	sectionId: string,
	callback: (delta: SectionDelta) => void,
	options: SubscribeSectionOptions = {},
): Unsubscribe {
	const {
		baseUrl = "https://api.llmtxt.my",
		token,
		onError,
		onAwareness,
	} = options;

	// Build WS URL — use wss:// scheme
	const httpBase = baseUrl
		.replace(/^http:\/\//, "ws://")
		.replace(/^https:\/\//, "wss://");
	const query = token ? `?token=${encodeURIComponent(token)}` : "";
	const url = `${httpBase}/v1/documents/${encodeURIComponent(slug)}/sections/${encodeURIComponent(sectionId)}/collab${query}`;

	const state: CrdtSection = {
		doc: new Loro(),
		ws: null,
		closed: false,
	};

	// Ensure the "content" LoroText root exists in the local doc.
	state.doc.getText("content");

	function connect(): void {
		// loro-sync-v1 subprotocol — server rejects any client sending legacy
		// yjs-sync-v1; do NOT downgrade to the legacy subprotocol.
		state.ws = new WebSocket(url, ["loro-sync-v1"]);
		state.ws.binaryType = "arraybuffer";

		state.ws.onopen = () => {
			if (!state.ws || state.closed) return;
			// SyncStep1: encode our local VersionVector and send as 0x01 frame.
			// This is Loro VersionVector bytes (NOT a Y.js state vector).
			const vvBytes = encodeVersionVector(state.doc);
			state.ws.send(framed(MSG_SYNC_STEP_1, vvBytes));
		};

		state.ws.onmessage = (event: MessageEvent) => {
			if (state.closed) return;

			const raw =
				event.data instanceof ArrayBuffer
					? new Uint8Array(event.data)
					: new Uint8Array(event.data as ArrayBufferLike);

			if (raw.length === 0) return;

			// Drop stray 0x00 frames (legacy Yjs SyncStep1 — must not be processed).
			if (raw[0] === 0x00) return;

			// JSON control messages (auth errors, etc.) start with '{'
			if (raw[0] === 0x7b /* '{' */) return;

			const { msgType, payload } = unframe(raw);

			if (msgType === MSG_SYNC_STEP_2 || msgType === MSG_UPDATE) {
				// Import Loro binary blob into local doc (idempotent per CRDT invariant).
				try {
					state.doc.import(payload);
				} catch {
					// Malformed or incompatible bytes — drop silently.
					return;
				}

				const text = state.doc.getText("content").toString();
				callback({
					slug,
					sectionId,
					text,
					updateBytes: payload,
					receivedAt: Date.now(),
				});
			} else if (msgType === MSG_AWARENESS_RELAY) {
				if (onAwareness) onAwareness(payload);
			}
			// Any other unrecognised byte: drop.
		};

		state.ws.onerror = (event: Event) => {
			if (onError) onError(event);
		};

		state.ws.onclose = () => {
			// Connection closed — no automatic reconnect in this version.
		};
	}

	connect();

	return () => {
		state.closed = true;
		if (
			state.ws &&
			(state.ws.readyState === WebSocket.OPEN ||
				state.ws.readyState === WebSocket.CONNECTING)
		) {
			state.ws.close(1000, "client unsubscribed");
		}
	};
}

// ── getSectionText ────────────────────────────────────────────────────────────

/**
 * Fetch the current plain-text content of a section via the HTTP fallback.
 *
 * Does not require WebSocket support. Returns the text extracted from the
 * consolidated Loro CRDT state. Returns null if the section has not been
 * initialized (HTTP 503).
 *
 * The server returns a base64-encoded Loro snapshot blob. This function:
 *  1. Decodes the base64 → Loro binary bytes.
 *  2. Creates a local Loro Doc and imports the bytes.
 *  3. Reads the "content" LoroText root and returns its string value.
 *
 * Wire-format note: the stateBase64 field contains Loro binary (magic header
 * 0x6c 0x6f 0x72 0x6f "loro"). Do NOT pass these bytes to any Y.js / lib0
 * decoder — they are bitwise incompatible.
 *
 * @param slug      - Document slug
 * @param sectionId - Section identifier
 * @param options   - Auth and endpoint configuration
 */
export async function getSectionText(
	slug: string,
	sectionId: string,
	options: SubscribeSectionOptions = {},
): Promise<string | null> {
	const { baseUrl = "https://api.llmtxt.my", token } = options;

	const url = `${baseUrl}/v1/documents/${encodeURIComponent(slug)}/sections/${encodeURIComponent(sectionId)}/crdt-state`;

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (token) headers.Authorization = `Bearer ${token}`;

	const res = await fetch(url, { headers });

	if (res.status === 503) return null; // section not yet initialized
	if (!res.ok) {
		throw new Error(`getSectionText: HTTP ${res.status} from ${url}`);
	}

	const json = (await res.json()) as { stateBase64: string };

	// Decode base64 → Loro binary snapshot bytes.
	const stateBytes = Uint8Array.from(atob(json.stateBase64), (c) =>
		c.charCodeAt(0),
	);

	// Import into a fresh Loro Doc and extract the "content" LoroText root.
	const doc = new Loro();
	doc.getText("content");
	if (stateBytes.length > 0) {
		doc.import(stateBytes);
	}
	return doc.getText("content").toString();
}

// ── Internal: VersionVector encoding ─────────────────────────────────────────

/**
 * Encode the Loro VersionVector of a local doc as bytes suitable for SyncStep1.
 *
 * Uses `doc.oplogVersion()` which mirrors the Rust server-side `oplog_vv()`
 * call in `crdt_state_vector`. Calling `.encode()` on the returned
 * `VersionVector` yields the wire bytes that the server can decode with
 * `VersionVector::decode()` to compute the diff update (SyncStep2).
 *
 * The returned bytes are Loro VersionVector bytes — NOT Y.js state vector bytes.
 * They are bitwise incompatible with lib0 v1 state vector encoding.
 */
function encodeVersionVector(doc: Loro): Uint8Array {
	return doc.oplogVersion().encode();
}
