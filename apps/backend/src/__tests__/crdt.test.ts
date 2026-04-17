/**
 * CRDT unit and integration tests.
 *
 * T207: Byte-identity tests (Node.js companion to Rust native tests)
 * T209: Two concurrent agents editing same section converge
 *
 * Run with:
 *   node --import tsx/esm --test src/__tests__/crdt.test.ts
 *
 * No live server required — tests the primitives and persistence layer
 * directly using in-memory state.
 *
 * All CRDT operations go through the llmtxt SDK (packages/llmtxt) — no
 * direct yjs imports per SSoT (docs/SSOT.md).
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
	crdt_merge_updates,
	crdt_new_doc,
	crdt_state_vector,
} from "../crdt/primitives.js";

// ── T207: Byte-identity tests ─────────────────────────────────────────────────

describe("CRDT byte-identity tests (T207)", () => {
	it("crdt_new_doc returns non-empty Loro snapshot bytes", () => {
		// NOTE: crdt_new_doc() now returns a Loro snapshot blob (NOT a VersionVector).
		// It has the Loro magic header 0x6c 0x6f 0x72 0x6f ("loro").
		const snap = crdt_new_doc();
		assert.ok(snap.length > 0, "new doc snapshot should not be empty");
	});

	it("crdt_encode_state_as_update is stable across two calls", () => {
		// Build a seed state via SDK helper (no direct yjs import needed)
		const state = crdt_make_state("hello world");

		const update1 = crdt_encode_state_as_update(state);
		const update2 = crdt_encode_state_as_update(state);

		// Content should be identical
		const text1 = crdt_get_text(crdt_apply_update(Buffer.alloc(0), update1));
		const text2 = crdt_get_text(crdt_apply_update(Buffer.alloc(0), update2));
		assert.equal(text1, "hello world");
		assert.equal(text1, text2, "repeated calls must produce identical content");
	});

	it("apply_update(init, merge(U1,U2)) == apply_update(apply_update(init,U1),U2) — associativity", () => {
		// Two independent agents each start from empty and insert their content
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
			`associativity: merged '${textA}' must equal sequential '${textB}'`,
		);
		assert.ok(textA.length > 0, "merged state should be non-empty");
	});

	it("apply_update(init, U) applied twice yields same content — idempotency", () => {
		const update = crdt_make_state("idempotent content");

		const stateOnce = crdt_apply_update(Buffer.alloc(0), update);
		const stateTwice = crdt_apply_update(stateOnce, update);

		const textOnce = crdt_get_text(stateOnce);
		const textTwice = crdt_get_text(stateTwice);

		assert.equal(
			textOnce,
			textTwice,
			`idempotency: '${textOnce}' vs '${textTwice}'`,
		);
		assert.equal(textOnce, "idempotent content");
	});

	it("crdt_state_vector: empty state gives non-empty sv", () => {
		const sv = crdt_state_vector(Buffer.alloc(0));
		assert.ok(sv.length > 0, "empty state vector bytes should be non-empty");
	});

	it("crdt_diff_update: diff from empty sv gives full state", () => {
		const state = crdt_make_state("full content");

		const diff = crdt_diff_update(state, Buffer.alloc(0));
		assert.ok(diff.length > 0, "diff should be non-empty");

		const result = crdt_apply_update(Buffer.alloc(0), diff);
		assert.equal(crdt_get_text(result), "full content");
	});
});

// ── T209: Two concurrent agents converge ─────────────────────────────────────

describe("CRDT two-agent convergence (T209)", () => {
	it("two agents editing same section converge to identical state", () => {
		// Simulate server in-memory state
		let serverState = Buffer.alloc(0);

		// Agent A: build 5 incremental updates (each appends to previous agent state)
		const agentAUpdates: Buffer[] = [];
		let agentAState: Buffer = Buffer.alloc(0);
		for (let i = 0; i < 5; i++) {
			const upd = crdt_make_incremental_update(agentAState, `A${i} `);
			agentAUpdates.push(upd);
			agentAState = crdt_apply_update(agentAState, upd) as Buffer;
		}

		// Agent B: build 5 incremental updates (starting from empty, concurrently)
		const agentBUpdates: Buffer[] = [];
		let agentBState: Buffer = Buffer.alloc(0);
		for (let i = 0; i < 5; i++) {
			const upd = crdt_make_incremental_update(agentBState, `B${i} `);
			agentBUpdates.push(upd);
			agentBState = crdt_apply_update(agentBState, upd) as Buffer;
		}

		// Server applies all 10 updates (simulating ws-crdt.ts handler)
		const allUpdates = [...agentAUpdates, ...agentBUpdates];
		for (const upd of allUpdates) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			serverState = crdt_apply_update(serverState, upd) as any;
		}

		// Agent A reconnects: sends its state vector; server replies with diff
		const svA = crdt_state_vector(agentAState);
		const diffForA = crdt_diff_update(serverState, svA);
		// Apply diff to agent A's local state to simulate client-side merge
		const agentAFinal = crdt_apply_update(agentAState, diffForA);

		// Agent B reconnects: sends its state vector; server replies with diff
		const svB = crdt_state_vector(agentBState);
		const diffForB = crdt_diff_update(serverState, svB);
		const agentBFinal = crdt_apply_update(agentBState, diffForB);

		// Both agents should now have the same text as the server
		const serverText = crdt_get_text(serverState);
		const textA = crdt_get_text(agentAFinal);
		const textB = crdt_get_text(agentBFinal);

		assert.equal(textA, serverText, `Agent A must converge to server state`);
		assert.equal(textB, serverText, `Agent B must converge to server state`);

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

	it("Loro SyncStep1+2 completes convergence in one RTT (simulated)", () => {
		// Server state with known content
		const serverState = crdt_make_state("server initial content");

		// Fresh client (empty) — client sends Loro VersionVector for empty doc (SyncStep1 0x01).
		// NOTE: crdt_new_doc() now returns a Loro snapshot blob, NOT a VersionVector.
		// Use crdt_state_vector(empty) to get the VersionVector of an empty doc.
		const clientVv = crdt_state_vector(Buffer.alloc(0)); // Loro VersionVector bytes
		assert.ok(clientVv.length > 0);

		// SyncStep2: server sends diff (only operations the client is missing)
		const diff = crdt_diff_update(serverState, clientVv);
		assert.ok(diff.length > 0, "diff should be non-empty for fresh client");

		// Client applies diff
		const clientState = crdt_apply_update(Buffer.alloc(0), diff);
		assert.equal(
			crdt_get_text(clientState),
			"server initial content",
			"client should converge after one RTT",
		);
	});

	it("crdt_merge_updates is commutative", () => {
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
});
