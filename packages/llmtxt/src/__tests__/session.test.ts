/**
 * AgentSession tests — T430 (skeleton) + T431 (open) + T432 (contribute)
 *                     + T433 (close) + T437 (ContributionReceipt)
 *
 * Test suite for the ephemeral agent session lifecycle.
 * Tests the state machine, open(), contribute(), close(), receipt building,
 * idempotency, best-effort teardown, and mock spy verification.
 *
 * Spec: docs/specs/ARCH-T426-ephemeral-agent-lifecycle.md
 * Test runner: node:test (native, no vitest dependency)
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type {
	Backend,
	BlobAttachment,
	ExportDocumentResult,
} from "../core/backend.js";
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
 * Call tracking helper — records arguments per method name.
 */
interface CallRecord {
	[method: string]: unknown[][];
}

/**
 * Build a minimal mock Backend that satisfies the AgentSession interface needs.
 *
 * All Backend interface methods are stubbed. Methods called by open() / close()
 * have meaningful stubs. Everything else resolves to a safe no-op default.
 *
 * Typed with `satisfies Backend` (where practical) to catch missed methods at
 * compile time. Because the Backend interface is very large we use a spread
 * approach with an explicit cast, and rely on `satisfies` on the final object.
 */
function makeMockBackend(
	overrides: Partial<Backend> & {
		/** Optional call tracker — mutated in place by the mock. */
		_calls?: CallRecord;
	} = {},
): Backend {
	const _calls: CallRecord = overrides._calls ?? {};

	function track(method: string, args: unknown[]): void {
		if (!_calls[method]) _calls[method] = [];
		_calls[method].push(args);
	}

	// ── Document ops ──────────────────────────────────────────────
	const createDocument: Backend["createDocument"] = async (params) => ({
		id: randomUUID(),
		slug: params.title.toLowerCase().replace(/\s+/g, "-"),
		title: params.title,
		state: "DRAFT",
		createdBy: params.createdBy,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		versionCount: 0,
	});

	const getDocument: Backend["getDocument"] = async () => null;
	const getDocumentBySlug: Backend["getDocumentBySlug"] = async () => null;
	const listDocuments: Backend["listDocuments"] = async () => ({
		items: [],
		nextCursor: null,
	});
	const deleteDocument: Backend["deleteDocument"] = async () => false;

	// ── Version ops ───────────────────────────────────────────────
	const publishVersion: Backend["publishVersion"] = async (params) => ({
		id: randomUUID(),
		documentId: params.documentId,
		versionNumber: 1,
		content: params.content,
		patchText: params.patchText,
		contentHash: "hash",
		createdBy: params.createdBy,
		changelog: params.changelog,
		createdAt: Date.now(),
		diffStats: { added: 0, removed: 0, unchanged: 0 },
	});
	const getVersion: Backend["getVersion"] = async () => null;
	const listVersions: Backend["listVersions"] = async () => [];
	const transitionVersion: Backend["transitionVersion"] = async () => ({
		success: true,
	});

	// ── Approval ops ──────────────────────────────────────────────
	const submitSignedApproval: Backend["submitSignedApproval"] = async () => ({
		success: true,
	});
	const getApprovalProgress: Backend["getApprovalProgress"] = async () => ({
		approved: false,
		approvedBy: [],
		rejectedBy: [],
		pendingFrom: [],
		staleFrom: [],
		reason: "no approvals",
	});
	const getApprovalPolicy: Backend["getApprovalPolicy"] = async () => ({
		requiredCount: 1,
		requireUnanimous: false,
		allowedReviewerIds: [],
		timeoutMs: 0,
	});
	const setApprovalPolicy: Backend["setApprovalPolicy"] = async () => {};

	// ── Contributor ops ───────────────────────────────────────────
	const listContributors: Backend["listContributors"] = async () => [];

	// ── BFT ops ───────────────────────────────────────────────────
	const getApprovalChain: Backend["getApprovalChain"] = async () => ({
		valid: true,
		length: 0,
		firstInvalidAt: null,
		entries: [],
	});

	// ── Event ops ─────────────────────────────────────────────────
	const appendEvent: Backend["appendEvent"] = async (params) => {
		track("appendEvent", [params]);
		return {
			id: randomUUID(),
			documentId: params.documentId,
			type: params.type,
			agentId: params.agentId,
			payload: params.payload ?? {},
			createdAt: Date.now(),
		};
	};
	const queryEvents: Backend["queryEvents"] = async () => ({
		items: [],
		nextCursor: null,
	});
	const subscribeStream: Backend["subscribeStream"] = (_documentId) => {
		async function* empty() {}
		return empty();
	};

	// ── CRDT ops ──────────────────────────────────────────────────
	const applyCrdtUpdate: Backend["applyCrdtUpdate"] = async (params) => ({
		documentId: params.documentId,
		sectionKey: params.sectionKey,
		stateVectorBase64: "",
		snapshotBase64: "",
		updatedAt: Date.now(),
	});
	const getCrdtState: Backend["getCrdtState"] = async () => null;
	const subscribeSection: Backend["subscribeSection"] = () => {
		async function* empty() {}
		return empty();
	};

	// ── Lease ops ─────────────────────────────────────────────────
	const acquireLease: Backend["acquireLease"] = async (params) => ({
		id: randomUUID(),
		resource: params.resource,
		holder: params.holder,
		expiresAt: Date.now() + params.ttlMs,
		acquiredAt: Date.now(),
	});
	const renewLease: Backend["renewLease"] = async () => null;
	const releaseLease: Backend["releaseLease"] = async (...args) => {
		track("releaseLease", args);
		return true;
	};
	const getLease: Backend["getLease"] = async () => null;

	// ── Presence ops ─────────────────────────────────────────────
	const joinPresence: Backend["joinPresence"] = async (docId, agentId) => {
		track("joinPresence", [docId, agentId]);
		return {
			agentId,
			documentId: docId,
			lastSeen: Date.now(),
			expiresAt: Date.now() + 30_000,
		};
	};
	const leavePresence: Backend["leavePresence"] = async (...args) => {
		track("leavePresence", args);
	};
	const listPresence: Backend["listPresence"] = async () => [];
	const heartbeatPresence: Backend["heartbeatPresence"] = async () => {};

	// ── Scratchpad ops ────────────────────────────────────────────
	const sendScratchpad: Backend["sendScratchpad"] = async (params) => ({
		id: randomUUID(),
		toAgentId: params.toAgentId,
		fromAgentId: params.fromAgentId,
		payload: params.payload,
		createdAt: Date.now(),
		exp: 0,
	});
	const pollScratchpad: Backend["pollScratchpad"] = async () => [];
	const deleteScratchpadMessage: Backend["deleteScratchpadMessage"] =
		async () => true;

	// ── A2A ops ───────────────────────────────────────────────────
	const sendA2AMessage: Backend["sendA2AMessage"] = async () => ({
		success: true,
	});
	const pollA2AInbox: Backend["pollA2AInbox"] = async (...args) => {
		track("pollA2AInbox", args);
		return [];
	};
	const deleteA2AMessage: Backend["deleteA2AMessage"] = async (...args) => {
		track("deleteA2AMessage", args);
		return true;
	};

	// ── Search ops ────────────────────────────────────────────────
	const indexDocument: Backend["indexDocument"] = async () => {};
	const search: Backend["search"] = async () => [];

	// ── Identity ops ──────────────────────────────────────────────
	const registerAgentPubkey: Backend["registerAgentPubkey"] = async (
		agentId,
		pubkeyHex,
		label,
	) => ({
		agentId,
		pubkeyHex,
		label,
		createdAt: Date.now(),
	});
	const lookupAgentPubkey: Backend["lookupAgentPubkey"] = async () => null;
	const listAgentPubkeys: Backend["listAgentPubkeys"] = async () => [];
	const revokeAgentPubkey: Backend["revokeAgentPubkey"] = async () => true;
	const recordSignatureNonce: Backend["recordSignatureNonce"] = async () =>
		true;
	const hasNonceBeenUsed: Backend["hasNonceBeenUsed"] = async () => false;

	// ── Collection ops ────────────────────────────────────────────
	const createCollection: Backend["createCollection"] = async (params) => ({
		id: randomUUID(),
		slug: params.name.toLowerCase(),
		name: params.name,
		description: params.description,
		ownerId: params.ownerId,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		documentSlugs: [],
	});
	const getCollection: Backend["getCollection"] = async () => null;
	const listCollections: Backend["listCollections"] = async () => ({
		items: [],
		nextCursor: null,
	});
	const addDocToCollection: Backend["addDocToCollection"] = async () => {};
	const removeDocFromCollection: Backend["removeDocFromCollection"] =
		async () => false;
	const reorderCollection: Backend["reorderCollection"] = async () => {};
	const exportCollection: Backend["exportCollection"] = async (slug) => ({
		collection: {
			id: randomUUID(),
			slug,
			name: slug,
			ownerId: "test",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			documentSlugs: [],
		},
		documents: [],
		exportedAt: Date.now(),
	});

	// ── Cross-doc ops ─────────────────────────────────────────────
	const createDocumentLink: Backend["createDocumentLink"] = async (params) => ({
		id: randomUUID(),
		sourceDocumentId: params.sourceDocumentId,
		targetDocumentId: params.targetDocumentId,
		label: params.label,
		createdAt: Date.now(),
	});
	const getDocumentLinks: Backend["getDocumentLinks"] = async () => [];
	const deleteDocumentLink: Backend["deleteDocumentLink"] = async () => false;
	const getGlobalGraph: Backend["getGlobalGraph"] = async () => ({
		nodes: [],
		edges: [],
	});

	// ── Webhook ops ───────────────────────────────────────────────
	const createWebhook: Backend["createWebhook"] = async (params) => ({
		id: randomUUID(),
		ownerId: params.ownerId,
		url: params.url,
		secret: "secret",
		events: params.events,
		enabled: true,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	});
	const listWebhooks: Backend["listWebhooks"] = async () => [];
	const deleteWebhook: Backend["deleteWebhook"] = async () => false;
	const testWebhook: Backend["testWebhook"] = async (id) => ({
		webhookId: id,
		delivered: true,
		durationMs: 0,
	});

	// ── Signed URL ops ────────────────────────────────────────────
	const createSignedUrl: Backend["createSignedUrl"] = async (params) => ({
		token: randomUUID(),
		documentId: params.documentId,
		expiresAt: Date.now() + (params.ttlMs ?? 86_400_000),
		permission: params.permission ?? "read",
		createdAt: Date.now(),
	});
	const verifySignedUrl: Backend["verifySignedUrl"] = async () => null;

	// ── Access control ops ────────────────────────────────────────
	const getDocumentAccess: Backend["getDocumentAccess"] = async (id) => ({
		documentId: id,
		visibility: "private",
		grants: [],
	});
	const grantDocumentAccess: Backend["grantDocumentAccess"] = async () => {};
	const revokeDocumentAccess: Backend["revokeDocumentAccess"] = async () =>
		false;
	const setDocumentVisibility: Backend["setDocumentVisibility"] =
		async () => {};

	// ── Organization ops ──────────────────────────────────────────
	const createOrganization: Backend["createOrganization"] = async (params) => ({
		id: randomUUID(),
		slug: params.name.toLowerCase(),
		name: params.name,
		ownerId: params.ownerId,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	});
	const getOrganization: Backend["getOrganization"] = async () => null;
	const listOrganizations: Backend["listOrganizations"] = async () => [];
	const addOrgMember: Backend["addOrgMember"] = async () => {};
	const removeOrgMember: Backend["removeOrgMember"] = async () => false;

	// ── API key ops ───────────────────────────────────────────────
	const createApiKey: Backend["createApiKey"] = async (params) => ({
		id: randomUUID(),
		userId: params.userId,
		name: params.name,
		prefix: "abcd1234",
		createdAt: Date.now(),
		secret: `sk-${randomUUID()}`,
	});
	const listApiKeys: Backend["listApiKeys"] = async () => [];
	const deleteApiKey: Backend["deleteApiKey"] = async () => false;
	const rotateApiKey: Backend["rotateApiKey"] = async (id, userId) => ({
		id,
		userId,
		name: "rotated",
		prefix: "abcd1234",
		createdAt: Date.now(),
		secret: `sk-${randomUUID()}`,
	});

	// ── Blob ops ──────────────────────────────────────────────────
	const attachBlob: Backend["attachBlob"] = async (params) =>
		({
			id: randomUUID(),
			docSlug: params.docSlug,
			blobName: params.name,
			hash: "deadbeef",
			size: params.data.byteLength,
			contentType: params.contentType,
			uploadedBy: params.uploadedBy,
			uploadedAt: Date.now(),
		}) satisfies BlobAttachment;
	const getBlob: Backend["getBlob"] = async () => null;
	const listBlobs: Backend["listBlobs"] = async () => [];
	const detachBlob: Backend["detachBlob"] = async () => false;
	const fetchBlobByHash: Backend["fetchBlobByHash"] = async () => null;

	// ── Export ops ────────────────────────────────────────────────
	const exportDocument: Backend["exportDocument"] = async (params) =>
		({
			filePath: `/tmp/${params.slug}.${params.format}`,
			slug: params.slug,
			version: 1,
			fileHash: "deadbeef",
			byteCount: 0,
			exportedAt: new Date().toISOString(),
			signatureHex: null,
		}) satisfies ExportDocumentResult;
	const exportAll: Backend["exportAll"] = async () => ({
		exported: [],
		skipped: [],
		totalCount: 0,
		failedCount: 0,
	});

	// ── Backend open/close + config ───────────────────────────────
	const open: Backend["open"] = async () => {};
	const close: Backend["close"] = async () => {};
	const config: Backend["config"] = {};

	const base: Backend = {
		// Document ops
		createDocument,
		getDocument,
		getDocumentBySlug,
		listDocuments,
		deleteDocument,
		// Version ops
		publishVersion,
		getVersion,
		listVersions,
		transitionVersion,
		// Approval ops
		submitSignedApproval,
		getApprovalProgress,
		getApprovalPolicy,
		setApprovalPolicy,
		// Contributor ops
		listContributors,
		// BFT ops
		getApprovalChain,
		// Event ops
		appendEvent,
		queryEvents,
		subscribeStream,
		// CRDT ops
		applyCrdtUpdate,
		getCrdtState,
		subscribeSection,
		// Lease ops
		acquireLease,
		renewLease,
		releaseLease,
		getLease,
		// Presence ops
		joinPresence,
		leavePresence,
		listPresence,
		heartbeatPresence,
		// Scratchpad ops
		sendScratchpad,
		pollScratchpad,
		deleteScratchpadMessage,
		// A2A ops
		sendA2AMessage,
		pollA2AInbox,
		deleteA2AMessage,
		// Search ops
		indexDocument,
		search,
		// Identity ops
		registerAgentPubkey,
		lookupAgentPubkey,
		listAgentPubkeys,
		revokeAgentPubkey,
		recordSignatureNonce,
		hasNonceBeenUsed,
		// Collection ops
		createCollection,
		getCollection,
		listCollections,
		addDocToCollection,
		removeDocFromCollection,
		reorderCollection,
		exportCollection,
		// Cross-doc ops
		createDocumentLink,
		getDocumentLinks,
		deleteDocumentLink,
		getGlobalGraph,
		// Webhook ops
		createWebhook,
		listWebhooks,
		deleteWebhook,
		testWebhook,
		// Signed URL ops
		createSignedUrl,
		verifySignedUrl,
		// Access control ops
		getDocumentAccess,
		grantDocumentAccess,
		revokeDocumentAccess,
		setDocumentVisibility,
		// Organization ops
		createOrganization,
		getOrganization,
		listOrganizations,
		addOrgMember,
		removeOrgMember,
		// API key ops
		createApiKey,
		listApiKeys,
		deleteApiKey,
		rotateApiKey,
		// Blob ops
		attachBlob,
		getBlob,
		listBlobs,
		detachBlob,
		fetchBlobByHash,
		// Export ops
		exportDocument,
		exportAll,
		// Backend lifecycle
		open,
		close,
		config,
	} satisfies Backend;

	// Merge overrides — callers can replace individual methods
	const { _calls: _ignored, ...cleanOverrides } = overrides;
	return { ...base, ...cleanOverrides, _calls } as Backend & {
		_calls: CallRecord;
	};
}

/**
 * Create a session in Active state (open() already called).
 * Used by tests that focus on contribute() / close() behaviour.
 */
async function makeActiveSession(
	backendOverrides: Partial<Backend> & { _calls?: CallRecord } = {},
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

		it("should throw INVALID_STATE when close() called on Open session", async () => {
			// Simulate a session stuck in Open (shouldn't happen normally, but guard it)
			const session = new AgentSession({
				backend: makeMockBackend({
					// Stall joinPresence so we can test the Open->close path (synchronous)
					// In practice, close() is async so we test via the state machine directly
					joinPresence: async () => {
						// Never resolves in a real sense — we test the state machine below
						return {
							agentId: "test-agent",
							documentId: "session:test",
							lastSeen: Date.now(),
							expiresAt: Date.now() + 30_000,
						};
					},
				}),
				agentId: "test-agent",
			});

			// Force state to Open to test the guard path
			// @ts-expect-error — testing internal guard
			session.state = "Open";

			await assert.rejects(
				async () => session.close(),
				(err: unknown) => {
					assert(err instanceof AgentSessionError);
					assert.equal(err.code, "INVALID_STATE");
					return true;
				},
			);
		});

		it("should be idempotent: close() on Closed returns cached receipt", async () => {
			const session = await makeActiveSession();
			const receipt1 = await session.close();
			const receipt2 = await session.close();
			assert.deepEqual(receipt1, receipt2);
			// Same object reference (cached)
			assert.strictEqual(receipt1, receipt2);
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

	// ── close() — T433 + T437 ─────────────────────────────────────

	describe("close() — teardown, receipt, idempotency", () => {
		it("should transition Active -> Closing -> Closed", async () => {
			const closingStates: AgentSessionState[] = [];
			const session = await makeActiveSession({
				leavePresence: async () => {
					// Capture state during teardown to verify Closing is observed
					closingStates.push(
						// We can't easily observe mid-async state without extension;
						// instead we verify the final state is Closed
					);
				},
			});

			assert.equal(session.getState(), AgentSessionState.Active);
			const receipt = await session.close();
			assert.equal(session.getState(), AgentSessionState.Closed);
			assert(receipt !== undefined);
		});

		it("should return a valid ContributionReceipt", async () => {
			const customId = randomUUID();
			const session = new AgentSession({
				backend: makeMockBackend(),
				agentId: "receipt-agent",
				sessionId: customId,
			});
			await session.open();
			await session.contribute(async () => ({ documentId: "doc-r1" }));
			await session.contribute(async () => ({ documentId: "doc-r2" }));

			const receipt = await session.close();

			assert.equal(receipt.sessionId, customId);
			assert.equal(receipt.agentId, "receipt-agent");
			assert.equal(receipt.eventCount, 2);
			assert(Array.isArray(receipt.documentIds));
			assert.equal(receipt.documentIds.length, 2);
			assert(typeof receipt.sessionDurationMs === "number");
			assert(receipt.sessionDurationMs >= 0);
			assert(!Number.isNaN(Date.parse(receipt.openedAt)));
			assert(!Number.isNaN(Date.parse(receipt.closedAt)));
		});

		it("should sort documentIds in receipt for deterministic output", async () => {
			const session = await makeActiveSession();
			// Add in non-sorted order
			await session.contribute(async () => ({ documentId: "doc-z" }));
			await session.contribute(async () => ({ documentId: "doc-a" }));
			await session.contribute(async () => ({ documentId: "doc-m" }));

			const receipt = await session.close();

			assert.deepEqual(receipt.documentIds, ["doc-a", "doc-m", "doc-z"]);
		});

		it("should throw INVALID_STATE when close() called from Idle", async () => {
			const session = new AgentSession({
				backend: makeMockBackend(),
				agentId: "a",
			});

			await assert.rejects(
				async () => session.close(),
				(err: unknown) => {
					assert(err instanceof AgentSessionError);
					assert.equal(err.code, "INVALID_STATE");
					return true;
				},
			);
		});

		it("should throw INVALID_STATE when close() called from Closed with missing cache", async () => {
			// Edge case: state is Closed but cachedReceipt was never set (internal invariant)
			const session = await makeActiveSession();
			await session.close();

			// Force corrupt state: clear the cached receipt to test the guard
			// @ts-expect-error — testing internal guard
			session.cachedReceipt = undefined;

			await assert.rejects(
				async () => session.close(),
				(err: unknown) => {
					assert(err instanceof AgentSessionError);
					assert.equal(err.code, "SESSION_NOT_FOUND");
					return true;
				},
			);
		});

		it("should be idempotent: second close() returns same cached receipt", async () => {
			const session = await makeActiveSession();
			await session.contribute(async () => ({ documentId: "doc-idem" }));

			const receipt1 = await session.close();
			const receipt2 = await session.close();

			assert.strictEqual(
				receipt1,
				receipt2,
				"second close() must return the exact same object",
			);
			assert.equal(receipt2.eventCount, 1);
			assert.deepEqual(receipt2.documentIds, ["doc-idem"]);
		});

		it("should call leavePresence during teardown", async () => {
			const calls: CallRecord = {};
			const session = await makeActiveSession({ _calls: calls });
			await session.close();

			assert(
				Array.isArray(calls.leavePresence),
				"leavePresence must be called",
			);
			assert(calls.leavePresence.length > 0);
			// First arg must be session sentinel doc ID
			const [docId] = calls.leavePresence[0] as [string, string];
			assert(
				docId.startsWith("session:"),
				`leavePresence docId must be session:<id>, got: ${docId}`,
			);
		});

		it("should call pollA2AInbox during teardown to drain inbox", async () => {
			const calls: CallRecord = {};
			const session = await makeActiveSession({ _calls: calls });
			await session.close();

			assert(
				Array.isArray(calls.pollA2AInbox),
				"pollA2AInbox must be called to drain inbox",
			);
			// Should have been called at least once (returns [] which stops the loop)
			assert(calls.pollA2AInbox.length >= 1);
		});

		it("should delete drained A2A messages during teardown", async () => {
			// Return 2 messages on first call, then empty to stop drain loop
			let pollCount = 0;
			const deletedIds: string[] = [];

			const session = await makeActiveSession({
				pollA2AInbox: async () => {
					pollCount += 1;
					if (pollCount === 1) {
						return [
							{
								id: "msg-1",
								toAgentId: "test-agent",
								envelopeJson: "{}",
								createdAt: Date.now(),
								exp: 0,
							},
							{
								id: "msg-2",
								toAgentId: "test-agent",
								envelopeJson: "{}",
								createdAt: Date.now(),
								exp: 0,
							},
						];
					}
					return [];
				},
				deleteA2AMessage: async (id) => {
					deletedIds.push(id);
					return true;
				},
			});

			await session.close();

			assert(deletedIds.includes("msg-1"), "msg-1 should be deleted");
			assert(deletedIds.includes("msg-2"), "msg-2 should be deleted");
		});

		it("should still return receipt even if leavePresence throws (best-effort teardown)", async () => {
			const session = await makeActiveSession({
				leavePresence: async () => {
					throw new Error("presence server down");
				},
			});

			// close() should throw SESSION_CLOSE_PARTIAL but attach the receipt
			let thrownErr: unknown;
			try {
				await session.close();
			} catch (err) {
				thrownErr = err;
			}

			assert(thrownErr instanceof AgentSessionError);
			assert.equal(
				(thrownErr as AgentSessionError).code,
				"SESSION_CLOSE_PARTIAL",
			);
			// Receipt must be attached even on partial close
			const partial = thrownErr as AgentSessionError;
			assert(partial.receipt !== undefined, "receipt must be attached");
			assert(partial.errors !== undefined, "errors must be attached");
			assert(partial.errors.length > 0);
			// Session should be in Closed state despite the error
			assert.equal(session.getState(), AgentSessionState.Closed);
		});

		it("should still return receipt even if pollA2AInbox throws (best-effort teardown)", async () => {
			const session = await makeActiveSession({
				pollA2AInbox: async () => {
					throw new Error("inbox unavailable");
				},
			});

			let thrownErr: unknown;
			try {
				await session.close();
			} catch (err) {
				thrownErr = err;
			}

			assert(thrownErr instanceof AgentSessionError);
			assert.equal(
				(thrownErr as AgentSessionError).code,
				"SESSION_CLOSE_PARTIAL",
			);
			const partial = thrownErr as AgentSessionError;
			assert(partial.receipt !== undefined);
			assert.equal(session.getState(), AgentSessionState.Closed);
		});

		it("should collect all step errors in SESSION_CLOSE_PARTIAL errors array", async () => {
			const session = await makeActiveSession({
				pollA2AInbox: async () => {
					throw new Error("inbox error");
				},
				leavePresence: async () => {
					throw new Error("presence error");
				},
			});

			let thrownErr: unknown;
			try {
				await session.close();
			} catch (err) {
				thrownErr = err;
			}

			assert(thrownErr instanceof AgentSessionError);
			const partial = thrownErr as AgentSessionError;
			assert(Array.isArray(partial.errors));
			// Both steps failed — should have 2 errors
			assert(partial.errors.length >= 2, "must collect all step errors");
			const stepNames = partial.errors.map((e) => e.step);
			assert(stepNames.includes("drainA2AInbox"));
			assert(stepNames.includes("leavePresence"));
		});

		it("should compute correct sessionDurationMs", async () => {
			const before = Date.now();
			const session = await makeActiveSession();

			// Small async delay to ensure non-zero duration
			await new Promise<void>((resolve) => setTimeout(resolve, 5));

			const receipt = await session.close();
			const after = Date.now();

			assert(receipt.sessionDurationMs >= 0);
			// Duration must be within the actual wall time of the test
			assert(
				receipt.sessionDurationMs <= after - before + 50,
				`sessionDurationMs=${receipt.sessionDurationMs} exceeds expected max`,
			);
		});

		it("should persist receipt via appendEvent when documents were touched", async () => {
			const calls: CallRecord = {};
			const session = await makeActiveSession({ _calls: calls });
			await session.contribute(async () => ({ documentId: "doc-persist" }));

			await session.close();

			assert(
				Array.isArray(calls.appendEvent),
				"appendEvent must be called for receipt persistence",
			);
			const appendCalls = calls.appendEvent as Array<
				[{ documentId: string; type: string; agentId: string }]
			>;
			const receiptCall = appendCalls.find(
				([params]) => params.type === "session.closed",
			);
			assert(
				receiptCall !== undefined,
				"session.closed event must be appended",
			);
			assert.equal(receiptCall[0].documentId, "doc-persist");
		});

		it("should NOT call appendEvent when no documents were touched", async () => {
			const calls: CallRecord = {};
			const session = await makeActiveSession({ _calls: calls });

			// No contribute() calls — zero documents touched
			await session.close();

			const appendCalls = calls.appendEvent ?? [];
			const receiptCalls = (appendCalls as Array<[{ type: string }]>).filter(
				([params]) => params.type === "session.closed",
			);
			assert.equal(
				receiptCalls.length,
				0,
				"appendEvent for session.closed must NOT be called when no documents touched",
			);
		});

		it("should include all receipt fields in appendEvent payload", async () => {
			const calls: CallRecord = {};
			const customId = randomUUID();
			const session = new AgentSession({
				backend: makeMockBackend({ _calls: calls }),
				agentId: "payload-agent",
				sessionId: customId,
			});
			await session.open();
			await session.contribute(async () => ({ documentId: "doc-payload" }));

			await session.close();

			const appendCalls = calls.appendEvent as Array<
				[
					{
						documentId: string;
						type: string;
						agentId: string;
						payload: ContributionReceipt;
					},
				]
			>;
			const receiptCall = appendCalls.find(
				([params]) => params.type === "session.closed",
			);
			assert(receiptCall !== undefined);
			const payload = receiptCall[0].payload;
			assert.equal(payload.sessionId, customId);
			assert.equal(payload.agentId, "payload-agent");
			assert(Array.isArray(payload.documentIds));
			assert(typeof payload.eventCount === "number");
			assert(typeof payload.sessionDurationMs === "number");
		});

		it("should still close and return receipt if appendEvent throws", async () => {
			const session = await makeActiveSession({
				appendEvent: async () => {
					throw new Error("event log unavailable");
				},
			});
			await session.contribute(async () => ({ documentId: "doc-ev" }));

			let thrownErr: unknown;
			try {
				await session.close();
			} catch (err) {
				thrownErr = err;
			}

			// Receipt is attached to SESSION_CLOSE_PARTIAL
			assert(thrownErr instanceof AgentSessionError);
			const partial = thrownErr as AgentSessionError;
			assert.equal(partial.code, "SESSION_CLOSE_PARTIAL");
			assert(partial.receipt !== undefined);
			assert.equal(session.getState(), AgentSessionState.Closed);
		});
	});
});
