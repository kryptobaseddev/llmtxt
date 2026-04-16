# CLEO + LLMtxt Integration Example

This example shows how CLEO project management integrates with LLMtxt's
`LocalBackend` for agent collaboration — task attachment docs, decision records,
agent-to-agent messaging, and real-time presence.

No network required. No api.llmtxt.my. Everything runs embedded in-process.

## Quick Start

```ts
import { LocalBackend } from 'llmtxt/local';

const backend = new LocalBackend({ storagePath: './.llmtxt' });
await backend.open();

// Create a document attached to a CLEO task
const spec = await backend.createDocument({
  title: 'T317 Portable SDK Specification',
  createdBy: 'agent-architect',
  labels: ['spec', 'T317'],
});

// Publish a version
await backend.publishVersion({
  documentId: spec.id,
  content: '# T317 Spec\n\n## Requirements\n- LocalBackend\n- RemoteBackend\n- CLI',
  patchText: '',
  createdBy: 'agent-architect',
  changelog: 'Initial specification',
});

// Other agents collaborate via events
await backend.appendEvent({
  documentId: spec.id,
  type: 'cleo.task.comment',
  agentId: 'agent-reviewer',
  payload: { comment: 'Add contract tests to requirements' },
});

await backend.close();
```

## Run the Full Example

```bash
# From the monorepo root:
pnpm --filter @llmtxt/example-cleo-integration exec tsx index.ts

# Or directly with tsx (if installed globally):
tsx apps/examples/cleo-integration/index.ts
```

## Patterns Demonstrated

| Pattern | Description |
|---------|-------------|
| Task Attachment | Create a versioned spec doc per CLEO task |
| Decision Records | BFT multi-agent approval gating |
| Agent Coordination | Scratchpad messaging + distributed leases |
| Presence | Who is currently editing a document |

## Storage

Documents are stored in SQLite at `./.llmtxt/llmtxt.db`. Large content
(> 10 KB) is stored as binary blobs in `./.llmtxt/blobs/`.

## Sync to Remote

When ready to share with remote agents:

```bash
llmtxt sync --remote https://api.llmtxt.my --api-key $LLMTXT_API_KEY
```
