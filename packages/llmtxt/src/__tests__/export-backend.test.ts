/**
 * Integration tests for LocalBackend.exportDocument() and exportAll() — T427.6.
 *
 * Tests:
 *   - exportDocument: all 4 formats (markdown, json, txt, llmtxt)
 *   - exportDocument: file written atomically with correct content
 *   - exportDocument: fileHash = SHA-256 of written bytes
 *   - exportDocument: DOC_NOT_FOUND ExportError thrown for unknown slug
 *   - exportDocument: VERSION_NOT_FOUND ExportError thrown for doc with no versions
 *   - exportAll: exports all docs, skips failures gracefully
 *
 * @see docs/specs/ARCH-T427-document-export-ssot.md §5.3, §5.5
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

import { LocalBackend } from '../local/local-backend.js';
import { ExportError } from '../core/backend.js';

// ── Helpers ────────────────────────────────────────────────────

/** Make a unique temp directory for test isolation. */
function makeTmpDir(prefix = 'llmtxt-export-test'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

/** Compute SHA-256 hex of a file's contents. */
function sha256File(filePath: string): string {
  const bytes = fs.readFileSync(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

// ── Shared backend fixture ─────────────────────────────────────

describe('LocalBackend.exportDocument() — T427.6', () => {
  let storagePath: string;
  let outputDir: string;
  let backend: LocalBackend;

  before(async () => {
    storagePath = makeTmpDir('storage');
    outputDir = makeTmpDir('output');
    backend = new LocalBackend({ storagePath });
    await backend.open();
  });

  after(async () => {
    await backend.close();
    fs.rmSync(storagePath, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  // ── Fixture setup (runs before each test to keep isolation) ──

  /** Create a fresh doc + version and return the slug. */
  async function createDocWithVersion(
    title = 'Test Document',
    content = '# Test Document\n\nHello world.',
  ): Promise<string> {
    const doc = await backend.createDocument({ title, createdBy: 'agent-test' });
    await backend.publishVersion({
      documentId: doc.id,
      content,
      patchText: '',
      createdBy: 'agent-test',
      changelog: 'Initial version',
    });
    return doc.slug;
  }

  // ── markdown format ──────────────────────────────────────────

  it('exports a document in markdown format', async () => {
    const slug = await createDocWithVersion('Markdown Doc', '# Markdown Doc\n\nSome content.');
    const outputPath = path.join(outputDir, `${slug}.md`);

    const result = await backend.exportDocument({
      slug,
      format: 'markdown',
      outputPath,
    });

    // File exists.
    assert.ok(fs.existsSync(outputPath), 'output file must exist');

    // Result fields.
    assert.strictEqual(result.slug, slug);
    assert.strictEqual(result.version, 1);
    assert.ok(result.filePath === path.resolve(outputPath), 'filePath must be absolute');
    assert.ok(result.byteCount > 0, 'byteCount must be positive');
    assert.ok(result.exportedAt, 'exportedAt must be set');
    assert.strictEqual(result.signatureHex, null, 'signatureHex must be null when sign=false');

    // fileHash matches actual file.
    const actualHash = sha256File(outputPath);
    assert.strictEqual(result.fileHash, actualHash, 'fileHash must match SHA-256 of written file');

    // Content structure: YAML frontmatter + blank line + body.
    const content = fs.readFileSync(outputPath, 'utf8');
    assert.ok(content.startsWith('---\n'), 'markdown must start with ---');
    assert.ok(content.includes('slug:'), 'markdown must contain slug field');
    assert.ok(content.includes('---\n\n# Markdown Doc'), 'body must follow closing fence');
    assert.ok(content.endsWith('\n'), 'must end with newline');
    assert.ok(!content.endsWith('\n\n'), 'must not end with double newline');
  });

  // ── json format ──────────────────────────────────────────────

  it('exports a document in json format', async () => {
    const slug = await createDocWithVersion('JSON Doc', '# JSON Doc\n\nData here.');
    const outputPath = path.join(outputDir, `${slug}.json`);

    const result = await backend.exportDocument({
      slug,
      format: 'json',
      outputPath,
    });

    assert.ok(fs.existsSync(outputPath), 'output file must exist');
    const actualHash = sha256File(outputPath);
    assert.strictEqual(result.fileHash, actualHash, 'fileHash must match');

    const raw = fs.readFileSync(outputPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    assert.strictEqual(parsed['schema'], 'llmtxt-export/1', 'schema must be llmtxt-export/1');
    assert.strictEqual(parsed['slug'], slug);
    assert.strictEqual(parsed['version'], 1);
    assert.ok(typeof parsed['content'] === 'string', 'content must be a string');
    assert.ok(raw.endsWith('\n'), 'must end with newline');
  });

  // ── txt format ───────────────────────────────────────────────

  it('exports a document in txt format', async () => {
    const slug = await createDocWithVersion('TXT Doc', '# TXT Doc\n\nPlain text output.');
    const outputPath = path.join(outputDir, `${slug}.txt`);

    const result = await backend.exportDocument({
      slug,
      format: 'txt',
      outputPath,
    });

    assert.ok(fs.existsSync(outputPath), 'output file must exist');
    const actualHash = sha256File(outputPath);
    assert.strictEqual(result.fileHash, actualHash, 'fileHash must match');

    const content = fs.readFileSync(outputPath, 'utf8');
    // txt format: no YAML frontmatter.
    assert.ok(!content.includes('---'), 'txt must have no frontmatter');
    assert.ok(content.includes('# TXT Doc'), 'body must be present');
    assert.ok(content.endsWith('\n'), 'must end with newline');
  });

  // ── llmtxt format ────────────────────────────────────────────

  it('exports a document in llmtxt format', async () => {
    const slug = await createDocWithVersion('LLMtxt Doc', '# LLMtxt Doc\n\nNative format.');
    const outputPath = path.join(outputDir, `${slug}.llmtxt`);

    const result = await backend.exportDocument({
      slug,
      format: 'llmtxt',
      outputPath,
    });

    assert.ok(fs.existsSync(outputPath), 'output file must exist');
    const actualHash = sha256File(outputPath);
    assert.strictEqual(result.fileHash, actualHash, 'fileHash must match');

    const content = fs.readFileSync(outputPath, 'utf8');
    assert.ok(content.startsWith('---\n'), 'llmtxt must start with ---');
    assert.ok(content.includes('chain_ref:'), 'llmtxt must have chain_ref field');
    assert.ok(content.includes('format: "llmtxt/1"'), 'llmtxt must have format field');
    assert.ok(content.endsWith('\n'), 'must end with newline');
  });

  // ── DOC_NOT_FOUND ────────────────────────────────────────────

  it('throws ExportError(DOC_NOT_FOUND) for unknown slug', async () => {
    const outputPath = path.join(outputDir, 'no-such-doc.md');
    let thrown: unknown;

    try {
      await backend.exportDocument({
        slug: 'this-slug-does-not-exist-xyz',
        format: 'markdown',
        outputPath,
      });
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown instanceof ExportError, 'must throw ExportError');
    assert.strictEqual((thrown as ExportError).code, 'DOC_NOT_FOUND');
  });

  // ── VERSION_NOT_FOUND ─────────────────────────────────────────

  it('throws ExportError(VERSION_NOT_FOUND) for doc with no versions', async () => {
    // Create a doc but do NOT publish any version.
    const doc = await backend.createDocument({
      title: 'Versionless Doc',
      createdBy: 'agent-test',
    });
    const outputPath = path.join(outputDir, 'versionless.md');
    let thrown: unknown;

    try {
      await backend.exportDocument({
        slug: doc.slug,
        format: 'markdown',
        outputPath,
      });
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown instanceof ExportError, 'must throw ExportError');
    assert.strictEqual((thrown as ExportError).code, 'VERSION_NOT_FOUND');
  });

  // ── includeMetadata=false ─────────────────────────────────────

  it('respects includeMetadata=false for markdown format', async () => {
    const slug = await createDocWithVersion('No-Meta Doc', '# No-Meta Doc\n\nBody only.');
    const outputPath = path.join(outputDir, `${slug}-nometa.md`);

    await backend.exportDocument({
      slug,
      format: 'markdown',
      outputPath,
      includeMetadata: false,
    });

    const content = fs.readFileSync(outputPath, 'utf8');
    assert.ok(!content.includes('---'), 'no frontmatter when includeMetadata=false');
    assert.ok(content.startsWith('# No-Meta Doc'), 'body must start immediately');
  });

  // ── exportAll ─────────────────────────────────────────────────

  describe('exportAll()', () => {
    let allOutputDir: string;
    let allBackend: LocalBackend;
    let allStoragePath: string;

    before(async () => {
      allStoragePath = makeTmpDir('all-storage');
      allOutputDir = makeTmpDir('all-output');
      allBackend = new LocalBackend({ storagePath: allStoragePath });
      await allBackend.open();

      // Create 3 documents with versions.
      for (const title of ['Alpha', 'Beta', 'Gamma']) {
        const doc = await allBackend.createDocument({
          title,
          createdBy: 'agent-bulk',
        });
        await allBackend.publishVersion({
          documentId: doc.id,
          content: `# ${title}\n\nContent for ${title}.`,
          patchText: '',
          createdBy: 'agent-bulk',
          changelog: 'v1',
        });
      }
    });

    after(async () => {
      await allBackend.close();
      fs.rmSync(allStoragePath, { recursive: true, force: true });
      fs.rmSync(allOutputDir, { recursive: true, force: true });
    });

    it('exports all documents in markdown format', async () => {
      const result = await allBackend.exportAll({
        format: 'markdown',
        outputDir: allOutputDir,
      });

      assert.strictEqual(result.exported.length, 3, 'must export 3 documents');
      assert.strictEqual(result.skipped.length, 0, 'must have no failures');
      assert.strictEqual(result.failedCount, 0);
      assert.strictEqual(result.totalCount, 3);

      // Each exported file must exist.
      for (const r of result.exported) {
        assert.ok(fs.existsSync(r.filePath), `file must exist: ${r.filePath}`);
        // fileHash must match the written file.
        const actualHash = sha256File(r.filePath);
        assert.strictEqual(r.fileHash, actualHash, `fileHash mismatch for ${r.slug}`);
      }
    });

    it('exports all documents in json format', async () => {
      const jsonOutputDir = makeTmpDir('json-output');
      try {
        const result = await allBackend.exportAll({
          format: 'json',
          outputDir: jsonOutputDir,
        });

        assert.strictEqual(result.exported.length, 3, 'must export 3 documents');
        for (const r of result.exported) {
          assert.ok(r.filePath.endsWith('.json'), 'json export must have .json extension');
        }
      } finally {
        fs.rmSync(jsonOutputDir, { recursive: true, force: true });
      }
    });

    it('exports all documents in txt format', async () => {
      const txtOutputDir = makeTmpDir('txt-output');
      try {
        const result = await allBackend.exportAll({
          format: 'txt',
          outputDir: txtOutputDir,
        });

        assert.strictEqual(result.exported.length, 3, 'must export 3 documents');
        for (const r of result.exported) {
          assert.ok(r.filePath.endsWith('.txt'), 'txt export must have .txt extension');
        }
      } finally {
        fs.rmSync(txtOutputDir, { recursive: true, force: true });
      }
    });

    it('exports all documents in llmtxt format', async () => {
      const llmOutputDir = makeTmpDir('llmtxt-output');
      try {
        const result = await allBackend.exportAll({
          format: 'llmtxt',
          outputDir: llmOutputDir,
        });

        assert.strictEqual(result.exported.length, 3, 'must export 3 documents');
        for (const r of result.exported) {
          assert.ok(r.filePath.endsWith('.llmtxt'), 'llmtxt export must have .llmtxt extension');
        }
      } finally {
        fs.rmSync(llmOutputDir, { recursive: true, force: true });
      }
    });

    it('collects skipped entries for docs with no versions', async () => {
      // Create a doc with no published versions.
      await allBackend.createDocument({ title: 'No Versions', createdBy: 'agent-bulk' });

      const skipOutputDir = makeTmpDir('skip-output');
      try {
        const result = await allBackend.exportAll({
          format: 'markdown',
          outputDir: skipOutputDir,
        });

        // Should have exported the 3 good docs; the versionless one is skipped.
        assert.ok(result.exported.length >= 3, 'good docs must be exported');
        assert.ok(result.skipped.length >= 1, 'versionless doc must be in skipped');
        assert.ok(
          result.skipped.some((s) => s.slug === 'no-versions' || s.reason.includes('no versions')),
          'skipped entry must reference the versionless doc',
        );
        assert.strictEqual(result.failedCount, result.skipped.length);
        assert.strictEqual(result.totalCount, result.exported.length + result.skipped.length);
      } finally {
        fs.rmSync(skipOutputDir, { recursive: true, force: true });
      }
    });
  });
});
