/**
 * Unit tests for path-matcher utility (T293).
 * Uses Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchPath, extractParams } from '../subscriptions/path-matcher.js';

describe('matchPath', () => {
  it('literal match', () => {
    assert.equal(matchPath('/health', '/health'), true);
  });

  it('literal no-match', () => {
    assert.equal(matchPath('/health', '/foo'), false);
  });

  it(':param single segment', () => {
    assert.equal(matchPath('/docs/:slug', '/docs/abc'), true);
  });

  it(':param does not match multi-segment path', () => {
    assert.equal(matchPath('/docs/:slug', '/docs/abc/xyz'), false);
  });

  it('* wildcard single segment', () => {
    assert.equal(matchPath('/docs/*', '/docs/abc'), true);
  });

  it('* wildcard does not match multi-segment', () => {
    assert.equal(matchPath('/docs/*', '/docs/abc/xyz'), false);
  });

  it('multiple :params match', () => {
    assert.equal(matchPath('/docs/:slug/sections/:sid', '/docs/my-doc/sections/intro'), true);
  });

  it('multiple :params no-match (short path)', () => {
    assert.equal(matchPath('/docs/:slug/sections/:sid', '/docs/my-doc'), false);
  });

  it('trailing slash normalisation on path', () => {
    assert.equal(matchPath('/docs/:slug', '/docs/abc/'), true);
  });

  it('trailing slash normalisation on pattern', () => {
    assert.equal(matchPath('/docs/:slug/', '/docs/abc'), true);
  });

  it('numeric segment match', () => {
    assert.equal(matchPath('/v/:version', '/v/123'), true);
  });

  it('no match for completely different paths', () => {
    assert.equal(matchPath('/api/v1/health', '/api/v2/health'), false);
  });
});

describe('extractParams', () => {
  it('extracts single param', () => {
    assert.deepEqual(extractParams('/docs/:slug', '/docs/my-doc'), { slug: 'my-doc' });
  });

  it('extracts multiple params', () => {
    assert.deepEqual(
      extractParams('/docs/:slug/sections/:sid', '/docs/my-doc/sections/intro'),
      { slug: 'my-doc', sid: 'intro' }
    );
  });

  it('returns empty object on no-match', () => {
    assert.deepEqual(extractParams('/docs/:slug', '/health'), {});
  });

  it('returns empty object when pattern has no params', () => {
    assert.deepEqual(extractParams('/health', '/health'), {});
  });

  it('wildcard does not appear in extracted params', () => {
    assert.deepEqual(extractParams('/docs/*', '/docs/abc'), {});
  });
});
