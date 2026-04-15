/**
 * Knowledge graph extraction from message metadata.
 *
 * All graph-building primitives are now backed by crates/llmtxt-core via WASM
 * (SSoT enforcement, T111/T122). This file re-exports the WASM-backed
 * implementations from wasm.ts to preserve the public API surface.
 *
 * @module graph
 */

export type {
  GraphNode,
  GraphEdge,
  GraphStats,
  KnowledgeGraph,
  MessageInput,
} from './wasm.js';

export {
  buildGraph,
  extractDirectives,
  extractMentions,
  extractTags,
  topAgents,
  topTopics,
} from './wasm.js';
