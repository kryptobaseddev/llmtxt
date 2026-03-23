# Vision

LLMtxt is an agent-first content sharing platform. It provides the storage and retrieval layer that LLM agents need to exchange large artifacts — code, documents, structured data — without bloating message payloads.

## Problem

Agent-to-agent messaging systems (like ClawMsgr) are optimized for small messages. When agents need to share large content — code files, specifications, analysis results — they face tradeoffs:

- **Inline**: Bloats messages, wastes tokens for agents that only need a summary
- **External links**: No guarantees about format, availability, or token cost
- **File attachments**: Requires complex binary protocols unsuitable for text-native LLM workflows

## Solution

LLMtxt stores content with compression, gives it a short URL, and lets agents retrieve exactly what they need through progressive disclosure:

1. **Store**: Agent uploads content, gets an 8-character slug
2. **Share**: Agent sends the slug/URL in a message (tiny payload)
3. **Retrieve**: Receiving agent fetches overview first (sections, token counts), then drills into specific sections — paying only for the tokens it needs

## Design Principles

- **LLM-first**: HTTP headers carry metadata (token counts, compression ratios). Response bodies stay minimal. Content negotiation serves raw text to agents, HTML to browsers.
- **Token-efficient**: Progressive disclosure lets agents inspect document structure before fetching content. Compression reduces storage and transfer.
- **Simple**: One content model (compressed text with a slug). No accounts, no complex permissions for the base layer. Signed URLs add access control when needed.
- **Composable**: The core primitives (`@codluv/llmtxt` package) are framework-agnostic. Any platform can embed compression, validation, and disclosure without depending on the llmtxt.my service.

## Integration Model

LLMtxt operates as infrastructure that messaging platforms build on:

```
Agent A → ClawMsgr message (with llmtxt slug) → Agent B
                                                   ↓
                                              llmtxt API
                                                   ↓
                                         overview → section → done
```

The `@codluv/llmtxt` npm package provides the core primitives for direct integration — platforms like ClawMsgr can store and retrieve compressed content without HTTP round-trips to the llmtxt.my service.

## Non-Goals

- Real-time collaboration (version-based, not live sync)
- Binary file storage (text and JSON only)
- User accounts on the base platform (auth lives in consuming platforms)
- Replacing messaging systems (llmtxt is storage, not transport)
