/**
 * Redis configuration startup validator — T726.
 *
 * Validates that REDIS_URL is set in production. Presence registry
 * (and CRDT pub/sub) require a shared Redis instance when running
 * more than one Railway replica. Without it, each pod maintains its
 * own isolated presence view, silently breaking the "Never duplicate
 * work / never impede others" Guiding Star property.
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
 * See: docs/ops/redis-setup.md for provisioning instructions.
 */

/**
 * Validate that REDIS_URL is configured for the given environment.
 *
 * Throws a descriptive Error when nodeEnv === 'production' and redisUrl
 * is absent or blank. The caller is responsible for calling process.exit(1)
 * so that this function remains pure and unit-testable.
 *
 * @param redisUrl   The value of REDIS_URL (defaults to '').
 * @param nodeEnv    The value of NODE_ENV (defaults to '').
 * @throws {Error}   When nodeEnv === 'production' and redisUrl is unset.
 */
export function validateRedisUrl(
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
        'All Railway replicas MUST share a Redis instance so that the presence ' +
        'registry and CRDT pub/sub produce a unified view across pods. ' +
        'Add a Redis service in the Railway dashboard and set REDIS_URL via a ' +
        'service variable reference (${{Redis.REDIS_URL}}). ' +
        'See docs/ops/redis-setup.md for step-by-step instructions.',
    );
  }
}
