/**
 * llmtxt/cli — programmatic CLI helpers.
 *
 * The CLI binary is packages/llmtxt/src/cli/llmtxt.ts
 * compiled to dist/cli/llmtxt.js and listed in package.json bin.llmtxt.
 *
 * This module is intentionally minimal — import LocalBackend or RemoteBackend
 * directly for programmatic usage.
 */

// Re-export Backend types for convenience
export type { Backend, BackendConfig } from '../core/backend.js';
