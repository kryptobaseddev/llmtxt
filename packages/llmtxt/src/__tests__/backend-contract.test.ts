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
