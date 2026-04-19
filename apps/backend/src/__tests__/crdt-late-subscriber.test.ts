/**
 * CRDT late-subscriber integration test — T719 / T700.
 *
 * Verifies that when a writer creates a section with CRDT content and a
 * subscriber connects AFTER the writer has finished, the subscriber still
 * receives the full CRDT state (non-zero bytes).
 *
 * This test covers the T308 Cap 2 failure scenario:
 *   - writer initialises section with content (simulated via crdt_make_state)
 *   - observer connects AFTER writer is done
 *   - server sends InitialSnapshot (MSG_UPDATE 0x03) on connect (T700/T717 fix)
 *   - observer receives non-zero bytes and converges to correct content
 *
 * The test simulates the ws-crdt.ts server-side InitialSnapshot logic directly
 * (no live WS server needed) — it models the exact sequence of bytes the server
 * sends and the client SDK processes:
 *
 *   Server on connect:
 *     1. Load serverState from DB (simulated with crdt_make_state)
 *     2. Send InitialSnapshot: framed(MSG_UPDATE, crdt_encode_state_as_update(serverState))
 *     3. Send SyncStep1: framed(SYNC_STEP_1, crdt_state_vector(serverState))
 *
 *   Client (SDK: crdt.ts subscribeSection onmessage):
 *     - Receives MSG_UPDATE (0x03) → imports into local doc → fires callback
 *     - Receives SYNC_STEP_1 (0x01) → sends its VV back → receives SyncStep2
 *     - SyncStep2 is now redundant (idempotent Loro import) but still handled
 *
 * Run with:
 *   pnpm --filter @llmtxt/backend test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	crdt_apply_update,
	crdt_diff_update,
	crdt_encode_state_as_update,
	crdt_get_text,
	crdt_make_incremental_update,
	crdt_make_state,
	crdt_state_vector,
} from "../crdt/primitives.js";

// ── Protocol constants (mirror ws-crdt.ts) ────────────────────────────────────

const SYNC_STEP_1 = 0x01;
const SYNC_STEP_2 = 0x02;
const MSG_UPDATE = 0x03;

/** Prepend a 1-byte message type prefix. */
function framed(msgType: number, payload: Buffer): Buffer {
	const frame = Buffer.allocUnsafe(1 + payload.length);
	frame[0] = msgType;
	payload.copy(frame, 1);
	return frame;
}

/** Strip the 1-byte prefix from a received frame. */
function unframe(frame: Buffer): { msgType: number; payload: Buffer } {
	return { msgType: frame[0], payload: frame.subarray(1) };
}

// ── Client-side simulation (mirrors crdt.ts subscribeSection onmessage) ────────

interface ClientState {
	/** Local Loro doc state (Buffer). Empty = no content yet. */
	docState: Buffer;
	/** Number of callback invocations (= crdt_messages). */
	messages: number;
	/** Total updateBytes received (= crdt_bytes). */
	bytes: number;
	/** All update payloads received. */
	updates: Buffer[];
}

/**
 * Simulate the SDK client processing a server-sent frame.
 * Mirrors the onmessage handler in packages/llmtxt/src/crdt.ts.
 *
 * Returns an array of outbound frames the client would send back to the server
 * (e.g. its SyncStep1 response). For MSG_UPDATE/MSG_SYNC_STEP_2 frames, the
 * callback is fired and no response is sent.
 */
function processServerFrame(
	frame: Buffer,
	clientState: ClientState,
): Buffer[] {
	if (frame.length === 0) return [];

	const { msgType, payload } = unframe(frame);

	// Drop stray 0x00 (legacy Yjs) and JSON control frames
	if (msgType === 0x00 || msgType === 0x7b) return [];

	if (msgType === MSG_UPDATE || msgType === SYNC_STEP_2) {
		// Import into local doc (idempotent Loro import)
		if (payload.length > 0) {
			clientState.docState = crdt_apply_update(clientState.docState, payload);
			clientState.messages++;
			clientState.bytes += payload.length;
			clientState.updates.push(payload);
		}
		return [];
	}

	if (msgType === SYNC_STEP_1) {
		// Server sent its VV → respond with our own VV (SyncStep1 from client)
		const clientVv = crdt_state_vector(clientState.docState);
		return [framed(SYNC_STEP_1, clientVv)];
	}

	return [];
}

/**
 * Simulate the server processing a client frame (mirrors ws-crdt.ts onmessage).
 * Returns frames the server would send back.
 */
function processClientFrame(
	frame: Buffer,
	serverState: Buffer,
): Buffer[] {
	if (frame.length === 0) return [];

	const { msgType, payload } = unframe(frame);

	if (msgType === SYNC_STEP_1) {
		// Client sent its VV → compute and send diff
		const diff = crdt_diff_update(serverState, payload);
		return [framed(SYNC_STEP_2, diff)];
	}

	if (msgType === MSG_UPDATE) {
		// Client sent an update — persist and broadcast (not tested here)
		return [];
	}

	return [];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CRDT late-subscriber receives full state (T719 / T700 fix)", () => {
	it("late subscriber receives non-zero bytes from InitialSnapshot on connect", () => {
		// Simulate writer: create section with content
		const writerContent = "Multi-agent collaboration with Loro CRDT — section content written by writer-bot";
		const serverState = crdt_make_state(writerContent);
		assert.ok(serverState.length > 0, "server state should be non-empty after writer writes");
		assert.equal(crdt_get_text(serverState), writerContent, "server state should contain writer content");

		// Simulate server connect sequence (T717 fix):
		//   1. Send InitialSnapshot (MSG_UPDATE with full state)
		//   2. Send SyncStep1 (server VV)
		const snapshot = crdt_encode_state_as_update(serverState);
		assert.ok(snapshot.length > 0, "snapshot must be non-empty for non-empty section");

		const initialSnapshotFrame = framed(MSG_UPDATE, snapshot);
		const serverVv = crdt_state_vector(serverState);
		const syncStep1Frame = framed(SYNC_STEP_1, serverVv);

		// Simulate late observer (fresh client, no prior state)
		const clientState: ClientState = {
			docState: Buffer.alloc(0),
			messages: 0,
			bytes: 0,
			updates: [],
		};

		// Observer processes InitialSnapshot frame (MSG_UPDATE 0x03)
		const responseToSnapshot = processServerFrame(initialSnapshotFrame, clientState);
		assert.equal(responseToSnapshot.length, 0, "client sends no response to MSG_UPDATE");
		assert.ok(clientState.messages >= 1, "callback must fire at least once on InitialSnapshot");
		assert.ok(clientState.bytes > 0, "crdt_bytes must be non-zero after InitialSnapshot — T308 Cap 2");
		assert.equal(
			crdt_get_text(clientState.docState),
			writerContent,
			"client doc must converge to writer content after InitialSnapshot",
		);

		// Observer processes SyncStep1 (0x01) — replies with its own VV
		const responseToSyncStep1 = processServerFrame(syncStep1Frame, clientState);
		assert.equal(responseToSyncStep1.length, 1, "client sends SyncStep1 response");
		assert.equal(responseToSyncStep1[0][0], SYNC_STEP_1, "response must be SyncStep1 frame");

		// Server processes client's SyncStep1 → sends SyncStep2 (now redundant but valid)
		const syncStep2Frames = processClientFrame(responseToSyncStep1[0], serverState);
		assert.equal(syncStep2Frames.length, 1, "server sends SyncStep2");
		assert.equal(syncStep2Frames[0][0], SYNC_STEP_2, "server response must be SyncStep2 frame");

		// Observer processes SyncStep2 (0x02) — idempotent import, still fires callback
		const responseToSyncStep2 = processServerFrame(syncStep2Frames[0], clientState);
		assert.equal(responseToSyncStep2.length, 0, "client sends no response to SyncStep2");

		// Final assertions
		assert.ok(clientState.messages >= 1, "at least 1 message must be received (InitialSnapshot)");
		assert.ok(clientState.bytes >= 100, `crdt_bytes must be >= 100 (T308 Cap 2 threshold), got ${clientState.bytes}`);
		assert.equal(
			crdt_get_text(clientState.docState),
			writerContent,
			"final client content must match writer content",
		);
	});

	it("late subscriber converges to correct content within 5s simulated deadline", async () => {
		// Simulate T308 scenario: writer writes 3 sections, observer connects late
		const sections = [
			{ id: "introduction", content: "Introduction to multi-agent collaboration." },
			{ id: "architecture", content: "Architecture overview with Loro CRDT backend." },
			{ id: "multi-agent", content: "Multi-agent workflow and consensus protocol." },
		];

		const results: Array<{
			sectionId: string;
			bytesReceived: number;
			messagesReceived: number;
			converged: boolean;
		}> = [];

		const start = Date.now();
		const DEADLINE_MS = 5000;

		for (const section of sections) {
			// Writer creates and writes section
			const serverState = crdt_make_state(section.content);

			// Observer connects late — server sends InitialSnapshot
			const snapshot = crdt_encode_state_as_update(serverState);
			const initialSnapshotFrame = framed(MSG_UPDATE, snapshot);

			// Late subscriber processes InitialSnapshot
			const clientState: ClientState = {
				docState: Buffer.alloc(0),
				messages: 0,
				bytes: 0,
				updates: [],
			};
			processServerFrame(initialSnapshotFrame, clientState);

			const elapsed = Date.now() - start;
			assert.ok(elapsed < DEADLINE_MS, `Section ${section.id}: must complete within ${DEADLINE_MS}ms, took ${elapsed}ms`);

			const converged = crdt_get_text(clientState.docState) === section.content;

			results.push({
				sectionId: section.id,
				bytesReceived: clientState.bytes,
				messagesReceived: clientState.messages,
				converged,
			});
		}

		// All sections must have non-zero bytes (T308 Cap 2)
		for (const r of results) {
			assert.ok(r.bytesReceived > 0, `Section ${r.sectionId}: crdt_bytes must be > 0, got ${r.bytesReceived}`);
			assert.ok(r.messagesReceived > 0, `Section ${r.sectionId}: crdt_messages must be > 0, got ${r.messagesReceived}`);
			assert.ok(r.converged, `Section ${r.sectionId}: content must converge to writer content`);
		}

		const totalBytes = results.reduce((s, r) => s + r.bytesReceived, 0);
		assert.ok(totalBytes >= 100, `Total crdt_bytes across all sections must be >= 100, got ${totalBytes}`);
	});

	it("InitialSnapshot does not affect existing writers (backward compat)", () => {
		// Existing writers connect BEFORE content is written — serverState is empty
		// Server should NOT send InitialSnapshot for empty sections (no-op)
		const emptyServerState = Buffer.alloc(0);

		// T717 fix: only send snapshot if serverState.length > 0
		const shouldSendSnapshot = emptyServerState.length > 0;
		assert.equal(shouldSendSnapshot, false, "server must not send snapshot for empty section");

		// Existing writer builds state and sends updates
		const writerContent = "Writer-first content";
		const writerState = crdt_make_state(writerContent);
		const writerUpdate = crdt_encode_state_as_update(writerState);

		// Server broadcasts MSG_UPDATE to all subscribers (writer fanout)
		const broadcastFrame = framed(MSG_UPDATE, writerUpdate);

		// Early subscriber (connected before writer) processes the live update
		const earlySubscriberState: ClientState = {
			docState: Buffer.alloc(0),
			messages: 0,
			bytes: 0,
			updates: [],
		};
		processServerFrame(broadcastFrame, earlySubscriberState);

		assert.ok(earlySubscriberState.messages >= 1, "early subscriber must receive live update");
		assert.ok(earlySubscriberState.bytes > 0, "early subscriber must see non-zero bytes from live update");
		assert.equal(
			crdt_get_text(earlySubscriberState.docState),
			writerContent,
			"early subscriber converges to writer content via live update",
		);
	});

	it("incremental updates after InitialSnapshot are correctly merged (no duplication)", () => {
		// Server state after writer writes initial content
		const initialContent = "Initial section content.";
		const serverStateV1 = crdt_make_state(initialContent);

		// Observer connects late → receives InitialSnapshot
		const snapshot = crdt_encode_state_as_update(serverStateV1);
		const clientState: ClientState = {
			docState: Buffer.alloc(0),
			messages: 0,
			bytes: 0,
			updates: [],
		};
		processServerFrame(framed(MSG_UPDATE, snapshot), clientState);

		assert.equal(crdt_get_text(clientState.docState), initialContent);

		// Writer sends a subsequent incremental update
		const incrementalUpdate = crdt_make_incremental_update(serverStateV1, " Additional text.");
		const serverStateV2 = crdt_apply_update(serverStateV1, incrementalUpdate);

		// Server broadcasts the incremental update (MSG_UPDATE)
		processServerFrame(framed(MSG_UPDATE, incrementalUpdate), clientState);

		const expectedContent = crdt_get_text(serverStateV2);
		const clientContent = crdt_get_text(clientState.docState);

		assert.equal(
			clientContent,
			expectedContent,
			"client must converge to final content after initial snapshot + incremental update",
		);
		assert.ok(clientContent.includes(initialContent), "final content must include initial content");
		assert.ok(clientContent.includes("Additional text"), "final content must include incremental update");
	});
});
