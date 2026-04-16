# Demo Clean Reset Procedure

> This document describes how to tear down and re-seed the demo environment.
> The reset script NEVER touches real user documents or production data outside
> the demo slug prefix and demo agent IDs.

---

## When to Reset

- Before showing the demo to someone new (start from a clean slate)
- Between test runs to avoid stale event history and summary noise
- After intentional state corruption testing
- When the demo document has reached APPROVED and no new writes are possible
- When agent inboxes contain stale messages from prior runs that confuse consensus

---

## What Gets Reset

The script targets data by **slug prefix** and **agent ID pattern**:

| Table | Deletion Criteria |
|-------|------------------|
| `documents` | `slug` matches prefix (`demo-*` or explicit slugs) |
| `versions` | FK cascade from deleted documents |
| `state_transitions` | FK cascade from deleted documents |
| `approvals` | FK cascade from deleted documents |
| `contributors` | FK cascade from deleted documents |
| `version_attributions` | FK cascade from deleted documents |
| `document_events` | FK cascade from deleted documents |
| `section_crdt_states` | FK cascade from deleted documents |
| `section_crdt_updates` | FK cascade from deleted documents |
| `signed_url_tokens` | FK cascade from deleted documents |
| `section_leases` | FK cascade from deleted documents |
| `agent_inbox_messages` | `from_agent_id` or `to_agent_id` in demo agent list |
| `agent_signature_nonces` | `agent_id` in demo agent list |

**Never deleted:** user accounts, API keys, production documents, audit logs
for production events, agent pubkeys (so agents can re-register without re-keying).

### Demo Agent IDs

```
writerbot-demo
reviewerbot-demo
consensusbot-demo
summarizerbot-demo
observerbot-t308
seeder-demo
```

### Default Slug Prefix

`demo-` — plus the three T308 test slugs (`AitP8qCx`, `ETlHNZ45`, `1jg483oR`)
which are added to the explicit slug list automatically.

---

## How to Run

```bash
# Dry run (default — shows what WOULD be deleted, touches nothing)
node apps/demo/scripts/reset.js

# Show help / all options
node apps/demo/scripts/reset.js --help

# Dry run with a custom prefix
node apps/demo/scripts/reset.js --slug-prefix=test-

# Execute the reset (requires explicit flag)
node apps/demo/scripts/reset.js --execute

# Execute without confirmation prompt
node apps/demo/scripts/reset.js --execute --yes
```

The script prints a count for each table, confirms the total row count to be
deleted, and exits 0 on success or 1 on any error.

---

## Prerequisites

One of the following must be available:

### Option A — Direct Postgres (preferred)

Set `DATABASE_URL` to the Railway Postgres public URL:

```bash
export DATABASE_URL="postgresql://postgres:<password>@nozomi.proxy.rlwy.net:17912/railway"
```

Retrieve the URL:
```bash
railway variables --service Postgres --kv | grep DATABASE_PUBLIC_URL
```

### Option B — (Future) Admin API

An admin API endpoint for bulk document deletion is not yet implemented.
`DATABASE_URL` is required for now.

---

## After Reset

Re-seed a fresh document and restart the agents:

```bash
# 1. Seed a new document
LLMTXT_API_KEY=<key> node apps/demo/scripts/seed.js
# Output: DEMO_SLUG=<new-slug>

# 2. Run the orchestrator
LLMTXT_API_KEY=<key> DEMO_SLUG=<new-slug> node apps/demo/scripts/t308-e2e-orchestrator.js
```

If the demo service is Railway-hosted, restart the `llmtxt-demo-agents` service
to begin a new cycle with a freshly seeded slug.

---

## Manual Fallback

If the script fails, run these psql commands in order (FK cascade order):

```sql
-- 1. Collect document IDs to delete
CREATE TEMP TABLE demo_doc_ids AS
SELECT id FROM documents
WHERE slug LIKE 'demo-%'
   OR slug IN ('AitP8qCx', 'ETlHNZ45', '1jg483oR');

-- 2. Delete documents (cascades to all child tables)
DELETE FROM documents WHERE id IN (SELECT id FROM demo_doc_ids);

-- 3. Clear demo agent inboxes
DELETE FROM agent_inbox_messages
WHERE from_agent_id IN (
  'writerbot-demo','reviewerbot-demo','consensusbot-demo',
  'summarizerbot-demo','observerbot-t308','seeder-demo'
)
   OR to_agent_id IN (
  'writerbot-demo','reviewerbot-demo','consensusbot-demo',
  'summarizerbot-demo','observerbot-t308','seeder-demo'
);

-- 4. Clear demo agent nonces
DELETE FROM agent_signature_nonces
WHERE agent_id IN (
  'writerbot-demo','reviewerbot-demo','consensusbot-demo',
  'summarizerbot-demo','observerbot-t308','seeder-demo'
);

DROP TABLE demo_doc_ids;
```

Connect to Postgres:
```bash
# Railway shell
railway connect Postgres

# Or psql from laptop
psql "$(railway variables --service Postgres --kv | grep DATABASE_PUBLIC_URL | cut -d= -f2-)"
```
