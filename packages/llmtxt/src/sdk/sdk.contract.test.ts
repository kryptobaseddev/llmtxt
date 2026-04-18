/**
 * Contract tests for the llmtxt/sdk subpath.
 *
 * Purpose: assert the stable public API surface of `llmtxt/sdk` so that any
 * rename, removal, or signature change is caught immediately.
 *
 * Rules:
 *  - All imports come from `./index.js` (the sdk subpath source entry point).
 *  - Tests must NOT mutate shared state or depend on order.
 *  - Tests cover: export existence, function arity, return types, and core
 *    behavioural invariants for pure functions.
 *
 * Test runner: node:test (native). No vitest.
 * Run with the package-level test script: pnpm test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// ── Imports — sdk subpath source entry point ─────────────────────────────────

import {
  // Document
  LlmtxtDocument,
  // Lifecycle
  DOCUMENT_STATES,
  isValidTransition,
  validateTransition,
  isEditable,
  isTerminal,
  // Versions
  reconstructVersion,
  validatePatchApplies,
  squashPatches,
  computeReversePatch,
  diffVersions,
  // Attribution
  attributeVersion,
  buildContributorSummary,
  // Consensus
  DEFAULT_APPROVAL_POLICY,
  evaluateApprovals,
  markStaleReviews,
  // Storage
  inlineRef,
  objectStoreRef,
  versionStorageKey,
  shouldUseObjectStore,
  // Retrieval
  planRetrieval,
  estimateRetrievalCost,
  // BFT
  bftQuorum,
  buildApprovalCanonicalPayload,
  // Scratchpad
  sendScratchpad,
  readScratchpad,
  onScratchpadMessage,
  // A2A
  A2AMessage,
  buildA2AMessage,
  sendToInbox,
  pollInbox,
  onDirectMessage,
  // AgentSession
  AgentSession,
  AgentSessionError,
  AgentSessionState,
} from './index.js';

// ── 1. Export existence — every documented export must exist ─────────────────

describe('llmtxt/sdk — export existence', () => {
  it('LlmtxtDocument is a constructor', () => {
    assert.equal(typeof LlmtxtDocument, 'function');
  });

  it('DOCUMENT_STATES is a readonly array with expected values', () => {
    assert.ok(Array.isArray(DOCUMENT_STATES));
    assert.ok((DOCUMENT_STATES as readonly string[]).includes('DRAFT'));
    assert.ok((DOCUMENT_STATES as readonly string[]).includes('REVIEW'));
    assert.ok((DOCUMENT_STATES as readonly string[]).includes('LOCKED'));
    assert.ok((DOCUMENT_STATES as readonly string[]).includes('ARCHIVED'));
    assert.equal(DOCUMENT_STATES.length, 4);
  });

  it('lifecycle functions are exported as functions', () => {
    assert.equal(typeof isValidTransition, 'function');
    assert.equal(typeof validateTransition, 'function');
    assert.equal(typeof isEditable, 'function');
    assert.equal(typeof isTerminal, 'function');
  });

  it('version functions are exported as functions', () => {
    assert.equal(typeof reconstructVersion, 'function');
    assert.equal(typeof validatePatchApplies, 'function');
    assert.equal(typeof squashPatches, 'function');
    assert.equal(typeof computeReversePatch, 'function');
    assert.equal(typeof diffVersions, 'function');
  });

  it('attribution functions are exported as functions', () => {
    assert.equal(typeof attributeVersion, 'function');
    assert.equal(typeof buildContributorSummary, 'function');
  });

  it('consensus exports are present', () => {
    assert.equal(typeof DEFAULT_APPROVAL_POLICY, 'object');
    assert.notEqual(DEFAULT_APPROVAL_POLICY, null);
    assert.equal(typeof evaluateApprovals, 'function');
    assert.equal(typeof markStaleReviews, 'function');
  });

  it('storage functions are exported as functions', () => {
    assert.equal(typeof inlineRef, 'function');
    assert.equal(typeof objectStoreRef, 'function');
    assert.equal(typeof versionStorageKey, 'function');
    assert.equal(typeof shouldUseObjectStore, 'function');
  });

  it('retrieval functions are exported as functions', () => {
    assert.equal(typeof planRetrieval, 'function');
    assert.equal(typeof estimateRetrievalCost, 'function');
  });

  it('BFT functions are exported as functions', () => {
    assert.equal(typeof bftQuorum, 'function');
    assert.equal(typeof buildApprovalCanonicalPayload, 'function');
  });

  it('scratchpad functions are exported as functions', () => {
    assert.equal(typeof sendScratchpad, 'function');
    assert.equal(typeof readScratchpad, 'function');
    assert.equal(typeof onScratchpadMessage, 'function');
  });

  it('A2A exports are present as functions', () => {
    assert.equal(typeof A2AMessage, 'function');
    assert.equal(typeof buildA2AMessage, 'function');
    assert.equal(typeof sendToInbox, 'function');
    assert.equal(typeof pollInbox, 'function');
    assert.equal(typeof onDirectMessage, 'function');
  });

  it('AgentSession exports are present', () => {
    assert.equal(typeof AgentSession, 'function');
    assert.equal(typeof AgentSessionError, 'function');
    assert.equal(typeof AgentSessionState, 'object');
    assert.notEqual(AgentSessionState, null);
  });
});

// ── 2. Lifecycle — isValidTransition / validateTransition ────────────────────

describe('llmtxt/sdk — lifecycle state machine contract', () => {
  it('DRAFT -> REVIEW is valid', () => {
    assert.equal(isValidTransition('DRAFT', 'REVIEW'), true);
  });

  it('DRAFT -> LOCKED is valid', () => {
    assert.equal(isValidTransition('DRAFT', 'LOCKED'), true);
  });

  it('REVIEW -> DRAFT is valid (reopen)', () => {
    assert.equal(isValidTransition('REVIEW', 'DRAFT'), true);
  });

  it('REVIEW -> LOCKED is valid', () => {
    assert.equal(isValidTransition('REVIEW', 'LOCKED'), true);
  });

  it('LOCKED -> ARCHIVED is valid', () => {
    assert.equal(isValidTransition('LOCKED', 'ARCHIVED'), true);
  });

  it('ARCHIVED -> DRAFT is not valid (terminal state)', () => {
    assert.equal(isValidTransition('ARCHIVED', 'DRAFT'), false);
  });

  it('ARCHIVED -> REVIEW is not valid (terminal state)', () => {
    assert.equal(isValidTransition('ARCHIVED', 'REVIEW'), false);
  });

  it('DRAFT -> DRAFT is not valid (self-transition)', () => {
    assert.equal(isValidTransition('DRAFT', 'DRAFT'), false);
  });

  it('validateTransition returns valid=true for valid transitions', () => {
    const result = validateTransition('DRAFT', 'REVIEW');
    assert.equal(typeof result, 'object');
    assert.equal(result.valid, true);
  });

  it('validateTransition returns valid=false with reason string for invalid transitions', () => {
    const result = validateTransition('ARCHIVED', 'DRAFT');
    assert.equal(result.valid, false);
    assert.equal(typeof result.reason, 'string');
    assert.ok(result.reason !== undefined && result.reason.length > 0);
  });

  it('isEditable returns true for DRAFT', () => {
    assert.equal(isEditable('DRAFT'), true);
  });

  it('isEditable returns true for REVIEW (REVIEW state allows edits)', () => {
    assert.equal(isEditable('REVIEW'), true);
  });

  it('isEditable returns false for LOCKED', () => {
    assert.equal(isEditable('LOCKED'), false);
  });

  it('isEditable returns false for ARCHIVED', () => {
    assert.equal(isEditable('ARCHIVED'), false);
  });

  it('isTerminal returns true for ARCHIVED', () => {
    assert.equal(isTerminal('ARCHIVED'), true);
  });

  it('isTerminal returns false for DRAFT', () => {
    assert.equal(isTerminal('DRAFT'), false);
  });

  it('isTerminal returns false for REVIEW', () => {
    assert.equal(isTerminal('REVIEW'), false);
  });

  it('isTerminal returns false for LOCKED', () => {
    assert.equal(isTerminal('LOCKED'), false);
  });
});

// ── 3. Consensus — DEFAULT_APPROVAL_POLICY shape, evaluateApprovals ──────────

describe('llmtxt/sdk — consensus contract', () => {
  it('DEFAULT_APPROVAL_POLICY has requiredCount as a number', () => {
    assert.equal(typeof DEFAULT_APPROVAL_POLICY.requiredCount, 'number');
  });

  it('DEFAULT_APPROVAL_POLICY has requireUnanimous as a boolean', () => {
    assert.equal(typeof DEFAULT_APPROVAL_POLICY.requireUnanimous, 'boolean');
  });

  it('DEFAULT_APPROVAL_POLICY has allowedReviewerIds as an array', () => {
    assert.ok(Array.isArray(DEFAULT_APPROVAL_POLICY.allowedReviewerIds));
  });

  it('DEFAULT_APPROVAL_POLICY has timeoutMs as a number', () => {
    assert.equal(typeof DEFAULT_APPROVAL_POLICY.timeoutMs, 'number');
  });

  it('evaluateApprovals returns object with approved, approvedBy, rejectedBy, pendingFrom, reason', () => {
    const result = evaluateApprovals([], DEFAULT_APPROVAL_POLICY, 1);
    assert.equal(typeof result.approved, 'boolean');
    assert.ok(Array.isArray(result.approvedBy));
    assert.ok(Array.isArray(result.rejectedBy));
    assert.ok(Array.isArray(result.pendingFrom));
    assert.equal(typeof result.reason, 'string');
  });

  it('evaluateApprovals approves when requiredCount=0 and no reviews', () => {
    const permissive = {
      ...DEFAULT_APPROVAL_POLICY,
      requiredCount: 0,
      requireUnanimous: false,
    };
    const result = evaluateApprovals([], permissive, 1);
    assert.equal(result.approved, true);
  });

  it('evaluateApprovals rejects when requiredCount=1 and no reviews', () => {
    const strict = {
      ...DEFAULT_APPROVAL_POLICY,
      requiredCount: 1,
      requireUnanimous: false,
    };
    const result = evaluateApprovals([], strict, 1);
    assert.equal(result.approved, false);
  });

  it('markStaleReviews marks reviews at old version as STALE', () => {
    const reviews = [
      {
        reviewerId: 'agent-1',
        status: 'APPROVED' as const,
        timestamp: Date.now(),
        atVersion: 1,
      },
    ];
    const updated = markStaleReviews(reviews, 2);
    assert.ok(Array.isArray(updated));
    assert.equal(updated.length, 1);
    assert.equal(updated[0].status, 'STALE');
  });

  it('markStaleReviews does not stale reviews at current version', () => {
    const now = Date.now();
    const reviews = [
      {
        reviewerId: 'agent-1',
        status: 'APPROVED' as const,
        timestamp: now,
        atVersion: 3,
      },
    ];
    const updated = markStaleReviews(reviews, 3);
    assert.equal(updated[0].status, 'APPROVED');
  });
});

// ── 4. Storage helpers — inlineRef, objectStoreRef, versionStorageKey ────────

describe('llmtxt/sdk — storage helpers contract', () => {
  it('inlineRef returns a ContentRef with type=inline', () => {
    const ref = inlineRef('abc123', 100, 60);
    assert.equal(ref.type, 'inline');
    assert.equal(ref.contentHash, 'abc123');
    assert.equal(ref.originalSize, 100);
    assert.equal(ref.compressedSize, 60);
  });

  it('objectStoreRef returns a ContentRef with type=object-store and storageKey', () => {
    const ref = objectStoreRef('my-key', 'abc123', 200, 100);
    assert.equal(ref.type, 'object-store');
    assert.equal(ref.storageKey, 'my-key');
    assert.equal(ref.contentHash, 'abc123');
    assert.equal(ref.originalSize, 200);
    assert.equal(ref.compressedSize, 100);
  });

  it('versionStorageKey returns a non-empty string', () => {
    const key = versionStorageKey('my-doc', 3);
    assert.equal(typeof key, 'string');
    assert.ok(key.length > 0);
  });

  it('versionStorageKey encodes the slug and version', () => {
    const key1 = versionStorageKey('doc-a', 1);
    const key2 = versionStorageKey('doc-b', 1);
    assert.notEqual(key1, key2, 'different slugs must produce different keys');
  });

  it('shouldUseObjectStore returns a boolean', () => {
    const result = shouldUseObjectStore(1000);
    assert.equal(typeof result, 'boolean');
  });

  it('shouldUseObjectStore returns false for small content (100 bytes)', () => {
    assert.equal(shouldUseObjectStore(100), false);
  });
});

// ── 5. BFT quorum — bftQuorum, buildApprovalCanonicalPayload ─────────────────

describe('llmtxt/sdk — BFT contract', () => {
  it('bftQuorum(0) returns 1 (2*0+1)', () => {
    assert.equal(bftQuorum(0), 1);
  });

  it('bftQuorum(1) returns 3 (2*1+1)', () => {
    assert.equal(bftQuorum(1), 3);
  });

  it('bftQuorum(2) returns 5 (2*2+1)', () => {
    assert.equal(bftQuorum(2), 5);
  });

  it('bftQuorum always returns an odd number', () => {
    for (const f of [0, 1, 2, 3, 4, 5, 10]) {
      const q = bftQuorum(f);
      assert.equal(q % 2, 1, `bftQuorum(${f})=${q} must be odd`);
    }
  });

  it('buildApprovalCanonicalPayload returns a string with newline-separated fields', () => {
    const payload = buildApprovalCanonicalPayload(
      'doc-slug',
      'agent-1',
      'APPROVED',
      1,
      1700000000000,
    );
    assert.equal(typeof payload, 'string');
    assert.ok(payload.length > 0);
    const lines = payload.split('\n');
    assert.equal(lines[0], 'doc-slug');
    assert.equal(lines[1], 'agent-1');
    assert.equal(lines[2], 'APPROVED');
    assert.equal(lines[3], '1');
    assert.equal(lines[4], '1700000000000');
  });
});

// ── 6. AgentSessionState enum shape ──────────────────────────────────────────

describe('llmtxt/sdk — AgentSessionState contract', () => {
  it('has Idle value', () => {
    assert.equal(AgentSessionState.Idle, 'Idle');
  });

  it('has Open value', () => {
    assert.equal(AgentSessionState.Open, 'Open');
  });

  it('has Active value', () => {
    assert.equal(AgentSessionState.Active, 'Active');
  });

  it('has Closing value', () => {
    assert.equal(AgentSessionState.Closing, 'Closing');
  });

  it('has Closed value', () => {
    assert.equal(AgentSessionState.Closed, 'Closed');
  });

  it('AgentSessionError is a constructor extending Error (takes code, message)', () => {
    const err = new AgentSessionError('TEST_CODE', 'contract test message');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof AgentSessionError);
    assert.equal(err.message, 'contract test message');
    assert.equal((err as { code?: string }).code, 'TEST_CODE');
  });
});

// ── 7. Attribution — attributeVersion, buildContributorSummary ───────────────

describe('llmtxt/sdk — attribution contract', () => {
  it('attributeVersion returns VersionAttribution with required fields', () => {
    const entry = { versionNumber: 1, changelog: 'init', createdAt: Date.now() };
    const attr = attributeVersion('', 'hello world', 'agent-1', entry);
    assert.equal(typeof attr, 'object');
    assert.equal(attr.versionNumber, 1);
    assert.equal(attr.authorId, 'agent-1');
    assert.equal(attr.changelog, 'init');
    assert.ok(Array.isArray(attr.sectionsModified));
    assert.equal(typeof attr.addedLines, 'number');
    assert.equal(typeof attr.removedLines, 'number');
    assert.equal(typeof attr.addedTokens, 'number');
    assert.equal(typeof attr.removedTokens, 'number');
  });

  it('buildContributorSummary returns array of ContributorSummary', () => {
    const now = Date.now();
    const attrs = [
      {
        versionNumber: 1,
        authorId: 'agent-1',
        changelog: 'first',
        addedLines: 5,
        removedLines: 0,
        addedTokens: 10,
        removedTokens: 0,
        sectionsModified: [],
        createdAt: now,
      },
      {
        versionNumber: 2,
        authorId: 'agent-1',
        changelog: 'second',
        addedLines: 3,
        removedLines: 1,
        addedTokens: 6,
        removedTokens: 2,
        sectionsModified: [],
        createdAt: now + 1000,
      },
    ];
    const summaries = buildContributorSummary(attrs);
    assert.ok(Array.isArray(summaries));
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].agentId, 'agent-1');
    assert.equal(summaries[0].versionsAuthored, 2);
    assert.equal(summaries[0].totalTokensAdded, 16);
    assert.equal(summaries[0].totalTokensRemoved, 2);
    assert.equal(summaries[0].netTokens, 14);
  });
});
