#!/usr/bin/env node
/**
 * reset.js — Demo environment clean-reset script.
 *
 * Deletes demo documents (by slug prefix) and demo agent state (inbox,
 * nonces) from Postgres. NEVER touches real user documents or prod data.
 *
 * Usage:
 *   node apps/demo/scripts/reset.js [--slug-prefix=<prefix>] [--execute] [--yes] [--help]
 *
 * Environment:
 *   DATABASE_URL  Postgres connection string (required)
 *
 * Safety:
 *   - Default mode is DRY-RUN: reports counts, makes no changes.
 *   - Pass --execute to actually delete.
 *   - Pass --yes to skip the confirmation prompt (useful in CI).
 *
 * Exit codes:
 *   0  Success (or dry-run completed)
 *   1  Error
 */

import postgres from 'postgres';
import { createInterface } from 'node:readline';

// ── CLI arg parsing ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Demo clean-reset script for LLMtxt.

Usage:
  node apps/demo/scripts/reset.js [options]

Options:
  --slug-prefix=<prefix>   Slug prefix to match (default: "demo-")
  --execute                Actually delete data (default is dry-run)
  --yes                    Skip confirmation prompt
  --help                   Show this help message

Environment:
  DATABASE_URL             Postgres connection string (required)

Examples:
  # Dry run — see what would be deleted
  node apps/demo/scripts/reset.js

  # Execute the reset
  node apps/demo/scripts/reset.js --execute

  # Execute without confirmation
  node apps/demo/scripts/reset.js --execute --yes

  # Custom prefix
  node apps/demo/scripts/reset.js --slug-prefix=test- --execute
`);
  process.exit(0);
}

const execute = args.includes('--execute');
const skipConfirm = args.includes('--yes');
const slugPrefixArg = args.find((a) => a.startsWith('--slug-prefix='));
const slugPrefix = slugPrefixArg ? slugPrefixArg.split('=')[1] : 'demo-';

// Known T308 test slugs — always included regardless of prefix
const KNOWN_TEST_SLUGS = ['AitP8qCx', 'ETlHNZ45', '1jg483oR'];

// Demo agent IDs — inbox + nonces for these are purged
const DEMO_AGENT_IDS = [
  'writerbot-demo',
  'reviewerbot-demo',
  'consensusbot-demo',
  'summarizerbot-demo',
  'observerbot-t308',
  'seeder-demo',
];

// ── Validation ────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[reset] ERROR: DATABASE_URL environment variable is required.');
  console.error('[reset] Retrieve it with:');
  console.error('[reset]   railway variables --service Postgres --kv | grep DATABASE_PUBLIC_URL');
  process.exit(1);
}

// ── Confirmation prompt ───────────────────────────────────────────────────────

async function confirm(question) {
  if (skipConfirm) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question + ' [y/N] ', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[reset] LLMtxt Demo Clean-Reset');
  console.log(`[reset] Mode         : ${execute ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`[reset] Slug prefix  : ${slugPrefix}`);
  console.log(`[reset] Known slugs  : ${KNOWN_TEST_SLUGS.join(', ')}`);
  console.log(`[reset] Agent IDs    : ${DEMO_AGENT_IDS.join(', ')}`);
  console.log('');

  let sql;
  try {
    sql = postgres(DATABASE_URL, {
      ssl: DATABASE_URL.includes('railway.internal') ? false : 'prefer',
      max: 1,
      idle_timeout: 30,
    });
  } catch (err) {
    console.error('[reset] ERROR: Failed to create database connection:', err.message);
    process.exit(1);
  }

  try {
    // ── Step 1: Collect document IDs to delete ──────────────────────────────

    console.log('[reset] Scanning for demo documents...');

    const matchingDocs = await sql`
      SELECT id, slug
      FROM documents
      WHERE slug LIKE ${slugPrefix + '%'}
         OR slug = ANY(${KNOWN_TEST_SLUGS})
      ORDER BY slug
    `;

    if (matchingDocs.length === 0) {
      console.log('[reset] No demo documents found. Nothing to delete.');
      await sql.end();
      process.exit(0);
    }

    const docIds = matchingDocs.map((d) => d.id);
    console.log(`[reset] Found ${matchingDocs.length} document(s):`);
    for (const d of matchingDocs) {
      console.log(`  - ${d.slug} (id=${d.id})`);
    }
    console.log('');

    // ── Step 2: Count rows in child tables (FK-cascaded) ────────────────────

    console.log('[reset] Counting rows that would be deleted (FK cascade from documents)...');

    const [
      { count: versionCount },
      { count: transitionCount },
      { count: approvalCount },
      { count: contributorCount },
      { count: versionAttrCount },
      { count: eventCount },
      { count: crdtStateCount },
      { count: crdtUpdateCount },
      { count: signedUrlCount },
      { count: leaseCount },
    ] = await Promise.all([
      sql`SELECT COUNT(*) FROM versions WHERE document_id = ANY(${docIds})`.then((r) => r[0]),
      sql`SELECT COUNT(*) FROM state_transitions WHERE document_id = ANY(${docIds})`.then((r) => r[0]),
      sql`SELECT COUNT(*) FROM approvals WHERE document_id = ANY(${docIds})`.then((r) => r[0]),
      sql`SELECT COUNT(*) FROM contributors WHERE document_id = ANY(${docIds})`.then((r) => r[0]),
      sql`SELECT COUNT(*) FROM version_attributions WHERE document_id = ANY(${docIds})`.then((r) => r[0]),
      sql`SELECT COUNT(*) FROM document_events WHERE document_id = ANY(${docIds})`.then((r) => r[0]),
      sql`SELECT COUNT(*) FROM section_crdt_states WHERE document_id = ANY(${docIds})`.then((r) => r[0]),
      sql`SELECT COUNT(*) FROM section_crdt_updates WHERE document_id = ANY(${docIds})`.then((r) => r[0]),
      sql`SELECT COUNT(*) FROM signed_url_tokens WHERE document_id = ANY(${docIds})`.then((r) => r[0]),
      sql`SELECT COUNT(*) FROM section_leases WHERE document_id = ANY(${docIds})`.then((r) => r[0]),
    ]);

    const [
      { count: inboxCount },
      { count: nonceCount },
    ] = await Promise.all([
      sql`
        SELECT COUNT(*) FROM agent_inbox_messages
        WHERE from_agent_id = ANY(${DEMO_AGENT_IDS})
           OR to_agent_id = ANY(${DEMO_AGENT_IDS})
      `.then((r) => r[0]),
      sql`
        SELECT COUNT(*) FROM agent_signature_nonces
        WHERE agent_id = ANY(${DEMO_AGENT_IDS})
      `.then((r) => r[0]),
    ]);

    console.log('');
    console.log('[reset] Rows to delete:');
    console.log(`  documents             : ${matchingDocs.length}`);
    console.log(`  versions              : ${versionCount}`);
    console.log(`  state_transitions     : ${transitionCount}`);
    console.log(`  approvals             : ${approvalCount}`);
    console.log(`  contributors          : ${contributorCount}`);
    console.log(`  version_attributions  : ${versionAttrCount}`);
    console.log(`  document_events       : ${eventCount}`);
    console.log(`  section_crdt_states   : ${crdtStateCount}`);
    console.log(`  section_crdt_updates  : ${crdtUpdateCount}`);
    console.log(`  signed_url_tokens     : ${signedUrlCount}`);
    console.log(`  section_leases        : ${leaseCount}`);
    console.log(`  agent_inbox_messages  : ${inboxCount}`);
    console.log(`  agent_signature_nonces: ${nonceCount}`);
    console.log('');

    if (!execute) {
      console.log('[reset] DRY-RUN complete. No data was modified.');
      console.log('[reset] Re-run with --execute to apply deletions.');
      await sql.end();
      process.exit(0);
    }

    // ── Step 3: Confirm before destructive operations ────────────────────────

    const totalRows = Number(matchingDocs.length) + Number(versionCount) +
      Number(transitionCount) + Number(approvalCount) + Number(contributorCount) +
      Number(versionAttrCount) + Number(eventCount) + Number(crdtStateCount) +
      Number(crdtUpdateCount) + Number(signedUrlCount) + Number(leaseCount) +
      Number(inboxCount) + Number(nonceCount);

    const ok = await confirm(
      `[reset] CONFIRM: Delete ${totalRows} total rows from the database? This cannot be undone.`
    );

    if (!ok) {
      console.log('[reset] Aborted. No data was modified.');
      await sql.end();
      process.exit(0);
    }

    // ── Step 4: Execute deletions ────────────────────────────────────────────

    console.log('[reset] Executing deletions...');

    // Documents — FK cascades to all child tables automatically
    const deletedDocs = await sql`
      DELETE FROM documents
      WHERE id = ANY(${docIds})
      RETURNING slug
    `;
    console.log(`[reset] Deleted ${deletedDocs.length} document(s) (cascade applied to child tables)`);

    // Agent inbox — not FK-linked to documents; delete by agent ID
    const deletedInbox = await sql`
      DELETE FROM agent_inbox_messages
      WHERE from_agent_id = ANY(${DEMO_AGENT_IDS})
         OR to_agent_id = ANY(${DEMO_AGENT_IDS})
    `;
    console.log(`[reset] Deleted ${deletedInbox.count ?? 0} agent inbox message(s)`);

    // Agent nonces — not FK-linked to documents; delete by agent ID
    const deletedNonces = await sql`
      DELETE FROM agent_signature_nonces
      WHERE agent_id = ANY(${DEMO_AGENT_IDS})
    `;
    console.log(`[reset] Deleted ${deletedNonces.count ?? 0} agent signature nonce(s)`);

    console.log('');
    console.log('[reset] Reset complete. Re-seed with:');
    console.log('[reset]   LLMTXT_API_KEY=<key> node apps/demo/scripts/seed.js');

    await sql.end();
    process.exit(0);
  } catch (err) {
    console.error('[reset] ERROR:', err.message);
    try {
      await sql.end();
    } catch {
      // Ignore close errors
    }
    process.exit(1);
  }
}

main();
