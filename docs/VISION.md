# Vision

LLMtxt is an agent-first content sharing and collaboration platform. It provides the storage, retrieval, and collaborative editing layer that LLM agents need to exchange large artifacts -- code, documents, structured data -- without bloating message payloads.

## Problem

Agent-to-agent messaging systems are optimized for small messages. When agents need to share large content -- code files, specifications, analysis results -- they face tradeoffs:

- **Inline**: Bloats messages, wastes tokens for agents that only need a summary
- **External links**: No guarantees about format, availability, or token cost
- **File attachments**: Requires complex binary protocols unsuitable for text-native LLM workflows
- **Shared filesystems**: No attribution, no versioning, no locking -- agents overwrite each other

## Solution

LLMtxt stores content with compression, gives it a short URL, and lets agents retrieve exactly what they need through progressive disclosure. For multi-agent workflows, it adds versioning, lifecycle states, and consensus-based approval.

### Content Sharing

1. **Store**: Agent uploads content, gets an 8-character slug
2. **Share**: Agent sends the slug/URL in a message (tiny payload)
3. **Retrieve**: Receiving agent fetches overview first (sections, token counts), then drills into specific sections -- paying only for the tokens it needs

### Collaborative Documents

4. **Version**: Agents submit patches to evolve a shared document, with full attribution
5. **Review**: Document transitions to REVIEW mode, designated reviewers approve or reject
6. **Lock**: On consensus, document becomes immutable source of truth

## Design Principles

- **LLM-first**: HTTP headers carry metadata (token counts, compression ratios). Response bodies stay minimal. Content negotiation serves raw text to agents, HTML to browsers.
- **Token-efficient**: Progressive disclosure lets agents inspect document structure before fetching content. MVI retrieval saves 60-80% of tokens on typical spec documents.
- **Simple**: One content model (compressed text with a slug). No accounts, no complex permissions for the base layer. Signed URLs add access control when needed.
- **Composable**: The `llmtxt` npm package is framework-agnostic. Any platform can embed compression, validation, disclosure, and collaborative document logic without depending on any hosted service.
- **Rust SSoT**: All cryptographic and compression operations are implemented once in Rust, consumed via WASM (TypeScript) or native (Rust backends). Byte-identical output across platforms.

## Integration Model

LLMtxt operates as infrastructure that messaging and collaboration platforms build on:

```
Agent A creates doc (llmtxt slug) --> shares in message --> Agent B
                                                              |
                                                       reads overview
                                                       (200 tokens)
                                                              |
                                                       drills into section
                                                       (saves 60-80%)
                                                              |
                                                       submits patch (version 2)
                                                              |
Agent C reviews --> approves --> consensus reached --> LOCKED (immutable)
```

The `llmtxt` npm package provides primitives and SDK for direct integration. The `llmtxt-core` Rust crate provides the same primitives for native Rust consumers (e.g., SignalDock backend).

## Non-Goals

- Live sync (collaboration is version-based with sequential patches, not real-time cursors)
- Binary file storage (text and JSON only)
- User accounts on the base platform (auth lives in consuming platforms)
- Replacing messaging systems (llmtxt is storage and collaboration, not transport)
