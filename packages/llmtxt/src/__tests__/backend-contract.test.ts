/**
 * Backend contract test suite.
 *
 * Runs the same set of behavioural assertions against any Backend
 * implementation. Currently validates LocalBackend; RemoteBackend is
 * validated against a mock HTTP server when one is available (skipped
 * in CI without a running server).
 *
 * Pattern: each `describe` block receives a `BackendFactory` and runs
 * identical assertions regardless of which implementation is under test.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import type { Backend } from '../core/backend.js';
import { LocalBackend } from '../local/local-backend.js';

// ── Test helpers ─────────────────────────────────────────────────

type BackendFactory = () => { backend: Backend; cleanup: () => Promise<void> };

/**
 * Make a temp dir for each test backend instance so tests are isolated.
 */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'llmtxt-contract-'));
}

// ── Contract suite factory ────────────────────────────────────────

function runContractSuite(label: string, factory: BackendFactory) {
  describe(`${label} — Backend contract`, () => {
    let backend: Backend;
    let cleanup: () => Promise<void>;

    before(async () => {
      ({ backend, cleanup } = factory());
      await backend.open();
    });

    after(async () => {
      await backend.close();
      await cleanup();
    });

    // ── Document CRUD ────────────────────────────────────────────

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
        const doc = await backend.createDocument({
          title: 'Explicit Slug Doc',
          createdBy: 'agent',
          slug: 'my-explicit-slug',
        });
        assert.equal(doc.slug, 'my-explicit-slug');
      });

      it('getDocumentBySlug retrieves a document', async () => {
        const doc = await backend.createDocument({
          title: 'Slug Lookup Test',
          createdBy: 'agent',
          slug: 'slug-lookup-unique',
        });
        const found = await backend.getDocumentBySlug('slug-lookup-unique');
        assert.ok(found);
        assert.equal(found.id, doc.id);
      });

      it('getDocumentBySlug returns null for unknown slug', async () => {
        const result = await backend.getDocumentBySlug('does-not-exist');
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

    // ── Versions ─────────────────────────────────────────────────

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

    // ── Events ───────────────────────────────────────────────────

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
        assert.equal(event.documentId, doc.id);
        assert.equal(event.type, 'test.event');
        assert.deepEqual(event.payload, { foo: 'bar' });

        const result = await backend.queryEvents({ documentId: doc.id });
        assert.ok(result.items.length >= 1);
        assert.equal(result.items[0]!.type, 'test.event');
      });
    });

    // ── Leases ───────────────────────────────────────────────────

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

    // ── Scratchpad ───────────────────────────────────────────────

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
  });
}

// ── Run contract suite against LocalBackend ───────────────────────

runContractSuite('LocalBackend', () => {
  const dir = makeTempDir();
  const backend = new LocalBackend({ storagePath: dir });
  return {
    backend,
    cleanup: async () => {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
});
