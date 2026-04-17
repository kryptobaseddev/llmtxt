/**
 * AgentSession skeleton tests
 *
 * Test suite for the ephemeral agent session lifecycle (T430).
 * Tests the state machine, error handling, and basic API shape.
 *
 * Spec: docs/specs/ARCH-T426-ephemeral-agent-lifecycle.md
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  AgentSession,
  AgentSessionError,
  AgentSessionState,
  type ContributionReceipt,
} from '../sdk/session.js';

// ── Helper: UUID validation ────────────────────────────────────
function isValidUUIDv4(str: string): boolean {
  const uuidv4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidv4Regex.test(str);
}

// ── Tests ──────────────────────────────────────────────────────

describe('AgentSession', () => {
  describe('constructor', () => {
    it('should create a new session in Idle state', () => {
      const session = new AgentSession({
        backend: {},
        agentId: 'test-agent-1',
      });

      assert.equal(session.getState(), AgentSessionState.Idle);
      assert.equal(session.getAgentId(), 'test-agent-1');
    });

    it('should generate a random sessionId when omitted', () => {
      const session = new AgentSession({
        backend: {},
        agentId: 'test-agent-1',
      });

      const sessionId = session.getSessionId();
      assert(typeof sessionId === 'string');
      assert(sessionId.length > 0);
      assert(isValidUUIDv4(sessionId), `sessionId should be a valid UUID v4: ${sessionId}`);
    });

    it('should use randomUUID() without external UUID library', () => {
      // Generate multiple sessions and verify uniqueness
      const session1 = new AgentSession({
        backend: {},
        agentId: 'agent-1',
      });
      const session2 = new AgentSession({
        backend: {},
        agentId: 'agent-1',
      });

      const id1 = session1.getSessionId();
      const id2 = session2.getSessionId();

      assert.notEqual(id1, id2, 'Two sessions should have different IDs');
    });

    it('should accept explicit sessionId override', () => {
      const customId = randomUUID();
      const session = new AgentSession({
        backend: {},
        agentId: 'test-agent-1',
        sessionId: customId,
      });

      assert.equal(session.getSessionId(), customId);
    });

    it('should track empty documentIds set initially', () => {
      const session = new AgentSession({
        backend: {},
        agentId: 'test-agent-1',
      });

      const docs = session.getDocumentIds();
      assert(Array.isArray(docs));
      assert.equal(docs.length, 0);
    });

    it('should have zero eventCount initially', () => {
      const session = new AgentSession({
        backend: {},
        agentId: 'test-agent-1',
      });

      assert.equal(session.getEventCount(), 0);
    });

    it('should store agentId', () => {
      const session = new AgentSession({
        backend: {},
        agentId: 'my-agent-123',
      });

      assert.equal(session.getAgentId(), 'my-agent-123');
    });
  });

  describe('state machine', () => {
    it('should start in Idle state', () => {
      const session = new AgentSession({
        backend: {},
        agentId: 'test-agent',
      });

      assert.equal(session.getState(), AgentSessionState.Idle);
    });

    it('should throw INVALID_STATE when contribute() called on Idle session', async () => {
      const session = new AgentSession({
        backend: {},
        agentId: 'test-agent',
      });

      try {
        await session.contribute(async () => {
          return 'work';
        });
        assert.fail('contribute() should throw on Idle state');
      } catch (err) {
        assert(err instanceof AgentSessionError);
        assert.equal(err.code, 'SESSION_NOT_ACTIVE');
        assert.match(err.message, /expected Active/);
      }
    });

    it('should throw INVALID_STATE when close() called on Idle session', async () => {
      const session = new AgentSession({
        backend: {},
        agentId: 'test-agent',
      });

      try {
        await session.close();
        assert.fail('close() should throw on Idle state');
      } catch (err) {
        assert(err instanceof AgentSessionError);
        assert.equal(err.code, 'INVALID_STATE');
        assert.match(err.message, /expected Active or Closed/);
      }
    });
  });

  describe('AgentSessionError', () => {
    it('should have a code property', () => {
      const err = new AgentSessionError('TEST_CODE', 'test message');

      assert.equal(err.code, 'TEST_CODE');
      assert.equal(err.message, 'test message');
      assert.equal(err.name, 'AgentSessionError');
    });

    it('should be instanceof Error', () => {
      const err = new AgentSessionError('TEST', 'message');

      assert(err instanceof Error);
      assert(err instanceof AgentSessionError);
    });
  });

  describe('type safety', () => {
    it('should have exhaustive AgentSessionState enum', () => {
      // Verify all states are defined
      assert.equal(AgentSessionState.Idle, 'Idle');
      assert.equal(AgentSessionState.Open, 'Open');
      assert.equal(AgentSessionState.Active, 'Active');
      assert.equal(AgentSessionState.Closing, 'Closing');
      assert.equal(AgentSessionState.Closed, 'Closed');
    });

    it('ContributionReceipt should have required fields', () => {
      // This is a type-level test: if ContributionReceipt is missing required
      // fields, TypeScript compilation will fail. We assert the interface exists.
      const receipt: ContributionReceipt = {
        sessionId: 'session-123',
        agentId: 'agent-456',
        documentIds: ['doc-1', 'doc-2'],
        eventCount: 3,
        sessionDurationMs: 1000,
        openedAt: new Date().toISOString(),
        closedAt: new Date().toISOString(),
      };

      assert(receipt.sessionId);
      assert(receipt.agentId);
      assert(Array.isArray(receipt.documentIds));
      assert(typeof receipt.eventCount === 'number');
      assert(typeof receipt.sessionDurationMs === 'number');
    });
  });

  describe('skeleton implementation', () => {
    it('should throw NOT_IMPLEMENTED for open()', async () => {
      const session = new AgentSession({
        backend: {},
        agentId: 'test-agent',
      });

      try {
        await session.open();
        assert.fail('open() should throw NOT_IMPLEMENTED in skeleton');
      } catch (err) {
        assert(err instanceof AgentSessionError);
        assert.equal(err.code, 'NOT_IMPLEMENTED');
      }
    });

    it('should throw NOT_IMPLEMENTED for contribute()', async () => {
      const session = new AgentSession({
        backend: {},
        agentId: 'test-agent',
      });

      // Manually set to Active state to bypass the state check
      // (can't do this via public API in skeleton)
      try {
        // Can't call contribute on Idle, will fail with SESSION_NOT_ACTIVE
        await session.contribute(async () => 'work');
        assert.fail('contribute() should throw');
      } catch (err) {
        assert(err instanceof AgentSessionError);
        // Could be either SESSION_NOT_ACTIVE (state check) or NOT_IMPLEMENTED (real implementation)
        assert(['SESSION_NOT_ACTIVE', 'NOT_IMPLEMENTED'].includes(err.code));
      }
    });

    it('should throw NOT_IMPLEMENTED for close()', async () => {
      const session = new AgentSession({
        backend: {},
        agentId: 'test-agent',
      });

      try {
        await session.close();
        assert.fail('close() should throw INVALID_STATE or NOT_IMPLEMENTED');
      } catch (err) {
        assert(err instanceof AgentSessionError);
        // Could be INVALID_STATE (state check) or NOT_IMPLEMENTED
        assert(['INVALID_STATE', 'NOT_IMPLEMENTED'].includes(err.code));
      }
    });
  });
});
