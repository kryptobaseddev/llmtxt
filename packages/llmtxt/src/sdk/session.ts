/**
 * Ephemeral Agent Lifecycle — AgentSession
 *
 * Provides AgentSession class for managing the lifecycle of ephemeral and
 * persistent agents with explicit state transitions, contribution tracking,
 * and auditable receipts.
 *
 * Spec: docs/specs/ARCH-T426-ephemeral-agent-lifecycle.md
 * Implements: T430 (skeleton), T431 (open), T432 (contribute), T433 (close), T437 (receipt),
 *             T434 (crash recovery contract)
 *
 * ── Crash Recovery Contract (spec §5) ────────────────────────────────────────
 *
 * AgentSession relies exclusively on TTL mechanisms already present in the backend.
 * No new server-side session registry is required.
 *
 * CRASH GUARANTEE: If an agent process dies without calling close(), all lease and
 * presence state WILL be cleaned up within max(leaseMaxDuration, presenceTtlMs) of
 * the crash — currently at most 330 s under default config:
 *
 *   | Resource       | TTL mechanism                   | Default expiry |
 *   |----------------|---------------------------------|----------------|
 *   | Leases         | leases.expiresAt (reaper-swept) | ≤ 300 s        |
 *   | Presence       | presenceTtlMs in BackendConfig  | 30 s           |
 *   | A2A inbox msgs | expiresAt on InboxMessage       | Policy-defined |
 *   | Nonces         | nonces table TTL                | Policy-defined |
 *
 * DATA SAFETY: close() is BEST-EFFORT. A crash is SURVIVABLE. Data (document
 * writes) is NOT LOST — contributions persisted via contribute() are durable
 * in the backend from the moment they complete, regardless of whether close()
 * is called. Only leases and presence entries expire; written documents remain.
 *
 * KNOWN GAP (acknowledged per spec §5): A2A inbox messages addressed to the
 * crashed agent accumulate until sender TTLs fire. Senders SHOULD set short
 * TTLs on ephemeral-worker-addressed messages.
 *
 * INTEGRATION TEST: packages/llmtxt/src/__tests__/session-crash-recovery.test.ts
 * SWARM TEST: packages/llmtxt/src/__tests__/session-swarm.test.ts (50 workers)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from "node:crypto";
import type { Backend } from "../core/backend.js";

/**
 * Session state machine: Idle -> Open -> Active -> Closing -> Closed
 *
 * - Idle: Initial state, waiting for open()
 * - Open: Backend initialization in progress (transient; transitions to Active)
 * - Active: Ready for contributions via contribute()
 * - Closing: Teardown in progress (mutex-protected)
 * - Closed: Teardown complete, receipt emitted
 */
export type AgentSessionState =
	| "Idle"
	| "Open"
	| "Active"
	| "Closing"
	| "Closed";

export const AgentSessionState = {
	Idle: "Idle" as const,
	Open: "Open" as const,
	Active: "Active" as const,
	Closing: "Closing" as const,
	Closed: "Closed" as const,
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

	/** Unique document IDs written during the session (sorted for determinism). */
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
	 *
	 * Stub for now — T461 will add Ed25519 signing to AgentSession.
	 */
	signature?: string;
}

/**
 * Error raised when one or more close() teardown steps fail while the session
 * still reaches the Closed state. Callers can inspect `errors` for details
 * and `receipt` for the partial receipt.
 */
export interface CloseStepError {
	step: string;
	error: Error;
}

/**
 * AgentSessionError: custom error for session lifecycle violations.
 *
 * Code taxonomy:
 * - SESSION_NOT_FOUND: No session found (e.g., during recovery)
 * - SESSION_ALREADY_OPEN: open() called when not in Idle state
 * - SESSION_NOT_ACTIVE: contribute() called when not in Active state
 * - INVALID_STATE: Invalid state transition attempt
 * - BACKEND_ERROR: Backend rejected the operation (wrapped original error)
 * - SESSION_CLOSE_PARTIAL: close() completed with failures; see attached errors
 */
export class AgentSessionError extends Error {
	readonly code: string;
	readonly cause?: unknown;
	/** Partial receipt attached when code is SESSION_CLOSE_PARTIAL. */
	receipt?: ContributionReceipt;
	/** Step-level errors attached when code is SESSION_CLOSE_PARTIAL. */
	errors?: CloseStepError[];

	constructor(code: string, message: string, cause?: unknown) {
		super(message);
		this.name = "AgentSessionError";
		this.code = code;
		this.cause = cause;
		Object.setPrototypeOf(this, AgentSessionError.prototype);
	}
}

/**
 * AgentSessionOptions: constructor configuration.
 */
export interface AgentSessionOptions {
	/**
	 * Backend to operate through (LocalBackend or RemoteBackend).
	 * Typed as Backend to enable proper method calls; consumers pass concrete
	 * implementations (LocalBackend or RemoteBackend).
	 */
	backend: Backend;

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
 * Shape returned by contribute() fn that carries document tracking info.
 * The fn MAY return an object with documentId or documentIds to allow the
 * session to track which documents were touched.
 */
interface ContributeResult {
	documentId?: string;
	documentIds?: string[];
}

/**
 * Backend extended surface used by close() teardown.
 *
 * The core Backend interface does not yet declare these optional session
 * primitives. We cast to this broader type inside close() to call them
 * when they exist at runtime. T461 will promote these into Backend proper.
 */
interface BackendWithOptionalSessionPrimitives {
	/** Flush any pending in-memory writes to durable storage. */
	flushPendingWrites?: () => Promise<void>;
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
 *   const result = await session.contribute((backend) => {
 *     return backend.createDocument({ title: 'My Doc', createdBy: 'agent-12345' });
 *   });
 *   const receipt = await session.close();
 *
 * State machine is mutex-protected to prevent concurrent close() calls.
 *
 * Backend interface note (T461 follow-up):
 *   The current Backend interface has no registerSession / unregisterSession /
 *   flushPendingWrites / releaseAllLeases methods. open() uses joinPresence()
 *   on a sentinel document ID derived from the sessionId to signal activity.
 *   T461 will add dedicated session primitives to the Backend interface.
 *
 * Receipt persistence note (T461 follow-up):
 *   When documents were touched, close() calls backend.appendEvent() to persist
 *   the receipt as a 'session.closed' event on the first touched document.
 *   A dedicated backend.persistContributionReceipt() is deferred to T461.
 */
export class AgentSession {
	private state: AgentSessionState = AgentSessionState.Idle;
	private readonly sessionId: string;
	private readonly agentId: string;
	private readonly backend: Backend;
	private readonly label: string;

	private openedAt?: Date;
	private closedAt?: Date;
	private cachedReceipt?: ContributionReceipt;

	private _documentIds: Set<string> = new Set();
	private _eventCount = 0;

	/** Mutex to protect close() from concurrent execution. */
	private closeGuard = false;

	constructor(options: AgentSessionOptions) {
		this.backend = options.backend;
		this.agentId = options.agentId;
		this.sessionId = options.sessionId ?? randomUUID();
		this.label =
			options.label ?? `${options.agentId} ${new Date().toISOString()}`;
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
		return Array.from(this._documentIds);
	}

	/**
	 * Get event count.
	 */
	getEventCount(): number {
		return this._eventCount;
	}

	/**
	 * open(): Transition Idle -> Open -> Active.
	 *
	 * Initialization steps (spec §3.2):
	 * 1. Guard: throw SESSION_ALREADY_OPEN if state !== Idle (not re-entrant)
	 * 2. Transition to Open
	 * 3. Record openedAt timestamp
	 * 4. Register presence via backend.joinPresence() (SHOULD per spec §3.2.4)
	 *    — uses a session sentinel doc ID since Backend has no registerSession().
	 *    T461 will add dedicated session primitives to Backend interface.
	 * 5. Transition to Active
	 *
	 * Throws AgentSessionError:
	 * - SESSION_ALREADY_OPEN if state is not Idle
	 * - BACKEND_ERROR if backend rejects synchronously (async rejections are tolerated)
	 */
	async open(): Promise<void> {
		if (this.state !== AgentSessionState.Idle) {
			throw new AgentSessionError(
				"SESSION_ALREADY_OPEN",
				`Cannot open session: state is ${this.state}, expected Idle`,
			);
		}

		// Transition to Open — marks initialization in progress
		this.state = AgentSessionState.Open;
		this.openedAt = new Date();

		// SHOULD register presence to signal activity (spec §3.2.4).
		// Backend has no registerSession(); we use joinPresence on a session
		// sentinel document ID. T461 will introduce proper session primitives.
		// Presence failure is non-fatal — session still opens.
		await this.backend
			.joinPresence(`session:${this.sessionId}`, this.agentId, {
				label: this.label,
				openedAt: this.openedAt.toISOString(),
			})
			.catch(() => {
				// Presence failure is advisory; do not block open().
			});

		// Transition to Active — session is now ready for contributions
		this.state = AgentSessionState.Active;
	}

	/**
	 * contribute<T>(fn): Wrap and track a unit of work.
	 *
	 * Requires state === Active. Wraps the caller's function and (spec §3.3):
	 * 1. Guard: throw SESSION_NOT_ACTIVE if state !== Active
	 * 2. Pass the session's backend instance to fn
	 * 3. On success:
	 *    a. Extract documentId / documentIds from the result (if object-shaped)
	 *    b. Increment eventCount
	 * 4. On error: propagate WITHOUT modifying eventCount or documentIds
	 *
	 * Document ID tracking strategy:
	 *   The spec offers two options — proxy interception or caller-returned IDs.
	 *   We use the caller-returned approach: if fn returns an object with
	 *   `documentId` (string) or `documentIds` (string[]) fields, those are
	 *   extracted. This is zero-overhead and does not require Proxy.
	 *
	 * Throws:
	 * - AgentSessionError(SESSION_NOT_ACTIVE) if state is not Active
	 * - Re-throws any error raised by fn (after leaving state as Active)
	 */
	async contribute<T>(fn: (backend: Backend) => Promise<T>): Promise<T> {
		if (this.state !== AgentSessionState.Active) {
			throw new AgentSessionError(
				"SESSION_NOT_ACTIVE",
				`Cannot contribute: session state is ${this.state}, expected Active`,
			);
		}

		// If fn throws, the exception propagates before the extraction and increment.
		// eventCount and documentIds are therefore unchanged on error (spec §3.3 MUST NOT).
		const result: T = await fn(this.backend);

		// Extract document IDs from result if it looks like a write response
		if (result !== null && result !== undefined && typeof result === "object") {
			const r = result as ContributeResult;
			if (typeof r.documentId === "string" && r.documentId.length > 0) {
				this._documentIds.add(r.documentId);
			}
			if (Array.isArray(r.documentIds)) {
				for (const id of r.documentIds) {
					if (typeof id === "string" && id.length > 0) {
						this._documentIds.add(id);
					}
				}
			}
		}

		// Increment eventCount only on success (spec §3.3)
		this._eventCount += 1;

		return result;
	}

	/**
	 * close(): Transition Active -> Closing -> Closed.
	 *
	 * Teardown steps (spec §3.4 — all attempted even if earlier steps fail):
	 * 1. Flush pending writes via backend.flushPendingWrites() if available
	 * 2. Drain A2A inbox: backend.pollA2AInbox(agentId) until empty
	 * 3. Release all leases (none tracked at session level — T461 will add
	 *    per-resource lease tracking; skipped with T461 note)
	 * 4. For LocalBackend: temp .db cleanup is deferred to T461 (backend owns paths)
	 * 5. Deregister presence: backend.leavePresence()
	 * 6. Build ContributionReceipt (documentIds sorted for determinism)
	 * 7. Persist receipt via backend.appendEvent() on first touched document
	 * 8. Return receipt
	 *
	 * All teardown steps MUST be attempted even if earlier steps fail. Failures
	 * are collected and surfaced as SESSION_CLOSE_PARTIAL with the partial receipt
	 * and a list of CloseStepError. The receipt is always returned (or rethrown
	 * attached to the error).
	 *
	 * Idempotency: calling close() on an already-closed session returns the
	 * cached receipt immediately without re-executing teardown steps.
	 *
	 * Throws AgentSessionError:
	 * - INVALID_STATE if state is not Active or Closed (i.e., Idle, Open, Closing)
	 * - SESSION_CLOSE_PARTIAL if teardown completed with step failures
	 *
	 * Note on leases: Per spec §3.4 step 3, leases should be released here.
	 * The current Backend interface tracks leases by resource key, not by session.
	 * AgentSession does not intercept acquireLease calls (it wraps via contribute()),
	 * so it cannot enumerate what the agent acquired. T461 will add a
	 * backend.releaseSessionLeases(sessionId) primitive. Until then, caller-acquired
	 * leases expire via TTL per the crash recovery contract (spec §5).
	 */
	async close(): Promise<ContributionReceipt> {
		// Idempotency: return cached receipt if already closed
		if (this.state === AgentSessionState.Closed) {
			if (this.cachedReceipt) {
				return this.cachedReceipt;
			}
			throw new AgentSessionError(
				"SESSION_NOT_FOUND",
				"Session is already closed but receipt was not cached",
			);
		}

		// Guard: only Active state can transition to Closing
		if (this.state !== AgentSessionState.Active) {
			throw new AgentSessionError(
				"INVALID_STATE",
				`Cannot close: session state is ${this.state}, expected Active or Closed`,
			);
		}

		// Mutex guard: prevent concurrent close() execution
		if (this.closeGuard) {
			throw new AgentSessionError(
				"INVALID_STATE",
				"close() is already in progress (mutex contention)",
			);
		}

		this.closeGuard = true;

		try {
			this.state = AgentSessionState.Closing;
			this.closedAt = new Date();

			const closeErrors: CloseStepError[] = [];

			// ── Step 1: Flush pending writes ─────────────────────────────────
			// Optional — flushPendingWrites is not in Backend interface (T461).
			// Cast to extended type to call it when available at runtime.
			try {
				const extended = this
					.backend as unknown as BackendWithOptionalSessionPrimitives;
				if (typeof extended.flushPendingWrites === "function") {
					await extended.flushPendingWrites();
				}
			} catch (err) {
				closeErrors.push({
					step: "flushPendingWrites",
					error: err instanceof Error ? err : new Error(String(err)),
				});
			}

			// ── Step 2: Drain A2A inbox ──────────────────────────────────────
			// Poll until empty; delete each message. Best-effort — failures collected.
			try {
				let batch: Awaited<ReturnType<Backend["pollA2AInbox"]>>;
				do {
					batch = await this.backend.pollA2AInbox(this.agentId, 50);
					for (const msg of batch) {
						// Best-effort per-message delete — failures don't abort drain
						await this.backend
							.deleteA2AMessage(msg.id, this.agentId)
							.catch(() => {});
					}
				} while (batch.length > 0);
			} catch (err) {
				closeErrors.push({
					step: "drainA2AInbox",
					error: err instanceof Error ? err : new Error(String(err)),
				});
			}

			// ── Step 3: Release leases ───────────────────────────────────────
			// T461 follow-up: AgentSession does not currently track which resources
			// the agent acquired leases on (leases are acquired inside contribute()
			// callbacks without interception). Until T461 adds a dedicated
			// backend.releaseSessionLeases(sessionId) method, leases expire via
			// the TTL-based crash recovery contract documented in spec §5.
			// No action taken here; documented as known gap per spec acknowledgment.

			// ── Step 4: Temp .db cleanup ─────────────────────────────────────
			// T461 follow-up: LocalBackend owns the temp DB path allocation.
			// AgentSession does not know the path. T461 will expose
			// backend.cleanupSessionStorage(sessionId) for this purpose.
			// TTL-based cleanup via OS temp dir GC covers the interim.

			// ── Step 5: Deregister presence ──────────────────────────────────
			// Non-fatal: TTL will clean up if leavePresence fails.
			try {
				await this.backend.leavePresence(
					`session:${this.sessionId}`,
					this.agentId,
				);
			} catch (err) {
				closeErrors.push({
					step: "leavePresence",
					error: err instanceof Error ? err : new Error(String(err)),
				});
			}

			// ── Step 6: Build ContributionReceipt ────────────────────────────
			// documentIds sorted for deterministic output (spec §4.1).
			const openedAtTs = this.openedAt ?? new Date();
			const sortedDocumentIds = Array.from(this._documentIds).sort();
			const receipt: ContributionReceipt = {
				sessionId: this.sessionId,
				agentId: this.agentId,
				documentIds: sortedDocumentIds,
				eventCount: this._eventCount,
				sessionDurationMs: this.closedAt.getTime() - openedAtTs.getTime(),
				openedAt: openedAtTs.toISOString(),
				closedAt: this.closedAt.toISOString(),
				// signature: undefined — T461 will add Ed25519 signing
			};

			// ── Step 7: Persist receipt ──────────────────────────────────────
			// Append a 'session.closed' event on the first touched document.
			// If no documents were touched, skip persistence (spec §4.3 OPTIONAL).
			// T461 will add backend.persistContributionReceipt() for both LocalBackend
			// (JSONL append) and RemoteBackend (dedicated endpoint).
			if (sortedDocumentIds.length > 0) {
				try {
					await this.backend.appendEvent({
						documentId: sortedDocumentIds[0],
						type: "session.closed",
						agentId: this.agentId,
						payload: receipt as unknown as Record<string, unknown>,
					});
				} catch (err) {
					closeErrors.push({
						step: "persistReceipt",
						error: err instanceof Error ? err : new Error(String(err)),
					});
				}
			}

			// ── Step 8: Cache receipt and finalize state ─────────────────────
			this.cachedReceipt = receipt;
			this.state = AgentSessionState.Closed;

			// Surface collected step errors as SESSION_CLOSE_PARTIAL
			if (closeErrors.length > 0) {
				const partial = new AgentSessionError(
					"SESSION_CLOSE_PARTIAL",
					`close() completed with ${closeErrors.length} error(s): ${closeErrors.map((e) => `${e.step}: ${e.error.message}`).join("; ")}`,
				);
				partial.receipt = receipt;
				partial.errors = closeErrors;
				throw partial;
			}

			return receipt;
		} finally {
			this.closeGuard = false;
		}
	}
}
