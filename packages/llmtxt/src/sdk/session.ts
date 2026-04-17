/**
 * Ephemeral Agent Session Lifecycle
 *
 * Provides AgentSession class for managing the lifecycle of ephemeral and
 * persistent agents with explicit state transitions, contribution tracking,
 * and auditable receipts.
 *
 * Spec: docs/specs/ARCH-T426-ephemeral-agent-lifecycle.md
 */

import { randomUUID } from 'node:crypto';

/**
 * Session state machine: Idle → Open → Active → Closing → Closed
 *
 * - Idle: Initial state, waiting for open()
 * - Open: Backend is reachable, temp storage allocated, presence registered
 * - Active: Ready for contributions via contribute()
 * - Closing: Teardown in progress (mutex-protected)
 * - Closed: Teardown complete, receipt emitted
 */
export type AgentSessionState = 'Idle' | 'Open' | 'Active' | 'Closing' | 'Closed';

export const AgentSessionState = {
  Idle: 'Idle' as const,
  Open: 'Open' as const,
  Active: 'Active' as const,
  Closing: 'Closing' as const,
  Closed: 'Closed' as const,
};

/**
 * Contribution Receipt: auditable proof of work performed during a session.
 *
 * RFC 2119 requirement: All fields are mandatory except signature (which is
 * mandatory only for RemoteBackend).
 */
export interface ContributionReceipt {
  /** Session ID (128-bit random, unguessable). */
  sessionId: string;

  /** Agent identity ID (must match authenticated identity in backend). */
  agentId: string;

  /** Unique document IDs written during the session. */
  documentIds: string[];

  /** Total successful write operations performed via contribute(). */
  eventCount: number;

  /** Session duration in milliseconds (closedAt - openedAt). */
  sessionDurationMs: number;

  /** ISO 8601 UTC timestamp of session open. */
  openedAt: string;

  /** ISO 8601 UTC timestamp of session close. */
  closedAt: string;

  /**
   * Ed25519 signature over the canonical receipt payload.
   * MUST be present when backend is RemoteBackend (cross-network).
   * MAY be omitted for LocalBackend (same-process).
   *
   * Signature covers: SHA-256(sessionId + agentId + documentIds.sort().join(',') +
   *                   eventCount + openedAt + closedAt)
   */
  signature?: string;
}

/**
 * AgentSessionError: custom error for session lifecycle violations.
 *
 * Code taxonomy:
 * - SESSION_NOT_FOUND: No session found (e.g., during recovery)
 * - SESSION_ALREADY_OPEN: open() called when not in Idle state
 * - SESSION_NOT_ACTIVE: contribute() called when not in Active state
 * - INVALID_STATE: Invalid state transition attempt
 * - SESSION_CLOSE_PARTIAL: close() completed with failures; see attached errors
 * - NOT_IMPLEMENTED: Method stub (temporary skeleton state)
 */
export class AgentSessionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AgentSessionError';
    this.code = code;
    Object.setPrototypeOf(this, AgentSessionError.prototype);
  }
}

/**
 * AgentSessionOptions: constructor configuration.
 */
export interface AgentSessionOptions {
  /** Backend to operate through (LocalBackend or RemoteBackend). */
  backend: unknown; // Backend type from packages/llmtxt/src/core/backend.ts

  /**
   * Agent identity. MUST match the authenticated identity registered
   * in the backend's identity primitives.
   */
  agentId: string;

  /**
   * Cryptographically random session ID (128-bit entropy minimum).
   * If omitted, AgentSession generates one using crypto.randomUUID().
   * MUST be unguessable; predictable IDs allow session hijacking.
   */
  sessionId?: string;

  /**
   * Human-readable label for this session. Used in receipts.
   * Defaults to agentId + timestamp ISO string.
   */
  label?: string;
}

/**
 * AgentSession: explicit, auditable lifecycle for ephemeral and persistent agents.
 *
 * Usage:
 *
 *   const session = new AgentSession({
 *     backend: remoteBackend,
 *     agentId: 'agent-12345',
 *   });
 *
 *   await session.open();
 *   const result = await session.contribute(() => {
 *     return backend.writeDocument({ ... });
 *   });
 *   const receipt = await session.close();
 *
 * State machine is mutex-protected to prevent concurrent close() calls.
 */
export class AgentSession {
  private state: AgentSessionState = AgentSessionState.Idle;
  private readonly sessionId: string;
  private readonly agentId: string;
  private readonly backend: unknown;
  private readonly label: string;

  private openedAt?: Date;
  private closedAt?: Date;
  private cachedReceipt?: ContributionReceipt;

  private documentIds: Set<string> = new Set();
  private eventCount: number = 0;

  /** Mutex to protect close() from concurrent execution. */
  private closeGuard: boolean = false;

  constructor(options: AgentSessionOptions) {
    this.backend = options.backend;
    this.agentId = options.agentId;
    this.sessionId = options.sessionId ?? randomUUID();
    this.label = options.label ?? `${options.agentId} ${new Date().toISOString()}`;
  }

  /**
   * Get the current session state.
   */
  getState(): AgentSessionState {
    return this.state;
  }

  /**
   * Get the session ID.
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get the agent ID.
   */
  getAgentId(): string {
    return this.agentId;
  }

  /**
   * Get tracked document IDs.
   */
  getDocumentIds(): string[] {
    return Array.from(this.documentIds);
  }

  /**
   * Get event count.
   */
  getEventCount(): number {
    return this.eventCount;
  }

  /**
   * open(): Transition Idle → Open → Active.
   *
   * Initialization steps:
   * 1. Validate backend is reachable (lightweight health probe)
   * 2. For LocalBackend: allocate temp SQLite file in deterministic path
   * 3. Record session start timestamp (monotonic)
   * 4. Register presence via backend.updatePresence() (SHOULD)
   *
   * Throws AgentSessionError:
   * - SESSION_ALREADY_OPEN if state is not Idle
   * - NOT_IMPLEMENTED (skeleton)
   */
  async open(): Promise<void> {
    if (this.state !== AgentSessionState.Idle) {
      throw new AgentSessionError(
        'INVALID_STATE',
        `Cannot open session: state is ${this.state}, expected Idle`
      );
    }

    // Skeleton: initialize state machine
    this.state = AgentSessionState.Open;
    this.openedAt = new Date();
    this.state = AgentSessionState.Active;

    throw new AgentSessionError(
      'NOT_IMPLEMENTED',
      'open() is a skeleton stub; implementation comes in T426.2'
    );
  }

  /**
   * contribute<T>(fn): Wrap and track a unit of work.
   *
   * Requires state === Active. Wraps the caller's function and:
   * 1. Passes the session's backend instance
   * 2. Tracks every documentId returned by write operations
   * 3. Increments eventCount for each successful write
   * 4. Propagates any error without swallowing
   *
   * Throws AgentSessionError:
   * - SESSION_NOT_ACTIVE if state is not Active
   * - NOT_IMPLEMENTED (skeleton)
   */
  async contribute<T>(fn: (backend: unknown) => Promise<T>): Promise<T> {
    if (this.state !== AgentSessionState.Active) {
      throw new AgentSessionError(
        'SESSION_NOT_ACTIVE',
        `Cannot contribute: session state is ${this.state}, expected Active`
      );
    }

    throw new AgentSessionError(
      'NOT_IMPLEMENTED',
      'contribute() is a skeleton stub; implementation comes in T426.3'
    );
  }

  /**
   * close(): Transition Active → Closing → Closed.
   *
   * Teardown steps (all attempted even if earlier steps fail):
   * 1. Sync flush: backend.flushPendingWrites() if exists
   * 2. Drain inbox: backend.pollInbox(agentId) until empty
   * 3. Release leases: backend.releaseLease() for each tracked resource
   * 4. For LocalBackend: delete temp .db file
   * 5. Deregister presence: backend.removePresence()
   * 6. Emit ContributionReceipt
   * 7. Return receipt
   *
   * Throws AgentSessionError:
   * - INVALID_STATE if state is not Active
   * - SESSION_CLOSE_PARTIAL if teardown completes with failures
   * - NOT_IMPLEMENTED (skeleton)
   *
   * Idempotency: calling close() on Closed session returns cached receipt.
   */
  async close(): Promise<ContributionReceipt> {
    if (this.state !== AgentSessionState.Active && this.state !== AgentSessionState.Closed) {
      throw new AgentSessionError(
        'INVALID_STATE',
        `Cannot close: session state is ${this.state}, expected Active or Closed`
      );
    }

    // Idempotency: return cached receipt if already closed
    if (this.state === AgentSessionState.Closed) {
      if (this.cachedReceipt) {
        return this.cachedReceipt;
      }
      throw new AgentSessionError(
        'SESSION_NOT_FOUND',
        'Session is already closed but receipt was not cached'
      );
    }

    // Mutex guard: prevent concurrent close()
    if (this.closeGuard) {
      throw new AgentSessionError(
        'INVALID_STATE',
        'close() is already in progress (mutex contention)'
      );
    }

    this.closeGuard = true;

    try {
      this.state = AgentSessionState.Closing;
      this.closedAt = new Date();

      // Skeleton: return stub receipt
      const receipt: ContributionReceipt = {
        sessionId: this.sessionId,
        agentId: this.agentId,
        documentIds: Array.from(this.documentIds),
        eventCount: this.eventCount,
        sessionDurationMs: this.closedAt.getTime() - (this.openedAt?.getTime() ?? 0),
        openedAt: this.openedAt?.toISOString() ?? new Date().toISOString(),
        closedAt: this.closedAt.toISOString(),
      };

      this.cachedReceipt = receipt;
      this.state = AgentSessionState.Closed;

      throw new AgentSessionError(
        'NOT_IMPLEMENTED',
        'close() is a skeleton stub; implementation comes in T426.4'
      );
    } finally {
      this.closeGuard = false;
    }
  }
}
