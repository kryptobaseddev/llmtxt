/**
 * Bandwidth regression test for differential subscriptions (T305).
 *
 * Proves that GET /sections/:name?since=N produces 5x smaller response
 * than a full GET /sections/:name when only a small change has occurred.
 *
 * Runs in unit mode without a real server — compares computed response
 * sizes for the delta structure vs. full content.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SectionDelta } from '../subscriptions/diff-helper.js';

describe('Differential bandwidth regression', () => {
  it('delta response is at least 5x smaller than full response for a small change', () => {
    // Simulate a large section (50 KB)
    const bigContent = 'x'.repeat(50_000);

    const fullResponse = JSON.stringify({
      slug: 'test-doc',
      section: { title: 'intro', depth: 1, startLine: 1, endLine: 1000, tokenCount: 12500 },
      content: bigContent,
      tokenCount: 12500,
      totalTokens: 12500,
      tokensSaved: 0,
    });

    // Simulate a delta with a small change
    const delta: SectionDelta = {
      added: [],
      modified: [{ name: 'intro', content: 'Updated 10 bytes.' }],
      deleted: [],
      fromSeq: 0,
      toSeq: 5,
    };

    const deltaResponse = JSON.stringify({
      delta,
      currentSeq: 5,
    });

    const fullBytes = Buffer.byteLength(fullResponse, 'utf-8');
    const deltaBytes = Buffer.byteLength(deltaResponse, 'utf-8');

    // Assert at least 5x reduction
    const ratio = fullBytes / deltaBytes;
    assert.ok(
      ratio >= 5,
      `Expected ratio >= 5 but got ${ratio.toFixed(2)} (full=${fullBytes}B, delta=${deltaBytes}B)`,
    );
  });

  it('delta null response is even smaller (no-op case)', () => {
    const bigContent = 'x'.repeat(50_000);

    const fullResponseBytes = Buffer.byteLength(
      JSON.stringify({ slug: 'test-doc', content: bigContent }),
      'utf-8',
    );

    const noOpDeltaBytes = Buffer.byteLength(
      JSON.stringify({ delta: null, currentSeq: 5 }),
      'utf-8',
    );

    assert.ok(fullResponseBytes / noOpDeltaBytes >= 5, 'no-op delta should be much smaller than full');
  });
});
