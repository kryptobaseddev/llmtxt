/**
 * llmtxt/local — LocalBackend embedded SQLite implementation.
 *
 * Import via:
 *   import { LocalBackend } from 'llmtxt/local';
 *   import type { Backend } from 'llmtxt/local';
 */
export { LocalBackend } from './local-backend.js';
export * as schema from './schema-local.js';

// Re-export Backend interface and all core types for convenience
export type {
  Backend,
  BackendConfig,
  Document,
  CreateDocumentParams,
  ListDocumentsParams,
  ListResult,
  PublishVersionParams,
  TransitionParams,
  AppendEventParams,
  DocumentEvent,
  QueryEventsParams,
  CrdtUpdate,
  CrdtState,
  AcquireLeaseParams,
  Lease,
  PresenceEntry,
  ScratchpadMessage,
  SendScratchpadParams,
  A2AMessage,
  SearchParams,
  SearchResult,
  AgentPubkeyRecord,
  ApprovalResult,
  ApprovalPolicy,
} from '../core/backend.js';
