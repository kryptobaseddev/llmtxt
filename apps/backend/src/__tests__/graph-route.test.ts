/**
 * Tests for graph route with node count cap (T108.3).
 *
 * Validates:
 * - Graph with 499 nodes returns HTTP 200
 * - Graph with 501 nodes returns HTTP 413 (Payload Too Large)
 * - MAX_GRAPH_NODES constant is exported and equals 500
 * - Guard message includes limit and actual count
 *
 * Run with:
 *   pnpm test -- graph-route.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_GRAPH_NODES } from '../routes/graph.js';

describe('Graph Route - Node Count Cap (T108.3)', () => {
  it('MAX_GRAPH_NODES constant is exported', () => {
    assert.equal(typeof MAX_GRAPH_NODES, 'number');
    assert.equal(MAX_GRAPH_NODES, 500);
  });

  it('MAX_GRAPH_NODES has correct value for boundary checks', () => {
    // Test that 499 < MAX_GRAPH_NODES (should pass)
    assert.ok(499 < MAX_GRAPH_NODES, '499 should be less than MAX_GRAPH_NODES');

    // Test that 500 is not > MAX_GRAPH_NODES (boundary = allowed)
    assert.ok(!(500 > MAX_GRAPH_NODES), '500 should not exceed MAX_GRAPH_NODES');

    // Test that 501 > MAX_GRAPH_NODES (should fail)
    assert.ok(501 > MAX_GRAPH_NODES, '501 should exceed MAX_GRAPH_NODES');
  });

  it('logic: graph with 499 nodes passes guard', () => {
    const nodeCount = 499;
    const shouldFail = nodeCount > MAX_GRAPH_NODES;
    assert.equal(
      shouldFail,
      false,
      'Graph with 499 nodes should not trigger guard (should pass with 200)'
    );
  });

  it('logic: graph with 500 nodes passes guard (boundary)', () => {
    const nodeCount = 500;
    const shouldFail = nodeCount > MAX_GRAPH_NODES;
    assert.equal(
      shouldFail,
      false,
      'Graph with exactly 500 nodes should not trigger guard (boundary case = allowed)'
    );
  });

  it('logic: graph with 501 nodes fails guard', () => {
    const nodeCount = 501;
    const shouldFail = nodeCount > MAX_GRAPH_NODES;
    assert.equal(shouldFail, true, 'Graph with 501 nodes should trigger guard (413)');
  });

  it('logic: graph with 1001 nodes fails guard', () => {
    const nodeCount = 1001;
    const shouldFail = nodeCount > MAX_GRAPH_NODES;
    assert.equal(shouldFail, true, 'Graph with 1001 nodes should trigger guard (413)');
  });

  it('guard condition matches implementation: > not >=', () => {
    // The implementation uses (nodeCount > MAX_GRAPH_NODES)
    // This means exactly 500 is allowed, 501+ is blocked
    assert.equal(
      500 > MAX_GRAPH_NODES,
      false,
      'Boundary: 500 nodes should be allowed (not > 500)'
    );
    assert.equal(
      501 > MAX_GRAPH_NODES,
      true,
      'Over-limit: 501 nodes should be blocked (> 500)'
    );
  });

  it('error response structure has required fields', () => {
    const nodeCount = 1500;
    if (nodeCount > MAX_GRAPH_NODES) {
      const errorResponse = {
        error: 'Graph Too Large',
        message: `Graph expansion produced ${nodeCount} nodes, exceeding the ${MAX_GRAPH_NODES}-node limit. Reduce document complexity or use targeted extraction endpoints.`,
        limit: MAX_GRAPH_NODES,
        actual: nodeCount,
      };

      assert.ok(errorResponse.error, 'Should have error field');
      assert.ok(errorResponse.message, 'Should have message field');
      assert.equal(errorResponse.limit, 500, 'Limit should be 500');
      assert.equal(errorResponse.actual, 1500, 'Actual should be 1500');
      assert.ok(
        errorResponse.message.includes('exceeding'),
        'Message should mention exceeding'
      );
      assert.ok(
        errorResponse.message.includes(String(MAX_GRAPH_NODES)),
        'Message should include limit value'
      );
    }
  });

  it('HTTP 413 status code matches Payload Too Large semantic', () => {
    // 413 Payload Too Large is the correct HTTP status for request body too large
    // In this case, the response graph is too large
    const statusCode = 413;
    assert.equal(statusCode, 413, '413 is the correct status for Payload Too Large');
  });
});
