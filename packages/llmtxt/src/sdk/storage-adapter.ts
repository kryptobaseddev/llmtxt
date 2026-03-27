/**
 * Storage adapter interface for platform-specific persistence.
 *
 * Platforms (SignalDock, llmtxt.my, etc.) implement this interface
 * to provide the backing store for LlmtxtDocument operations.
 * The SDK never touches storage directly -- all I/O goes through this adapter.
 */
import type { DocumentState, StateTransition } from './lifecycle.js';
import type { VersionEntry } from './versions.js';
import type { Review, ApprovalPolicy } from './consensus.js';
import type { ContentRef } from './storage.js';

/** Storage adapter that platforms implement. */
export interface StorageAdapter {
  /**
   * Retrieve document content at a specific version.
   * When version is omitted, returns the latest version's content.
   */
  getContent(slug: string, version?: number): Promise<string>;

  /**
   * Store document content for a specific version.
   * Returns a ContentRef indicating where the content was stored.
   */
  putContent(slug: string, version: number, content: string): Promise<ContentRef>;

  /**
   * Get the ordered list of version entries for a document.
   */
  getVersions(slug: string): Promise<VersionEntry[]>;

  /**
   * Append a new version entry to the document's version stack.
   */
  addVersion(slug: string, entry: VersionEntry): Promise<void>;

  /**
   * Get the current lifecycle state of a document.
   */
  getState(slug: string): Promise<DocumentState>;

  /**
   * Record a lifecycle state transition.
   */
  setState(slug: string, transition: StateTransition): Promise<void>;

  /**
   * Get all reviews for a document.
   */
  getReviews(slug: string): Promise<Review[]>;

  /**
   * Add or update a review for a document.
   */
  addReview(slug: string, review: Review): Promise<void>;

  /**
   * Get the approval policy for a document.
   */
  getApprovalPolicy(slug: string): Promise<ApprovalPolicy>;
}
