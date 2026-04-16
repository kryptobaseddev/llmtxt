/**
 * BFT consensus SDK helpers — W3/T264.
 *
 * Provides high-level helpers for signing and submitting BFT approvals
 * via the /api/v1/documents/:slug/bft/approve endpoint.
 *
 * Usage:
 * ```ts
 * const identity = await AgentIdentity.generate();
 * const headers = await signApproval(identity, 'my-doc', 'agent-1', 'APPROVED', 3);
 * await submitSignedApproval(baseUrl, 'my-doc', headers, { status: 'APPROVED' });
 * ```
 */

import type { AgentIdentity } from '../identity.js';

// ── Types ─────────────────────────────────────────────────────────

/** BFT approval status. */
export type BFTApprovalStatus = 'APPROVED' | 'REJECTED';

/** Signed approval envelope ready to POST to /bft/approve. */
export interface SignedApprovalEnvelope {
  status: BFTApprovalStatus;
  sig_hex: string;
  canonical_payload: string;
  comment?: string;
}

/** Response from POST /documents/:slug/bft/approve. */
export interface BFTApprovalResponse {
  slug: string;
  approvalId: string;
  status: BFTApprovalStatus;
  sigVerified: boolean;
  chainHash: string;
  bftF: number;
  quorum: number;
  currentApprovals: number;
  quorumReached: boolean;
}

/** Response from GET /documents/:slug/bft/status. */
export interface BFTStatusResponse {
  slug: string;
  bftF: number;
  quorum: number;
  currentApprovals: number;
  quorumReached: boolean;
  approvers: string[];
}

/** Response from GET /documents/:slug/chain. */
export interface ChainVerificationResponse {
  valid: boolean;
  length: number;
  firstInvalidAt: number | null;
  slug: string;
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Compute BFT quorum for given fault tolerance f.
 * Formula: 2f + 1.
 */
export function bftQuorum(f: number): number {
  return 2 * f + 1;
}

/**
 * Build the canonical approval payload string (to be signed).
 *
 * Format: `documentSlug\nreviewerId\nstatus\natVersion\ntimestamp`
 */
export function buildApprovalCanonicalPayload(
  documentSlug: string,
  reviewerId: string,
  status: BFTApprovalStatus,
  atVersion: number,
  timestamp: number
): string {
  return [documentSlug, reviewerId, status, atVersion, timestamp].join('\n');
}

/**
 * Sign an approval with the given AgentIdentity.
 *
 * Returns a {@link SignedApprovalEnvelope} ready for POST to /bft/approve.
 *
 * @param identity   - Agent's Ed25519 identity
 * @param slug       - Document slug
 * @param agentId    - Agent identifier (must match the registered pubkey)
 * @param status     - APPROVED or REJECTED
 * @param atVersion  - Document version being approved
 * @param comment    - Optional human-readable comment
 * @param nowMs      - Override for timestamp (default: Date.now())
 */
export async function signApproval(
  identity: AgentIdentity,
  slug: string,
  agentId: string,
  status: BFTApprovalStatus,
  atVersion: number,
  comment?: string,
  nowMs?: number
): Promise<SignedApprovalEnvelope> {
  const ts = nowMs ?? Date.now();
  const canonicalPayload = buildApprovalCanonicalPayload(slug, agentId, status, atVersion, ts);
  const payloadBytes = new TextEncoder().encode(canonicalPayload);
  const sig = await identity.sign(payloadBytes);
  const sigHex = Array.from(sig)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    status,
    sig_hex: sigHex,
    canonical_payload: canonicalPayload,
    comment,
  };
}

/**
 * Submit a signed approval to the backend.
 *
 * @param baseUrl  - API base URL (e.g. "https://api.llmtxt.my/api/v1")
 * @param slug     - Document slug
 * @param envelope - From {@link signApproval}
 * @param headers  - Optional extra headers (e.g. Authorization)
 */
export async function submitSignedApproval(
  baseUrl: string,
  slug: string,
  envelope: SignedApprovalEnvelope,
  headers: Record<string, string> = {}
): Promise<BFTApprovalResponse> {
  const url = `${baseUrl}/documents/${slug}/bft/approve`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(envelope),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(
      `BFT approve failed (${res.status}): ${(err as { message?: string }).message ?? res.statusText}`
    );
  }

  return res.json() as Promise<BFTApprovalResponse>;
}

/**
 * Get current BFT quorum status for a document.
 */
export async function getBFTStatus(
  baseUrl: string,
  slug: string,
  headers: Record<string, string> = {}
): Promise<BFTStatusResponse> {
  const url = `${baseUrl}/documents/${slug}/bft/status`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`BFT status failed (${res.status})`);
  return res.json() as Promise<BFTStatusResponse>;
}

/**
 * Verify the tamper-evident approval chain for a document.
 */
export async function verifyApprovalChain(
  baseUrl: string,
  slug: string,
  headers: Record<string, string> = {}
): Promise<ChainVerificationResponse> {
  const url = `${baseUrl}/documents/${slug}/chain`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Chain verify failed (${res.status})`);
  return res.json() as Promise<ChainVerificationResponse>;
}
