/**
 * CLI integration tests for blob commands — T428.7 (T463)
 *
 * Tests llmtxt attach / detach / blobs by running the CLI as a child process
 * against a real LocalBackend in a temp directory.
 *
 * Tests:
 *   - attach: happy path (prints hash + size)
 *   - attach: --name override
 *   - attach: --content-type override
 *   - attach: auto-detect MIME from extension
 *   - attach: file not found exits non-zero
 *   - detach: removes attachment and prints confirmation
 *   - detach: missing blob exits non-zero
 *   - blobs: renders table of all active attachments
 *   - blobs: prints "No blobs" message when none exist
 *   - Error cases: missing positional args exit non-zero
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ── Paths ──────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Root of the packages/llmtxt package (where node_modules/tsx lives). */
const PKG_ROOT = path.resolve(__dirname, '../..');

/** Path to the CLI entry point (absolute). */
const CLI_PATH = path.resolve(PKG_ROOT, 'src/cli/llmtxt.ts');

// ── Helpers ────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'llmtxt-blob-cli-test-'));
}

/**
 * Run the CLI as a child process via tsx.
 * cwd is always PKG_ROOT so that node_modules/tsx is found.
 * Storage paths in args must be absolute.
 * Returns { stdout, stderr, status }.
 */
function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(
    'node',
    ['--import', 'tsx/esm', CLI_PATH, ...args],
    { cwd: PKG_ROOT, encoding: 'utf8', timeout: 30_000 }
  );
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
}

/** Write a temp file with given content and return its absolute path. */
function writeTempFile(dir: string, name: string, content: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

// ── Test suite ─────────────────────────────────────────────────────

describe('CLI — blob commands', () => {
  let tmpDir: string;
  let storageDir: string;
  let fileDir: string;

  before(() => {
    tmpDir = makeTempDir();
    storageDir = path.join(tmpDir, 'storage');
    fileDir = path.join(tmpDir, 'files');
    fs.mkdirSync(storageDir, { recursive: true });
    fs.mkdirSync(fileDir, { recursive: true });

    // Initialise the LocalBackend (creates SQLite DB + identity.json)
    const init = runCli(['--storage', storageDir, 'init']);
    assert.equal(init.status, 0, `init failed: ${init.stderr}`);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── attach ─────────────────────────────────────────────────────────

  describe('attach', () => {
    it('attaches a file and prints hash + size', () => {
      const filePath = writeTempFile(fileDir, 'hello.txt', 'hello world from CLI');
      const result = runCli(['--storage', storageDir, 'attach', 'cli-doc-1', filePath]);

      assert.equal(result.status, 0, `Expected exit 0, got ${result.status}: ${result.stderr}`);
      assert.ok(result.stdout.includes('Attached hello.txt'), `stdout must contain "Attached hello.txt": ${result.stdout}`);
      assert.ok(result.stdout.includes('Hash:'), 'stdout must contain Hash:');
      assert.ok(result.stdout.includes('Size:'), 'stdout must contain Size:');
    });

    it('supports --name override', () => {
      const filePath = writeTempFile(fileDir, 'original.txt', 'renamed content');
      const result = runCli([
        '--storage', storageDir, 'attach', 'cli-doc-rename', filePath,
        '--name', 'custom-name.txt',
      ]);

      assert.equal(result.status, 0, `Expected exit 0: ${result.stderr}`);
      assert.ok(result.stdout.includes('Attached custom-name.txt'), 'must use custom name');
    });

    it('supports --content-type override', () => {
      const filePath = writeTempFile(fileDir, 'data.bin', 'binary data');
      const result = runCli([
        '--storage', storageDir, 'attach', 'cli-doc-ct', filePath,
        '--content-type', 'application/custom',
      ]);

      assert.equal(result.status, 0, `Expected exit 0: ${result.stderr}`);
      assert.ok(result.stdout.includes('Attached'), 'must attach successfully');
    });

    it('auto-detects MIME type from .png extension', () => {
      const filePath = writeTempFile(fileDir, 'image.png', '\x89PNG fake image bytes');
      const result = runCli(['--storage', storageDir, 'attach', 'cli-doc-png', filePath]);

      assert.equal(result.status, 0, `Expected exit 0: ${result.stderr}`);
      assert.ok(result.stdout.includes('Attached image.png'), 'must attach with detected name');
    });

    it('exits non-zero when file not found', () => {
      const result = runCli([
        '--storage', storageDir, 'attach', 'cli-doc-missing', '/tmp/does-not-exist-xyz-blob-test.bin',
      ]);

      assert.notEqual(result.status, 0, 'must exit non-zero for missing file');
      assert.ok(
        result.stderr.includes('not found') || result.stderr.includes('Error'),
        `stderr must indicate error: ${result.stderr}`
      );
    });

    it('exits non-zero when slug or filepath arg missing', () => {
      const result = runCli(['--storage', storageDir, 'attach']);
      assert.notEqual(result.status, 0, 'must exit non-zero for missing args');
    });
  });

  // ── blobs ───────────────────────────────────────────────────────────

  describe('blobs', () => {
    it('prints "No blobs" when document has no attachments', () => {
      const result = runCli(['--storage', storageDir, 'blobs', 'empty-doc-blobs-cli']);

      assert.equal(result.status, 0, `Expected exit 0: ${result.stderr}`);
      assert.ok(result.stdout.includes('No blobs'), `must print No blobs message: ${result.stdout}`);
    });

    it('renders a table of active attachments', () => {
      // Attach a file first
      const filePath = writeTempFile(fileDir, 'table-test.pdf', 'pdf data for table test');
      const attachResult = runCli(['--storage', storageDir, 'attach', 'cli-table-doc', filePath]);
      assert.equal(attachResult.status, 0, `attach failed: ${attachResult.stderr}`);

      // Now list blobs
      const result = runCli(['--storage', storageDir, 'blobs', 'cli-table-doc']);

      assert.equal(result.status, 0, `Expected exit 0: ${result.stderr}`);
      assert.ok(result.stdout.includes('NAME'), 'must include NAME header');
      assert.ok(result.stdout.includes('SIZE'), 'must include SIZE header');
      assert.ok(result.stdout.includes('TYPE'), 'must include TYPE header');
      assert.ok(result.stdout.includes('UPLOADED BY'), 'must include UPLOADED BY header');
      assert.ok(result.stdout.includes('UPLOADED AT'), 'must include UPLOADED AT header');
      assert.ok(result.stdout.includes('table-test.pdf'), 'must list the attached blob name');
    });

    it('exits non-zero when slug arg missing', () => {
      const result = runCli(['--storage', storageDir, 'blobs']);
      assert.notEqual(result.status, 0, 'must exit non-zero for missing slug');
    });
  });

  // ── detach ──────────────────────────────────────────────────────────

  describe('detach', () => {
    it('detaches a blob and prints confirmation', () => {
      const filePath = writeTempFile(fileDir, 'to-detach.txt', 'will be detached');
      const docSlug = 'cli-detach-doc';

      // Attach first
      const attachResult = runCli(['--storage', storageDir, 'attach', docSlug, filePath]);
      assert.equal(attachResult.status, 0, `attach failed: ${attachResult.stderr}`);

      // Detach
      const result = runCli(['--storage', storageDir, 'detach', docSlug, 'to-detach.txt']);

      assert.equal(result.status, 0, `Expected exit 0: ${result.stderr}`);
      assert.ok(result.stdout.includes('Detached'), `must print Detached confirmation: ${result.stdout}`);

      // Verify removed from list
      const listResult = runCli(['--storage', storageDir, 'blobs', docSlug]);
      assert.ok(
        listResult.stdout.includes('No blobs') || !listResult.stdout.includes('to-detach.txt'),
        'detached blob must no longer appear in list'
      );
    });

    it('exits non-zero when blob does not exist', () => {
      const result = runCli([
        '--storage', storageDir, 'detach', 'cli-detach-missing-doc', 'ghost.txt',
      ]);

      assert.notEqual(result.status, 0, 'must exit non-zero for non-existent blob');
    });

    it('exits non-zero when slug or blobname arg missing', () => {
      const noArgs = runCli(['--storage', storageDir, 'detach']);
      assert.notEqual(noArgs.status, 0, 'must exit non-zero for missing args');

      const oneArg = runCli(['--storage', storageDir, 'detach', 'my-doc']);
      assert.notEqual(oneArg.status, 0, 'must exit non-zero for missing blobname');
    });
  });
});
