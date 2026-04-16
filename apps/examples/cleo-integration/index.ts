/**
 * CLEO + LLMtxt Integration Example
 *
 * This example shows how CLEO project management can use LLMtxt's LocalBackend
 * to store structured documents for:
 *
 *  1. Task attachment docs — attach an LLMtxt document to a CLEO task so agents
 *     have a shared, versioned specification to collaborate on.
 *
 *  2. Decision records — agents write decisions to a shared doc; BFT approval
 *     gates ensure multi-agent consensus before a decision is finalised.
 *
 *  3. Agent-to-agent coordination — agents exchange lightweight typed messages
 *     via the A2A inbox without needing a message broker.
 *
 * This example uses LocalBackend (no network, zero config), meaning any CLEO
 * task or agent harness can embed LLMtxt without deploying api.llmtxt.my.
 *
 * Run with:
 *   npx tsx apps/examples/cleo-integration/index.ts
 *   # or
 *   pnpm dlx tsx apps/examples/cleo-integration/index.ts
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { LocalBackend } from 'llmtxt/local';

// ── Bootstrap ─────────────────────────────────────────────────────

const STORAGE_PATH = path.join(os.tmpdir(), 'cleo-integration-example');
fs.mkdirSync(STORAGE_PATH, { recursive: true });

const backend = new LocalBackend({ storagePath: STORAGE_PATH });

// ── Pattern 1: Task attachment doc ───────────────────────────────

async function taskAttachmentPattern() {
  console.log('\n─── Pattern 1: Task Attachment Doc ───');

  // Create a structured spec document for a CLEO task (e.g., T317)
  const specDoc = await backend.createDocument({
    title: 'T317 Portable SDK — Technical Specification',
    createdBy: 'cleo-orchestrator',
    labels: ['spec', 'epic', 'T317'],
  });

  console.log(`Created spec doc: ${specDoc.slug} (${specDoc.id})`);

  // Agent 1 publishes the initial spec
  const v1 = await backend.publishVersion({
    documentId: specDoc.id,
    content: `# T317 Portable SDK Specification

## Goal
Make LLMtxt fully embeddable without api.llmtxt.my.

## Requirements
- LocalBackend: SQLite + in-process EventEmitter
- RemoteBackend: HTTP/WS client
- CLI: init, create-doc, push-version, sync
- CLEO integration example

## Acceptance Criteria
- [ ] npm install llmtxt + 5 lines = working document system
- [ ] CLI llmtxt init works offline
- [ ] Backend-agnostic contract tests green
`,
    patchText: '',
    createdBy: 'agent-architect',
    changelog: 'Initial technical specification',
  });

  console.log(`Published spec v${v1.versionNumber} (hash: ${v1.contentHash.slice(0, 12)}...)`);

  // Agent 2 collaborates by appending an event
  await backend.appendEvent({
    documentId: specDoc.id,
    type: 'cleo.task.comment',
    agentId: 'agent-reviewer',
    payload: {
      taskId: 'T317',
      comment: 'Add RemoteBackend to the requirements list',
      priority: 'high',
    },
  });

  const events = await backend.queryEvents({ documentId: specDoc.id });
  console.log(`Events on doc: ${events.items.length} (${events.items[0]?.type})`);

  return specDoc;
}

// ── Pattern 2: BFT Decision Record ───────────────────────────────

async function decisionRecordPattern() {
  console.log('\n─── Pattern 2: Decision Record with BFT Approval ───');

  // Create a decision record document
  const decisionDoc = await backend.createDocument({
    title: 'D004: NAPI-RS Deferred',
    createdBy: 'cleo-orchestrator',
    labels: ['decision', 'architecture'],
  });

  // Transition to REVIEW to allow approvals
  await backend.transitionVersion({
    documentId: decisionDoc.id,
    to: 'REVIEW',
    changedBy: 'cleo-orchestrator',
    reason: 'Ready for multi-agent consensus',
  });

  console.log(`Decision doc in REVIEW: ${decisionDoc.slug}`);

  // Set a 2-of-3 approval policy
  await backend.setApprovalPolicy(decisionDoc.id, {
    requiredCount: 2,
    timeoutMs: 0,
    allowOwnerOverride: false,
  });

  // Agents vote on the decision (signatures are mock base64 for demo purposes)
  const mockSig = Buffer.from('demo-signature').toString('base64');

  await backend.submitSignedApproval({
    documentId: decisionDoc.id,
    versionNumber: 0,
    reviewerId: 'agent-1',
    status: 'APPROVED',
    reason: 'NAPI-RS brings too much CI complexity for unmeasured benefit',
    signatureBase64: mockSig,
  });

  await backend.submitSignedApproval({
    documentId: decisionDoc.id,
    versionNumber: 0,
    reviewerId: 'agent-2',
    status: 'APPROVED',
    reason: 'YAGNI applies here',
    signatureBase64: mockSig,
  });

  const progress = await backend.getApprovalProgress(decisionDoc.id, 0);
  console.log(`Approval: ${progress.approvedBy.length} approved, ${progress.rejectedBy.length} rejected (consensus: ${progress.approved})`);

  return decisionDoc;
}

// ── Pattern 3: Agent-to-Agent coordination ───────────────────────

async function agentCoordinationPattern() {
  console.log('\n─── Pattern 3: Agent-to-Agent Coordination ───');

  // Agent 1 acquires a lease on a shared resource
  const lease = await backend.acquireLease({
    resource: 'cleo:epic:T317:spec',
    holder: 'agent-writer',
    ttlMs: 30_000,
  });

  if (!lease) {
    console.log('Could not acquire lease (already held)');
    return;
  }

  console.log(`Agent-writer acquired lease on cleo:epic:T317:spec`);

  // Agent 1 sends a message to Agent 2 via scratchpad
  const msg = await backend.sendScratchpad({
    toAgentId: 'agent-reviewer',
    fromAgentId: 'agent-writer',
    payload: {
      type: 'cleo.review.request',
      taskId: 'T317',
      version: 1,
      message: 'Spec ready for review. Lease will expire in 30s.',
    },
  });

  console.log(`Sent scratchpad message: ${msg.id}`);

  // Agent 2 polls its scratchpad
  const inbox = await backend.pollScratchpad('agent-reviewer');
  console.log(`Agent-reviewer inbox: ${inbox.length} message(s)`);
  if (inbox[0]) {
    const p = inbox[0].payload as { type: string; taskId: string };
    console.log(`  → ${p.type} for task ${p.taskId}`);
    await backend.deleteScratchpadMessage(inbox[0].id, 'agent-reviewer');
  }

  // Release the lease
  await backend.releaseLease('cleo:epic:T317:spec', 'agent-writer');
  console.log('Lease released.');
}

// ── Pattern 4: Presence (who is editing?) ────────────────────────

async function presencePattern(docId: string) {
  console.log('\n─── Pattern 4: Real-time Presence ───');

  // Two agents join presence on the spec doc
  await backend.joinPresence(docId, 'agent-writer', { role: 'author', color: '#3b82f6' });
  await backend.joinPresence(docId, 'agent-reviewer', { role: 'reviewer', color: '#10b981' });

  const present = await backend.listPresence(docId);
  console.log(`Agents currently on doc: ${present.map((p) => p.agentId).join(', ')}`);

  await backend.leavePresence(docId, 'agent-reviewer');
  const after = await backend.listPresence(docId);
  console.log(`After reviewer leaves: ${after.map((p) => p.agentId).join(', ')}`);
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('CLEO + LLMtxt Integration Example');
  console.log(`Storage: ${STORAGE_PATH}`);

  await backend.open();

  const specDoc = await taskAttachmentPattern();
  await decisionRecordPattern();
  await agentCoordinationPattern();
  await presencePattern(specDoc.id);

  await backend.close();

  console.log('\nExample complete. Storage written to:', STORAGE_PATH);
  console.log('Run `ls -la ' + STORAGE_PATH + '` to see the SQLite DB and blobs.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
