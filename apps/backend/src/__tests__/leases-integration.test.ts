/**
 * Integration tests for section leases (T288).
 *
 * These tests use the real Drizzle db via DATABASE_URL_PG when available,
 * or skip gracefully in SQLite mode (sectionLeases table is PG-only).
 *
 * Requires: DATABASE_URL_PG env var pointing to a PostgreSQL instance.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, teardownTestDb } from './helpers/test-db.js';
import type { TestDbContext } from './helpers/test-db.js';

// Helper: create a minimal document for FK purposes
async function createTestDocument(db: unknown, slug: string) {
  const { documents } = await import('../db/schema-pg.js');
  const { sql } = await import('drizzle-orm');
  const id = `doc-${slug}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any)
    .insert(documents)
    .values({
      id,
      slug,
      format: 'text',
      contentHash: 'abc',
      originalSize: 100,
      compressedSize: 50,
      createdAt: Date.now(),
      state: 'DRAFT',
      storageType: 'inline',
      currentVersion: 0,
      versionCount: 0,
      sharingMode: 'public',
      approvalRequiredCount: 1,
      approvalRequireUnanimous: false,
      approvalAllowedReviewers: '',
      approvalTimeoutMs: 0,
      visibility: 'public',
      eventSeqCounter: BigInt(0),
    })
    .onConflictDoNothing();
  return { id, slug };
}

describe('Lease service — PG integration', () => {
  let ctx: TestDbContext;

  before(async () => {
    if (!process.env.DATABASE_URL_PG) return;
    ctx = await setupTestDb();
  });

  after(async () => {
    if (!process.env.DATABASE_URL_PG) return;
    await teardownTestDb(ctx);
  });

  it('skips gracefully when DATABASE_URL_PG is not set', () => {
    if (!process.env.DATABASE_URL_PG) {
      // Not an error — tests are skipped in SQLite mode
      assert.ok(true, 'Skipped: no PG env');
      return;
    }
    assert.ok(ctx, 'ctx should be set');
  });

  it('acquireLease returns a Lease on free section', async () => {
    if (!process.env.DATABASE_URL_PG) return;

    const { acquireLease, getActiveLease } = await import('../leases/lease-service.js');
    const slug = `lease-test-${Date.now()}`;
    await createTestDocument(ctx.db, slug);

    const lease = await acquireLease(ctx.db, slug, 'section-1', 'agent-a', 30_000);
    assert.ok(lease !== null, 'should return a lease');
    assert.equal(lease!.holderAgentId, 'agent-a');
    assert.equal(lease!.sectionId, 'section-1');
    assert.ok(lease!.expiresAt > new Date(), 'expiresAt should be in the future');
  });

  it('acquireLease returns null when section held by another agent', async () => {
    if (!process.env.DATABASE_URL_PG) return;

    const { acquireLease } = await import('../leases/lease-service.js');
    const slug = `lease-test-conflict-${Date.now()}`;
    await createTestDocument(ctx.db, slug);

    const lease = await acquireLease(ctx.db, slug, 'section-1', 'agent-a', 30_000);
    assert.ok(lease !== null, 'first acquire should succeed');

    const conflict = await acquireLease(ctx.db, slug, 'section-1', 'agent-b', 30_000);
    assert.equal(conflict, null, 'second acquire by different agent should return null');
  });

  it('releaseLease by holder removes the lease', async () => {
    if (!process.env.DATABASE_URL_PG) return;

    const { acquireLease, releaseLease, getActiveLease } = await import('../leases/lease-service.js');
    const slug = `lease-test-release-${Date.now()}`;
    await createTestDocument(ctx.db, slug);

    const lease = await acquireLease(ctx.db, slug, 'section-1', 'agent-a', 30_000);
    assert.ok(lease !== null);

    const released = await releaseLease(ctx.db, lease!.id, 'agent-a');
    assert.equal(released, true);

    const active = await getActiveLease(ctx.db, slug, 'section-1');
    assert.equal(active, null, 'no active lease after release');
  });

  it('renewLease by non-holder returns null', async () => {
    if (!process.env.DATABASE_URL_PG) return;

    const { acquireLease, renewLease } = await import('../leases/lease-service.js');
    const slug = `lease-test-renew-${Date.now()}`;
    await createTestDocument(ctx.db, slug);

    const lease = await acquireLease(ctx.db, slug, 'section-1', 'agent-a', 30_000);
    assert.ok(lease !== null);

    const renewed = await renewLease(ctx.db, lease!.id, 'agent-b', 30_000);
    assert.equal(renewed, null, 'non-holder cannot renew');
  });

  it('getActiveLease returns null after TTL expires', async () => {
    if (!process.env.DATABASE_URL_PG) return;

    const { acquireLease, getActiveLease } = await import('../leases/lease-service.js');
    const slug = `lease-test-expire-${Date.now()}`;
    await createTestDocument(ctx.db, slug);

    // Acquire a lease with 1ms TTL (immediately expired)
    const lease = await acquireLease(ctx.db, slug, 'section-1', 'agent-a', 1);
    assert.ok(lease !== null);

    // Wait 5ms for expiry
    await new Promise((r) => setTimeout(r, 5));

    const active = await getActiveLease(ctx.db, slug, 'section-1');
    assert.equal(active, null, 'expired lease should not be returned');
  });

  it('release-and-reacquire: agent-b acquires after agent-a releases', async () => {
    if (!process.env.DATABASE_URL_PG) return;

    const { acquireLease, releaseLease } = await import('../leases/lease-service.js');
    const slug = `lease-test-reacquire-${Date.now()}`;
    await createTestDocument(ctx.db, slug);

    const leaseA = await acquireLease(ctx.db, slug, 'section-1', 'agent-a', 30_000);
    assert.ok(leaseA !== null);

    await releaseLease(ctx.db, leaseA!.id, 'agent-a');

    const leaseB = await acquireLease(ctx.db, slug, 'section-1', 'agent-b', 30_000);
    assert.ok(leaseB !== null, 'agent-b should acquire after agent-a releases');
    assert.equal(leaseB!.holderAgentId, 'agent-b');
  });
});
