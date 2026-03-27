/**
 * LlmtxtDocument -- stateful orchestration for collaborative documents.
 *
 * Composes all SDK modules (lifecycle, versions, attribution, consensus,
 * storage, retrieval) behind a single high-level API. All I/O goes through
 * the StorageAdapter; all computation uses the pure SDK functions backed
 * by Rust WASM primitives.
 */
import type { StorageAdapter } from './storage-adapter.js';
import type { DocumentState, StateTransition } from './lifecycle.js';
import { validateTransition, isEditable } from './lifecycle.js';
import type { VersionEntry, ReconstructionResult, VersionDiffSummary } from './versions.js';
import { reconstructVersion, squashPatches, diffVersions, validatePatchApplies } from './versions.js';
import type { VersionAttribution, ContributorSummary } from './attribution.js';
import { attributeVersion, buildContributorSummary } from './attribution.js';
import type { Review, ApprovalResult } from './consensus.js';
import { evaluateApprovals, markStaleReviews } from './consensus.js';
import type { RetrievalPlan, RetrievalOptions } from './retrieval.js';
import { planRetrieval as planRetrievalFn } from './retrieval.js';
import type { DocumentOverview } from '../disclosure.js';
import { generateOverview, getSection } from '../disclosure.js';
import { createPatch } from '../patch.js';
import { hashContent } from '../compression.js';

// -- Options --

/** Options for creating a new version. */
export interface CreateVersionOptions {
  /** Agent creating this version. */
  agentId: string;
  /** One-line change description. */
  changelog: string;
}

/** Options for constructing an LlmtxtDocument. */
export interface LlmtxtDocumentOptions {
  /** Document slug. */
  slug: string;
  /** Storage adapter for persistence. */
  storage: StorageAdapter;
}

// -- Helpers --

function currentMaxVersion(versions: VersionEntry[]): number {
  return versions.length > 0 ? Math.max(...versions.map(v => v.versionNumber)) : 0;
}

// -- Document Class --

/**
 * High-level document orchestration object.
 *
 * Each instance wraps a single document slug and delegates all persistence
 * to the provided StorageAdapter. All computation (diffing, hashing,
 * disclosure, consensus) uses the pure SDK functions.
 */
export class LlmtxtDocument {
  readonly slug: string;
  private readonly storage: StorageAdapter;

  constructor(options: LlmtxtDocumentOptions) {
    this.slug = options.slug;
    this.storage = options.storage;
  }

  // -- Content --

  /** Get document content at a specific version (defaults to latest). */
  async getContent(version?: number): Promise<string> {
    return this.storage.getContent(this.slug, version);
  }

  /** Reconstruct content from base + patch stack at a specific version. */
  async reconstruct(targetVersion?: number): Promise<ReconstructionResult> {
    const baseContent = await this.storage.getContent(this.slug, 0);
    const patches = await this.storage.getVersions(this.slug);
    return reconstructVersion(baseContent, patches, targetVersion);
  }

  // -- Disclosure --

  /** Generate structural overview of the current document. */
  async overview(): Promise<DocumentOverview> {
    const content = await this.storage.getContent(this.slug);
    return generateOverview(content);
  }

  /** Extract a named section from the current document. */
  async section(name: string, depthAll = false): Promise<{
    content: string;
    tokenCount: number;
    totalTokens: number;
    tokensSaved: number;
  } | null> {
    const content = await this.storage.getContent(this.slug);
    return getSection(content, name, depthAll);
  }

  // -- Versioning --

  /** Get all version entries. */
  async getVersions(): Promise<VersionEntry[]> {
    return this.storage.getVersions(this.slug);
  }

  /** Create a new version from updated content. */
  async createVersion(
    newContent: string,
    options: CreateVersionOptions,
  ): Promise<VersionEntry> {
    const state = await this.storage.getState(this.slug);
    if (!isEditable(state)) {
      throw new Error('Cannot create version: document is in ' + state + ' state');
    }

    const currentContent = await this.storage.getContent(this.slug);
    const patchText = createPatch(currentContent, newContent);

    const validation = validatePatchApplies(currentContent, patchText);
    if (!validation.applies) {
      throw new Error('Patch does not apply cleanly: ' + (validation.error || 'unknown'));
    }

    const versions = await this.storage.getVersions(this.slug);
    const nextVersion = currentMaxVersion(versions) + 1;

    const entry: VersionEntry = {
      versionNumber: nextVersion,
      patchText,
      createdBy: options.agentId,
      changelog: options.changelog,
      contentHash: hashContent(newContent),
      createdAt: Date.now(),
    };

    await this.storage.putContent(this.slug, nextVersion, newContent);
    await this.storage.addVersion(this.slug, entry);

    // Mark existing reviews as stale
    const reviews = await this.storage.getReviews(this.slug);
    const updated = markStaleReviews(reviews, nextVersion);
    for (const review of updated) {
      if (review.status === 'STALE') {
        await this.storage.addReview(this.slug, review);
      }
    }

    return entry;
  }

  /** Compute a diff summary between two versions. */
  async diff(fromVersion: number, toVersion: number): Promise<VersionDiffSummary> {
    const baseContent = await this.storage.getContent(this.slug, 0);
    const patches = await this.storage.getVersions(this.slug);
    return diffVersions(baseContent, patches, fromVersion, toVersion);
  }

  /** Squash all patches into a single diff. */
  async squash(): Promise<{ patchText: string; contentHash: string; tokenCount: number }> {
    const baseContent = await this.storage.getContent(this.slug, 0);
    const patches = await this.storage.getVersions(this.slug);
    return squashPatches(baseContent, patches);
  }

  // -- Lifecycle --

  /** Get current document state. */
  async getState(): Promise<DocumentState> {
    return this.storage.getState(this.slug);
  }

  /** Transition document to a new state. */
  async transition(
    to: DocumentState,
    metadata: { changedBy: string; reason?: string },
  ): Promise<void> {
    const from = await this.storage.getState(this.slug);
    const result = validateTransition(from, to);
    if (!result.valid) {
      throw new Error(result.reason);
    }

    const versions = await this.storage.getVersions(this.slug);

    const transition: StateTransition = {
      from,
      to,
      changedBy: metadata.changedBy,
      changedAt: Date.now(),
      reason: metadata.reason,
      atVersion: currentMaxVersion(versions),
    };

    await this.storage.setState(this.slug, transition);
  }

  // -- Consensus --

  /** Check current approval status against policy. */
  async checkApproval(): Promise<ApprovalResult> {
    const reviews = await this.storage.getReviews(this.slug);
    const policy = await this.storage.getApprovalPolicy(this.slug);
    const versions = await this.storage.getVersions(this.slug);
    return evaluateApprovals(reviews, policy, currentMaxVersion(versions));
  }

  /** Submit an approval for the current version. */
  async approve(options: { reviewerId: string; reason?: string }): Promise<void> {
    const versions = await this.storage.getVersions(this.slug);
    await this.storage.addReview(this.slug, {
      reviewerId: options.reviewerId,
      status: 'APPROVED',
      timestamp: Date.now(),
      reason: options.reason,
      atVersion: currentMaxVersion(versions),
    });
  }

  /** Submit a rejection for the current version. */
  async reject(options: { reviewerId: string; reason: string }): Promise<void> {
    const versions = await this.storage.getVersions(this.slug);
    await this.storage.addReview(this.slug, {
      reviewerId: options.reviewerId,
      status: 'REJECTED',
      timestamp: Date.now(),
      reason: options.reason,
      atVersion: currentMaxVersion(versions),
    });
  }

  // -- Attribution --

  /** Compute attribution for all versions. */
  async getAttributions(): Promise<VersionAttribution[]> {
    const baseContent = await this.storage.getContent(this.slug, 0);
    const versions = await this.storage.getVersions(this.slug);
    const sorted = [...versions].sort((a, b) => a.versionNumber - b.versionNumber);

    const attributions: VersionAttribution[] = [];
    let previousContent = baseContent;

    for (const entry of sorted) {
      const { content: currentContent } = reconstructVersion(baseContent, sorted, entry.versionNumber);
      attributions.push(attributeVersion(previousContent, currentContent, entry.createdBy, entry));
      previousContent = currentContent;
    }

    return attributions;
  }

  /** Get aggregated contributor summaries. */
  async getContributors(): Promise<ContributorSummary[]> {
    const attributions = await this.getAttributions();
    return buildContributorSummary(attributions);
  }

  // -- Retrieval Planning --

  /** Plan which sections to retrieve given a token budget. */
  async planRetrieval(
    tokenBudget: number,
    query?: string,
    options?: RetrievalOptions,
  ): Promise<RetrievalPlan> {
    const content = await this.storage.getContent(this.slug);
    const ov = generateOverview(content);
    return planRetrievalFn(ov, tokenBudget, query, options);
  }
}
