/**
 * Contract tests for the llmtxt/crdt subpath.
 *
 * Purpose: assert the stable public API surface of `llmtxt/crdt` so that any
 * rename, removal, or signature change is caught immediately.
 *
 * The llmtxt/crdt subpath is a flat source file at src/crdt.ts. These tests
 * import from it directly (one directory up) to mirror the compiled subpath
 * import `llmtxt/crdt`.
 *
 * Exported symbols:
 *   Types:    SectionDelta, Unsubscribe, SubscribeSectionOptions
 *   Functions: subscribeSection, getSectionText
 *
 * Contract verification strategy for network-dependent functions:
 *  - subscribeSection: verify return type (function) and that calling the
 *    returned unsubscribe() is safe (does not throw).
 *  - getSectionText: verify function arity.
 *
 * Test runner: node:test (native). No vitest.
 * Run with the package-level test script: pnpm test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// ── Imports — crdt subpath source (../crdt.ts mirrors llmtxt/crdt) ───────────

import {
  subscribeSection,
  getSectionText,
} from '../crdt.js';

// ── 1. Export existence ───────────────────────────────────────────────────────

describe('llmtxt/crdt — export existence', () => {
  it('subscribeSection is exported as a function', () => {
    assert.equal(typeof subscribeSection, 'function');
  });

  it('getSectionText is exported as a function', () => {
    assert.equal(typeof getSectionText, 'function');
  });
});

// ── 2. Function signatures — arity and return types ──────────────────────────

describe('llmtxt/crdt — function signature contract', () => {
  it('subscribeSection accepts (slug, sectionId, callback, options?) and returns a function', () => {
    // We cannot open a real WebSocket in tests, but we CAN verify the return
    // type. A non-existent host will fail to connect, but the return value
    // (Unsubscribe) must be a function synchronously.
    let unsub: (() => void) | undefined;
    assert.doesNotThrow(() => {
      unsub = subscribeSection(
        'test-slug',
        'test-section',
        (_delta) => { /* noop */ },
        { baseUrl: 'http://localhost:0' }, // unreachable — WS will fail async
      );
    });
    assert.equal(typeof unsub, 'function', 'subscribeSection must return an Unsubscribe function');

    // Calling unsub() on an already-failed socket must not throw
    assert.doesNotThrow(() => {
      unsub!();
    });
  });

  it('subscribeSection returns a different function on each call', () => {
    const cb = (_delta: unknown) => { /* noop */ };
    const unsub1 = subscribeSection('s1', 'sec1', cb, { baseUrl: 'http://localhost:0' });
    const unsub2 = subscribeSection('s2', 'sec2', cb, { baseUrl: 'http://localhost:0' });
    assert.notEqual(unsub1, unsub2, 'each call must return a distinct unsubscribe closure');
    // Cleanup
    unsub1();
    unsub2();
  });

  it('getSectionText has function.length >= 2 (slug, sectionId are required)', () => {
    // Function.length counts required params before any optional/default ones
    assert.ok(getSectionText.length >= 2,
      `getSectionText.length=${getSectionText.length} must be >= 2`);
  });

  it('getSectionText returns a Promise when called with unreachable base', async () => {
    const result = getSectionText('test-slug', 'test-section', {
      baseUrl: 'http://localhost:0',
    });
    assert.ok(result instanceof Promise, 'getSectionText must return a Promise');
    // The promise will reject with a network error — that is expected.
    // We just verify it IS a promise; we do not await it.
    result.catch(() => { /* expected network error */ });
  });
});

// ── 3. subscribeSection — options shape contract ──────────────────────────────

describe('llmtxt/crdt — subscribeSection options contract', () => {
  it('works with no options argument (uses defaults)', () => {
    // The default baseUrl is https://api.llmtxt.my — the WS will fail in test
    // environment, but the function must not throw synchronously.
    let unsub: (() => void) | undefined;
    assert.doesNotThrow(() => {
      unsub = subscribeSection('slug', 'section', () => { /* noop */ });
    });
    assert.equal(typeof unsub, 'function');
    unsub!();
  });

  it('accepts token option without throwing', () => {
    let unsub: (() => void) | undefined;
    assert.doesNotThrow(() => {
      unsub = subscribeSection('slug', 'section', () => { /* noop */ }, {
        token: 'llmtxt_test_token',
        baseUrl: 'http://localhost:0',
      });
    });
    unsub!();
  });

  it('accepts onError option without throwing', () => {
    let unsub: (() => void) | undefined;
    assert.doesNotThrow(() => {
      unsub = subscribeSection('slug', 'section', () => { /* noop */ }, {
        onError: (_err: Event) => { /* noop */ },
        baseUrl: 'http://localhost:0',
      });
    });
    unsub!();
  });

  it('accepts onAwareness option without throwing', () => {
    let unsub: (() => void) | undefined;
    assert.doesNotThrow(() => {
      unsub = subscribeSection('slug', 'section', () => { /* noop */ }, {
        onAwareness: (_payload: Uint8Array) => { /* noop */ },
        baseUrl: 'http://localhost:0',
      });
    });
    unsub!();
  });
});

// ── 4. Unsubscribe idempotency ────────────────────────────────────────────────

describe('llmtxt/crdt — Unsubscribe idempotency', () => {
  it('calling unsub() twice does not throw', () => {
    const unsub = subscribeSection('slug', 'section', () => { /* noop */ }, {
      baseUrl: 'http://localhost:0',
    });
    assert.doesNotThrow(() => {
      unsub();
      unsub(); // second call must also be safe
    });
  });
});
