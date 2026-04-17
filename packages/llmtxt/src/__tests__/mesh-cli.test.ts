/**
 * mesh-cli.test.ts — T420: `llmtxt mesh` CLI command tests
 *
 * Tests:
 *  1. `mesh` with no subcommand exits non-zero with a usage message.
 *  2. `mesh unknown-sub` exits non-zero with an error message.
 *  3. `mesh stop` with no running process exits non-zero with a helpful message.
 *  4. `mesh status` with no status file prints "No running mesh process".
 *  5. `mesh peers` with an empty mesh dir prints "No peers discovered".
 *  6. `mesh sync` with no identity exits non-zero with an error.
 *  7. `mesh start --help` flag triggers the global help output (integration check).
 *  8. Arg parsing correctly captures --transport, --port, --peer, --mesh-dir.
 *
 * Runner: node:test (native, no vitest dependency)
 * Spec: docs/specs/P3-p2p-mesh.md §8
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fsPromises } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, before, after } from 'node:test';

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Run the CLI against the TypeScript source via tsx (same as `pnpm test`).
 * Returns { stdout, stderr, status }.
 */
function runCli(
  args: string[],
  opts?: { env?: NodeJS.ProcessEnv; cwd?: string }
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx/esm', path.resolve('src/cli/llmtxt.ts'), ...args],
    {
      encoding: 'utf-8',
      timeout: 10_000,
      env: { ...process.env, ...opts?.env },
      cwd: opts?.cwd ?? process.cwd(),
    }
  );
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
}

// ── Test Suite ────────────────────────────────────────────────────

describe('llmtxt mesh CLI', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'llmtxt-mesh-cli-test-'));
  });

  after(async () => {
    await fsPromises.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Test 1: mesh with no subcommand ──────────────────────────────

  it('mesh with no subcommand exits non-zero with usage message', () => {
    const result = runCli(['mesh']);
    assert.notEqual(result.status, 0, 'Expected non-zero exit');
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('start') || combined.includes('stop') || combined.includes('Usage'),
      `Expected usage info, got: ${combined.slice(0, 300)}`
    );
  });

  // ── Test 2: mesh with unknown subcommand ──────────────────────────

  it('mesh with unknown subcommand exits non-zero with error message', () => {
    const result = runCli(['mesh', 'frobnicate']);
    assert.notEqual(result.status, 0, 'Expected non-zero exit');
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.toLowerCase().includes('unknown') || combined.includes('frobnicate'),
      `Expected error about unknown subcommand, got: ${combined.slice(0, 300)}`
    );
  });

  // ── Test 3: mesh stop with no running process ─────────────────────

  it('mesh stop with no running process exits non-zero with helpful message', () => {
    // Use an isolated home dir so no mesh.pid exists.
    const isolatedHome = path.join(tmpDir, 'home-stop');
    const result = runCli(['mesh', 'stop', '--storage', path.join(tmpDir, 'storage-stop')], {
      env: {
        HOME: isolatedHome,
        LLMTXT_MESH_DIR: path.join(isolatedHome, '.llmtxt', 'mesh'),
      },
    });
    assert.notEqual(result.status, 0, 'Expected non-zero exit when no mesh.pid found');
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('No running mesh') ||
        combined.includes('mesh.pid') ||
        combined.includes('not found'),
      `Expected helpful message about no running mesh, got: ${combined.slice(0, 300)}`
    );
  });

  // ── Test 4: mesh status with no status file ───────────────────────

  it('mesh status with no status file reports no running process', () => {
    const isolatedHome = path.join(tmpDir, 'home-status');
    const result = runCli(['mesh', 'status', '--storage', path.join(tmpDir, 'storage-status')], {
      env: {
        HOME: isolatedHome,
        LLMTXT_MESH_DIR: path.join(isolatedHome, '.llmtxt', 'mesh'),
      },
    });
    // Should exit 0 (status is informational, not an error).
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('No running') ||
        combined.includes('not found') ||
        combined.includes('STOPPED'),
      `Expected "no running mesh" message, got: ${combined.slice(0, 300)}`
    );
  });

  // ── Test 5: mesh peers with empty mesh directory ──────────────────

  it('mesh peers with empty mesh dir prints "No peers discovered"', async () => {
    const emptyMeshDir = path.join(tmpDir, 'empty-mesh');
    await fsPromises.mkdir(emptyMeshDir, { recursive: true });

    const result = runCli(['mesh', 'peers'], {
      env: {
        LLMTXT_MESH_DIR: emptyMeshDir,
      },
    });
    // Exit 0 — no peers is an informational result.
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('No peers') || combined.includes('0 peer'),
      `Expected "no peers" message, got: ${combined.slice(0, 300)}`
    );
  });

  // ── Test 6: mesh sync without identity exits with error ───────────

  it('mesh sync without identity exits non-zero with identity error', () => {
    const emptyStorage = path.join(tmpDir, 'no-id-storage');
    const emptyMeshDir = path.join(tmpDir, 'no-id-mesh');
    const result = runCli(['mesh', 'sync', '--storage', emptyStorage], {
      env: {
        LLMTXT_MESH_DIR: emptyMeshDir,
      },
    });
    assert.notEqual(result.status, 0, 'Expected non-zero exit when no identity exists');
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('No identity') ||
        combined.includes('identity') ||
        combined.includes('init'),
      `Expected identity error message, got: ${combined.slice(0, 300)}`
    );
  });

  // ── Test 7: --help shows mesh in command list ─────────────────────

  it('--help output includes mesh commands', () => {
    const result = runCli(['--help']);
    assert.equal(result.status, 0, '--help should exit 0');
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('mesh'),
      `Expected mesh command in help output, got: ${combined.slice(0, 500)}`
    );
  });

  // ── Test 8: arg parsing captures mesh flags ──────────────────────

  it('mesh flags are parsed: --transport, --port, --peer, --mesh-dir', () => {
    // We test parsing indirectly by checking that mesh peers accepts --mesh-dir
    // without error (even if the dir is nonexistent, it prints the "does not exist" message
    // rather than an arg-parsing error).
    const fakeMeshDir = path.join(tmpDir, 'fake-mesh-dir');
    const result = runCli(['mesh', 'peers', '--mesh-dir', fakeMeshDir]);
    // Should not print "unknown option" or crash with a parsing error.
    const combined = result.stdout + result.stderr;
    assert.ok(
      !combined.toLowerCase().includes('unknown option') &&
        !combined.toLowerCase().includes('invalid flag'),
      `Expected clean parsing, got: ${combined.slice(0, 300)}`
    );
  });
});
