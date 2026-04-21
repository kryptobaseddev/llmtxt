/**
 * T827: classifyContent contract tests — TypeScript wrapper around WASM classify_content_wasm.
 *
 * Validates:
 *   1. PDF binary detection (magic bytes)
 *   2. PNG binary detection (magic bytes)
 *   3. Markdown detection from string input
 *   4. Heading-only markdown (T814 regression guard)
 *   5. JSON structured detection
 *   6. Rust code detection
 *   7. Plain text detection
 *   8. Empty input → unknown/0 confidence
 *   9. Buffer input
 *  10. Uint8Array and Buffer produce equivalent results
 *
 * Refs: T827, T780
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyContent, detectFormatFromClassification } from '../classify.js';
import type { ClassificationResult } from '../classify.js';

// ── Binary format detection ─────────────────────────────────────

describe('classifyContent — PDF from bytes', () => {
  it('detects PDF magic bytes', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37]);
    const r = classifyContent(pdf);
    assert.equal(r.format, 'pdf');
    assert.equal(r.category, 'binary');
    assert.equal(r.mimeType, 'application/pdf');
    assert.equal(r.confidence, 1.0);
    assert.equal(r.isExtractable, true);
  });
});

describe('classifyContent — PNG from bytes', () => {
  it('detects PNG magic bytes', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const r = classifyContent(png);
    assert.equal(r.format, 'png');
    assert.equal(r.category, 'binary');
  });
});

// ── Text format detection ────────────────────────────────────────

describe('classifyContent — markdown from string', () => {
  it('detects markdown with heading and body', () => {
    const r = classifyContent('# Heading\n\nsome body text');
    assert.equal(r.format, 'markdown');
    assert.equal(r.category, 'text');
  });
});

describe('classifyContent — heading-only is markdown (T814 regression)', () => {
  it('heading-only string is classified as markdown', () => {
    const r = classifyContent('# Only heading');
    assert.equal(r.format, 'markdown');
  });
});

describe('classifyContent — JSON from string', () => {
  it('detects JSON structured format', () => {
    const r = classifyContent('{"key": 1, "ok": true}');
    assert.equal(r.format, 'json');
    assert.equal(r.category, 'structured');
    assert.equal(r.confidence, 1.0);
  });
});

describe('classifyContent — Rust code from string', () => {
  it('detects Rust source code', () => {
    const r = classifyContent('pub fn main() {\n    let x = 1;\n}');
    assert.equal(r.format, 'rust');
  });
});

describe('classifyContent — plain text from string', () => {
  it('classifies unrecognised text as plainText', () => {
    const r = classifyContent('just a simple paragraph');
    assert.equal(r.format, 'plainText');
  });
});

// ── Edge cases ───────────────────────────────────────────────────

describe('classifyContent — empty input', () => {
  it('returns unknown format with 0 confidence', () => {
    const r = classifyContent('');
    assert.equal(r.format, 'unknown');
    assert.equal(r.confidence, 0);
  });
});

// ── Input type variants ──────────────────────────────────────────

describe('classifyContent — Buffer input', () => {
  it('accepts Node.js Buffer and detects ZIP', () => {
    const zip = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
    const r = classifyContent(zip);
    assert.equal(r.format, 'zip');
  });
});

describe('classifyContent — Uint8Array and Buffer equivalence', () => {
  it('produces identical results for equivalent Uint8Array and Buffer', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const buf = Buffer.from(gif);
    const r1 = classifyContent(gif);
    const r2 = classifyContent(buf);
    assert.deepEqual(r1, r2);
  });
});

// ── detectFormatFromClassification ──────────────────────────────

describe('detectFormatFromClassification — legacy format mapping', () => {
  it('maps json → json', () => {
    const r: ClassificationResult = { format: 'json', category: 'structured', mimeType: 'application/json', confidence: 1, isExtractable: true };
    assert.equal(detectFormatFromClassification(r), 'json');
  });

  it('maps markdown → markdown', () => {
    const r: ClassificationResult = { format: 'markdown', category: 'text', mimeType: 'text/markdown', confidence: 0.8, isExtractable: true };
    assert.equal(detectFormatFromClassification(r), 'markdown');
  });

  it('maps typescript → code', () => {
    const r: ClassificationResult = { format: 'typescript', category: 'text', mimeType: 'text/typescript', confidence: 0.8, isExtractable: true };
    assert.equal(detectFormatFromClassification(r), 'code');
  });

  it('maps pdf → text (binary formats fall through to text)', () => {
    const r: ClassificationResult = { format: 'pdf', category: 'binary', mimeType: 'application/pdf', confidence: 1.0, isExtractable: true };
    assert.equal(detectFormatFromClassification(r), 'text');
  });

  it('maps unknown → text', () => {
    const r: ClassificationResult = { format: 'unknown', category: 'unknown', mimeType: 'application/octet-stream', confidence: 0, isExtractable: false };
    assert.equal(detectFormatFromClassification(r), 'text');
  });
});
