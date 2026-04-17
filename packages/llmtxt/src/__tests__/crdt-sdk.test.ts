/**
 * SDK CRDT tests — T397.
 *
 * Validates subscribeSection() and getSectionText() after migration from
 * Y.js / y-sync to the Loro framing protocol (spec P1 §3.2).
 *
 * Test strategy:
 *  - getSectionText(): tested via a mock fetch() that returns a Loro snapshot
 *    as base64. Verifies the function correctly imports the snapshot and
 *    returns the expected plain-text content.
 *  - subscribeSection(): tested via a mock WebSocket that simulates the
 *    loro-sync-v1 server exchange: receives SyncStep1 (0x01), replies with
 *    SyncStep2 (0x02) carrying a Loro update blob, then sends a subsequent
 *    Update (0x03). Verifies that:
 *      - The first outbound frame uses 0x01 prefix (not 0x00 legacy Yjs).
 *      - SyncStep2 and Update frames are imported into the local doc.
 *      - The callback fires with correct text after each inbound update.
 *      - Stray 0x00 frames (legacy Yjs) are silently dropped.
 *      - AwarenessRelay (0x04) is forwarded to the onAwareness callback.
 *      - Unsubscribe closes the WS gracefully.
 *
 * Binary format: Loro binary (magic header 0x6c 0x6f 0x72 0x6f "loro").
 * Wire protocol: 0x01/0x02/0x03/0x04 — NOT the legacy 0x00/0x01/0x02/0x03.
 *
 * Test runner: node:test (native, no vitest dependency).
 * Run with:
 *   node --import tsx/esm --test src/__tests__/crdt-sdk.test.ts
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Loro } from "loro-crdt";
import type { SectionDelta } from "../crdt.js";
import { getSectionText, subscribeSection } from "../crdt.js";

// ── Loro helper: build a state snapshot from content string ──────────────────

function makeLoroSnapshot(content: string): Uint8Array {
	const doc = new Loro();
	const text = doc.getText("content");
	if (content.length > 0) {
		text.insert(0, content);
		doc.commit();
	}
	return doc.export({ mode: "snapshot" });
}

function makeLoroUpdate(baseState: Uint8Array, append: string): Uint8Array {
	const doc = new Loro();
	doc.getText("content");
	if (baseState.length > 0) {
		doc.import(baseState);
	}
	const prevVersion = doc.oplogVersion();
	const text = doc.getText("content");
	text.insert(text.length, append);
	doc.commit();
	return doc.export({ mode: "update", from: prevVersion });
}

// ── Frame helpers matching the protocol ──────────────────────────────────────

const MSG_SYNC_STEP_1 = 0x01;
const MSG_SYNC_STEP_2 = 0x02;
const MSG_UPDATE = 0x03;
const MSG_AWARENESS_RELAY = 0x04;

function framed(msgType: number, payload: Uint8Array): Uint8Array {
	const out = new Uint8Array(1 + payload.length);
	out[0] = msgType;
	out.set(payload, 1);
	return out;
}

// ── Mock WebSocket ────────────────────────────────────────────────────────────

/**
 * Minimal mock WebSocket that captures sent frames and allows the test to
 * inject inbound messages.
 */
class MockWebSocket {
	static OPEN = 1;
	static CONNECTING = 0;

	readyState: number = MockWebSocket.CONNECTING;
	binaryType: string = "arraybuffer";

	onopen: ((e: Event) => void) | null = null;
	onmessage: ((e: MessageEvent) => void) | null = null;
	onerror: ((e: Event) => void) | null = null;
	onclose: (() => void) | null = null;

	sentFrames: Uint8Array[] = [];
	closeCode: number | null = null;
	closeReason: string | null = null;

	constructor(
		public readonly url: string,
		public readonly protocols: string[],
	) {}

	/** Simulate the server accepting the connection. */
	simulateOpen(): void {
		this.readyState = MockWebSocket.OPEN;
		this.onopen?.(new Event("open"));
	}

	/** Simulate an inbound binary message from the server. */
	simulateMessage(data: ArrayBuffer): void {
		this.onmessage?.(new MessageEvent("message", { data }));
	}

	/** Client calls this to send a frame to the server. */
	send(data: Uint8Array): void {
		this.sentFrames.push(new Uint8Array(data));
	}

	close(code: number, reason: string): void {
		this.closeCode = code;
		this.closeReason = reason;
		this.readyState = 3; // CLOSED
		this.onclose?.();
	}
}

// ── Tests: getSectionText ─────────────────────────────────────────────────────

describe("getSectionText (Loro HTTP fallback)", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("returns null when server responds 503 (not initialized)", async () => {
		globalThis.fetch = (async (_url: string) => ({
			ok: false,
			status: 503,
			json: async () => ({}),
		})) as unknown as typeof fetch;

		const result = await getSectionText("my-doc", "intro");
		assert.equal(result, null);
	});

	it("throws on unexpected HTTP error", async () => {
		globalThis.fetch = (async (_url: string) => ({
			ok: false,
			status: 500,
			json: async () => ({}),
		})) as unknown as typeof fetch;

		await assert.rejects(() => getSectionText("my-doc", "intro"), /HTTP 500/);
	});

	it("decodes Loro snapshot and returns plain text", async () => {
		const snap = makeLoroSnapshot("hello from loro");
		const stateBase64 = Buffer.from(snap).toString("base64");

		globalThis.fetch = (async (_url: string) => ({
			ok: true,
			status: 200,
			json: async () => ({ stateBase64 }),
		})) as unknown as typeof fetch;

		const text = await getSectionText("my-doc", "intro");
		assert.equal(text, "hello from loro");
	});

	it("returns empty string for an empty Loro snapshot", async () => {
		const snap = makeLoroSnapshot("");
		const stateBase64 = Buffer.from(snap).toString("base64");

		globalThis.fetch = (async (_url: string) => ({
			ok: true,
			status: 200,
			json: async () => ({ stateBase64 }),
		})) as unknown as typeof fetch;

		const text = await getSectionText("my-doc", "intro");
		assert.equal(text, "");
	});

	it("sends Authorization header when token is provided", async () => {
		const snap = makeLoroSnapshot("auth test");
		const stateBase64 = Buffer.from(snap).toString("base64");
		let capturedHeaders: Record<string, string> | null = null;

		globalThis.fetch = (async (_url: string, init?: RequestInit) => {
			capturedHeaders = (init?.headers as Record<string, string>) ?? null;
			return {
				ok: true,
				status: 200,
				json: async () => ({ stateBase64 }),
			};
		}) as unknown as typeof fetch;

		await getSectionText("my-doc", "intro", { token: "llmtxt_abc123" });
		assert.ok(capturedHeaders !== null, "fetch should have been called");
		assert.equal(
			(capturedHeaders as Record<string, string>).Authorization,
			"Bearer llmtxt_abc123",
		);
	});

	it("URL encodes slug and sectionId in the request URL", async () => {
		const snap = makeLoroSnapshot("url test");
		const stateBase64 = Buffer.from(snap).toString("base64");
		let capturedUrl = "";

		globalThis.fetch = (async (url: string) => {
			capturedUrl = url as string;
			return {
				ok: true,
				status: 200,
				json: async () => ({ stateBase64 }),
			};
		}) as unknown as typeof fetch;

		await getSectionText("my doc/slug", "section id", {
			baseUrl: "https://api.llmtxt.my",
		});
		assert.ok(capturedUrl.includes("my%20doc%2Fslug"), "slug must be encoded");
		assert.ok(
			capturedUrl.includes("section%20id"),
			"sectionId must be encoded",
		);
	});
});

// ── Tests: subscribeSection ───────────────────────────────────────────────────

// Module-level slot so MockWebSocket instances can register themselves.
// The class is used directly as the global WebSocket constructor; each
// instance stores itself here so tests can inspect it.
let lastCreatedMock: MockWebSocket | null = null;

// Subclass that registers itself on creation — avoids noConstructorReturn.
class CapturingMockWebSocket extends MockWebSocket {
	constructor(url: string, protocols: string[]) {
		super(url, protocols);
		lastCreatedMock = this;
	}
}

describe("subscribeSection (Loro WS protocol)", () => {
	let OriginalWebSocket: typeof WebSocket;

	beforeEach(() => {
		OriginalWebSocket = globalThis.WebSocket;
		lastCreatedMock = null;
		// Install CapturingMockWebSocket as the global WebSocket constructor.
		// crdt.ts calls `new WebSocket(url, [subprotocol])` and this intercepts it.
		(globalThis as unknown as Record<string, unknown>).WebSocket =
			CapturingMockWebSocket;
	});

	afterEach(() => {
		globalThis.WebSocket = OriginalWebSocket;
		lastCreatedMock = null;
	});

	function getMockWs(): MockWebSocket {
		assert.ok(lastCreatedMock !== null, "MockWebSocket was not constructed");
		return lastCreatedMock;
	}

	it("uses loro-sync-v1 subprotocol (not yjs-sync-v1)", () => {
		subscribeSection("doc", "sec", () => {});
		getMockWs().simulateOpen();
		assert.ok(
			getMockWs().protocols.includes("loro-sync-v1"),
			"must use loro-sync-v1 subprotocol",
		);
		assert.ok(
			!getMockWs().protocols.includes("yjs-sync-v1"),
			"must NOT use legacy yjs-sync-v1 subprotocol",
		);
	});

	it("sends SyncStep1 (0x01) on open — not legacy 0x00", () => {
		subscribeSection("doc", "sec", () => {});
		getMockWs().simulateOpen();

		assert.equal(
			getMockWs().sentFrames.length,
			1,
			"should send exactly one frame on open",
		);
		const frame = getMockWs().sentFrames[0];
		assert.ok(frame.length > 0, "frame must not be empty");
		assert.equal(
			frame[0],
			MSG_SYNC_STEP_1,
			"first byte must be 0x01 (SyncStep1)",
		);
		assert.notEqual(frame[0], 0x00, "must NOT send legacy 0x00 Yjs frame");
	});

	it("SyncStep1 payload is non-empty Loro VersionVector bytes", () => {
		subscribeSection("doc", "sec", () => {});
		getMockWs().simulateOpen();

		const frame = getMockWs().sentFrames[0];
		// The payload is the VV bytes after the 0x01 prefix
		const vvPayload = frame.subarray(1);
		assert.ok(vvPayload.length > 0, "VersionVector payload must be non-empty");
		// Must NOT start with "loro" magic (VV encoding differs from snapshot)
		const LORO_MAGIC = [0x6c, 0x6f, 0x72, 0x6f];
		if (vvPayload.length >= 4) {
			const firstFour = Array.from(vvPayload.slice(0, 4));
			assert.notDeepEqual(
				firstFour,
				LORO_MAGIC,
				"VersionVector bytes must not start with Loro snapshot magic header",
			);
		}
	});

	it("callback fires when SyncStep2 (0x02) is received with Loro update", async () => {
		const deltas: SectionDelta[] = [];
		subscribeSection("doc", "sec", (d) => deltas.push(d));
		getMockWs().simulateOpen();

		// Server sends SyncStep2 with a Loro snapshot
		const snap = makeLoroSnapshot("initial content from server");
		getMockWs().simulateMessage(
			framed(MSG_SYNC_STEP_2, snap).buffer as ArrayBuffer,
		);

		// Flush microtasks
		await Promise.resolve();

		assert.equal(deltas.length, 1, "callback should fire once");
		assert.equal(deltas[0].text, "initial content from server");
		assert.equal(deltas[0].slug, "doc");
		assert.equal(deltas[0].sectionId, "sec");
		assert.ok(deltas[0].receivedAt > 0);
	});

	it("callback fires when Update (0x03) is received with incremental Loro update", async () => {
		const deltas: SectionDelta[] = [];
		subscribeSection("doc", "sec", (d) => deltas.push(d));
		getMockWs().simulateOpen();

		// First: bootstrap with a snapshot via SyncStep2
		const baseSnap = makeLoroSnapshot("hello");
		getMockWs().simulateMessage(
			framed(MSG_SYNC_STEP_2, baseSnap).buffer as ArrayBuffer,
		);
		await Promise.resolve();

		// Then: incremental update via Update (0x03)
		const incr = makeLoroUpdate(baseSnap, " world");
		getMockWs().simulateMessage(framed(MSG_UPDATE, incr).buffer as ArrayBuffer);
		await Promise.resolve();

		assert.equal(deltas.length, 2, "callback should fire for each update");
		assert.equal(deltas[0].text, "hello");
		assert.equal(deltas[1].text, "hello world");
	});

	it("stray 0x00 frames (legacy Yjs SyncStep1) are silently dropped", async () => {
		const deltas: SectionDelta[] = [];
		subscribeSection("doc", "sec", (d) => deltas.push(d));
		getMockWs().simulateOpen();

		// Inject a stray 0x00 frame
		const strayFrame = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
		getMockWs().simulateMessage(strayFrame.buffer as ArrayBuffer);
		await Promise.resolve();

		assert.equal(
			deltas.length,
			0,
			"stray 0x00 frame must not trigger callback",
		);
	});

	it("JSON control messages (0x7b) are silently dropped", async () => {
		const deltas: SectionDelta[] = [];
		subscribeSection("doc", "sec", (d) => deltas.push(d));
		getMockWs().simulateOpen();

		const jsonMsg = new TextEncoder().encode(
			JSON.stringify({ error: "auth_error", code: 4401 }),
		);
		getMockWs().simulateMessage(jsonMsg.buffer as ArrayBuffer);
		await Promise.resolve();

		assert.equal(
			deltas.length,
			0,
			"JSON control message must not trigger callback",
		);
	});

	it("AwarenessRelay (0x04) forwarded to onAwareness callback", async () => {
		const awarenessPayloads: Uint8Array[] = [];
		subscribeSection("doc", "sec", () => {}, {
			onAwareness: (p) => awarenessPayloads.push(p),
		});
		getMockWs().simulateOpen();

		const awarenessData = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
		getMockWs().simulateMessage(
			framed(MSG_AWARENESS_RELAY, awarenessData).buffer as ArrayBuffer,
		);
		await Promise.resolve();

		assert.equal(
			awarenessPayloads.length,
			1,
			"onAwareness should be called once",
		);
		assert.deepEqual(
			Array.from(awarenessPayloads[0]),
			Array.from(awarenessData),
		);
	});

	it("AwarenessRelay (0x04) does not trigger SectionDelta callback", async () => {
		const deltas: SectionDelta[] = [];
		subscribeSection("doc", "sec", (d) => deltas.push(d));
		getMockWs().simulateOpen();

		const awarenessData = new Uint8Array([0x01, 0x02]);
		getMockWs().simulateMessage(
			framed(MSG_AWARENESS_RELAY, awarenessData).buffer as ArrayBuffer,
		);
		await Promise.resolve();

		assert.equal(
			deltas.length,
			0,
			"awareness relay must not trigger SectionDelta",
		);
	});

	it("unsubscribe closes the WebSocket with code 1000", () => {
		const unsub = subscribeSection("doc", "sec", () => {});
		getMockWs().simulateOpen();

		unsub();

		assert.equal(getMockWs().closeCode, 1000);
		assert.equal(getMockWs().closeReason, "client unsubscribed");
	});

	it("WS URL includes token as query param when provided", () => {
		subscribeSection("doc", "sec", () => {}, {
			baseUrl: "https://api.llmtxt.my",
			token: "llmtxt_tok123",
		});

		assert.ok(
			getMockWs().url.includes("?token=llmtxt_tok123"),
			`URL should include token; got: ${getMockWs().url}`,
		);
	});

	it("WS URL uses wss:// scheme", () => {
		subscribeSection("doc", "sec", () => {}, {
			baseUrl: "https://api.llmtxt.my",
		});

		assert.ok(
			getMockWs().url.startsWith("wss://"),
			`URL must use wss:// scheme; got: ${getMockWs().url}`,
		);
	});

	it("WS URL encodes slug and sectionId", () => {
		subscribeSection("my doc/slug", "section id", () => {});

		assert.ok(
			getMockWs().url.includes("my%20doc%2Fslug"),
			"slug must be URL-encoded",
		);
		assert.ok(
			getMockWs().url.includes("section%20id"),
			"sectionId must be URL-encoded",
		);
	});

	it("empty frame is dropped without error", async () => {
		const deltas: SectionDelta[] = [];
		subscribeSection("doc", "sec", (d) => deltas.push(d));
		getMockWs().simulateOpen();

		getMockWs().simulateMessage(new ArrayBuffer(0));
		await Promise.resolve();

		assert.equal(deltas.length, 0, "empty frame must be silently ignored");
	});

	it("malformed Loro bytes are dropped without throwing", async () => {
		const deltas: SectionDelta[] = [];
		subscribeSection("doc", "sec", (d) => deltas.push(d));
		getMockWs().simulateOpen();

		// Valid 0x02 prefix but garbage payload
		const garbage = new Uint8Array([MSG_SYNC_STEP_2, 0xff, 0xfe, 0xfd, 0xab]);
		getMockWs().simulateMessage(garbage.buffer as ArrayBuffer);
		await Promise.resolve();

		assert.equal(
			deltas.length,
			0,
			"malformed Loro bytes must not trigger callback",
		);
	});

	it("two consecutive updates both trigger callback with accumulated text", async () => {
		const texts: string[] = [];
		subscribeSection("doc", "sec", (d) => texts.push(d.text));
		getMockWs().simulateOpen();

		const snap1 = makeLoroSnapshot("first");
		getMockWs().simulateMessage(
			framed(MSG_SYNC_STEP_2, snap1).buffer as ArrayBuffer,
		);
		await Promise.resolve();

		const upd2 = makeLoroUpdate(snap1, " second");
		getMockWs().simulateMessage(framed(MSG_UPDATE, upd2).buffer as ArrayBuffer);
		await Promise.resolve();

		assert.equal(texts.length, 2);
		assert.equal(texts[0], "first");
		assert.equal(texts[1], "first second");
	});
});
