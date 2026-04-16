/**
 * Unit tests for the presence registry (T258).
 * Uses Node.js built-in test runner.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PresenceRegistry } from '../presence/registry.js';

describe('PresenceRegistry', () => {
  let registry: PresenceRegistry;

  beforeEach(() => {
    registry = new PresenceRegistry();
  });

  it('upsert inserts an entry', () => {
    registry.upsert('agent-1', 'doc-a', 'intro');
    const records = registry.getByDoc('doc-a');
    assert.equal(records.length, 1);
    assert.equal(records[0].agentId, 'agent-1');
    assert.equal(records[0].section, 'intro');
  });

  it('upsert same agentId twice in same doc produces only 1 entry', () => {
    registry.upsert('agent-1', 'doc-a', 'intro');
    registry.upsert('agent-1', 'doc-a', 'outro');
    const records = registry.getByDoc('doc-a');
    assert.equal(records.length, 1);
    assert.equal(records[0].section, 'outro');
  });

  it('getByDoc returns empty array for unknown doc', () => {
    assert.deepEqual(registry.getByDoc('nonexistent'), []);
  });

  it('getByDoc returns records sorted by lastSeen descending', () => {
    registry.upsert('agent-1', 'doc-a', 'intro');
    registry.upsert('agent-2', 'doc-a', 'outro');
    const records = registry.getByDoc('doc-a');
    assert.equal(records.length, 2);
    assert.ok(records[0].lastSeen >= records[1].lastSeen);
  });

  it('expire removes entries older than 30s', () => {
    registry.upsert('agent-1', 'doc-a', 'intro');
    registry.upsert('agent-2', 'doc-a', 'outro');
    registry.upsert('agent-3', 'doc-b', 'intro');

    const future = Date.now() + 31_000;
    registry.expire(future);

    assert.equal(registry.getByDoc('doc-a').length, 0);
    assert.equal(registry.getByDoc('doc-b').length, 0);
  });

  it('expire does not remove entries within TTL', () => {
    registry.upsert('agent-1', 'doc-a', 'intro');

    const future = Date.now() + 5_000;
    registry.expire(future);

    assert.equal(registry.getByDoc('doc-a').length, 1);
  });

  it('upsert stores cursorOffset when provided', () => {
    registry.upsert('agent-1', 'doc-a', 'intro', 42);
    const records = registry.getByDoc('doc-a');
    assert.equal(records[0].cursorOffset, 42);
  });
});
