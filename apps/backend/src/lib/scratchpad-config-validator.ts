/**
 * Scratchpad Redis startup validator — T734.
 *
 * Validates that REDIS_URL is set when NODE_ENV=production so that the
 * scratchpad never silently falls back to the in-memory EventEmitter in a
 * multi-pod environment.  Without Redis, scratchpad messages are lost on pod
 * restart — a violation of the "never lose work" Guiding Star property.
 *
 * Logic:
 *   - If NODE_ENV === 'production' and REDIS_URL is unset → fatal error.
 *     Callers MUST call process.exit(1) after catching the thrown Error.
 *   - All other environments → emit a single WARN and continue (in-memory
 *     fallback is acceptable for local dev and CI).
 *
 * The implementation is a pure, testable function (no side-effects) so that
 * unit tests can exercise both branches without spawning a real process.
 *
 * Note: `validateScratchpadRedis` is also exported from `./scratchpad.ts`
 * (inline implementation) for callers that only depend on the scratchpad
 * module.  This standalone module mirrors the pattern established by
 * `./redis-config-validator.ts` (T726) for index.ts startup validation.
 *
 * See: docs/ops/redis-setup.md for provisioning instructions.
 */

/**
 * Validate that REDIS_URL is configured for scratchpad durability in production.
 *
 * Throws a descriptive Error when nodeEnv === 'production' and redisUrl is
 * absent or blank.  The caller is responsible for calling process.exit(1) so
 * that this function remains pure and unit-testable.
 *
 * @param redisUrl  The value of REDIS_URL (defaults to '').
 * @param nodeEnv   The value of NODE_ENV (defaults to '').
 * @throws {Error}  When nodeEnv === 'production' and redisUrl is unset.
 */
export function validateScratchpadConfig(
  redisUrl: string = '',
  nodeEnv: string = '',
): void {
  if (nodeEnv !== 'production') {
    // Outside production: allow missing REDIS_URL (in-memory fallback).
    // The caller should still emit a WARN but that is its responsibility.
    return;
  }

  if (!redisUrl || !redisUrl.trim()) {
    throw new Error(
      '[FATAL] REDIS_URL is not set and NODE_ENV=production. ' +
        'Scratchpad messages will be lost on every pod restart without a shared ' +
        'Redis Stream instance.  All Railway replicas MUST share Redis so that ' +
        'the scratchpad consumer group provides durable, at-least-once message ' +
        'delivery across restarts.  Add a Redis service in the Railway dashboard ' +
        'and set REDIS_URL via a service variable reference (${{Redis.REDIS_URL}}). ' +
        'See docs/ops/redis-setup.md for step-by-step instructions.',
    );
  }
}
