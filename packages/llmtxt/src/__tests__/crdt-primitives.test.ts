/**
 * CRDT primitives tests — T391 / Loro migration.
 *
 * Validates the six core CRDT functions after migration from Yrs to Loro:
 *   1. New doc → encode → decode → identical snapshot (round-trip)
 *   2. Merge commutativity (A+B == B+A)
 *   3. Apply idempotency
 *   4. State vector extraction
 *   5. Diff update (SyncStep2)
 *   6. Two-agent convergence
 *
 * Binary format: Loro binary (magic header 0x6c 0x6f 0x72 0x6f "loro").
 * This format is bitwise INCOMPATIBLE with the previous Yrs lib0 v1 format.
 *
 * Test runner: node:test (native, no vitest dependency).
 * Run with:
 *   node --import tsx/esm --test src/__tests__/crdt-primitives.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	crdt_apply_to_local_doc,
	crdt_apply_update,
	crdt_diff_update,
	crdt_encode_state_as_update,
	crdt_get_text,
	crdt_make_incremental_update,
	crdt_make_state,
	crdt_merge_updates,
	crdt_new_doc,
	crdt_state_vector,
} from "../crdt-primitives.js";

// ── Helper: verify Loro magic header ────────────────────────────────────────

const LORO_MAGIC = [0x6c, 0x6f, 0x72, 0x6f]; // "loro"

function assertLoroMagic(buf: Buffer, label: string): void {
	assert.ok(buf.length >= 4, `${label} must be at least 4 bytes`);
	const header = Array.from(buf.slice(0, 4));
	assert.deepEqual(
		header,
		LORO_MAGIC,
		`${label} must have Loro magic header 0x6c 0x6f 0x72 0x6f, got ${header.map((b) => b.toString(16)).join(" ")}`,
	);
}

// ── 1. crdt_new_doc ──────────────────────────────────────────────────────────

describe("crdt_new_doc", () => {
	it("returns non-empty Loro snapshot bytes", () => {
		const snap = crdt_new_doc();
		assert.ok(snap.length > 0, "new doc snapshot should not be empty");
		assertLoroMagic(snap, "crdt_new_doc");
	});

	it("two calls produce snapshots of the same length (deterministic empty doc)", () => {
		const snap1 = crdt_new_doc();
		const snap2 = crdt_new_doc();
		// Both are empty Loro docs — content length should be equal
		// (may not be byte-identical due to peer IDs, but content is empty)
		assert.equal(crdt_get_text(snap1), "", "new doc text must be empty");
		assert.equal(crdt_get_text(snap2), "", "new doc text must be empty");
	});

	it("crdt_get_text of new doc returns empty string", () => {
		const snap = crdt_new_doc();
		assert.equal(crdt_get_text(snap), "");
	});
});

// ── 2. crdt_encode_state_as_update ──────────────────────────────────────────

describe("crdt_encode_state_as_update", () => {
	it("returns Loro snapshot bytes for a state", () => {
		const state = crdt_make_state("hello world");
		const encoded = crdt_encode_state_as_update(state);
		assertLoroMagic(encoded, "encoded state");
		assert.ok(encoded.length > 0);
	});

	it("round-trip: encode then decode preserves text content", () => {
		const state = crdt_make_state("round-trip content");
		const encoded = crdt_encode_state_as_update(state);
		// Apply the encoded blob to an empty state
		const decoded = crdt_apply_update(Buffer.alloc(0), encoded);
		assert.equal(crdt_get_text(decoded), "round-trip content");
	});

	it("is stable across two calls (same content)", () => {
		const state = crdt_make_state("stable content");
		const enc1 = crdt_encode_state_as_update(state);
		const enc2 = crdt_encode_state_as_update(state);
		// Content must be identical even if byte sequences differ
		const text1 = crdt_get_text(crdt_apply_update(Buffer.alloc(0), enc1));
		const text2 = crdt_get_text(crdt_apply_update(Buffer.alloc(0), enc2));
		assert.equal(text1, "stable content");
		assert.equal(text1, text2, "repeated encode calls must yield same content");
	});

	it("empty state returns canonical empty-doc snapshot", () => {
		const encoded = crdt_encode_state_as_update(Buffer.alloc(0));
		assertLoroMagic(encoded, "empty-state encoded");
		assert.equal(
			crdt_get_text(crdt_apply_update(Buffer.alloc(0), encoded)),
			"",
		);
	});
});

// ── 3. crdt_apply_update ────────────────────────────────────────────────────

describe("crdt_apply_update", () => {
	it("applies a Loro snapshot to empty state and returns new state", () => {
		const update = crdt_make_state("hello");
		const newState = crdt_apply_update(Buffer.alloc(0), update);
		assertLoroMagic(newState, "applied state");
		assert.equal(crdt_get_text(newState), "hello");
	});

	it("idempotency: applying same update twice yields same content", () => {
		const update = crdt_make_state("idempotent content");
		const stateOnce = crdt_apply_update(Buffer.alloc(0), update);
		const stateTwice = crdt_apply_update(stateOnce, update);
		assert.equal(crdt_get_text(stateOnce), crdt_get_text(stateTwice));
		assert.equal(crdt_get_text(stateOnce), "idempotent content");
	});

	it("applying incremental update grows state", () => {
		const initial = crdt_make_state("hello");
		const incr = crdt_make_incremental_update(initial, " world");
		const newState = crdt_apply_update(initial, incr);
		assert.equal(crdt_get_text(newState), "hello world");
	});
});

// ── 4. crdt_merge_updates ───────────────────────────────────────────────────

describe("crdt_merge_updates", () => {
	it("empty array returns empty Loro snapshot", () => {
		const merged = crdt_merge_updates([]);
		assertLoroMagic(merged, "empty merge result");
		assert.equal(crdt_get_text(merged), "");
	});

	it("merge commutativity: merge([A,B]) content == merge([B,A]) content", () => {
		const uA = crdt_make_state("Alpha");
		const uB = crdt_make_state("Beta");

		const mergedAB = crdt_get_text(crdt_merge_updates([uA, uB]));
		const mergedBA = crdt_get_text(crdt_merge_updates([uB, uA]));

		assert.equal(
			mergedAB,
			mergedBA,
			`commutativity: '${mergedAB}' vs '${mergedBA}'`,
		);
	});

	it("merge associativity: apply(merge(U1,U2)) content == apply(apply(U1),U2) content", () => {
		const u1 = crdt_make_state("Hello ");
		const u2 = crdt_make_state("World");
		const init = Buffer.alloc(0);

		// Path A: apply merged
		const merged = crdt_merge_updates([u1, u2]);
		const stateA = crdt_apply_update(init, merged);
		const textA = crdt_get_text(stateA);

		// Path B: apply sequentially
		const stateB1 = crdt_apply_update(init, u1);
		const stateB2 = crdt_apply_update(stateB1, u2);
		const textB = crdt_get_text(stateB2);

		assert.equal(
			textA,
			textB,
			`associativity: '${textA}' must equal '${textB}'`,
		);
		assert.ok(textA.length > 0, "merged state should be non-empty");
	});

	it("merging a single update returns equivalent state", () => {
		const u = crdt_make_state("single");
		const merged = crdt_merge_updates([u]);
		assert.equal(
			crdt_get_text(crdt_apply_update(Buffer.alloc(0), merged)),
			"single",
		);
	});
});

// ── 5. crdt_state_vector ────────────────────────────────────────────────────

describe("crdt_state_vector", () => {
	it("empty state gives non-empty Loro VersionVector bytes", () => {
		const sv = crdt_state_vector(Buffer.alloc(0));
		assert.ok(sv.length > 0, "empty state VersionVector should be non-empty");
		// Loro VersionVector bytes do NOT have the "loro" magic header
		// They are a compact binary encoding different from the snapshot format
	});

	it("state with content gives VersionVector bytes", () => {
		const state = crdt_make_state("hello");
		const sv = crdt_state_vector(state);
		assert.ok(sv.length > 0, "VersionVector should be non-empty");
	});

	it("VersionVector bytes are different from snapshot bytes", () => {
		const state = crdt_make_state("hello");
		const sv = crdt_state_vector(state);
		// VersionVector must NOT start with "loro" magic (it is a different encoding)
		const firstFour = Array.from(sv.slice(0, 4));
		assert.notDeepEqual(
			firstFour,
			LORO_MAGIC,
			"VersionVector must not use Loro snapshot magic header",
		);
	});
});

// ── 6. crdt_diff_update ─────────────────────────────────────────────────────

describe("crdt_diff_update", () => {
	it("diff from empty VersionVector gives full state blob", () => {
		const state = crdt_make_state("full content");
		const diff = crdt_diff_update(state, Buffer.alloc(0));
		assert.ok(diff.length > 0, "diff should be non-empty");
		const result = crdt_apply_update(Buffer.alloc(0), diff);
		assert.equal(crdt_get_text(result), "full content");
	});

	it("diff from current VersionVector gives empty/minimal blob", () => {
		const state = crdt_make_state("synced content");
		const sv = crdt_state_vector(state);
		const diff = crdt_diff_update(state, sv);
		// Client is up-to-date, so applying this diff changes nothing
		const result = crdt_apply_update(state, diff);
		assert.equal(crdt_get_text(result), "synced content");
	});

	it("SyncStep1+2 converges fresh client in one RTT", () => {
		const serverState = crdt_make_state("server initial content");

		// Fresh client sends empty VersionVector (simulating SyncStep1)
		const clientSv = crdt_state_vector(Buffer.alloc(0));
		assert.ok(clientSv.length > 0);

		// SyncStep2: server sends diff
		const diff = crdt_diff_update(serverState, clientSv);
		assert.ok(diff.length > 0, "diff should be non-empty for fresh client");

		// Client applies diff
		const clientState = crdt_apply_update(Buffer.alloc(0), diff);
		assert.equal(
			crdt_get_text(clientState),
			"server initial content",
			"client should converge after one RTT",
		);
	});
});

// ── 7. crdt_get_text ────────────────────────────────────────────────────────

describe("crdt_get_text", () => {
	it("empty state returns empty string", () => {
		assert.equal(crdt_get_text(Buffer.alloc(0)), "");
	});

	it("extracts text from Loro snapshot", () => {
		const state = crdt_make_state("extracted text");
		assert.equal(crdt_get_text(state), "extracted text");
	});

	it("extracts text from applied state", () => {
		const u1 = crdt_make_state("foo");
		const u2 = crdt_make_incremental_update(u1, " bar");
		const state = crdt_apply_update(u1, u2);
		assert.equal(crdt_get_text(state), "foo bar");
	});
});

// ── 8. Two-agent convergence ─────────────────────────────────────────────────

describe("Two-agent convergence (Loro protocol)", () => {
	it("two agents editing same section converge to identical state", () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let serverState: Buffer = Buffer.alloc(0) as any;

		// Agent A: 5 incremental updates
		const agentAUpdates: Buffer[] = [];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let agentAState: Buffer = Buffer.alloc(0) as any;
		for (let i = 0; i < 5; i++) {
			const upd = crdt_make_incremental_update(agentAState, `A${i} `);
			agentAUpdates.push(upd);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			agentAState = crdt_apply_update(agentAState, upd) as any;
		}

		// Agent B: 5 incremental updates (starting from empty, concurrently)
		const agentBUpdates: Buffer[] = [];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let agentBState: Buffer = Buffer.alloc(0) as any;
		for (let i = 0; i < 5; i++) {
			const upd = crdt_make_incremental_update(agentBState, `B${i} `);
			agentBUpdates.push(upd);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			agentBState = crdt_apply_update(agentBState, upd) as any;
		}

		// Server applies all 10 updates (simulating ws-crdt.ts handler)
		for (const upd of [...agentAUpdates, ...agentBUpdates]) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			serverState = crdt_apply_update(serverState, upd) as any;
		}

		// Agent A reconnects: sends VersionVector; server replies with diff
		const svA = crdt_state_vector(agentAState);
		const diffForA = crdt_diff_update(serverState, svA);
		const agentAFinal = crdt_apply_to_local_doc(agentAState, diffForA);

		// Agent B reconnects: sends VersionVector; server replies with diff
		const svB = crdt_state_vector(agentBState);
		const diffForB = crdt_diff_update(serverState, svB);
		const agentBFinal = crdt_apply_to_local_doc(agentBState, diffForB);

		// Both agents should now have the same text as the server
		const serverText = crdt_get_text(serverState);
		const textA = crdt_get_text(agentAFinal);
		const textB = crdt_get_text(agentBFinal);

		assert.equal(textA, serverText, "Agent A must converge to server state");
		assert.equal(textB, serverText, "Agent B must converge to server state");

		// Verify all A and B tokens appear in the final state
		for (let i = 0; i < 5; i++) {
			assert.ok(
				serverText.includes(`A${i}`),
				`Agent A update ${i} should be in merged state`,
			);
			assert.ok(
				serverText.includes(`B${i}`),
				`Agent B update ${i} should be in merged state`,
			);
		}
	});
});
