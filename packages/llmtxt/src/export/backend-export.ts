/**
 * Shared export-to-disk logic for Backend implementations (T427.6).
 *
 * This module provides the core mechanics shared by LocalBackend, RemoteBackend,
 * and PostgresBackend:
 *  - Format dispatch (markdown / json / txt / llmtxt)
 *  - Atomic file write (.tmp + rename)
 *  - SHA-256 file hash computation
 *  - Optional Ed25519 signing over the file hash
 *  - Content hash computation for DocumentExportState
 *
 * Backend implementations call `writeExportFile()` after building a
 * `DocumentExportState` from their storage layer.
 *
 * @see docs/specs/ARCH-T427-document-export-ssot.md §5.3, §6, §6.2
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { formatMarkdown } from './markdown.js';
import { formatJson } from './json.js';
import { formatTxt } from './txt.js';
import { formatLlmtxt } from './llmtxt.js';
import type { DocumentExportState } from './types.js';
import type {
  ExportDocumentParams,
  ExportDocumentResult,
  ExportFormat,
} from '../core/backend.js';
import { ExportError } from '../core/backend.js';

// Re-export types needed by the server-side HTTP route
export type { DocumentExportState } from './types.js';
export type { ExportFormat } from '../core/backend.js';

// ── File extension mapping §13 ──────────────────────────────────

/** Map from export format to file extension. */
export const FORMAT_EXT: Record<ExportFormat, string> = {
  markdown: 'md',
  json: 'json',
  txt: 'txt',
  llmtxt: 'llmtxt',
};

/** Map from export format to HTTP Content-Type. */
export const FORMAT_CONTENT_TYPE: Record<ExportFormat, string> = {
  markdown: 'text/markdown; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  llmtxt: 'application/x-llmtxt; charset=utf-8',
};

// ── Format dispatch ─────────────────────────────────────────────

/**
 * Serialize a DocumentExportState to a string using the requested format.
 *
 * @throws {ExportError} with code 'UNSUPPORTED_FORMAT' for unknown formats.
 */
export function serializeDocument(
  state: DocumentExportState,
  format: ExportFormat,
  opts: { includeMetadata?: boolean },
): string {
  const exportOpts = { includeMetadata: opts.includeMetadata !== false };

  switch (format) {
    case 'markdown':
      return formatMarkdown(state, exportOpts);
    case 'json':
      return formatJson(state, exportOpts);
    case 'txt':
      return formatTxt(state);
    case 'llmtxt':
      return formatLlmtxt(state, exportOpts);
    default: {
      // TypeScript exhaustiveness: this branch is never reached at compile time
      // when ExportFormat is fully handled above. Runtime guard for JS callers.
      const _exhaustive: never = format;
      throw new ExportError('UNSUPPORTED_FORMAT', `Unsupported export format: ${String(_exhaustive)}`);
    }
  }
}

// ── Atomic file write ───────────────────────────────────────────

/**
 * Atomically write `content` to `filePath`.
 *
 * Writes to a `.tmp` sibling, then renames to the target path. This prevents
 * partial files from being visible to other processes (spec §5.3).
 *
 * Creates intermediate directories via `mkdirSync({ recursive: true })`.
 *
 * @throws {ExportError} with code 'WRITE_FAILED' on any I/O error.
 */
function atomicWriteFile(filePath: string, content: Buffer): void {
  const dir = path.dirname(filePath);
  const tmpPath = filePath + '.tmp';

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, filePath);
  } catch (err: unknown) {
    // Best-effort cleanup of tmp file
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup error
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new ExportError('WRITE_FAILED', `Failed to write export file ${filePath}: ${msg}`);
  }
}

// ── SHA-256 file hash ───────────────────────────────────────────

/** Compute SHA-256 hex of a UTF-8 string's bytes. */
export function sha256Hex(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Compute SHA-256 hex of the body content (used as content_hash in frontmatter). */
export function contentHashHex(body: string): string {
  return createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');
}

// ── Sign ─────────────────────────────────────────────────────────

/**
 * Sign a 32-byte raw SHA-256 hash with the local Ed25519 identity.
 *
 * Loads the identity from `identityPath` (defaults to `~/.llmtxt/identity.key`).
 * Returns the 64-byte signature as lowercase hex.
 *
 * @throws {ExportError} with code 'SIGN_FAILED' if no identity is found or
 *   signing fails.
 */
async function signFileHash(fileHashHex: string, identityPath?: string): Promise<string> {
  // Dynamically import to avoid loading @noble/ed25519 in every bundle.
  const { AgentIdentity } = await import('../identity.js');

  let identity = await AgentIdentity.load();

  // If an explicit identityPath is given, try loading from that path.
  if (!identity && identityPath) {
    try {
      const { promises: fsP } = await import('node:fs');
      const raw = await fsP.readFile(identityPath, 'utf-8');
      const parsed = JSON.parse(raw) as { sk: string; pk: string };
      const { fromHex } = await import('../identity.js') as unknown as {
        fromHex: (h: string) => Uint8Array;
      };
      // AgentIdentity.fromSeed is public API
      const skBytes = Buffer.from(parsed.sk, 'hex');
      identity = await AgentIdentity.fromSeed(skBytes);
    } catch {
      // fall through to error below
    }
  }

  if (!identity) {
    throw new ExportError(
      'SIGN_FAILED',
      'No Ed25519 identity found. Run `llmtxt identity generate` to create one.',
    );
  }

  // Sign the raw 32 bytes of the file hash (not the hex string).
  const hashBytes = Buffer.from(fileHashHex, 'hex');
  const sig = await identity.sign(hashBytes);
  return Buffer.from(sig).toString('hex');
}

// ── Main entry point ────────────────────────────────────────────

/**
 * Write a DocumentExportState to disk and return an ExportDocumentResult.
 *
 * This is the canonical implementation shared by all Backend variants.
 * Backends build the `state` from their storage layer, then call this.
 *
 * @param state      - Fully populated document snapshot.
 * @param params     - ExportDocumentParams from the caller.
 * @param identityPath - Optional path to identity keypair (for sign=true).
 * @returns Resolved ExportDocumentResult.
 *
 * @throws {ExportError} on write or sign failure.
 */
export async function writeExportFile(
  state: DocumentExportState,
  params: ExportDocumentParams,
  identityPath?: string,
): Promise<ExportDocumentResult> {
  const { format, outputPath, includeMetadata, sign } = params;

  // Resolve outputPath to absolute.
  const absPath = path.resolve(outputPath);

  // Serialize to string.
  const serialized = serializeDocument(state, format, { includeMetadata });

  // Encode as UTF-8 bytes.
  const fileBytes = Buffer.from(serialized, 'utf8');

  // Compute file hash (SHA-256 of written bytes).
  const fileHash = sha256Hex(fileBytes);

  // Atomic write.
  atomicWriteFile(absPath, fileBytes);

  // Optional signing.
  let signatureHex: string | null = null;
  if (sign === true) {
    signatureHex = await signFileHash(fileHash, identityPath);
  }

  return {
    filePath: absPath,
    slug: state.slug,
    version: state.version,
    fileHash,
    byteCount: fileBytes.byteLength,
    exportedAt: state.exportedAt,
    signatureHex,
  };
}

/**
 * Build the output file path for an exportAll() call.
 *
 * File name is `<slug>.<ext>` inside `outputDir`.
 */
export function exportAllFilePath(outputDir: string, slug: string, format: ExportFormat): string {
  return path.join(outputDir, `${slug}.${FORMAT_EXT[format]}`);
}
