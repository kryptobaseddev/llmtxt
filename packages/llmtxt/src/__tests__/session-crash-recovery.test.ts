/**
 * T434 (T426.5): AgentSession Crash Recovery Contract — Integration Test
 *
 * Verifies the crash recovery contract documented in spec §5:
 *
 *   "If an agent process dies without calling close(), all lease and presence
 *    state WILL be cleaned up within max(leaseMaxDuration, presenceTtlMs) of
 *    the crash — currently at most 330 s under default config."
 *
 * Test strategy:
 *   - We use a mock backend that tracks leases and presence with explicit TTLs.
 *   - "Crash" is simulated by dropping the AgentSession reference without calling
 *     close(). The session is orphaned — the mock backend retains state.
 *   - We then advance virtual time past the TTL using mock clock helpers.
 *   - The mock backend's reaper (triggered via advanceTime) clears expired entries.
 *   - Assertions verify no orphan state remains after TTL has fired.
 *
 * Key contract assertions (spec §5):
 *   1. Contributions persisted via contribute() survive the crash (data is NOT lost).
 *   2. Leases acquired during the session are removed after TTL.
 *   3. Presence entries are removed after presenceTtlMs.
 *   4. close() is best-effort — crash is survivable without explicit teardown.
 *
 * Spec: docs/specs/ARCH-T426-ephemeral-agent-lifecycle.md §5
 * Implements: T434
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type {
	Backend,
	BlobAttachment,
	ExportDocumentResult,
	ImportDocumentResult,
	Lease,
	AcquireLeaseParams,
	PresenceEntry,
} from "../core/backend.js";
import {
	AgentSession,
	AgentSessionState,
	type ContributionReceipt,
} from "../sdk/session.js";

// ── Virtual clock ──────────────────────────────────────────────────────────────
//
// We avoid real wall-clock sleeps for TTL verification. Instead, the crash
// recovery mock backend reads time from a virtualNow() function. advanceTime()
// increments the virtual clock and triggers the TTL sweep inline.

let _virtualNow = Date.now();

function virtualNow(): number {
	return _virtualNow;
}

function advanceTime(ms: number): void {
	_virtualNow += ms;
}

// ── CrashRecoveryHub: mock backend with TTL-aware lease + presence store ──────
//
// Key design decisions:
//   - Leases are stored with explicit expiresAt; sweep() removes expired ones.
//   - Presence entries are stored with explicit expiresAt; sweep() removes expired ones.
//   - Document writes are stored durably — they survive simulated crashes.
//   - sweep() is called manually via advanceAndSweep() in tests (no background timer).
//   - The backend is safe for shared-hub use: multiple agents share the same store.

interface LeaseEntry {
	id: string;
	resource: string;
	holder: string;
	acquiredAt: number;
	expiresAt: number;
}

interface PresenceRecord {
	agentId: string;
	documentId: string;
	meta?: Record<string, unknown>;
	lastSeen: number;
	expiresAt: number;
}

interface DocumentEntry {
	id: string;
	title: string;
	createdBy: string;
	createdAt: number;
	events: Array<{
		type: string;
		agentId: string;
		payload: Record<string, unknown>;
		createdAt: number;
	}>;
}

class CrashRecoveryHub {
	private _leases = new Map<string, LeaseEntry>(); // key=resource
	private _presence = new Map<string, PresenceRecord>(); // key=`${docId}::${agentId}`
	private _documents = new Map<string, DocumentEntry>(); // key=docId

	readonly presenceTtlMs: number;
	readonly leaseMaxDurationMs: number;

	constructor(opts: { presenceTtlMs?: number; leaseMaxDurationMs?: number } = {}) {
		this.presenceTtlMs = opts.presenceTtlMs ?? 200; // 200ms virtual TTL for fast tests
		this.leaseMaxDurationMs = opts.leaseMaxDurationMs ?? 300; // 300ms virtual lease max
	}

	// ── TTL sweep (simulates background reaper) ────────────────────────────────

	sweep(): void {
		const now = virtualNow();

		// Sweep expired leases
		for (const [resource, lease] of this._leases.entries()) {
			if (lease.expiresAt > 0 && lease.expiresAt < now) {
				this._leases.delete(resource);
			}
		}

		// Sweep expired presence entries
		for (const [key, record] of this._presence.entries()) {
			if (record.expiresAt < now) {
				this._presence.delete(key);
			}
		}
	}

	// ── Inspection (for test assertions) ──────────────────────────────────────

	listAllLeases(): LeaseEntry[] {
		return Array.from(this._leases.values());
	}

	listAllPresence(): PresenceRecord[] {
		return Array.from(this._presence.values());
	}

	getDocuments(): DocumentEntry[] {
		return Array.from(this._documents.values());
	}

	getAllEvents(): Array<{ type: string; agentId: string }> {
		const events: Array<{ type: string; agentId: string }> = [];
		for (const doc of this._documents.values()) {
			for (const ev of doc.events) {
				events.push({ type: ev.type, agentId: ev.agentId });
			}
		}
		return events;
	}

	// ── Backend interface ──────────────────────────────────────────────────────

	toBackend(): Backend {
		const hub = this;
		const presenceTtlMs = this.presenceTtlMs;
		const leaseMaxDurationMs = this.leaseMaxDurationMs;

		const createDocument: Backend["createDocument"] = async (params) => {
			const id = randomUUID();
			const doc: DocumentEntry = {
				id,
				title: params.title,
				createdBy: params.createdBy,
				createdAt: virtualNow(),
				events: [],
			};
			hub._documents.set(id, doc);
			return {
				id,
				slug: params.title.toLowerCase().replace(/\s+/g, "-"),
				title: params.title,
				state: "DRAFT",
				createdBy: params.createdBy,
				createdAt: virtualNow(),
				updatedAt: virtualNow(),
				versionCount: 0,
			};
		};

		const appendEvent: Backend["appendEvent"] = async (params) => {
			const doc = hub._documents.get(params.documentId);
			if (doc) {
				doc.events.push({
					type: params.type,
					agentId: params.agentId,
					payload: params.payload ?? {},
					createdAt: virtualNow(),
				});
			} else {
				// Allow appending to non-existent doc ID (for session sentinel doc IDs)
			}
			return {
				id: randomUUID(),
				documentId: params.documentId,
				type: params.type,
				agentId: params.agentId,
				payload: params.payload ?? {},
				createdAt: virtualNow(),
			};
		};

		const acquireLease: Backend["acquireLease"] = async (params) => {
			const now = virtualNow();
			const existing = hub._leases.get(params.resource);
			if (existing && existing.expiresAt > now) {
				// Lease held by another holder — check if same holder (re-acquire)
				if (existing.holder !== params.holder) {
					return null; // Contention — cannot acquire
				}
			}
			const lease: LeaseEntry = {
				id: randomUUID(),
				resource: params.resource,
				holder: params.holder,
				acquiredAt: now,
				expiresAt: now + Math.min(params.ttlMs, leaseMaxDurationMs),
			};
			hub._leases.set(params.resource, lease);
			return {
				id: lease.id,
				resource: lease.resource,
				holder: lease.holder,
				expiresAt: lease.expiresAt,
				acquiredAt: lease.acquiredAt,
			};
		};

		const releaseLease: Backend["releaseLease"] = async (resource, holder) => {
			const existing = hub._leases.get(resource);
			if (!existing || existing.holder !== holder) return false;
			hub._leases.delete(resource);
			return true;
		};

		const getLease: Backend["getLease"] = async (resource) => {
			const entry = hub._leases.get(resource);
			if (!entry) return null;
			if (entry.expiresAt > 0 && entry.expiresAt < virtualNow()) {
				hub._leases.delete(resource);
				return null;
			}
			return {
				id: entry.id,
				resource: entry.resource,
				holder: entry.holder,
				expiresAt: entry.expiresAt,
				acquiredAt: entry.acquiredAt,
			};
		};

		const joinPresence: Backend["joinPresence"] = async (docId, agentId, meta) => {
			const key = `${docId}::${agentId}`;
			const now = virtualNow();
			const record: PresenceRecord = {
				agentId,
				documentId: docId,
				meta,
				lastSeen: now,
				expiresAt: now + presenceTtlMs,
			};
			hub._presence.set(key, record);
			return {
				agentId,
				documentId: docId,
				lastSeen: now,
				expiresAt: now + presenceTtlMs,
			};
		};

		const leavePresence: Backend["leavePresence"] = async (docId, agentId) => {
			hub._presence.delete(`${docId}::${agentId}`);
		};

		const listPresence: Backend["listPresence"] = async (documentId) => {
			const now = virtualNow();
			const entries: PresenceEntry[] = [];
			for (const record of hub._presence.values()) {
				if (record.documentId === documentId && record.expiresAt > now) {
					entries.push({
						agentId: record.agentId,
						documentId: record.documentId,
						meta: record.meta,
						lastSeen: record.lastSeen,
						expiresAt: record.expiresAt,
					});
				}
			}
			return entries;
		};

		const heartbeatPresence: Backend["heartbeatPresence"] = async (docId, agentId) => {
			const key = `${docId}::${agentId}`;
			const record = hub._presence.get(key);
			if (record) {
				const now = virtualNow();
				record.lastSeen = now;
				record.expiresAt = now + presenceTtlMs;
			}
		};

		const pollA2AInbox: Backend["pollA2AInbox"] = async () => [];
		const deleteA2AMessage: Backend["deleteA2AMessage"] = async () => true;
		const sendA2AMessage: Backend["sendA2AMessage"] = async () => ({ success: true });

		// Minimal stubs for remaining Backend interface methods
		const stub = <T>(val: T) => async (..._args: unknown[]) => val;
		const stubAsync = stub as unknown as typeof stub;
		void stubAsync; // suppress unused warning

		return {
			createDocument,
			getDocument: async () => null,
			getDocumentBySlug: async () => null,
			listDocuments: async () => ({ items: [], nextCursor: null }),
			deleteDocument: async () => false,
			publishVersion: async (p) => ({
				id: randomUUID(),
				documentId: p.documentId,
				versionNumber: 1,
				content: p.content,
				patchText: p.patchText,
				contentHash: "hash",
				createdBy: p.createdBy,
				changelog: p.changelog,
				createdAt: virtualNow(),
				diffStats: { added: 0, removed: 0, unchanged: 0 },
			}),
			getVersion: async () => null,
			listVersions: async () => [],
			transitionVersion: async () => ({ success: true }),
			submitSignedApproval: async () => ({ success: true }),
			getApprovalProgress: async () => ({
				approved: false,
				approvedBy: [],
				rejectedBy: [],
				pendingFrom: [],
				staleFrom: [],
				reason: "no approvals",
			}),
			getApprovalPolicy: async () => ({
				requiredCount: 1,
				requireUnanimous: false,
				allowedReviewerIds: [],
				timeoutMs: 0,
			}),
			setApprovalPolicy: async () => {},
			listContributors: async () => [],
			getApprovalChain: async () => ({
				valid: true,
				length: 0,
				firstInvalidAt: null,
				entries: [],
			}),
			appendEvent,
			queryEvents: async () => ({ items: [], nextCursor: null }),
			subscribeStream: (_docId) => {
				async function* empty() {}
				return empty();
			},
			applyCrdtUpdate: async (p) => ({
				documentId: p.documentId,
				sectionKey: p.sectionKey,
				stateVectorBase64: "",
				snapshotBase64: "",
				updatedAt: virtualNow(),
			}),
			getCrdtState: async () => null,
			subscribeSection: () => {
				async function* empty() {}
				return empty();
			},
			acquireLease,
			renewLease: async () => null,
			releaseLease,
			getLease,
			joinPresence,
			leavePresence,
			listPresence,
			heartbeatPresence,
			sendScratchpad: async (p) => ({
				id: randomUUID(),
				toAgentId: p.toAgentId,
				fromAgentId: p.fromAgentId,
				payload: p.payload,
				createdAt: virtualNow(),
				exp: 0,
			}),
			pollScratchpad: async () => [],
			deleteScratchpadMessage: async () => true,
			sendA2AMessage,
			pollA2AInbox,
			deleteA2AMessage,
			indexDocument: async () => {},
			search: async () => [],
			registerAgentPubkey: async (agentId, pubkeyHex, label) => ({
				agentId,
				pubkeyHex,
				label,
				createdAt: virtualNow(),
			}),
			lookupAgentPubkey: async () => null,
			listAgentPubkeys: async () => [],
			revokeAgentPubkey: async () => true,
			recordSignatureNonce: async () => true,
			hasNonceBeenUsed: async () => false,
			createCollection: async (p) => ({
				id: randomUUID(),
				slug: p.name.toLowerCase(),
				name: p.name,
				description: p.description,
				ownerId: p.ownerId,
				createdAt: virtualNow(),
				updatedAt: virtualNow(),
				documentSlugs: [],
			}),
			getCollection: async () => null,
			listCollections: async () => ({ items: [], nextCursor: null }),
			addDocToCollection: async () => {},
			removeDocFromCollection: async () => false,
			reorderCollection: async () => {},
			exportCollection: async (slug) => ({
				collection: {
					id: randomUUID(),
					slug,
					name: slug,
					ownerId: "test",
					createdAt: virtualNow(),
					updatedAt: virtualNow(),
					documentSlugs: [],
				},
				documents: [],
				exportedAt: virtualNow(),
			}),
			createDocumentLink: async (p) => ({
				id: randomUUID(),
				sourceDocumentId: p.sourceDocumentId,
				targetDocumentId: p.targetDocumentId,
				label: p.label,
				createdAt: virtualNow(),
			}),
			getDocumentLinks: async () => [],
			deleteDocumentLink: async () => false,
			getGlobalGraph: async () => ({ nodes: [], edges: [] }),
			createWebhook: async (p) => ({
				id: randomUUID(),
				ownerId: p.ownerId,
				url: p.url,
				secret: "secret",
				events: p.events,
				enabled: true,
				createdAt: virtualNow(),
				updatedAt: virtualNow(),
			}),
			listWebhooks: async () => [],
			deleteWebhook: async () => false,
			testWebhook: async (id) => ({ webhookId: id, delivered: true, durationMs: 0 }),
			createSignedUrl: async (p) => ({
				token: randomUUID(),
				documentId: p.documentId,
				expiresAt: virtualNow() + (p.ttlMs ?? 86_400_000),
				permission: p.permission ?? "read",
				createdAt: virtualNow(),
			}),
			verifySignedUrl: async () => null,
			getDocumentAccess: async (id) => ({
				documentId: id,
				visibility: "private",
				grants: [],
			}),
			grantDocumentAccess: async () => {},
			revokeDocumentAccess: async () => false,
			setDocumentVisibility: async () => {},
			createOrganization: async (p) => ({
				id: randomUUID(),
				slug: p.name.toLowerCase(),
				name: p.name,
				ownerId: p.ownerId,
				createdAt: virtualNow(),
				updatedAt: virtualNow(),
			}),
			getOrganization: async () => null,
			listOrganizations: async () => [],
			addOrgMember: async () => {},
			removeOrgMember: async () => false,
			createApiKey: async (p) => ({
				id: randomUUID(),
				userId: p.userId,
				name: p.name,
				prefix: "abcd1234",
				createdAt: virtualNow(),
				secret: `sk-${randomUUID()}`,
			}),
			listApiKeys: async () => [],
			deleteApiKey: async () => false,
			rotateApiKey: async (id, userId) => ({
				id,
				userId,
				name: "rotated",
				prefix: "abcd1234",
				createdAt: virtualNow(),
				secret: `sk-${randomUUID()}`,
			}),
			attachBlob: async (p) =>
				({
					id: randomUUID(),
					docSlug: p.docSlug,
					blobName: p.name,
					hash: "deadbeef",
					size: p.data.byteLength,
					contentType: p.contentType,
					uploadedBy: p.uploadedBy,
					uploadedAt: virtualNow(),
				}) satisfies BlobAttachment,
			getBlob: async () => null,
			listBlobs: async () => [],
			detachBlob: async () => false,
			fetchBlobByHash: async () => null,
			exportDocument: async (p) =>
				({
					filePath: `/tmp/${p.slug}.${p.format}`,
					slug: p.slug,
					version: 1,
					fileHash: "deadbeef",
					byteCount: 0,
					exportedAt: new Date().toISOString(),
					signatureHex: null,
				}) satisfies ExportDocumentResult,
			exportAll: async () => ({
				exported: [],
				skipped: [],
				totalCount: 0,
				failedCount: 0,
			}),
			importDocument: async (_p): Promise<ImportDocumentResult> => ({
				action: "created",
				slug: "stub",
				documentId: randomUUID(),
				versionNumber: 1,
				contentHash: "stub",
			}),
			getChangesSince: async (_v: bigint): Promise<Uint8Array> => new Uint8Array(0),
			applyChanges: async (_c: Uint8Array): Promise<bigint> => BigInt(0),
			open: async () => {},
			close: async () => {},
			config: {
				presenceTtlMs: hub.presenceTtlMs,
			},
		} satisfies Backend;
	}
}

// ── Helper: advance virtual time and sweep ─────────────────────────────────────

function advanceAndSweep(hub: CrashRecoveryHub, ms: number): void {
	advanceTime(ms);
	hub.sweep();
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("T434 — AgentSession crash recovery contract", () => {
	// Reset virtual clock before each group
	// (node:test doesn't have beforeEach at module level, so each it() resets)

	it("contract: contributions persist after crash (data is NOT lost)", async () => {
		_virtualNow = Date.now(); // reset virtual clock
		const hub = new CrashRecoveryHub({ presenceTtlMs: 200, leaseMaxDurationMs: 300 });
		const backend = hub.toBackend();

		const session = new AgentSession({ backend, agentId: "crash-agent-1" });
		await session.open();

		// Agent performs writes
		const doc1 = await session.contribute((b) =>
			b.createDocument({ title: "Doc A", createdBy: "crash-agent-1" }),
		);
		const doc2 = await session.contribute((b) =>
			b.createDocument({ title: "Doc B", createdBy: "crash-agent-1" }),
		);

		// Simulate crash: drop session reference without calling close()
		// In a real process crash the JS heap would be GC'd; we simulate by
		// simply not calling close(). The backend retains the documents.
		const crashedSession = session;
		void crashedSession; // suppress lint — intentionally orphaned

		// Documents must be visible in the hub immediately (writes already persisted)
		const docs = hub.getDocuments();
		assert(
			docs.some((d) => d.id === doc1.id),
			"Doc A must persist after crash",
		);
		assert(
			docs.some((d) => d.id === doc2.id),
			"Doc B must persist after crash",
		);
		assert.equal(docs.length, 2, "exactly 2 documents should be persisted");
	});

	it("contract: presence expires after presenceTtlMs of crash", async () => {
		_virtualNow = Date.now();
		const hub = new CrashRecoveryHub({ presenceTtlMs: 200, leaseMaxDurationMs: 300 });
		const backend = hub.toBackend();

		const session = new AgentSession({
			backend,
			agentId: "crash-agent-presence",
			sessionId: "fixed-session-id",
		});
		await session.open();

		// Presence should be registered immediately after open()
		const presenceBefore = hub.listAllPresence();
		assert(
			presenceBefore.length > 0,
			"Presence must be registered by open() (spec §3.2.4)",
		);

		// Simulate crash: advance virtual time past presenceTtlMs and sweep
		advanceAndSweep(hub, 201); // 201ms > presenceTtlMs (200ms)

		const presenceAfter = hub.listAllPresence();
		assert.equal(
			presenceAfter.length,
			0,
			`Presence must be removed after presenceTtlMs. Remaining: ${JSON.stringify(presenceAfter)}`,
		);
	});

	it("contract: leases expire after TTL when session crashes", async () => {
		_virtualNow = Date.now();
		const hub = new CrashRecoveryHub({ presenceTtlMs: 200, leaseMaxDurationMs: 300 });
		const backend = hub.toBackend();

		const session = new AgentSession({ backend, agentId: "crash-agent-lease" });
		await session.open();

		// Agent acquires a lease inside contribute()
		await session.contribute(async (b) => {
			const lease = await b.acquireLease({
				resource: "document:test-resource",
				holder: "crash-agent-lease",
				ttlMs: 250, // within leaseMaxDurationMs
			});
			return lease ? { documentId: "irrelevant" } : null;
		});

		// Lease should be held now
		const leasesBefore = hub.listAllLeases();
		assert.equal(
			leasesBefore.length,
			1,
			`Expected 1 active lease, got ${leasesBefore.length}`,
		);

		// Simulate crash: no close() called
		// Advance time past leaseMaxDurationMs and sweep
		advanceAndSweep(hub, 301); // 301ms > leaseMaxDurationMs (300ms)

		const leasesAfter = hub.listAllLeases();
		assert.equal(
			leasesAfter.length,
			0,
			`Leases must expire after TTL. Remaining: ${JSON.stringify(leasesAfter)}`,
		);
	});

	it("contract: all state clears within max(presenceTtlMs, leaseMaxDurationMs)", async () => {
		_virtualNow = Date.now();
		const presenceTtlMs = 200;
		const leaseMaxDurationMs = 300;
		const hub = new CrashRecoveryHub({ presenceTtlMs, leaseMaxDurationMs });
		const backend = hub.toBackend();

		const session = new AgentSession({ backend, agentId: "crash-agent-all" });
		await session.open();

		// Acquire a lease
		await session.contribute(async (b) => {
			await b.acquireLease({
				resource: "document:shared-resource",
				holder: "crash-agent-all",
				ttlMs: leaseMaxDurationMs,
			});
			return null;
		});

		// Verify state exists before crash
		assert(hub.listAllPresence().length > 0, "Presence must be set");
		assert.equal(hub.listAllLeases().length, 1, "Lease must be held");

		// Simulate crash — do NOT call close()
		// Advance to max(presenceTtlMs, leaseMaxDurationMs) + margin
		const maxTtl = Math.max(presenceTtlMs, leaseMaxDurationMs);
		advanceAndSweep(hub, maxTtl + 10);

		// All state must be cleared
		assert.equal(
			hub.listAllPresence().length,
			0,
			"All presence must expire after max TTL",
		);
		assert.equal(
			hub.listAllLeases().length,
			0,
			"All leases must expire after max TTL",
		);
	});

	it("contract: close() is best-effort — normal path releases state immediately", async () => {
		_virtualNow = Date.now();
		const hub = new CrashRecoveryHub({ presenceTtlMs: 200, leaseMaxDurationMs: 300 });
		const backend = hub.toBackend();

		const session = new AgentSession({ backend, agentId: "clean-close-agent" });
		await session.open();

		// Contribute something (return documentId so session tracks it)
		await session.contribute(async (b) => {
			const created = await b.createDocument({
				title: "Clean Doc",
				createdBy: "clean-close-agent",
			});
			return { documentId: created.id };
		});

		// Presence should be registered
		assert(hub.listAllPresence().length > 0, "Presence must be registered");

		// Close normally — presence should be immediately released (without waiting for TTL)
		const receipt = await session.close();

		assert.equal(
			session.getState(),
			AgentSessionState.Closed,
			"State must be Closed after clean close()",
		);
		assert(receipt.eventCount >= 1, "Receipt must count the contribute() call");
		assert(receipt.documentIds.length >= 1, "Receipt must list the written document");

		// Presence must be gone immediately (leavePresence called)
		// No need to advance virtual time
		const presenceAfterClose = hub.listAllPresence();
		assert.equal(
			presenceAfterClose.length,
			0,
			"Presence must be removed immediately on clean close()",
		);
	});

	it("contract: state machine stays Active mid-contribute on crash path", async () => {
		_virtualNow = Date.now();
		const hub = new CrashRecoveryHub({ presenceTtlMs: 200 });
		const backend = hub.toBackend();

		const session = new AgentSession({ backend, agentId: "mid-crash-agent" });
		await session.open();

		assert.equal(session.getState(), AgentSessionState.Active);

		// Start a contribute() but simulate crash by NOT calling close()
		// (In a real process crash, the promise would never resolve.)
		// We just verify the session stays Active and contributions are tracked.
		await session.contribute(async (b) => {
			const doc = await b.createDocument({
				title: "Mid-crash Doc",
				createdBy: "mid-crash-agent",
			});
			return { documentId: doc.id };
		});

		assert.equal(session.getState(), AgentSessionState.Active);
		assert.equal(session.getEventCount(), 1);
		// Do NOT call close() — simulating crash
	});

	it("contract: multiple concurrent contribute() calls do not corrupt state", async () => {
		_virtualNow = Date.now();
		const hub = new CrashRecoveryHub({ presenceTtlMs: 200 });
		const backend = hub.toBackend();

		const session = new AgentSession({ backend, agentId: "concurrent-crash-agent" });
		await session.open();

		// Launch 5 concurrent contribute() calls
		const results = await Promise.all(
			Array.from({ length: 5 }, (_, i) =>
				session.contribute((b) =>
					b.createDocument({
						title: `Concurrent Doc ${i}`,
						createdBy: "concurrent-crash-agent",
					}),
				),
			),
		);

		// All 5 results should be valid documents
		for (const doc of results) {
			assert(typeof doc.id === "string" && doc.id.length > 0);
		}

		// eventCount must equal number of successful contribute() calls
		assert.equal(session.getEventCount(), 5);

		// All 5 documents must be in the hub
		const hubDocs = hub.getDocuments();
		assert.equal(hubDocs.length, 5, "All 5 documents must persist in hub");

		// Simulate crash — advance past TTL
		advanceAndSweep(hub, 201);

		// Documents survive TTL sweep (only leases and presence expire)
		assert.equal(
			hub.getDocuments().length,
			5,
			"Documents must not be swept by TTL reaper",
		);
		assert.equal(hub.listAllPresence().length, 0, "Presence must expire after TTL");
	});

	it("contract: receipt is emitted on clean close() with all contribution metadata", async () => {
		_virtualNow = Date.now();
		const hub = new CrashRecoveryHub({ presenceTtlMs: 200 });
		const backend = hub.toBackend();

		const customSessionId = randomUUID();
		const session = new AgentSession({
			backend,
			agentId: "receipt-test-agent",
			sessionId: customSessionId,
		});
		await session.open();

		const docResult = await session.contribute(async (b) => {
			const created = await b.createDocument({
				title: "Receipt Doc",
				createdBy: "receipt-test-agent",
			});
			return { documentId: created.id };
		});

		const receipt: ContributionReceipt = await session.close();

		assert.equal(receipt.sessionId, customSessionId);
		assert.equal(receipt.agentId, "receipt-test-agent");
		assert.equal(receipt.eventCount, 1);
		assert(receipt.documentIds.includes(docResult.documentId), "receipt must include written doc ID");
		assert(receipt.sessionDurationMs >= 0);
		assert(!Number.isNaN(Date.parse(receipt.openedAt)));
		assert(!Number.isNaN(Date.parse(receipt.closedAt)));
	});

	it("contract: idempotent close() returns cached receipt without re-running teardown", async () => {
		_virtualNow = Date.now();
		const hub = new CrashRecoveryHub({ presenceTtlMs: 200 });
		const backend = hub.toBackend();

		const session = new AgentSession({ backend, agentId: "idempotent-agent" });
		await session.open();
		await session.contribute(async () => ({ documentId: "idem-doc" }));

		const receipt1 = await session.close();
		const receipt2 = await session.close();

		// Must return the exact same cached object
		assert.strictEqual(receipt1, receipt2, "idempotent close() must return cached receipt");
		assert.equal(session.getState(), AgentSessionState.Closed);
	});
});
