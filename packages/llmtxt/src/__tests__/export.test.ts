/**
 * Export formatter tests — T438, T440, T442, T444.
 *
 * Validates byte-exact output for at least 2 fixtures per format, structural
 * invariants, determinism, and edge cases.
 *
 * Test runner: node:test (native, no vitest dependency).
 * @see docs/specs/ARCH-T427-document-export-ssot.md §4
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatMarkdown,
  formatJson,
  formatTxt,
  formatLlmtxt,
} from '../export/index.js';
import type { DocumentExportState, ExportOpts } from '../export/index.js';

// ── Shared fixtures ────────────────────────────────────────────

/** Standard fixture — matches the spec §4.1 example. */
function makeDoc(overrides: Partial<DocumentExportState> = {}): DocumentExportState {
  return {
    title: 'My Document Title',
    slug: 'my-document-title',
    version: 3,
    state: 'APPROVED',
    contributors: ['agent-bob', 'agent-alice'], // deliberately unsorted
    contentHash: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    exportedAt: '2026-04-17T19:00:00.000Z',
    content: '# My Document Title\n\nFull body here.',
    labels: ['sdk', 'spec'],
    createdBy: 'agent-alice',
    createdAt: 1745000000000,
    updatedAt: 1745010000000,
    versionCount: 3,
    chainRef: null,
    ...overrides,
  };
}

/** Minimal fixture — no optional fields, empty contributors. */
function makeMinimalDoc(overrides: Partial<DocumentExportState> = {}): DocumentExportState {
  return {
    title: 'Minimal',
    slug: 'minimal',
    version: 1,
    state: 'DRAFT',
    contributors: [],
    contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    exportedAt: '2026-01-01T00:00:00.000Z',
    content: 'Just some plain text.',
    ...overrides,
  };
}

// ── T438: formatMarkdown ───────────────────────────────────────

describe('formatMarkdown (T438)', () => {
  it('fixture 1: emits frontmatter + blank line + body with single trailing newline', () => {
    const doc = makeDoc();
    const result = formatMarkdown(doc);

    // Must start with opening fence.
    assert.ok(result.startsWith('---\n'), 'must start with ---\\n');

    // Must contain title in frontmatter.
    assert.ok(result.includes('title: "My Document Title"\n'), 'must have title');

    // Contributors sorted lexicographically (alice before bob).
    const alicePos = result.indexOf('agent-alice');
    const bobPos = result.indexOf('agent-bob');
    assert.ok(alicePos < bobPos, 'contributors must be sorted: alice before bob');

    // Exactly one blank line between closing fence and body.
    assert.ok(result.includes('---\n\n#'), 'must have blank line after closing fence');

    // Body present.
    assert.ok(result.includes('# My Document Title\n\nFull body here.'), 'body must be present');

    // Single trailing newline.
    assert.ok(result.endsWith('\n'), 'must end with \\n');
    assert.ok(!result.endsWith('\n\n'), 'must not end with double newline');
  });

  it('fixture 2: minimal doc (empty contributors, DRAFT state)', () => {
    const doc = makeMinimalDoc();
    const result = formatMarkdown(doc);

    assert.ok(result.startsWith('---\n'), 'must start with ---\\n');
    assert.ok(result.includes('state: "DRAFT"\n'), 'state must be DRAFT');
    assert.ok(result.includes('contributors:\n'), 'contributors key must be present');
    // No contributor entries.
    assert.ok(!result.includes('  - "'), 'empty contributors: no list entries');
    assert.ok(result.includes('---\n\nJust some plain text.\n'), 'body must be present');
    assert.ok(result.endsWith('\n'), 'must end with \\n');
    assert.ok(!result.endsWith('\n\n'), 'must not end with double newline');
  });

  it('fixture 3: includeMetadata=false emits body only', () => {
    const doc = makeDoc();
    const opts: ExportOpts = { includeMetadata: false };
    const result = formatMarkdown(doc, opts);

    assert.ok(!result.includes('---'), 'no frontmatter fences when includeMetadata=false');
    assert.ok(result.startsWith('# My Document Title'), 'body must start immediately');
    assert.ok(result.endsWith('\n'), 'must end with \\n');
  });

  it('fixture 4: LF-only line endings (no CRLF)', () => {
    const doc = makeDoc({ content: 'Line 1\r\nLine 2\r\nLine 3' });
    const result = formatMarkdown(doc);
    assert.ok(!result.includes('\r'), 'must not contain CR characters');
  });

  it('fixture 5: body with trailing blank lines stripped to single newline', () => {
    const doc = makeDoc({ content: 'Body content\n\n\n' });
    const result = formatMarkdown(doc);
    // Body portion must end with exactly one \n.
    assert.ok(result.endsWith('Body content\n'), 'trailing blank lines stripped');
  });

  it('fixture 6: version number emitted as integer (not quoted)', () => {
    const doc = makeDoc({ version: 7 });
    const result = formatMarkdown(doc);
    assert.ok(result.includes('version: 7\n'), 'version must be unquoted integer');
    assert.ok(!result.includes('"7"'), 'version must not be quoted');
  });

  it('fixture 7: special characters in title are escaped', () => {
    const doc = makeDoc({ title: 'Doc with "quotes" and \\backslash' });
    const result = formatMarkdown(doc);
    assert.ok(
      result.includes('title: "Doc with \\"quotes\\" and \\\\backslash"'),
      'title special chars must be escaped',
    );
  });

  it('determinism: identical inputs produce identical output', () => {
    const doc = makeDoc();
    const r1 = formatMarkdown(doc);
    const r2 = formatMarkdown(doc);
    assert.strictEqual(r1, r2, 'output must be deterministic');
  });
});

// ── T440: formatJson ───────────────────────────────────────────

describe('formatJson (T440)', () => {
  it('fixture 1: produces valid JSON with schema field', () => {
    const doc = makeDoc();
    const result = formatJson(doc);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    assert.strictEqual(parsed['schema'], 'llmtxt-export/1', 'schema must be llmtxt-export/1');
    assert.strictEqual(parsed['title'], 'My Document Title');
    assert.strictEqual(parsed['slug'], 'my-document-title');
    assert.strictEqual(parsed['version'], 3);
    assert.strictEqual(parsed['state'], 'APPROVED');
  });

  it('fixture 2: contributors sorted lexicographically', () => {
    const doc = makeDoc({
      contributors: ['zeta', 'alpha', 'beta'],
    });
    const result = formatJson(doc);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    assert.deepStrictEqual(parsed['contributors'], ['alpha', 'beta', 'zeta']);
  });

  it('fixture 3: minimal doc — optional fields serialized as null', () => {
    const doc = makeMinimalDoc();
    const result = formatJson(doc);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    assert.strictEqual(parsed['labels'], null);
    assert.strictEqual(parsed['created_by'], null);
    assert.strictEqual(parsed['created_at'], null);
    assert.strictEqual(parsed['updated_at'], null);
    assert.strictEqual(parsed['version_count'], null);
  });

  it('fixture 4: key order matches spec §4.3', () => {
    const doc = makeDoc();
    const result = formatJson(doc);
    // Extract keys from the top-level JSON object.
    const keys = Object.keys(JSON.parse(result) as Record<string, unknown>);
    const expected = [
      'schema', 'title', 'slug', 'version', 'state', 'contributors',
      'content_hash', 'exported_at', 'content', 'labels', 'created_by',
      'created_at', 'updated_at', 'version_count',
    ];
    assert.deepStrictEqual(keys, expected, 'key order must match spec §4.3');
  });

  it('fixture 5: LF-only line endings, single trailing newline', () => {
    const doc = makeDoc();
    const result = formatJson(doc);
    assert.ok(!result.includes('\r'), 'must not contain CR characters');
    assert.ok(result.endsWith('\n'), 'must end with \\n');
    assert.ok(!result.endsWith('\n\n'), 'must not end with double newline');
  });

  it('fixture 6: 2-space indentation', () => {
    const doc = makeDoc();
    const result = formatJson(doc);
    // The second line should start with two spaces (first key indented).
    const lines = result.split('\n');
    assert.ok(lines[1]?.startsWith('  '), 'must use 2-space indent');
  });

  it('determinism: identical inputs produce identical output', () => {
    const doc = makeDoc();
    const r1 = formatJson(doc);
    const r2 = formatJson(doc);
    assert.strictEqual(r1, r2, 'output must be deterministic');
  });
});

// ── T442: formatTxt ────────────────────────────────────────────

describe('formatTxt (T442)', () => {
  it('fixture 1: body only, no frontmatter, single trailing newline', () => {
    const doc = makeDoc();
    const result = formatTxt(doc);
    assert.ok(!result.includes('---'), 'must not contain frontmatter fences');
    assert.ok(!result.includes('title:'), 'must not contain YAML keys');
    assert.ok(result.includes('# My Document Title'), 'body must be present');
    assert.ok(result.endsWith('\n'), 'must end with \\n');
    assert.ok(!result.endsWith('\n\n'), 'must not end with double newline');
  });

  it('fixture 2: minimal doc — plain text body', () => {
    const doc = makeMinimalDoc();
    const result = formatTxt(doc);
    assert.strictEqual(result, 'Just some plain text.\n');
  });

  it('fixture 3: CRLF normalised to LF', () => {
    const doc = makeDoc({ content: 'Line 1\r\nLine 2\r\n' });
    const result = formatTxt(doc);
    assert.ok(!result.includes('\r'), 'must not contain CR characters');
    assert.strictEqual(result, 'Line 1\nLine 2\n');
  });

  it('fixture 4: content with multiple trailing blank lines — exactly one newline', () => {
    const doc = makeDoc({ content: 'Hello\n\n\n\n' });
    const result = formatTxt(doc);
    assert.strictEqual(result, 'Hello\n');
  });

  it('fixture 5: empty content becomes a single newline', () => {
    const doc = makeDoc({ content: '' });
    const result = formatTxt(doc);
    assert.strictEqual(result, '\n', 'empty content must produce single newline');
  });

  it('determinism: identical inputs produce identical output', () => {
    const doc = makeDoc();
    const r1 = formatTxt(doc);
    const r2 = formatTxt(doc);
    assert.strictEqual(r1, r2, 'output must be deterministic');
  });
});

// ── T444: formatLlmtxt ────────────────────────────────────────

describe('formatLlmtxt (T444)', () => {
  it('fixture 1: contains all standard frontmatter fields plus chain_ref and format', () => {
    const doc = makeDoc({ chainRef: 'bft:abc123def456' });
    const result = formatLlmtxt(doc);

    assert.ok(result.startsWith('---\n'), 'must start with ---\\n');
    assert.ok(result.includes('title: "My Document Title"\n'), 'must have title');
    assert.ok(result.includes('slug: "my-document-title"\n'), 'must have slug');
    assert.ok(result.includes('version: 3\n'), 'must have version');
    assert.ok(result.includes('state: "APPROVED"\n'), 'must have state');
    assert.ok(result.includes('content_hash:'), 'must have content_hash');
    assert.ok(result.includes('exported_at:'), 'must have exported_at');
    assert.ok(result.includes('chain_ref: "bft:abc123def456"\n'), 'must have chain_ref');
    assert.ok(result.includes('format: "llmtxt/1"\n'), 'must have format field');
    assert.ok(result.includes('---\n\n# My Document Title'), 'body must follow fence + blank line');
    assert.ok(result.endsWith('\n'), 'must end with \\n');
  });

  it('fixture 2: chain_ref null serialised as bare YAML null (not "null")', () => {
    const doc = makeDoc({ chainRef: null });
    const result = formatLlmtxt(doc);

    // Must contain bare null scalar, not quoted "null".
    assert.ok(result.includes('chain_ref: null\n'), 'chain_ref null must be bare YAML null');
    assert.ok(!result.includes('chain_ref: "null"'), 'chain_ref null must not be quoted');
  });

  it('fixture 3: format field is the last field before closing fence', () => {
    const doc = makeDoc({ chainRef: null });
    const result = formatLlmtxt(doc);

    // Find the closing fence; the line immediately before must be format.
    const lines = result.split('\n');
    // The frontmatter closing fence is the first standalone "---" after the opening.
    let closingIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '---') {
        closingIdx = i;
        break;
      }
    }
    assert.ok(closingIdx > 0, 'closing fence must be found');
    assert.strictEqual(
      lines[closingIdx - 1],
      'format: "llmtxt/1"',
      'format must be last field before closing fence',
    );
    // chain_ref must be second-to-last.
    assert.strictEqual(
      lines[closingIdx - 2],
      'chain_ref: null',
      'chain_ref must be second-to-last field',
    );
  });

  it('fixture 4: contributors sorted (alice before bob)', () => {
    const doc = makeDoc({ contributors: ['zeta', 'alpha', 'beta'], chainRef: null });
    const result = formatLlmtxt(doc);
    const alphaPos = result.indexOf('alpha');
    const betaPos = result.indexOf('beta');
    const zetaPos = result.indexOf('zeta');
    assert.ok(alphaPos < betaPos, 'alpha must come before beta');
    assert.ok(betaPos < zetaPos, 'beta must come before zeta');
  });

  it('fixture 5: includeMetadata=false emits body only (no frontmatter)', () => {
    const doc = makeDoc({ chainRef: null });
    const opts: ExportOpts = { includeMetadata: false };
    const result = formatLlmtxt(doc, opts);

    assert.ok(!result.includes('---'), 'no frontmatter fences when includeMetadata=false');
    assert.ok(!result.includes('chain_ref'), 'no chain_ref when metadata omitted');
    assert.ok(result.startsWith('# My Document Title'), 'body must start immediately');
    assert.ok(result.endsWith('\n'), 'must end with \\n');
  });

  it('fixture 6: LF-only line endings, no CRLF', () => {
    const doc = makeDoc({ content: 'Line A\r\nLine B\r\n', chainRef: null });
    const result = formatLlmtxt(doc);
    assert.ok(!result.includes('\r'), 'must not contain CR characters');
  });

  it('fixture 7: chainRef undefined treated as null', () => {
    const doc = makeMinimalDoc(); // chainRef not set (undefined)
    const result = formatLlmtxt(doc);
    assert.ok(result.includes('chain_ref: null\n'), 'undefined chainRef must be null');
  });

  it('determinism: identical inputs produce identical output', () => {
    const doc = makeDoc({ chainRef: 'bft:deadbeef' });
    const r1 = formatLlmtxt(doc);
    const r2 = formatLlmtxt(doc);
    assert.strictEqual(r1, r2, 'output must be deterministic');
  });
});
