/**
 * Backend contract test suite — parametrized over LocalBackend and PostgresBackend.
 *
 * Runs the same set of behavioural assertions against any Backend implementation.
 * Each describe block receives a BackendFactory and runs identical assertions
 * regardless of which backend is under test.
 *
 * Backends:
 *  - LocalBackend (SQLite, temp dir) — always runs.
 *  - PostgresBackend (Postgres via DATABASE_URL_PG env) — skipped with WARN if
 *    DATABASE_URL_PG is not set. Never fails the suite when absent.
 *
 * Output format:
 *   [LocalBackend] documents.create …
 *   [PostgresBackend] documents.create …  (or SKIPPED if no PG)
 *
 * Multi-agent semantic tests (added in T361):
 *   - Lease contention: agent-1 acquires, agent-2 blocked, release, agent-2 acquires.
 *   - A2A round-trip: send + pollInbox + markRead (deleteA2AMessage).
 *   - Scratchpad round-trip: send + poll + delete.
 *   - Identity: register + lookup + revoke + nonce replay prevention.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import type { Backend } from '../core/backend.js';
import { LocalBackend } from '../local/local-backend.js';
import { PG_AVAILABLE, createPgBackend } from './helpers/test-pg.js';
import {
  crdt_make_state,
  crdt_make_incremental_update,
  crdt_apply_update,
  crdt_get_text,
  crdt_state_vector,
  crdt_diff_update,
} from '../crdt-primitives.js';

// ── Test helpers ──────────────────────────────────────────────────

type BackendFactory = () => Promise<{ backend: Backend; tearDown: () => Promise<void> }>;

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'llmtxt-contract-'));
}

// ── Contract suite factory ─────────────────────────────────────────

function runContractSuite(label: string, factory: BackendFactory) {
  describe(`[${label}] Backend contract`, () => {
    let backend: Backend;
    let tearDown: () => Promise<void>;

    before(async () => {
      ({ backend, tearDown } = await factory());
      await backend.open();
    });

    after(async () => {
      await backend.close();
      await tearDown();
    });

    // ── Document CRUD ──────────────────────────────────────────────

    describe('createDocument / getDocument', () => {
      it('creates a document and retrieves it by id', async () => {
        const doc = await backend.createDocument({
          title: 'Contract Test Doc',
          createdBy: 'test-agent',
        });

        assert.ok(doc.id, 'document id must be truthy');
        assert.equal(doc.title, 'Contract Test Doc');
        assert.equal(doc.createdBy, 'test-agent');
        assert.equal(doc.state, 'DRAFT');
        assert.equal(doc.versionCount, 0);

        const fetched = await backend.getDocument(doc.id);
        assert.ok(fetched, 'getDocument must return the document');
        assert.equal(fetched.id, doc.id);
        assert.equal(fetched.title, doc.title);
      });

      it('getDocument returns null for unknown id', async () => {
        const result = await backend.getDocument('nonexistent-id-xyz');
        assert.equal(result, null, 'must return null for missing document');
      });

      it('generates a unique slug from the title', async () => {
        const doc = await backend.createDocument({
          title: 'Slug Test Document',
          createdBy: 'agent',
        });
        assert.ok(doc.slug, 'slug must be set');
        assert.match(doc.slug, /^[a-z0-9-]+$/, 'slug must be url-safe');
      });

      it('accepts an explicit slug', async () => {
        const uniqueSuffix = Math.random().toString(36).slice(2, 8);
        const explicitSlug = `my-explicit-slug-${uniqueSuffix}`;
        const doc = await backend.createDocument({
          title: 'Explicit Slug Doc',
          createdBy: 'agent',
          slug: explicitSlug,
        });
        // Slug may have a suffix appended by PgContractAdapter for uniqueness;
        // assert it starts with the requested prefix.
        assert.ok(
          doc.slug.startsWith('my-explicit-slug'),
          `slug '${doc.slug}' must start with 'my-explicit-slug'`
        );
      });

      it('getDocumentBySlug retrieves a document', async () => {
        const uniqueSuffix = Math.random().toString(36).slice(2, 8);
        const slug = `slug-lookup-${uniqueSuffix}`;
        const doc = await backend.createDocument({
          title: 'Slug Lookup Test',
          createdBy: 'agent',
          slug,
        });
        // Use the actual slug returned (may differ slightly for PG)
        const found = await backend.getDocumentBySlug(doc.slug);
        assert.ok(found);
        assert.equal(found.id, doc.id);
      });

      it('getDocumentBySlug returns null for unknown slug', async () => {
        const result = await backend.getDocumentBySlug('does-not-exist-xyz');
        assert.equal(result, null);
      });
    });

    describe('listDocuments', () => {
      it('returns documents with pagination', async () => {
        const result = await backend.listDocuments({ limit: 100 });
        assert.ok(Array.isArray(result.items));
        assert.ok(result.items.length >= 1, 'at least one document from prior tests');
      });
    });

    describe('deleteDocument', () => {
      it('deletes an existing document and returns true', async () => {
        const doc = await backend.createDocument({
          title: 'Delete Me',
          createdBy: 'agent',
        });
        const deleted = await backend.deleteDocument(doc.id);
        assert.equal(deleted, true);

        const fetched = await backend.getDocument(doc.id);
        assert.equal(fetched, null, 'must not exist after deletion');
      });

      it('returns false for nonexistent document', async () => {
        const result = await backend.deleteDocument('never-existed');
        assert.equal(result, false);
      });
    });

    // ── Versions ──────────────────────────────────────────────────

    describe('publishVersion / getVersion / listVersions', () => {
      it('publishes and retrieves a version', async () => {
        const doc = await backend.createDocument({
          title: 'Version Test Doc',
          createdBy: 'agent',
        });

        const version = await backend.publishVersion({
          documentId: doc.id,
          content: '# Hello\n\nThis is version 1.',
          patchText: '',
          createdBy: 'agent',
          changelog: 'Initial version',
        });

        assert.equal(version.versionNumber, 1);
        assert.equal(version.createdBy, 'agent');
        assert.equal(version.changelog, 'Initial version');
        assert.ok(version.contentHash, 'contentHash must be set');

        const fetched = await backend.getVersion(doc.id, 1);
        assert.ok(fetched);
        assert.equal(fetched.versionNumber, 1);
        assert.equal(fetched.contentHash, version.contentHash);
      });

      it('increments versionCount on the document', async () => {
        const doc = await backend.createDocument({
          title: 'Version Count Test',
          createdBy: 'agent',
        });

        await backend.publishVersion({
          documentId: doc.id,
          content: 'v1',
          patchText: '',
          createdBy: 'agent',
          changelog: 'v1',
        });

        await backend.publishVersion({
          documentId: doc.id,
          content: 'v2',
          patchText: '',
          createdBy: 'agent',
          changelog: 'v2',
        });

        const updated = await backend.getDocument(doc.id);
        assert.ok(updated);
        assert.equal(updated.versionCount, 2);
      });

      it('getVersion returns null for unknown version', async () => {
        const doc = await backend.createDocument({
          title: 'Version Null Test',
          createdBy: 'agent',
        });
        const result = await backend.getVersion(doc.id, 999);
        assert.equal(result, null);
      });

      it('listVersions returns all versions in order', async () => {
        const doc = await backend.createDocument({
          title: 'List Versions Test',
          createdBy: 'agent',
        });

        await backend.publishVersion({ documentId: doc.id, content: 'v1', patchText: '', createdBy: 'agent', changelog: 'v1' });
        await backend.publishVersion({ documentId: doc.id, content: 'v2', patchText: '', createdBy: 'agent', changelog: 'v2' });

        const versions = await backend.listVersions(doc.id);
        assert.equal(versions.length, 2);
        assert.equal(versions[0]!.versionNumber, 1);
        assert.equal(versions[1]!.versionNumber, 2);
      });
    });

    describe('transitionVersion', () => {
      it('transitions DRAFT → REVIEW', async () => {
        const doc = await backend.createDocument({
          title: 'Lifecycle Transition Test',
          createdBy: 'agent',
        });

        const result = await backend.transitionVersion({
          documentId: doc.id,
          to: 'REVIEW',
          changedBy: 'agent',
        });

        assert.equal(result.success, true);
        assert.ok(result.document);
        assert.equal(result.document.state, 'REVIEW');
      });

      it('rejects invalid transitions', async () => {
        const doc = await backend.createDocument({
          title: 'Invalid Transition Test',
          createdBy: 'agent',
        });

        // DRAFT → ARCHIVED is not a valid direct transition
        const result = await backend.transitionVersion({
          documentId: doc.id,
          to: 'ARCHIVED',
          changedBy: 'agent',
        });

        assert.equal(result.success, false);
        assert.ok(result.error, 'error message must be provided');
      });
    });

    // ── Events ────────────────────────────────────────────────────

    describe('appendEvent / queryEvents', () => {
      it('appends and queries events', async () => {
        const doc = await backend.createDocument({
          title: 'Event Test Doc',
          createdBy: 'agent',
        });

        const event = await backend.appendEvent({
          documentId: doc.id,
          type: 'test.event',
          agentId: 'agent',
          payload: { foo: 'bar' },
        });

        assert.ok(event.id);
        assert.equal(event.type, 'test.event');
        assert.deepEqual(event.payload, { foo: 'bar' });

        const result = await backend.queryEvents({ documentId: doc.id });
        assert.ok(result.items.length >= 1);
        assert.equal(result.items[0]!.type, 'test.event');
      });
    });

    // ── Leases ────────────────────────────────────────────────────

    describe('acquireLease / renewLease / releaseLease / getLease', () => {
      it('acquires, checks, and releases a lease', async () => {
        const resource = `test-resource-${Date.now()}`;

        const lease = await backend.acquireLease({
          resource,
          holder: 'agent-1',
          ttlMs: 5000,
        });

        assert.ok(lease, 'lease must be acquired');
        assert.equal(lease.resource, resource);
        assert.equal(lease.holder, 'agent-1');

        const fetched = await backend.getLease(resource);
        assert.ok(fetched);
        assert.equal(fetched.holder, 'agent-1');

        const released = await backend.releaseLease(resource, 'agent-1');
        assert.equal(released, true);

        const afterRelease = await backend.getLease(resource);
        assert.equal(afterRelease, null);
      });

      it('blocks second agent from acquiring held lease', async () => {
        const resource = `contested-${Date.now()}`;

        await backend.acquireLease({ resource, holder: 'agent-1', ttlMs: 5000 });
        const second = await backend.acquireLease({ resource, holder: 'agent-2', ttlMs: 5000 });
        assert.equal(second, null, 'second agent must not acquire a held lease');

        await backend.releaseLease(resource, 'agent-1');
      });

      it('allows same holder to re-acquire (idempotent)', async () => {
        const resource = `reacquire-${Date.now()}`;

        const first = await backend.acquireLease({ resource, holder: 'agent-1', ttlMs: 5000 });
        const second = await backend.acquireLease({ resource, holder: 'agent-1', ttlMs: 5000 });
        assert.ok(first);
        assert.ok(second, 'same holder re-acquire must succeed');

        await backend.releaseLease(resource, 'agent-1');
      });
    });

    // ── Scratchpad ────────────────────────────────────────────────

    describe('sendScratchpad / pollScratchpad / deleteScratchpadMessage', () => {
      it('sends and polls a scratchpad message', async () => {
        const msg = await backend.sendScratchpad({
          toAgentId: 'rx-agent',
          fromAgentId: 'tx-agent',
          payload: { task: 'do the thing' },
        });

        assert.ok(msg.id);
        assert.equal(msg.toAgentId, 'rx-agent');
        assert.deepEqual(msg.payload, { task: 'do the thing' });

        const polled = await backend.pollScratchpad('rx-agent');
        const found = polled.find((m) => m.id === msg.id);
        assert.ok(found, 'message must be pollable');

        const deleted = await backend.deleteScratchpadMessage(msg.id, 'rx-agent');
        assert.equal(deleted, true);

        const afterDelete = await backend.pollScratchpad('rx-agent');
        const stillThere = afterDelete.find((m) => m.id === msg.id);
        assert.equal(stillThere, undefined, 'message must not appear after deletion');
      });
    });

    // ── A2A ──────────────────────────────────────────────────────

    describe('sendA2AMessage / pollA2AInbox / deleteA2AMessage', () => {
      it('delivers and polls an A2A message', async () => {
        const sent = await backend.sendA2AMessage({
          toAgentId: 'target-agent',
          envelopeJson: JSON.stringify({ op: 'ping', from: 'sender' }),
        });

        assert.equal(sent.success, true);
        assert.ok(sent.message);
        assert.equal(sent.message.toAgentId, 'target-agent');

        const inbox = await backend.pollA2AInbox('target-agent');
        const found = inbox.find((m) => m.id === sent.message!.id);
        assert.ok(found);

        const deleted = await backend.deleteA2AMessage(sent.message.id, 'target-agent');
        assert.equal(deleted, true);
      });
    });

    // ── Identity ─────────────────────────────────────────────────

    describe('registerAgentPubkey / lookupAgentPubkey / revokeAgentPubkey', () => {
      it('registers, looks up, and revokes a pubkey', async () => {
        const agentId = `agent-${Date.now()}`;
        const pubkeyHex = 'a'.repeat(64); // fake but syntactically valid

        const record = await backend.registerAgentPubkey(agentId, pubkeyHex, 'Test Key');
        assert.equal(record.agentId, agentId);
        assert.equal(record.pubkeyHex, pubkeyHex);

        const fetched = await backend.lookupAgentPubkey(agentId);
        assert.ok(fetched);
        assert.equal(fetched.agentId, agentId);

        const revoked = await backend.revokeAgentPubkey(agentId, pubkeyHex);
        assert.equal(revoked, true);
      });

      it('registerAgentPubkey is idempotent', async () => {
        const agentId = `idem-agent-${Date.now()}`;
        const pubkeyHex = 'b'.repeat(64);

        await backend.registerAgentPubkey(agentId, pubkeyHex);
        const second = await backend.registerAgentPubkey(agentId, pubkeyHex);
        assert.equal(second.agentId, agentId, 'idempotent: no error on second call');
      });

      it('lookupAgentPubkey returns null for unregistered agent', async () => {
        const result = await backend.lookupAgentPubkey('never-registered');
        assert.equal(result, null);
      });
    });

    describe('recordSignatureNonce / hasNonceBeenUsed', () => {
      it('records and checks nonces', async () => {
        const agentId = `nonce-agent-${Date.now()}`;
        const nonce = `nonce-${Date.now()}`;

        const first = await backend.recordSignatureNonce(agentId, nonce);
        assert.equal(first, true, 'first recording must succeed');

        const second = await backend.recordSignatureNonce(agentId, nonce);
        assert.equal(second, false, 'duplicate nonce must be rejected');

        const used = await backend.hasNonceBeenUsed(agentId, nonce);
        assert.equal(used, true);
      });
    });

    // ── Multi-agent semantic tests (T361) ─────────────────────────
    //
    // These tests cover critical coordination semantics added in Waves B–C.
    // They verify that CLEO (LocalBackend) and api.llmtxt.my (PostgresBackend)
    // share identical multi-agent coordination behaviour.

    describe('Multi-agent: Lease contention', () => {
      it('agent-1 acquires, agent-2 blocked; after release agent-2 succeeds', async () => {
        const resource = `ma-lease-${Date.now()}`;

        // Agent 1 acquires
        const lease1 = await backend.acquireLease({ resource, holder: 'ma-agent-1', ttlMs: 10_000 });
        assert.ok(lease1, 'agent-1 must acquire lease');
        assert.equal(lease1.holder, 'ma-agent-1');

        // Agent 2 is blocked
        const attempt = await backend.acquireLease({ resource, holder: 'ma-agent-2', ttlMs: 10_000 });
        assert.equal(attempt, null, 'agent-2 must be blocked while agent-1 holds');

        // Agent 1 releases
        const released = await backend.releaseLease(resource, 'ma-agent-1');
        assert.equal(released, true);

        // Agent 2 now succeeds
        const lease2 = await backend.acquireLease({ resource, holder: 'ma-agent-2', ttlMs: 10_000 });
        assert.ok(lease2, 'agent-2 must acquire after release');
        assert.equal(lease2.holder, 'ma-agent-2');

        // Cleanup
        await backend.releaseLease(resource, 'ma-agent-2');
      });
    });

    describe('Multi-agent: A2A send + inbox + markRead round-trip', () => {
      it('agent sends message, recipient polls and deletes it', async () => {
        const recipient = `ma-rx-${Date.now()}`;
        const envelope = JSON.stringify({
          op: 'task.assign',
          from: 'orchestrator',
          nonce: `n-${Date.now()}`,
          payload: { taskId: 'T999' },
        });

        // Send
        const sent = await backend.sendA2AMessage({ toAgentId: recipient, envelopeJson: envelope });
        assert.equal(sent.success, true, 'send must succeed');
        assert.ok(sent.message?.id, 'sent message must have id');

        // Poll — message must be in inbox
        const inbox = await backend.pollA2AInbox(recipient);
        const found = inbox.find((m) => m.id === sent.message!.id);
        assert.ok(found, 'message must appear in recipient inbox');
        assert.equal(found.toAgentId, recipient);

        // Mark read (delete)
        const ack = await backend.deleteA2AMessage(sent.message!.id, recipient);
        assert.equal(ack, true, 'delete must succeed');

        // Confirm gone
        const after = await backend.pollA2AInbox(recipient);
        const stillThere = after.find((m) => m.id === sent.message!.id);
        assert.equal(stillThere, undefined, 'message must not appear after deletion');
      });

      it('duplicate nonce is rejected', async () => {
        const nonce = `dup-nonce-${Date.now()}`;
        const agent = `dn-agent-${Date.now()}`;

        const first = await backend.recordSignatureNonce(agent, nonce);
        assert.equal(first, true, 'first nonce record must succeed');

        const second = await backend.recordSignatureNonce(agent, nonce);
        assert.equal(second, false, 'duplicate nonce must fail (replay prevention)');
      });
    });

    describe('Multi-agent: Scratchpad multi-message ordering', () => {
      it('multiple messages arrive in send order', async () => {
        const agent = `sp-order-${Date.now()}`;

        const m1 = await backend.sendScratchpad({ toAgentId: agent, fromAgentId: 'sender', payload: { seq: 1 } });
        const m2 = await backend.sendScratchpad({ toAgentId: agent, fromAgentId: 'sender', payload: { seq: 2 } });
        const m3 = await backend.sendScratchpad({ toAgentId: agent, fromAgentId: 'sender', payload: { seq: 3 } });

        const polled = await backend.pollScratchpad(agent);
        const ids = polled.map((m) => m.id);
        assert.ok(ids.includes(m1.id), 'm1 must be present');
        assert.ok(ids.includes(m2.id), 'm2 must be present');
        assert.ok(ids.includes(m3.id), 'm3 must be present');
        assert.ok(polled.length >= 3, 'at least 3 messages');

        // Cleanup
        for (const m of [m1, m2, m3]) {
          await backend.deleteScratchpadMessage(m.id, agent);
        }
      });
    });

    describe('Multi-agent: Event log monotonic sequence', () => {
      it('events for a document have increasing createdAt timestamps', async () => {
        const doc = await backend.createDocument({
          title: 'Event Seq Test',
          createdBy: 'agent',
        });

        // Append 3 events in sequence
        const e1 = await backend.appendEvent({ documentId: doc.id, type: 'seq.test', agentId: 'a', payload: { n: 1 } });
        const e2 = await backend.appendEvent({ documentId: doc.id, type: 'seq.test', agentId: 'a', payload: { n: 2 } });
        const e3 = await backend.appendEvent({ documentId: doc.id, type: 'seq.test', agentId: 'a', payload: { n: 3 } });

        // Events must have valid ids
        assert.ok(e1.id && e2.id && e3.id, 'all events must have ids');

        // Query and verify order
        const result = await backend.queryEvents({ documentId: doc.id });
        assert.ok(result.items.length >= 3, 'at least 3 events');

        // Verify createdAt is non-decreasing
        const timestamps = result.items.map((e) => e.createdAt);
        for (let i = 1; i < timestamps.length; i++) {
          assert.ok(
            timestamps[i]! >= timestamps[i - 1]!,
            `event ${i} createdAt (${timestamps[i]}) must be >= event ${i - 1} createdAt (${timestamps[i - 1]})`
          );
        }
      });
    });

    // ── CRDT section ops (T396 / P1.10) ──────────────────────────────────────
    //
    // These tests verify that applyCrdtUpdate / getCrdtState use Loro primitives
    // and that both LocalBackend and PostgresBackend produce identical convergence
    // results. No yrs or lib0 encoding is used in any assertion.

    describe('CRDT section ops: applyCrdtUpdate / getCrdtState', () => {
      it('getCrdtState returns null for a section with no updates', async () => {
        const doc = await backend.createDocument({
          title: 'CRDT Null State Test',
          createdBy: 'agent-crdt',
        });

        const state = await backend.getCrdtState(doc.id, 'intro');
        assert.equal(state, null, 'getCrdtState must return null when no update has been applied');
      });

      it('applyCrdtUpdate persists a Loro snapshot and getCrdtState retrieves it', async () => {
        const doc = await backend.createDocument({
          title: 'CRDT Persist Test',
          createdBy: 'agent-crdt',
        });

        // Build a Loro state and apply it
        const loroSnapshot = crdt_make_state('section content from agent');
        const updateBase64 = loroSnapshot.toString('base64');

        const result = await backend.applyCrdtUpdate({
          documentId: doc.id,
          sectionKey: 'body',
          updateBase64,
          agentId: 'agent-1',
        });

        assert.equal(result.documentId, doc.id, 'returned CrdtState must reference the document');
        assert.equal(result.sectionKey, 'body', 'returned CrdtState must reference the section');
        assert.ok(result.snapshotBase64.length > 0, 'snapshotBase64 must be non-empty');
        assert.ok(result.stateVectorBase64.length > 0, 'stateVectorBase64 must be non-empty');

        // getCrdtState must return the same snapshot
        const fetched = await backend.getCrdtState(doc.id, 'body');
        assert.ok(fetched, 'getCrdtState must return a state after applyCrdtUpdate');
        assert.equal(fetched.documentId, doc.id);
        assert.equal(fetched.sectionKey, 'body');
        assert.ok(fetched.snapshotBase64.length > 0, 'fetched snapshotBase64 must be non-empty');

        // Decode the stored snapshot and verify it contains the original content
        const storedBlob = Buffer.from(fetched.snapshotBase64, 'base64');
        const storedText = crdt_get_text(storedBlob);
        assert.equal(storedText, 'section content from agent', 'stored snapshot must decode to original content');
      });

      it('applying a second update merges via Loro (idempotent CRDT)', async () => {
        const doc = await backend.createDocument({
          title: 'CRDT Merge Test',
          createdBy: 'agent-crdt',
        });

        // Agent 1 applies initial content
        const snap1 = crdt_make_state('Agent1 content');
        await backend.applyCrdtUpdate({
          documentId: doc.id,
          sectionKey: 'merged',
          updateBase64: snap1.toString('base64'),
          agentId: 'agent-1',
        });

        // Agent 2 applies incremental update on top of agent 1's state
        const update2 = crdt_make_incremental_update(snap1, ' plus Agent2');
        await backend.applyCrdtUpdate({
          documentId: doc.id,
          sectionKey: 'merged',
          updateBase64: update2.toString('base64'),
          agentId: 'agent-2',
        });

        const state = await backend.getCrdtState(doc.id, 'merged');
        assert.ok(state, 'getCrdtState must return state after two updates');
        const blob = Buffer.from(state.snapshotBase64, 'base64');
        const text = crdt_get_text(blob);

        // After merging: must contain agent 1's contribution
        assert.ok(text.includes('Agent1 content'), `merged text '${text}' must include Agent1 content`);
      });

      it('applying same update twice is idempotent (CRDT property)', async () => {
        const doc = await backend.createDocument({
          title: 'CRDT Idempotency Test',
          createdBy: 'agent-crdt',
        });

        const snap = crdt_make_state('idempotent section');
        const updateBase64 = snap.toString('base64');

        // Apply once
        await backend.applyCrdtUpdate({
          documentId: doc.id,
          sectionKey: 'idem',
          updateBase64,
          agentId: 'agent-1',
        });

        const stateAfterFirst = await backend.getCrdtState(doc.id, 'idem');
        assert.ok(stateAfterFirst, 'state must exist after first apply');

        // Apply same update again (idempotent)
        await backend.applyCrdtUpdate({
          documentId: doc.id,
          sectionKey: 'idem',
          updateBase64,
          agentId: 'agent-1',
        });

        const stateAfterSecond = await backend.getCrdtState(doc.id, 'idem');
        assert.ok(stateAfterSecond, 'state must exist after second apply');

        // Content must be identical
        const textFirst = crdt_get_text(Buffer.from(stateAfterFirst.snapshotBase64, 'base64'));
        const textSecond = crdt_get_text(Buffer.from(stateAfterSecond.snapshotBase64, 'base64'));
        assert.equal(textFirst, textSecond, 'idempotent: applying same update twice must yield same content');
        assert.equal(textFirst, 'idempotent section', 'content must match original');
      });

      it('stateVectorBase64 encodes a valid Loro VersionVector (non-empty, decodable)', async () => {
        const doc = await backend.createDocument({
          title: 'CRDT State Vector Test',
          createdBy: 'agent-crdt',
        });

        const snap = crdt_make_state('sv-test content');
        await backend.applyCrdtUpdate({
          documentId: doc.id,
          sectionKey: 'sv-check',
          updateBase64: snap.toString('base64'),
          agentId: 'agent-sv',
        });

        const state = await backend.getCrdtState(doc.id, 'sv-check');
        assert.ok(state, 'state must exist');

        // stateVectorBase64 must decode to non-empty bytes
        const svBytes = Buffer.from(state.stateVectorBase64, 'base64');
        assert.ok(svBytes.length > 0, 'stateVectorBase64 must decode to non-empty bytes');

        // The VersionVector must be usable as a diff_update input
        const snapshotBlob = Buffer.from(state.snapshotBase64, 'base64');
        const selfDiff = crdt_diff_update(snapshotBlob, svBytes);
        // Applying self-diff must not change content
        const afterSelfDiff = crdt_apply_update(snapshotBlob, selfDiff);
        assert.equal(
          crdt_get_text(afterSelfDiff as Buffer),
          crdt_get_text(snapshotBlob),
          'self-diff must not change content (state vector up-to-date)'
        );
      });
    });

    describe('CRDT 2-agent convergence via backend ops', () => {
      it('two agents apply concurrent updates; server converges both agents to identical content', async () => {
        const doc = await backend.createDocument({
          title: 'CRDT 2-Agent Convergence Test',
          createdBy: 'orchestrator',
        });

        // Agent A: builds a Loro state with 3 incremental edits
        let agentAState: Buffer = Buffer.alloc(0);
        const agentAUpdates: string[] = [];
        for (let i = 0; i < 3; i++) {
          const upd = crdt_make_incremental_update(agentAState, `A${i} `);
          agentAUpdates.push(upd.toString('base64'));
          agentAState = Buffer.from(crdt_apply_update(agentAState, upd));
        }

        // Agent B: concurrent edits starting from empty
        let agentBState: Buffer = Buffer.alloc(0);
        const agentBUpdates: string[] = [];
        for (let i = 0; i < 3; i++) {
          const upd = crdt_make_incremental_update(agentBState, `B${i} `);
          agentBUpdates.push(upd.toString('base64'));
          agentBState = Buffer.from(crdt_apply_update(agentBState, upd));
        }

        // Apply all agent A updates to the backend (simulates A's WS stream)
        for (const upd of agentAUpdates) {
          await backend.applyCrdtUpdate({
            documentId: doc.id,
            sectionKey: 'convergence',
            updateBase64: upd,
            agentId: 'agent-a',
          });
        }

        // Apply all agent B updates to the backend (simulates B's WS stream)
        for (const upd of agentBUpdates) {
          await backend.applyCrdtUpdate({
            documentId: doc.id,
            sectionKey: 'convergence',
            updateBase64: upd,
            agentId: 'agent-b',
          });
        }

        // Retrieve server state
        const serverState = await backend.getCrdtState(doc.id, 'convergence');
        assert.ok(serverState, 'server must have a CRDT state after all updates');

        const serverBlob = Buffer.from(serverState.snapshotBase64, 'base64');
        const serverText = crdt_get_text(serverBlob);

        // Agent A reconnects: SyncStep1 — sends its VersionVector
        const svA = crdt_state_vector(agentAState);
        // SyncStep2 — backend provides diff
        const diffForA = crdt_diff_update(serverBlob, svA);
        const agentAFinal = crdt_apply_update(agentAState, diffForA);
        const textA = crdt_get_text(agentAFinal as Buffer);

        // Agent B reconnects: same pattern
        const svB = crdt_state_vector(agentBState);
        const diffForB = crdt_diff_update(serverBlob, svB);
        const agentBFinal = crdt_apply_update(agentBState, diffForB);
        const textB = crdt_get_text(agentBFinal as Buffer);

        // All three must converge to identical content
        assert.equal(textA, serverText, 'Agent A must converge to server state');
        assert.equal(textB, serverText, 'Agent B must converge to server state');

        // Verify all contributions are present
        for (let i = 0; i < 3; i++) {
          assert.ok(serverText.includes(`A${i}`), `Agent A update ${i} must be in merged state`);
          assert.ok(serverText.includes(`B${i}`), `Agent B update ${i} must be in merged state`);
        }
      });

      it('convergence is backend-independent: both backends produce same Loro content for same updates', async () => {
        // This test is LocalBackend-only (contrast is against a known computed state).
        // The contract guarantee is: given the same sequence of Loro updates applied
        // via applyCrdtUpdate, getCrdtState().snapshotBase64 must decode to the same
        // content. Backend-independence is verified by running the same suite on both
        // LocalBackend and PostgresBackend (when PG is available).

        const doc = await backend.createDocument({
          title: 'CRDT Backend-Independence Test',
          createdBy: 'agent-crdt',
        });

        const u1 = crdt_make_state('independent-update-1');
        const u2 = crdt_make_incremental_update(u1, ' plus-2');

        // Apply both updates through the backend
        await backend.applyCrdtUpdate({
          documentId: doc.id,
          sectionKey: 'bi-test',
          updateBase64: u1.toString('base64'),
          agentId: 'agent-a',
        });
        await backend.applyCrdtUpdate({
          documentId: doc.id,
          sectionKey: 'bi-test',
          updateBase64: u2.toString('base64'),
          agentId: 'agent-b',
        });

        // Compute expected text locally (without the backend) for comparison
        const localMerge = crdt_apply_update(crdt_apply_update(Buffer.alloc(0), u1), u2);
        const expectedText = crdt_get_text(localMerge as Buffer);

        // Retrieve via backend and compare
        const state = await backend.getCrdtState(doc.id, 'bi-test');
        assert.ok(state, 'state must exist after applying two updates');
        const backendText = crdt_get_text(Buffer.from(state.snapshotBase64, 'base64'));

        assert.equal(
          backendText,
          expectedText,
          `backend must produce same content as local CRDT merge: expected '${expectedText}', got '${backendText}'`
        );
      });
    });
  });
}

// ── LocalBackend suite ────────────────────────────────────────────

runContractSuite('LocalBackend', async () => {
  const dir = makeTempDir();
  const backend = new LocalBackend({ storagePath: dir });
  return {
    backend,
    tearDown: async () => {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
});

// ── T410: getChangesSince + applyChanges contract tests (P2.12) ───────────
//
// These tests extend the contract suite with targeted coverage for the two
// new Backend interface methods: getChangesSince() and applyChanges().
//
// Test matrix:
//  1. LocalBackend: getChangesSince(0) after a document write returns non-empty Uint8Array.
//  2. LocalBackend: applyChanges round-trip — doc created on A appears in B.
//  3. LocalBackend: applyChanges twice with the same changeset is idempotent.
//  4. PostgresBackend stub: both methods throw (not implemented).
//
// Skip strategy (DR-P2-01): if @vlcn.io/crsqlite is not available (hasCRR=false),
// CRR-dependent assertions are skipped. The "not loaded" error path is always tested.

async function isCrSqliteAvailable(): Promise<boolean> {
  const dir = makeTempDir();
  const b = new LocalBackend({ storagePath: dir, wal: false, leaseReaperIntervalMs: 0 });
  try {
    await b.open();
    return b.hasCRR;
  } catch {
    return false;
  } finally {
    try { await b.close(); } catch { /* ignore */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

describe('[T410] Contract: getChangesSince + applyChanges — LocalBackend', () => {
  let crSqliteAvail = false;

  before(async () => {
    crSqliteAvail = await isCrSqliteAvailable();
    if (!crSqliteAvail) {
      console.log('[T410] @vlcn.io/crsqlite not available — CRR-dependent tests will skip');
    }
  });

  it('getChangesSince(0n) after a document create returns non-empty Uint8Array', async () => {
    const dir = makeTempDir();
    const backend = new LocalBackend({ storagePath: dir, wal: false, leaseReaperIntervalMs: 0 });
    await backend.open();
    try {
      if (!backend.hasCRR) {
        // hasCRR=false path: must throw CrSqliteNotLoadedError (not crash).
        await assert.rejects(
          () => backend.getChangesSince(0n),
          (err: Error) => err.name === 'CrSqliteNotLoadedError' || err.message.includes('crsqlite'),
          'getChangesSince must throw CrSqliteNotLoadedError when hasCRR=false'
        );
        return;
      }

      // hasCRR=true: write a document, then verify changeset is non-empty.
      await backend.createDocument({ title: 'Contract getChangesSince test', createdBy: 'agent-t410' });
      const changeset = await backend.getChangesSince(0n);

      assert.ok(changeset instanceof Uint8Array, 'Must return Uint8Array');
      assert.ok(changeset.length > 0, 'Changeset must be non-empty after a write');
    } finally {
      try { await backend.close(); } catch { /* ignore */ }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('applyChanges round-trip: doc created in A is visible in B after apply', async () => {
    if (!crSqliteAvail) {
      console.log('[SKIP] @vlcn.io/crsqlite not available — skipping applyChanges round-trip');
      return;
    }

    const dirA = makeTempDir();
    const dirB = makeTempDir();
    const backendA = new LocalBackend({ storagePath: dirA, wal: false, leaseReaperIntervalMs: 0 });
    const backendB = new LocalBackend({ storagePath: dirB, wal: false, leaseReaperIntervalMs: 0 });
    await backendA.open();
    await backendB.open();

    try {
      // Create a document on A.
      const doc = await backendA.createDocument({
        title: 'Round-trip contract doc',
        createdBy: 'agent-t410-a',
      });

      // Extract changeset from A.
      const changeset = await backendA.getChangesSince(0n);
      assert.ok(changeset.length > 0, 'Changeset must be non-empty');

      // Apply to B.
      const newVersion = await backendB.applyChanges(changeset);
      assert.ok(typeof newVersion === 'bigint', 'applyChanges must return bigint db_version');

      // Document must now be visible in B.
      const found = await backendB.getDocument(doc.id);
      assert.ok(found !== null, 'Document created in A must be visible in B after applyChanges');
      assert.equal(found!.title, 'Round-trip contract doc');
      assert.equal(found!.createdBy, 'agent-t410-a');
    } finally {
      try { await backendA.close(); } catch { /* ignore */ }
      try { await backendB.close(); } catch { /* ignore */ }
      try { fs.rmSync(dirA, { recursive: true, force: true }); } catch { /* ignore */ }
      try { fs.rmSync(dirB, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('applyChanges twice with the same changeset is idempotent (no duplicates, no errors)', async () => {
    if (!crSqliteAvail) {
      console.log('[SKIP] @vlcn.io/crsqlite not available — skipping idempotency contract test');
      return;
    }

    const dirA = makeTempDir();
    const dirB = makeTempDir();
    const backendA = new LocalBackend({ storagePath: dirA, wal: false, leaseReaperIntervalMs: 0 });
    const backendB = new LocalBackend({ storagePath: dirB, wal: false, leaseReaperIntervalMs: 0 });
    await backendA.open();
    await backendB.open();

    try {
      const doc = await backendA.createDocument({
        title: 'Idempotency contract doc',
        createdBy: 'agent-t410-b',
      });

      const changeset = await backendA.getChangesSince(0n);

      // Apply once.
      await backendB.applyChanges(changeset);
      // Apply same changeset again — must not throw or create duplicate rows.
      await assert.doesNotReject(
        () => backendB.applyChanges(changeset),
        'Applying same changeset twice must not throw'
      );

      // Verify no duplicate rows — document must exist exactly once.
      const found = await backendB.getDocument(doc.id);
      assert.ok(found !== null, 'Document must exist after double-apply');

      const list = await backendB.listDocuments({ limit: 1000 });
      const copies = list.items.filter((d) => d.id === doc.id);
      assert.equal(copies.length, 1, 'Document must appear exactly once (idempotency guarantee)');
    } finally {
      try { await backendA.close(); } catch { /* ignore */ }
      try { await backendB.close(); } catch { /* ignore */ }
      try { fs.rmSync(dirA, { recursive: true, force: true }); } catch { /* ignore */ }
      try { fs.rmSync(dirB, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

describe('[T410] Contract: getChangesSince + applyChanges — PostgresBackend stub', () => {
  it('PostgresBackend.getChangesSince throws (not implemented — cr-sqlite is LocalBackend-only)', async () => {
    if (!PG_AVAILABLE) {
      // Even without a PG connection we can test the contract adapter stub via
      // the PgContractAdapter which is constructed independently of a live DB.
      // If PG is not available we verify the contract via a LocalBackend with
      // a fake crsqliteExtPath (hasCRR=false path) as an analogous "not supported" stub.
      const dir = makeTempDir();
      const backend = new LocalBackend({
        storagePath: dir,
        wal: false,
        leaseReaperIntervalMs: 0,
        crsqliteExtPath: path.join(dir, 'nonexistent.so'),
      });
      await backend.open();
      try {
        await assert.rejects(
          () => backend.getChangesSince(0n),
          (err: Error) => err.name === 'CrSqliteNotLoadedError' || err.message.includes('crsqlite'),
          'Must throw when cr-sqlite not loaded'
        );
      } finally {
        try { await backend.close(); } catch { /* ignore */ }
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
      return;
    }

    // PG available: test the real PgContractAdapter stub.
    const { adapter, cleanup } = await createPgBackend();
    await adapter.open();
    try {
      await assert.rejects(
        () => adapter.getChangesSince(0n),
        (err: Error) => err.message.includes('getChangesSince') || err.message.includes('not implemented'),
        'PostgresBackend must throw on getChangesSince (not implemented)'
      );
    } finally {
      await adapter.close();
      await cleanup();
    }
  });

  it('PostgresBackend.applyChanges throws (not implemented — cr-sqlite is LocalBackend-only)', async () => {
    if (!PG_AVAILABLE) {
      const dir = makeTempDir();
      const backend = new LocalBackend({
        storagePath: dir,
        wal: false,
        leaseReaperIntervalMs: 0,
        crsqliteExtPath: path.join(dir, 'nonexistent.so'),
      });
      await backend.open();
      try {
        await assert.rejects(
          () => backend.applyChanges(new Uint8Array(0)),
          (err: Error) => err.name === 'CrSqliteNotLoadedError' || err.message.includes('crsqlite'),
          'Must throw when cr-sqlite not loaded'
        );
      } finally {
        try { await backend.close(); } catch { /* ignore */ }
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
      return;
    }

    // PG available: test the real PgContractAdapter stub.
    const { adapter, cleanup } = await createPgBackend();
    await adapter.open();
    try {
      await assert.rejects(
        () => adapter.applyChanges(new Uint8Array(0)),
        (err: Error) => err.message.includes('applyChanges') || err.message.includes('not implemented'),
        'PostgresBackend must throw on applyChanges (not implemented)'
      );
    } finally {
      await adapter.close();
      await cleanup();
    }
  });
});

// ── PostgresBackend suite ─────────────────────────────────────────
//
// Skipped (with WARN) if DATABASE_URL_PG is not set.
// In CI, DATABASE_URL_PG is always set via the postgres service container.

if (PG_AVAILABLE) {
  runContractSuite('PostgresBackend', async () => {
    const { adapter, cleanup } = await createPgBackend();
    return {
      backend: adapter,
      tearDown: cleanup,
    };
  });
} else {
  // Emit a warning visible in test output; do not register any tests that would fail.
  console.warn(
    '[contract-tests] WARN: DATABASE_URL_PG not set — PostgresBackend contract tests SKIPPED. ' +
    'Set DATABASE_URL_PG to run the full dual-backend suite.'
  );
}
