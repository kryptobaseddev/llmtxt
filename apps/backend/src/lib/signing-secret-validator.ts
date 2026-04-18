/**
 * Signing-secret startup validator — T108.6 / T472.
 *
 * Validates that SIGNING_SECRET is set to a strong, non-default value in
 * production.  Signed URLs produced with a well-known dev secret can be
 * forged by anyone who reads the source code, so a misconfigured production
 * server MUST NOT start.
 *
 * The logic is extracted into a pure, testable function so that:
 *   1. index.ts can call it at startup before the server accepts connections.
 *   2. signed-urls.ts can re-use the constant list without duplicating it.
 *   3. Unit tests can exercise both the "pass" and "fail" branches without
 *      spawning a real process.
 */

/**
 * Well-known development / placeholder secrets that MUST NOT be used in
 * production.  The empty string represents an unset SIGNING_SECRET.
 */
export const KNOWN_INSECURE_SIGNING_SECRETS = new Set([
  '',                    // unset / empty
  'changeme',
  'default',
  'secret',
  'dev-secret',
  'llmtxt-dev-secret',
  'development-secret',
]);

/**
 * Validate the SIGNING_SECRET value for the given environment.
 *
 * Throws a descriptive Error when the secret is insecure and the environment
 * is production.  The caller is responsible for calling `process.exit(1)`
 * so that this function remains pure and unit-testable.
 *
 * @param secret     The value of SIGNING_SECRET (defaults to '').
 * @param nodeEnv    The value of NODE_ENV (defaults to '').
 * @throws {Error}   When nodeEnv === 'production' and secret is insecure.
 */
export function validateSigningSecret(
  secret: string = '',
  nodeEnv: string = '',
): void {
  if (nodeEnv !== 'production') return;

  if (KNOWN_INSECURE_SIGNING_SECRETS.has(secret)) {
    throw new Error(
      '[FATAL] SIGNING_SECRET is missing or set to an insecure default value. ' +
      'Set a strong random secret (e.g. openssl rand -hex 32) before deploying.',
    );
  }
}
