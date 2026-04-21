/**
 * Unit tests for the SvelteKit hooks.server.ts CSP policy (T850).
 *
 * Verifies that the Content-Security-Policy:
 *   - Permits Google Fonts CSS in style-src (fonts.googleapis.com).
 *   - Permits Google Fonts woff2 files in font-src (fonts.gstatic.com).
 *   - Still carries a per-request nonce in script-src.
 *   - Still includes default protections (frame-ancestors, COEP, etc.).
 *
 * Run with:
 *   node --import tsx/esm --test src/__tests__/csp-headers.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../hooks.server.ts';

interface MinimalEvent {
  locals: Record<string, unknown>;
}

async function invokeHandle(): Promise<Response> {
  const event = { locals: {} } as unknown as Parameters<typeof handle>[0]['event'];
  const resolve = (async () => new Response('<html></html>', { status: 200 })) as Parameters<
    typeof handle
  >[0]['resolve'];
  return handle({ event, resolve } as Parameters<typeof handle>[0]);
}

describe('CSP — Google Fonts allowance (T850)', () => {
  it('style-src includes https://fonts.googleapis.com', async () => {
    const res = await invokeHandle();
    const csp = res.headers.get('content-security-policy') ?? '';
    const styleSrc = csp.split(';').find((d) => d.trim().startsWith('style-src')) ?? '';
    assert.match(
      styleSrc,
      /https:\/\/fonts\.googleapis\.com/,
      `style-src must allow fonts.googleapis.com — got: "${styleSrc}"`,
    );
  });

  it('font-src includes https://fonts.gstatic.com', async () => {
    const res = await invokeHandle();
    const csp = res.headers.get('content-security-policy') ?? '';
    const fontSrc = csp.split(';').find((d) => d.trim().startsWith('font-src')) ?? '';
    assert.match(
      fontSrc,
      /https:\/\/fonts\.gstatic\.com/,
      `font-src must allow fonts.gstatic.com — got: "${fontSrc}"`,
    );
  });

  it('style-src still requires self + unsafe-inline (SvelteKit components)', async () => {
    const res = await invokeHandle();
    const csp = res.headers.get('content-security-policy') ?? '';
    const styleSrc = csp.split(';').find((d) => d.trim().startsWith('style-src')) ?? '';
    assert.match(styleSrc, /'self'/);
    assert.match(styleSrc, /'unsafe-inline'/);
  });

  it('font-src still requires self', async () => {
    const res = await invokeHandle();
    const csp = res.headers.get('content-security-policy') ?? '';
    const fontSrc = csp.split(';').find((d) => d.trim().startsWith('font-src')) ?? '';
    assert.match(fontSrc, /'self'/);
  });
});

describe('CSP — defense-in-depth invariants preserved', () => {
  it('script-src carries a per-request nonce', async () => {
    const res = await invokeHandle();
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
  });

  it('two requests get different nonces', async () => {
    const r1 = await invokeHandle();
    const r2 = await invokeHandle();
    const n1 = (r1.headers.get('content-security-policy') ?? '').match(/'nonce-([^']+)'/)?.[1];
    const n2 = (r2.headers.get('content-security-policy') ?? '').match(/'nonce-([^']+)'/)?.[1];
    assert.ok(n1 && n2, 'both responses carry a nonce');
    assert.notEqual(n1, n2, 'nonces must be unique per request');
  });

  it('frame-ancestors is none', async () => {
    const res = await invokeHandle();
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /frame-ancestors 'none'/);
  });

  it('connect-src allows api.llmtxt.my (HTTPS) and wss://api.llmtxt.my', async () => {
    const res = await invokeHandle();
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /connect-src[^;]*https:\/\/api\.llmtxt\.my/);
    assert.match(csp, /connect-src[^;]*wss:\/\/api\.llmtxt\.my/);
  });

  it('COEP, COOP, CORP set for cross-origin isolation', async () => {
    const res = await invokeHandle();
    assert.equal(res.headers.get('cross-origin-embedder-policy'), 'credentialless');
    assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin');
  });

  it('legacy security headers present', async () => {
    const res = await invokeHandle();
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-xss-protection'), '0');
  });
});
