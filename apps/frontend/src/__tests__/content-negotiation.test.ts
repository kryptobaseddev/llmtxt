/**
 * Unit tests for content negotiation utilities (T014.1 / T014.5).
 *
 * Tests the negotiateFormat() and extensionToFormat() functions without
 * any SvelteKit or browser dependencies.
 *
 * Run with:
 *   node --import tsx/esm --test src/__tests__/content-negotiation.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  negotiateFormat,
  extensionToFormat,
  isBotUserAgent,
} from '../lib/content/negotiation.js';

// ── isBotUserAgent ─────────────────────────────────────────────

describe('isBotUserAgent', () => {
  it('returns true for curl', () => {
    assert.equal(isBotUserAgent('curl/7.88.1'), true);
  });

  it('returns true for wget', () => {
    assert.equal(isBotUserAgent('Wget/1.21.4'), true);
  });

  it('returns true for GPTBot', () => {
    assert.equal(isBotUserAgent('GPTBot/1.0'), true);
  });

  it('returns true for ClaudeBot', () => {
    assert.equal(isBotUserAgent('ClaudeBot/1.0'), true);
  });

  it('returns true for Googlebot', () => {
    assert.equal(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)'), true);
  });

  it('returns true for python-requests', () => {
    assert.equal(isBotUserAgent('python-requests/2.31.0'), true);
  });

  it('returns true for Go-http-client', () => {
    assert.equal(isBotUserAgent('Go-http-client/2.0'), true);
  });

  it('returns false for Chrome browser', () => {
    assert.equal(
      isBotUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      ),
      false,
    );
  });

  it('returns false for Firefox', () => {
    assert.equal(
      isBotUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0'),
      false,
    );
  });

  it('returns false for undefined', () => {
    assert.equal(isBotUserAgent(undefined), false);
  });

  it('returns false for empty string', () => {
    assert.equal(isBotUserAgent(''), false);
  });
});

// ── negotiateFormat ────────────────────────────────────────────

describe('negotiateFormat — Accept header takes priority', () => {
  it('returns "text" for Accept: text/plain', () => {
    assert.equal(negotiateFormat('text/plain', null), 'text');
  });

  it('returns "json" for Accept: application/json', () => {
    assert.equal(negotiateFormat('application/json', null), 'json');
  });

  it('returns "markdown" for Accept: text/markdown', () => {
    assert.equal(negotiateFormat('text/markdown', null), 'markdown');
  });

  it('returns "markdown" for Accept: text/x-markdown', () => {
    assert.equal(negotiateFormat('text/x-markdown', null), 'markdown');
  });

  it('returns null for Accept: text/html (let page render)', () => {
    assert.equal(negotiateFormat('text/html', 'curl/7.88.1'), null);
  });

  it('Accept: text/html takes priority over bot UA', () => {
    assert.equal(negotiateFormat('text/html,application/xhtml+xml', 'curl/7.88.1'), null);
  });

  it('handles mixed Accept with text/plain', () => {
    assert.equal(
      negotiateFormat('application/xml, text/plain; q=0.9, */*; q=0.8', null),
      'text',
    );
  });

  it('handles mixed Accept with application/json', () => {
    assert.equal(
      negotiateFormat('text/html, application/json; q=0.9', 'Chrome/120'),
      'json',
    );
  });
});

describe('negotiateFormat — User-Agent heuristic for wildcard Accept', () => {
  it('curl with */* defaults to text', () => {
    assert.equal(negotiateFormat('*/*', 'curl/7.88.1'), 'text');
  });

  it('curl with no Accept defaults to text', () => {
    assert.equal(negotiateFormat(null, 'curl/7.88.1'), 'text');
  });

  it('wget with no Accept defaults to text', () => {
    assert.equal(negotiateFormat(undefined, 'Wget/1.21.4'), 'text');
  });

  it('GPTBot with no Accept defaults to text', () => {
    assert.equal(negotiateFormat('*/*', 'GPTBot/1.0'), 'text');
  });

  it('python-requests with */* defaults to text', () => {
    assert.equal(negotiateFormat('*/*', 'python-requests/2.31.0'), 'text');
  });

  it('browser with */* returns null (render HTML page)', () => {
    assert.equal(
      negotiateFormat(
        '*/*',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
      ),
      null,
    );
  });

  it('no Accept, no UA returns null', () => {
    assert.equal(negotiateFormat(null, null), null);
  });

  it('no Accept, no UA returns null (undefined)', () => {
    assert.equal(negotiateFormat(undefined, undefined), null);
  });
});

// ── extensionToFormat ──────────────────────────────────────────

describe('extensionToFormat', () => {
  it('maps "txt" to "text"', () => {
    assert.equal(extensionToFormat('txt'), 'text');
  });

  it('maps "json" to "json"', () => {
    assert.equal(extensionToFormat('json'), 'json');
  });

  it('maps "md" to "markdown"', () => {
    assert.equal(extensionToFormat('md'), 'markdown');
  });

  it('returns null for unknown extension', () => {
    assert.equal(extensionToFormat('xml'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(extensionToFormat(''), null);
  });

  it('handles uppercase extensions', () => {
    assert.equal(extensionToFormat('TXT'), 'text');
    assert.equal(extensionToFormat('JSON'), 'json');
    assert.equal(extensionToFormat('MD'), 'markdown');
  });
});
