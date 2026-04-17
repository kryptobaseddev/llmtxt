/**
 * crsqlite-loader.ts
 *
 * Dynamically imports @vlcn.io/crsqlite and returns the resolved extensionPath
 * string that better-sqlite3 can pass to db.loadExtension().
 *
 * Design constraints (DR-P2-01, spec §3.1):
 *  - @vlcn.io/crsqlite is an ES module ("type": "module") — require() MUST NOT
 *    be used; it would throw ERR_REQUIRE_ESM in CommonJS callers.
 *  - The package is an optional peer dependency. If it is not installed, this
 *    module returns null rather than throwing at import time.
 *  - Callers that need the extension path MUST check for null and throw a typed
 *    error (CrSqliteNotLoadedError) at the point of use, not here.
 *
 * Usage:
 *   const extPath = await loadCrSqliteExtensionPath();
 *   if (extPath === null) throw new CrSqliteNotLoadedError();
 *   db.loadExtension(extPath);
 */

/**
 * Typed error thrown by LocalBackend when cr-sqlite support is requested but
 * the @vlcn.io/crsqlite package is not installed.
 */
export class CrSqliteNotLoadedError extends Error {
  constructor() {
    super(
      '@vlcn.io/crsqlite is not installed. ' +
        'Install it as a peer dependency to enable cr-sqlite sync: ' +
        'pnpm add @vlcn.io/crsqlite'
    );
    this.name = 'CrSqliteNotLoadedError';
  }
}

/**
 * Attempts to dynamically import @vlcn.io/crsqlite and resolve the native
 * SQLite extension path.
 *
 * @returns The absolute path to the crsqlite native extension (.so / .dylib /
 *   .dll), or null if the package is not installed.
 */
export async function loadCrSqliteExtensionPath(): Promise<string | null> {
  try {
    // Dynamic import is required because @vlcn.io/crsqlite is ESM-only.
    // Using require() would throw ERR_REQUIRE_ESM in CommonJS callers.
    const mod = await import('@vlcn.io/crsqlite');
    const extPath: string = mod.extensionPath;
    if (typeof extPath !== 'string' || extPath.length === 0) {
      return null;
    }
    return extPath;
  } catch {
    // Package not installed or failed to resolve binary — return null so
    // callers can throw CrSqliteNotLoadedError at the appropriate layer.
    return null;
  }
}
