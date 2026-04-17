/**
 * Document import parser for all 4 export formats (T427.8).
 *
 * Parses a file on disk and extracts:
 *   - slug       (from frontmatter or filename stem)
 *   - title      (from frontmatter or filename stem)
 *   - content    (body text)
 *   - contentHash (expected hash from frontmatter, if present)
 *
 * Supported file types: .md, .llmtxt, .json, .txt
 *
 * @see docs/specs/ARCH-T427-document-export-ssot.md §5.8, §11
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { ExportError } from '../core/backend.js';

// ── Parsed import payload ───────────────────────────────────────

export interface ParsedImport {
  /** URL-safe slug (from frontmatter, or derived from filename). */
  slug: string;
  /** Human-readable title (from frontmatter, or derived from filename). */
  title: string;
  /** Raw body content. */
  content: string;
  /**
   * Expected SHA-256 hex of content, if present in frontmatter.
   * Callers MUST verify this matches the actual body before importing.
   */
  expectedContentHash: string | null;
}

// ── SHA-256 helper ──────────────────────────────────────────────

function sha256Body(body: string): string {
  return createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');
}

// ── Frontmatter parser ──────────────────────────────────────────

/**
 * Minimal line-by-line YAML frontmatter parser.
 *
 * The canonical frontmatter schema is tightly constrained (spec §4.1), so a
 * full YAML library is not required. The parser handles:
 *   - `key: "value"`    (string values — double-quoted)
 *   - `key: value`      (unquoted strings and integers)
 *   - `contributors:`   (block sequence; items start with `  - `)
 *
 * Returns `null` when no opening `---` fence is found on line 1.
 */
function parseFrontmatter(text: string): {
  fields: Record<string, string | string[] | number>;
  body: string;
} | null {
  const lines = text.split('\n');

  // Opening fence must be the first line.
  if (lines[0]?.trimEnd() !== '---') return null;

  const fields: Record<string, string | string[] | number> = {};
  let closingIdx = -1;
  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;

    // Closing fence.
    if (line.trimEnd() === '---') {
      // Flush any open list.
      if (currentKey !== null && currentList !== null) {
        fields[currentKey] = currentList;
        currentList = null;
        currentKey = null;
      }
      closingIdx = i;
      break;
    }

    // Sequence item (must follow a list-typed key).
    if (line.startsWith('  - ') && currentList !== null) {
      currentList.push(line.slice(4).trim().replace(/^"|"$/g, ''));
      continue;
    }

    // Flush any open list when we hit a non-item line.
    if (currentList !== null && currentKey !== null) {
      fields[currentKey] = currentList;
      currentList = null;
      currentKey = null;
    }

    // Key: value line.
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    // Empty value after key = start of block sequence.
    if (rawValue === '') {
      currentKey = key;
      currentList = [];
      continue;
    }

    // Remove surrounding double-quotes if present.
    const value = rawValue.startsWith('"') && rawValue.endsWith('"')
      ? rawValue.slice(1, -1)
      : rawValue;

    // Detect integer values (version, etc.)
    const asInt = Number.parseInt(value, 10);
    if (!Number.isNaN(asInt) && String(asInt) === value) {
      fields[key] = asInt;
    } else {
      fields[key] = value;
    }
  }

  if (closingIdx === -1) {
    // No closing fence — treat entire text as body with no frontmatter.
    return null;
  }

  // Body is everything after the closing fence + optional blank line.
  const bodyLines = lines.slice(closingIdx + 1);
  // Drop exactly one leading blank line (spec §4.2).
  if (bodyLines.length > 0 && bodyLines[0]?.trim() === '') {
    bodyLines.shift();
  }
  const body = bodyLines.join('\n');

  return { fields, body };
}

// ── Filename stem helper ────────────────────────────────────────

/** Derive a slug-like value from a filename stem (no extension). */
function stemFromFilePath(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

// ── Format-specific parsers ─────────────────────────────────────

function parseMarkdownOrLlmtxt(filePath: string, text: string): ParsedImport {
  const parsed = parseFrontmatter(text);
  const stem = stemFromFilePath(filePath);

  if (parsed === null) {
    // No frontmatter — treat entire file as body.
    return {
      slug: stem,
      title: stem,
      content: text.replace(/\n+$/, '') + '\n',
      expectedContentHash: null,
    };
  }

  const { fields, body } = parsed;

  const slug = typeof fields['slug'] === 'string' ? fields['slug'] : stem;
  const title = typeof fields['title'] === 'string' ? fields['title'] : stem;
  const expectedContentHash = typeof fields['content_hash'] === 'string'
    ? fields['content_hash']
    : null;

  // Normalise body: strip trailing blank lines, ensure exactly one trailing newline.
  const normBody = body.replace(/\n+$/, '') + '\n';

  return { slug, title, content: normBody, expectedContentHash };
}

function parseJson(filePath: string, text: string): ParsedImport {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ExportError('PARSE_FAILED', `Failed to parse JSON from ${filePath}: ${msg}`);
  }

  const stem = stemFromFilePath(filePath);

  const content = typeof parsed['content'] === 'string' ? parsed['content'] : '';
  const slug = typeof parsed['slug'] === 'string' ? parsed['slug'] : stem;
  const title = typeof parsed['title'] === 'string' ? parsed['title'] : stem;
  const expectedContentHash = typeof parsed['content_hash'] === 'string'
    ? parsed['content_hash']
    : null;

  // Normalise content trailing newline.
  const normContent = content.replace(/\n+$/, '') + '\n';

  return { slug, title, content: normContent, expectedContentHash };
}

function parseTxt(filePath: string, text: string): ParsedImport {
  const stem = stemFromFilePath(filePath);
  // Plain text: body only, no frontmatter.
  const normContent = text.replace(/\n+$/, '') + '\n';
  return {
    slug: stem,
    title: stem,
    content: normContent,
    expectedContentHash: null,
  };
}

// ── Main entry point ────────────────────────────────────────────

/**
 * Parse an import file and return a ParsedImport.
 *
 * @throws {ExportError} PARSE_FAILED on I/O or parse errors.
 * @throws {ExportError} HASH_MISMATCH when frontmatter content_hash does not
 *   match the actual body SHA-256.
 */
export function parseImportFile(filePath: string): ParsedImport {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ExportError('PARSE_FAILED', `Cannot read import file ${filePath}: ${msg}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  let result: ParsedImport;

  switch (ext) {
    case '.md':
    case '.llmtxt':
      result = parseMarkdownOrLlmtxt(filePath, text);
      break;
    case '.json':
      result = parseJson(filePath, text);
      break;
    case '.txt':
      result = parseTxt(filePath, text);
      break;
    default:
      // Unknown extension — try markdown-style parse, fall back to plain text.
      result = parseMarkdownOrLlmtxt(filePath, text);
      break;
  }

  // Validate content_hash if present in frontmatter (spec §5.8).
  if (result.expectedContentHash !== null) {
    const actual = sha256Body(result.content);
    if (actual !== result.expectedContentHash) {
      throw new ExportError(
        'HASH_MISMATCH',
        `Content hash mismatch in ${filePath}: frontmatter says ${result.expectedContentHash} but body SHA-256 is ${actual}`,
      );
    }
  }

  return result;
}
