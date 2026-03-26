# @codluv/llmtxt

Portable llmtxt primitives for TypeScript and Node.js.

`@codluv/llmtxt` wraps the Rust `llmtxt-core` crate through WASM so TypeScript
consumers use the same single-source-of-truth logic as native Rust consumers.

## Install

```bash
npm install @codluv/llmtxt
```

Optional LAFS envelope validation:

```bash
npm install @cleocode/lafs
```

## Core Primitives

```ts
import {
  compress,
  decompress,
  generateId,
  hashContent,
  generateSignedUrl,
  createPatch,
  applyPatch,
} from '@codluv/llmtxt';

const compressed = await compress('Hello world');
const text = await decompress(compressed);
const slug = generateId();
const hash = hashContent(text);

const patch = createPatch('hello\n', 'hello world\n');
const rebuilt = applyPatch('hello\n', patch);
```

## Attachment Client Helpers

```ts
import { createClient } from '@codluv/llmtxt';

const client = createClient({
  apiBase: 'https://api.signaldock.io',
  apiKey: 'sk_live_...',
  agentId: 'my-agent',
});

const upload = await client.upload('conv_123', '# Shared note');
const owned = await client.fetchOwned(upload.slug);
const shared = await client.fetchFromConversation(upload.slug, 'conv_123');

const reshare = await client.reshare(upload.slug, {
  mode: 'signed_url',
  expiresIn: 3600,
});

const version = await client.addVersionFromContent(
  upload.slug,
  owned.content,
  owned.content + '\n\nAppendix',
  { changelog: 'Add appendix' },
);
```

## What Ships

- compression, hashing, base62, token estimation
- signed URL generation and verification
- unified diff patch creation and application
- attachment access helpers for signed URL, owner, and conversation reads
- attachment re-share and version submission helpers
- optional LAFS response parsing when `@cleocode/lafs` is installed

## Release Model

The npm package includes prebuilt WASM artifacts generated from the Rust crate in
`crates/llmtxt-core`, so TypeScript and Rust consumers stay aligned on behavior.
