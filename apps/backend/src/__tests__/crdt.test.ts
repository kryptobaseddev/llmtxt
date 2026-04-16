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
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  crdt_new_doc,
  crdt_encode_state_as_update,
  crdt_apply_update,
  crdt_merge_updates,
  crdt_state_vector,
  crdt_diff_update,
  crdt_get_text,
} from '../crdt/primitives.js';
import * as Y from 'yjs';

// ── T207: Byte-identity tests ─────────────────────────────────────────────────

describe('CRDT byte-identity tests (T207)', () => {
  it('crdt_new_doc returns non-empty state vector', () => {
    const sv = crdt_new_doc();
    assert.ok(sv.length > 0, 'new doc state vector should not be empty');
  });

  it('crdt_encode_state_as_update is stable across two calls', () => {
    const state = (() => {
      const doc = new Y.Doc();
      const text = doc.getText('content');
      text.insert(0, 'hello world');
      return Buffer.from(Y.encodeStateAsUpdate(doc));
    })();

    const update1 = crdt_encode_state_as_update(state);
    const update2 = crdt_encode_state_as_update(state);

    // Content should be identical
    const text1 = crdt_get_text(crdt_apply_update(Buffer.alloc(0), update1));
    const text2 = crdt_get_text(crdt_apply_update(Buffer.alloc(0), update2));
    assert.equal(text1, 'hello world');
    assert.equal(text1, text2, 'repeated calls must produce identical content');
  });

  it('apply_update(init, merge(U1,U2)) == apply_update(apply_update(init,U1),U2) — associativity', () => {
    const doc1 = new Y.Doc();
    doc1.getText('content').insert(0, 'Hello ');
    const u1 = Buffer.from(Y.encodeStateAsUpdate(doc1));

    const doc2 = new Y.Doc();
    doc2.getText('content').insert(0, 'World');
    const u2 = Buffer.from(Y.encodeStateAsUpdate(doc2));

    const init = Buffer.alloc(0);

    // Path A: apply merged
    const merged = crdt_merge_updates([u1, u2]);
    const stateA = crdt_apply_update(init, merged);
    const textA = crdt_get_text(stateA);

    // Path B: apply sequentially
    const stateB1 = crdt_apply_update(init, u1);
    const stateB2 = crdt_apply_update(stateB1, u2);
    const textB = crdt_get_text(stateB2);

    assert.equal(textA, textB, `associativity: merged '${textA}' must equal sequential '${textB}'`);
    assert.ok(textA.length > 0, 'merged state should be non-empty');
  });

  it('apply_update(init, U) applied twice yields same content — idempotency', () => {
    const doc = new Y.Doc();
    doc.getText('content').insert(0, 'idempotent content');
    const update = Buffer.from(Y.encodeStateAsUpdate(doc));

    const stateOnce = crdt_apply_update(Buffer.alloc(0), update);
    const stateTwice = crdt_apply_update(stateOnce, update);

    const textOnce = crdt_get_text(stateOnce);
    const textTwice = crdt_get_text(stateTwice);

    assert.equal(textOnce, textTwice, `idempotency: '${textOnce}' vs '${textTwice}'`);
    assert.equal(textOnce, 'idempotent content');
  });

  it('crdt_state_vector: empty state gives non-empty sv', () => {
    const sv = crdt_state_vector(Buffer.alloc(0));
    assert.ok(sv.length > 0, 'empty state vector bytes should be non-empty');
  });

  it('crdt_diff_update: diff from empty sv gives full state', () => {
    const doc = new Y.Doc();
    doc.getText('content').insert(0, 'full content');
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));

    const diff = crdt_diff_update(state, Buffer.alloc(0));
    assert.ok(diff.length > 0, 'diff should be non-empty');

    const result = crdt_apply_update(Buffer.alloc(0), diff);
    assert.equal(crdt_get_text(result), 'full content');
  });
});

// ── T209: Two concurrent agents converge ─────────────────────────────────────

describe('CRDT two-agent convergence (T209)', () => {
  it('two agents editing same section converge to identical state', () => {
    // Simulate server in-memory state
    let serverState = Buffer.alloc(0);

    // Agent A sends 5 updates
    const agentAUpdates: Buffer[] = [];
    const docA = new Y.Doc();
    docA.getText('content');
    for (let i = 0; i < 5; i++) {
      const prevSv = Y.encodeStateVector(docA);
      docA.getText('content').insert(docA.getText('content').length, `A${i} `);
      const update = Buffer.from(Y.encodeStateAsUpdate(docA, prevSv));
      agentAUpdates.push(update);
    }

    // Agent B sends 5 updates (concurrently, starting from empty)
    const agentBUpdates: Buffer[] = [];
    const docB = new Y.Doc();
    docB.getText('content');
    for (let i = 0; i < 5; i++) {
      const prevSv = Y.encodeStateVector(docB);
      docB.getText('content').insert(docB.getText('content').length, `B${i} `);
      const update = Buffer.from(Y.encodeStateAsUpdate(docB, prevSv));
      agentBUpdates.push(update);
    }

    // Server applies all 10 updates (simulating ws-crdt.ts handler)
    const allUpdates = [...agentAUpdates, ...agentBUpdates];
    for (const upd of allUpdates) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      serverState = crdt_apply_update(serverState, upd) as any;
    }

    // Agent A reconnects: sends its state vector; server replies with diff
    const svA = crdt_state_vector(Buffer.from(Y.encodeStateAsUpdate(docA)));
    const diffForA = crdt_diff_update(serverState, svA);
    Y.applyUpdate(docA, new Uint8Array(diffForA));

    // Agent B reconnects: sends its state vector; server replies with diff
    const svB = crdt_state_vector(Buffer.from(Y.encodeStateAsUpdate(docB)));
    const diffForB = crdt_diff_update(serverState, svB);
    Y.applyUpdate(docB, new Uint8Array(diffForB));

    // Both agents should now have the same text as the server
    const serverText = crdt_get_text(serverState);
    const textA = docA.getText('content').toString();
    const textB = docB.getText('content').toString();

    assert.equal(textA, serverText, `Agent A must converge to server state`);
    assert.equal(textB, serverText, `Agent B must converge to server state`);

    // Verify all A and B tokens appear in the final state
    for (let i = 0; i < 5; i++) {
      assert.ok(serverText.includes(`A${i}`), `Agent A update ${i} should be in merged state`);
      assert.ok(serverText.includes(`B${i}`), `Agent B update ${i} should be in merged state`);
    }
  });

  it('Yjs sync step 1+2 completes convergence in one RTT (simulated)', () => {
    // Server state with known content
    const serverDoc = new Y.Doc();
    serverDoc.getText('content').insert(0, 'server initial content');
    const serverState = Buffer.from(Y.encodeStateAsUpdate(serverDoc));

    // Fresh client (empty)
    const clientDoc = new Y.Doc();
    clientDoc.getText('content');

    // Sync step 1: client sends SV
    const clientSv = crdt_new_doc(); // empty sv
    assert.ok(clientSv.length > 0);

    // Sync step 2: server sends diff
    const diff = crdt_diff_update(serverState, clientSv);
    assert.ok(diff.length > 0, 'diff should be non-empty for fresh client');

    // Client applies diff
    Y.applyUpdate(clientDoc, new Uint8Array(diff));
    assert.equal(
      clientDoc.getText('content').toString(),
      'server initial content',
      'client should converge after one RTT',
    );
  });

  it('crdt_merge_updates is commutative', () => {
    const docA = new Y.Doc();
    docA.getText('content').insert(0, 'Alpha');
    const uA = Buffer.from(Y.encodeStateAsUpdate(docA));

    const docB = new Y.Doc();
    docB.getText('content').insert(0, 'Beta');
    const uB = Buffer.from(Y.encodeStateAsUpdate(docB));

    const mergedAB = crdt_get_text(crdt_merge_updates([uA, uB]));
    const mergedBA = crdt_get_text(crdt_merge_updates([uB, uA]));

    assert.equal(mergedAB, mergedBA, `commutativity: '${mergedAB}' vs '${mergedBA}'`);
  });
});
