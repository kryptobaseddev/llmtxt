/**
 * Version stack management for collaborative documents.
 *
 * Provides helpers to reconstruct any version from a base document
 * plus a sequence of patches, validate patch applicability, squash
 * consecutive patches, and compute reverse patches for rollback.
 */
import { createPatch, applyPatch, reconstructVersion as wasmReconstruct, squashPatchesWasm } from '../patch.js';
import { calculateTokens, hashContent, computeDiff } from '../compression.js';

// ── Types ──────────────────────────────────────────────────────

/** A single version entry in a document's patch stack. */
export interface VersionEntry {
  /** Sequential version number (1-based). */
  versionNumber: number;
  /** Unified diff patch text. */
  patchText: string;
  /** Agent that authored this version. */
  createdBy: string;
  /** One-line description of the change. */
  changelog: string;
  /** SHA-256 hash of the resulting content after applying this patch. */
  contentHash: string;
  /** Timestamp of creation (ms since epoch). */
  createdAt: number;
}

/** Result of reconstructing a document at a specific version. */
export interface ReconstructionResult {
  /** The document content at the requested version. */
  content: string;
  /** The version number that was reconstructed. */
  version: number;
  /** Number of patches applied to reach this version. */
  patchesApplied: number;
  /** SHA-256 hash of the reconstructed content. */
  contentHash: string;
  /** Token count of the reconstructed content. */
  tokenCount: number;
}

/** Result of validating whether a patch applies cleanly. */
export interface PatchValidationResult {
  /** Whether the patch can be applied without conflicts. */
  applies: boolean;
  /** Error message if the patch does not apply. */
  error?: string;
  /** The content that would result if the patch applies. */
  resultContent?: string;
}

// ── Reconstruction ─────────────────────────────────────────────

/**
 * Reconstruct a document at a specific version by applying patches
 * sequentially from the base content.
 *
 * @param baseContent - The original document content (version 0).
 * @param patches - Ordered array of version entries.
 * @param targetVersion - The version to reconstruct. Defaults to latest.
 * @returns The reconstructed document content and metadata.
 * @throws If a patch in the sequence fails to apply.
 */
export function reconstructVersion(
  baseContent: string,
  patches: VersionEntry[],
  targetVersion?: number,
): ReconstructionResult {
  const sorted = [...patches].sort((a, b) => a.versionNumber - b.versionNumber);
  const target = targetVersion ?? (sorted.length > 0 ? sorted[sorted.length - 1].versionNumber : 0);

  if (target === 0) {
    return {
      content: baseContent,
      version: 0,
      patchesApplied: 0,
      contentHash: hashContent(baseContent),
      tokenCount: calculateTokens(baseContent),
    };
  }

  // Delegate to Rust for N patch applications in a single WASM call
  const patchTexts = sorted
    .filter(e => e.versionNumber <= target)
    .map(e => e.patchText);
  const patchesJson = JSON.stringify(patchTexts);
  const content = wasmReconstruct(baseContent, patchesJson, patchTexts.length);

  return {
    content,
    version: target,
    patchesApplied: patchTexts.length,
    contentHash: hashContent(content),
    tokenCount: calculateTokens(content),
  };
}

// ── Validation ─────────────────────────────────────────────────

/**
 * Check whether a patch applies cleanly to the given content.
 *
 * @param content - The current document content.
 * @param patchText - The unified diff to test.
 * @returns Whether the patch applies and the resulting content.
 */
export function validatePatchApplies(
  content: string,
  patchText: string,
): PatchValidationResult {
  try {
    const result = applyPatch(content, patchText);
    if (result === content && patchText.trim().length > 0) {
      return { applies: false, error: 'Patch did not modify content (possible conflict)' };
    }
    return { applies: true, resultContent: result };
  } catch (err) {
    return {
      applies: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Squashing ──────────────────────────────────────────────────

/**
 * Squash a sequence of patches into a single unified diff.
 *
 * Applies all patches sequentially to the base content, then produces
 * one diff from base to final state.
 *
 * @param baseContent - The content before the first patch.
 * @param patches - Ordered array of version entries to squash.
 * @returns A single patch text and the final content hash.
 */
export function squashPatches(
  baseContent: string,
  patches: VersionEntry[],
): { patchText: string; contentHash: string; tokenCount: number } {
  const sorted = [...patches].sort((a, b) => a.versionNumber - b.versionNumber);
  const patchesJson = JSON.stringify(sorted.map(e => e.patchText));

  // Single WASM call: apply all patches then diff base vs final
  const patchText = squashPatchesWasm(baseContent, patchesJson);

  // Reconstruct final content to compute hash and tokens
  const finalContent = wasmReconstruct(baseContent, patchesJson, sorted.length);
  return {
    patchText,
    contentHash: hashContent(finalContent),
    tokenCount: calculateTokens(finalContent),
  };
}

// ── Reverse Patch ──────────────────────────────────────────────

/**
 * Compute a reverse patch that undoes a version's changes.
 *
 * @param contentBefore - Document content before the patch was applied.
 * @param contentAfter - Document content after the patch was applied.
 * @returns A unified diff that reverts `contentAfter` back to `contentBefore`.
 */
export function computeReversePatch(
  contentBefore: string,
  contentAfter: string,
): string {
  return createPatch(contentAfter, contentBefore);
}

// ── Version Diff Summary ───────────────────────────────────────

/** Summary of changes between two versions. */
export interface VersionDiffSummary {
  /** Source version number. */
  fromVersion: number;
  /** Target version number. */
  toVersion: number;
  /** Lines added between versions. */
  addedLines: number;
  /** Lines removed between versions. */
  removedLines: number;
  /** Tokens added between versions. */
  addedTokens: number;
  /** Tokens removed between versions. */
  removedTokens: number;
  /** Unified diff text. */
  patchText: string;
}

/**
 * Compute a diff summary between two versions of a document.
 *
 * @param baseContent - The original document content (version 0).
 * @param patches - Full ordered patch stack.
 * @param fromVersion - Start version.
 * @param toVersion - End version.
 * @returns Diff statistics and patch text between the two versions.
 */
export function diffVersions(
  baseContent: string,
  patches: VersionEntry[],
  fromVersion: number,
  toVersion: number,
): VersionDiffSummary {
  const fromContent = reconstructVersion(baseContent, patches, fromVersion).content;
  const toContent = reconstructVersion(baseContent, patches, toVersion).content;
  const diff = computeDiff(fromContent, toContent);
  const patchText = createPatch(fromContent, toContent);

  return {
    fromVersion,
    toVersion,
    addedLines: diff.addedLines,
    removedLines: diff.removedLines,
    addedTokens: diff.addedTokens,
    removedTokens: diff.removedTokens,
    patchText,
  };
}
