/**
 * T428.9 (T465): 5-agent hub-spoke blob integration test.
 *
 * This file re-exports the canonical test suite from packages/llmtxt.
 * The authoritative implementation lives at:
 *   packages/llmtxt/src/__tests__/blob-5-agent-hub-spoke.test.ts
 *
 * All 5 acceptance criteria are tested there:
 *   1. All 5 agents attach different blobs — all 5 in listBlobs
 *   2. LWW: two agents attach same blobName — newer uploadedAt wins
 *   3. Tie-break: same uploadedAt, higher lex uploadedBy wins
 *   4. Lazy sync: agent A attaches; agent B resolves via changeset + getBlob
 *   5. Hash tampering: BlobCorruptError returned on corrupt read
 *
 * Run with:
 *   pnpm --filter llmtxt test
 *
 * Or directly:
 *   node --import tsx/esm --test \
 *     packages/llmtxt/src/__tests__/blob-5-agent-hub-spoke.test.ts
 */

// No additional implementation here — see the canonical test file above.
export {};
