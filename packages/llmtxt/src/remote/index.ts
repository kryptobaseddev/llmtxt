/**
 * llmtxt/remote — RemoteBackend HTTP/WS client.
 *
 * Import via:
 *   import { RemoteBackend } from 'llmtxt/remote';
 *   import type { Backend } from 'llmtxt/remote';
 */
export { RemoteBackend } from './remote-backend.js';

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
