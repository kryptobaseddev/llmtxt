/**
 * AgentSession tests — T430 (skeleton) + T431 (open) + T432 (contribute)
 *
 * Test suite for the ephemeral agent session lifecycle.
 * Tests the state machine, open(), contribute(), error handling, and type API.
 *
 * Spec: docs/specs/ARCH-T426-ephemeral-agent-lifecycle.md
 * Test runner: node:test (native, no vitest dependency)
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type { Backend } from "../core/backend.js";
import {
	AgentSession,
	AgentSessionError,
	type AgentSessionOptions,
	AgentSessionState,
	type ContributionReceipt,
} from "../sdk/session.js";

// ── Helpers ────────────────────────────────────────────────────

function isValidUUIDv4(str: string): boolean {
	const uuidv4Regex =
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	return uuidv4Regex.test(str);
}

/**
 * Build a minimal mock Backend that satisfies the AgentSession interface needs.
 * Only the methods called by open() / close() need non-throwing stubs.
 */
function makeMockBackend(overrides: Partial<Backend> = {}): Backend {
	const base: Partial<Backend> = {
		// Presence — called by open() and close()
		joinPresence: async () => ({
			agentId: "test-agent",
			documentId: "session:test",
			lastSeen: Date.now(),
			expiresAt: Date.now() + 30_000,
		}),
		leavePresence: async () => {},

		// A2A inbox — drained by close()
		pollA2AInbox: async () => [],
		deleteA2AMessage: async () => true,
	};

	return { ...base, ...overrides } as Backend;
}

/**
 * Create a session in Active state (open() already called).
 * Used by tests that focus on contribute() behaviour.
 */
async function makeActiveSession(
	backendOverrides: Partial<Backend> = {},
	opts: Partial<AgentSessionOptions> = {},
): Promise<AgentSession> {
	const session = new AgentSession({
		backend: makeMockBackend(backendOverrides),
		agentId: "test-agent",
		...opts,
	});
	await session.open();
	return session;
}

// ── Test suite ─────────────────────────────────────────────────

describe("AgentSession", () => {
	// ── constructor ──────────────────────────────────────────────

	describe("constructor", () => {
		it("should create a new session in Idle state", () => {
			const session = new AgentSession({
				backend: makeMockBackend(),
				agentId: "test-agent-1",
			});

			assert.equal(session.getState(), AgentSessionState.Idle);
			assert.equal(session.getAgentId(), "test-agent-1");
		});

		it("should generate a random sessionId when omitted", () => {
			const session = new AgentSession({
				backend: makeMockBackend(),
				agentId: "test-agent-1",
			});

			const sessionId = session.getSessionId();
			assert(typeof sessionId === "string");
			assert(sessionId.length > 0);
			assert(
				isValidUUIDv4(sessionId),
				`sessionId should be a valid UUID v4: ${sessionId}`,
			);
		});

		it("should use randomUUID() and produce unique IDs", () => {
			const s1 = new AgentSession({ backend: makeMockBackend(), agentId: "a" });
			const s2 = new AgentSession({ backend: makeMockBackend(), agentId: "a" });
			assert.notEqual(s1.getSessionId(), s2.getSessionId());
		});

		it("should accept explicit sessionId override", () => {
			const customId = randomUUID();
			const session = new AgentSession({
				backend: makeMockBackend(),
				agentId: "test-agent-1",
				sessionId: customId,
			});
			assert.equal(session.getSessionId(), customId);
		});

		it("should track empty documentIds set initially", () => {
			const session = new AgentSession({
				backend: makeMockBackend(),
				agentId: "a",
			});
			assert.deepEqual(session.getDocumentIds(), []);
		});

		it("should have zero eventCount initially", () => {
			const session = new AgentSession({
				backend: makeMockBackend(),
				agentId: "a",
			});
			assert.equal(session.getEventCount(), 0);
		});
	});

	// ── open() ───────────────────────────────────────────────────

	describe("open()", () => {
		it("should succeed from Idle state and end in Active", async () => {
			const session = new AgentSession({
				backend: makeMockBackend(),
				agentId: "test-agent",
			});

			assert.equal(session.getState(), AgentSessionState.Idle);
			await session.open();
			assert.equal(session.getState(), AgentSessionState.Active);
		});

		it("should record openedAt after open()", async () => {
			const before = Date.now();
			const session = await makeActiveSession();
			const after = Date.now();

			// Verify openedAt via close() receipt
			const receipt = await session.close();
			assert(
				typeof receipt.openedAt === "string",
				"openedAt should be a string",
			);
			const openedMs = new Date(receipt.openedAt).getTime();
			assert(openedMs >= before, "openedAt should be >= test start");
			assert(openedMs <= after + 100, "openedAt should be <= test end + 100ms");
		});

		it("should call joinPresence on the backend", async () => {
			let presenceCalled = false;
			const session = new AgentSession({
				backend: makeMockBackend({
					joinPresence: async (docId, agentId) => {
						assert(
							docId.startsWith("session:"),
							"sentinel doc ID must start with session:",
						);
						assert.equal(agentId, "test-agent-presence");
						presenceCalled = true;
						return {
							agentId,
							documentId: docId,
							lastSeen: Date.now(),
							expiresAt: Date.now() + 30_000,
						};
					},
				}),
				agentId: "test-agent-presence",
			});

			await session.open();
			assert(presenceCalled, "joinPresence should have been called");
		});

		it("should still open successfully even if joinPresence fails", async () => {
			// Presence is advisory — non-fatal per spec §3.2.4 (SHOULD, not MUST)
			const session = new AgentSession({
				backend: makeMockBackend({
					joinPresence: async () => {
						throw new Error("presence server unreachable");
					},
				}),
				agentId: "test-agent",
			});

			await session.open(); // MUST NOT throw
			assert.equal(session.getState(), AgentSessionState.Active);
		});

		it("should throw SESSION_ALREADY_OPEN when called from Active state", async () => {
			const session = await makeActiveSession();

			await assert.rejects(
				async () => session.open(),
				(err: unknown) => {
					assert(err instanceof AgentSessionError);
					assert.equal(err.code, "SESSION_ALREADY_OPEN");
					assert.match(err.message, /expected Idle/);
					return true;
				},
			);
		});

		it("should throw SESSION_ALREADY_OPEN when called twice (idempotency guard)", async () => {
			const session = new AgentSession({
				backend: makeMockBackend(),
				agentId: "test-agent",
			});

			await session.open();

			await assert.rejects(
				async () => session.open(),
				(err: unknown) => {
					assert(err instanceof AgentSessionError);
					assert.equal(err.code, "SESSION_ALREADY_OPEN");
					return true;
				},
			);
		});

		it("should throw SESSION_ALREADY_OPEN from Closed state", async () => {
			const session = new AgentSession({
				backend: makeMockBackend(),
				agentId: "test-agent",
			});
			await session.open();
			await session.close();

			await assert.rejects(
				async () => session.open(),
				(err: unknown) => {
					assert(err instanceof AgentSessionError);
					assert.equal(err.code, "SESSION_ALREADY_OPEN");
					return true;
				},
			);
		});
	});

	// ── contribute() ─────────────────────────────────────────────

	describe("contribute()", () => {
		it("should throw SESSION_NOT_ACTIVE when called on Idle session", async () => {
			const session = new AgentSession({
				backend: makeMockBackend(),
				agentId: "test-agent",
			});

			await assert.rejects(
				async () => session.contribute(async () => "work"),
				(err: unknown) => {
					assert(err instanceof AgentSessionError);
					assert.equal(err.code, "SESSION_NOT_ACTIVE");
					assert.match(err.message, /expected Active/);
					return true;
				},
			);
		});

		it("should throw SESSION_NOT_ACTIVE when called on Closed session", async () => {
			const session = await makeActiveSession();
			await session.close();

			await assert.rejects(
				async () => session.contribute(async () => "work"),
				(err: unknown) => {
					assert(err instanceof AgentSessionError);
					assert.equal(err.code, "SESSION_NOT_ACTIVE");
					return true;
				},
			);
		});

		it("should return the result of the user function", async () => {
			const session = await makeActiveSession();
			const result = await session.contribute(async () => 42);
			assert.equal(result, 42);
		});

		it("should increment eventCount on success", async () => {
			const session = await makeActiveSession();

			assert.equal(session.getEventCount(), 0);
			await session.contribute(async () => "done");
			assert.equal(session.getEventCount(), 1);
			await session.contribute(async () => "done2");
			assert.equal(session.getEventCount(), 2);
		});

		it("should NOT increment eventCount when fn throws", async () => {
			const session = await makeActiveSession();

			await assert.rejects(
				async () =>
					session.contribute(async () => {
						throw new Error("user fn failed");
					}),
				/user fn failed/,
			);

			assert.equal(
				session.getEventCount(),
				0,
				"eventCount must remain 0 after fn error",
			);
		});

		it("should re-throw user fn errors without wrapping", async () => {
			const session = await makeActiveSession();
			const originalError = new TypeError("something broke");

			await assert.rejects(
				async () =>
					session.contribute(async () => {
						throw originalError;
					}),
				(err: unknown) => {
					assert.strictEqual(
						err,
						originalError,
						"error identity must be preserved",
					);
					return true;
				},
			);
		});

		it("should remain Active after fn throws (state not modified)", async () => {
			const session = await makeActiveSession();

			await assert.rejects(async () =>
				session.contribute(async () => {
					throw new Error("error");
				}),
			);

			assert.equal(
				session.getState(),
				AgentSessionState.Active,
				"state must remain Active",
			);
		});

		it("should track documentId returned by fn", async () => {
			const session = await makeActiveSession();

			await session.contribute(async () => ({
				documentId: "doc-abc-123",
				content: "some content",
			}));

			assert.deepEqual(session.getDocumentIds(), ["doc-abc-123"]);
		});

		it("should track documentIds array returned by fn", async () => {
			const session = await makeActiveSession();

			await session.contribute(async () => ({
				documentIds: ["doc-1", "doc-2", "doc-3"],
			}));

			assert.deepEqual(
				session.getDocumentIds().sort(),
				["doc-1", "doc-2", "doc-3"].sort(),
			);
		});

		it("should deduplicate documentIds across multiple contribute() calls", async () => {
			const session = await makeActiveSession();

			await session.contribute(async () => ({ documentId: "doc-shared" }));
			await session.contribute(async () => ({ documentId: "doc-shared" }));
			await session.contribute(async () => ({ documentId: "doc-unique" }));

			assert.equal(session.getDocumentIds().length, 2);
			assert(session.getDocumentIds().includes("doc-shared"));
			assert(session.getDocumentIds().includes("doc-unique"));
		});

		it("should NOT track documentIds when fn throws", async () => {
			const session = await makeActiveSession();

			await assert.rejects(async () =>
				session.contribute(async () => {
					throw new Error("write failed before returning documentId");
				}),
			);

			assert.deepEqual(
				session.getDocumentIds(),
				[],
				"documentIds must be empty after fn error",
			);
		});

		it("should pass the backend instance to fn", async () => {
			const mockBackend = makeMockBackend();
			const session = new AgentSession({
				backend: mockBackend,
				agentId: "test-agent",
			});
			await session.open();

			let receivedBackend: unknown;
			await session.contribute(async (b) => {
				receivedBackend = b;
			});

			assert.strictEqual(
				receivedBackend,
				mockBackend,
				"fn must receive the session backend",
			);
		});

		it("should support multiple sequential contribute() calls", async () => {
			const session = await makeActiveSession();

			for (let i = 0; i < 5; i++) {
				await session.contribute(async () => ({ documentId: `doc-${i}` }));
			}

			assert.equal(session.getEventCount(), 5);
			assert.equal(session.getDocumentIds().length, 5);
		});

		it("should handle fn returning null without error", async () => {
			const session = await makeActiveSession();
			const result = await session.contribute(async () => null);

			assert.equal(result, null);
			assert.equal(session.getEventCount(), 1);
			assert.deepEqual(session.getDocumentIds(), []);
		});

		it("should handle fn returning a string without error", async () => {
			const session = await makeActiveSession();
			const result = await session.contribute(async () => "hello");

			assert.equal(result, "hello");
			assert.equal(session.getEventCount(), 1);
			assert.deepEqual(session.getDocumentIds(), []);
		});
	});

	// ── state machine ────────────────────────────────────────────

	describe("state machine", () => {
		it("should start in Idle state", () => {
			const session = new AgentSession({
				backend: makeMockBackend(),
				agentId: "a",
			});
			assert.equal(session.getState(), AgentSessionState.Idle);
		});

		it("should transition Idle -> Active via open()", async () => {
			const session = new AgentSession({
				backend: makeMockBackend(),
				agentId: "a",
			});
			await session.open();
			assert.equal(session.getState(), AgentSessionState.Active);
		});

		it("should transition Active -> Closed via close()", async () => {
			const session = await makeActiveSession();
			await session.close();
			assert.equal(session.getState(), AgentSessionState.Closed);
		});

		it("should throw INVALID_STATE when close() called on Idle session", async () => {
			const session = new AgentSession({
				backend: makeMockBackend(),
				agentId: "a",
			});

			await assert.rejects(
				async () => session.close(),
				(err: unknown) => {
					assert(err instanceof AgentSessionError);
					assert.equal(err.code, "INVALID_STATE");
					assert.match(err.message, /expected Active or Closed/);
					return true;
				},
			);
		});

		it("should be idempotent: close() on Closed returns cached receipt", async () => {
			const session = await makeActiveSession();
			const receipt1 = await session.close();
			const receipt2 = await session.close();
			assert.deepEqual(receipt1, receipt2);
		});
	});

	// ── AgentSessionError ────────────────────────────────────────

	describe("AgentSessionError", () => {
		it("should have a code property", () => {
			const err = new AgentSessionError("TEST_CODE", "test message");
			assert.equal(err.code, "TEST_CODE");
			assert.equal(err.message, "test message");
			assert.equal(err.name, "AgentSessionError");
		});

		it("should be instanceof Error", () => {
			const err = new AgentSessionError("TEST", "message");
			assert(err instanceof Error);
			assert(err instanceof AgentSessionError);
		});

		it("should accept optional cause", () => {
			const cause = new Error("root cause");
			const err = new AgentSessionError("WRAPPED", "outer", cause);
			assert.strictEqual(err.cause, cause);
		});
	});

	// ── type safety ──────────────────────────────────────────────

	describe("type safety", () => {
		it("should have exhaustive AgentSessionState enum", () => {
			assert.equal(AgentSessionState.Idle, "Idle");
			assert.equal(AgentSessionState.Open, "Open");
			assert.equal(AgentSessionState.Active, "Active");
			assert.equal(AgentSessionState.Closing, "Closing");
			assert.equal(AgentSessionState.Closed, "Closed");
		});

		it("ContributionReceipt should have required fields", () => {
			const receipt: ContributionReceipt = {
				sessionId: "session-123",
				agentId: "agent-456",
				documentIds: ["doc-1", "doc-2"],
				eventCount: 3,
				sessionDurationMs: 1000,
				openedAt: new Date().toISOString(),
				closedAt: new Date().toISOString(),
			};

			assert(receipt.sessionId);
			assert(receipt.agentId);
			assert(Array.isArray(receipt.documentIds));
			assert(typeof receipt.eventCount === "number");
			assert(typeof receipt.sessionDurationMs === "number");
		});
	});

	// ── close() receipt ──────────────────────────────────────────

	describe("close() receipt", () => {
		it("should include correct sessionId, agentId in receipt", async () => {
			const customId = randomUUID();
			const session = new AgentSession({
				backend: makeMockBackend(),
				agentId: "my-agent",
				sessionId: customId,
			});
			await session.open();
			const receipt = await session.close();

			assert.equal(receipt.sessionId, customId);
			assert.equal(receipt.agentId, "my-agent");
		});

		it("should include tracked documentIds in receipt", async () => {
			const session = await makeActiveSession();
			await session.contribute(async () => ({ documentId: "doc-x" }));
			await session.contribute(async () => ({ documentId: "doc-y" }));

			const receipt = await session.close();
			assert.deepEqual(receipt.documentIds.sort(), ["doc-x", "doc-y"].sort());
		});

		it("should include eventCount in receipt", async () => {
			const session = await makeActiveSession();
			await session.contribute(async () => null);
			await session.contribute(async () => null);
			await session.contribute(async () => null);

			const receipt = await session.close();
			assert.equal(receipt.eventCount, 3);
		});

		it("should include non-negative sessionDurationMs", async () => {
			const session = await makeActiveSession();
			const receipt = await session.close();

			assert(typeof receipt.sessionDurationMs === "number");
			assert(receipt.sessionDurationMs >= 0);
		});

		it("should include valid ISO 8601 openedAt and closedAt", async () => {
			const session = await makeActiveSession();
			const receipt = await session.close();

			assert(
				!Number.isNaN(Date.parse(receipt.openedAt)),
				"openedAt must be a valid date",
			);
			assert(
				!Number.isNaN(Date.parse(receipt.closedAt)),
				"closedAt must be a valid date",
			);
			assert(
				new Date(receipt.closedAt).getTime() >=
					new Date(receipt.openedAt).getTime(),
				"closedAt must be >= openedAt",
			);
		});
	});
});
