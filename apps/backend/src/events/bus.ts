/**
 * In-process event bus for document lifecycle events.
 *
 * All route handlers emit events AFTER a successful database write.
 * Listeners are WebSocket connections, SSE streams, and webhook delivery
 * workers — none of which block the request handler.
 *
 * The bus is a plain EventEmitter with a single channel: 'document'.
 * This keeps the fan-out logic entirely in the consumers; the bus has
 * zero knowledge of connections or transports.
 *
 * DocumentEventType and DocumentEvent are canonical types exported from
 * the llmtxt SDK (packages/llmtxt/src/types.ts). This file re-exports
 * them for backward-compatibility with existing backend imports.
 */
import { EventEmitter } from 'node:events';
import type { DocumentEventType, DocumentEvent } from 'llmtxt';

export type { DocumentEventType, DocumentEvent };

// ── Event bus class ──────────────────────────────────────────────────────────

class DocumentEventBus extends EventEmitter {
  constructor() {
    super();
    // Increase the default listener limit to accommodate many concurrent
    // WebSocket / SSE connections per document. 0 = unlimited.
    this.setMaxListeners(0);
  }

  // ── Typed overloads ──────────────────────────────────────────────────────

  emit(event: 'document', payload: DocumentEvent): boolean {
    return super.emit(event, payload);
  }

  on(event: 'document', listener: (payload: DocumentEvent) => void): this {
    return super.on(event, listener);
  }

  off(event: 'document', listener: (payload: DocumentEvent) => void): this {
    return super.off(event, listener);
  }

  once(event: 'document', listener: (payload: DocumentEvent) => void): this {
    return super.once(event, listener);
  }

  // ── Convenience emitters ─────────────────────────────────────────────────

  emitVersionCreated(
    slug: string,
    documentId: string,
    actor: string,
    data: { version: number; changelog?: string | null; createdBy?: string | null },
  ): void {
    this.emit('document', {
      type: 'version.created',
      slug,
      documentId,
      timestamp: Date.now(),
      actor,
      data: data as Record<string, unknown>,
    });
  }

  emitStateChanged(
    slug: string,
    documentId: string,
    actor: string,
    data: { fromState: string; toState: string; reason?: string | null },
  ): void {
    const type: DocumentEventType =
      data.toState === 'LOCKED'
        ? 'document.locked'
        : data.toState === 'ARCHIVED'
          ? 'document.archived'
          : 'state.changed';

    this.emit('document', {
      type,
      slug,
      documentId,
      timestamp: Date.now(),
      actor,
      data: data as Record<string, unknown>,
    });
  }

  emitApprovalSubmitted(
    slug: string,
    documentId: string,
    actor: string,
    data: { status: 'APPROVED' | 'REJECTED'; atVersion: number; autoLocked?: boolean },
  ): void {
    const type: DocumentEventType =
      data.status === 'REJECTED' ? 'approval.rejected' : 'approval.submitted';

    this.emit('document', {
      type,
      slug,
      documentId,
      timestamp: Date.now(),
      actor,
      data: data as Record<string, unknown>,
    });
  }

  emitDocumentCreated(
    slug: string,
    documentId: string,
    actor: string,
    data: { tokenCount: number; format: string },
  ): void {
    this.emit('document', {
      type: 'document.created',
      slug,
      documentId,
      timestamp: Date.now(),
      actor,
      data: data as Record<string, unknown>,
    });
  }
}

// ── Singleton export ─────────────────────────────────────────────────────────

export const eventBus = new DocumentEventBus();
