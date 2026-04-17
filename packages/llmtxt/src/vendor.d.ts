/**
 * vendor.d.ts
 *
 * Ambient module declarations for optional peer dependencies that are not
 * installed in devDependencies. These stubs provide the minimal type surface
 * needed by the loader modules so that `tsc` succeeds even when the packages
 * are absent.
 *
 * Do NOT import from these stubs directly. All access MUST go through the
 * dynamic-import loaders (e.g. crsqlite-loader.ts) which catch import failures.
 */

/**
 * @vlcn.io/crsqlite — optional peer dependency (DR-P2-01).
 *
 * ESM-only package. Exports the path to the native cr-sqlite SQLite extension
 * that was downloaded at install time. CommonJS callers MUST use dynamic
 * import() — never require().
 *
 * Real type declaration: @vlcn.io/crsqlite/nodejs-helper.d.ts
 */
declare module '@vlcn.io/crsqlite' {
  /** Absolute path to the crsqlite native extension (.so / .dylib / .dll). */
  export const extensionPath: string;
}
