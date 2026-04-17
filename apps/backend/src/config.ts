/**
 * apps/backend/src/config.ts
 *
 * Centralised configuration for the backend server.
 * All env-var reads for blob storage, S3/R2, and related settings
 * live here so that they can be imported by any module without
 * reaching directly into process.env.
 *
 * T460: blob storage configuration added (BLOB_STORAGE_MODE, S3_*).
 */

// ── Blob storage ───────────────────────────────────────────────

/**
 * Storage backend for binary blob attachments.
 *
 *   's3'   — (default) store bytes in an S3-compatible object store
 *             (AWS S3, Cloudflare R2, MinIO, …). Requires BLOB_S3_BUCKET.
 *   'pg-lo' — store bytes in PostgreSQL large objects via lo_creat/lo_write.
 *             Useful for single-node deployments that have no S3 access.
 */
export const BLOB_STORAGE_MODE: 's3' | 'pg-lo' =
  (process.env.BLOB_STORAGE_MODE as 's3' | 'pg-lo' | undefined) === 'pg-lo'
    ? 'pg-lo'
    : 's3';

/**
 * S3/R2/MinIO bucket name.
 * Required when BLOB_STORAGE_MODE = 's3'.
 */
export const S3_BUCKET: string | undefined = process.env.BLOB_S3_BUCKET ?? process.env.S3_BUCKET;

/**
 * Custom S3-compatible endpoint URL (e.g. Cloudflare R2, MinIO).
 * Leave unset to use the default AWS regional endpoint.
 *
 * Example: "https://<account>.r2.cloudflarestorage.com"
 */
export const S3_ENDPOINT: string | undefined =
  process.env.BLOB_S3_ENDPOINT ?? process.env.S3_ENDPOINT;

/**
 * AWS/R2 region string (e.g. "us-east-1", "auto").
 * Defaults to "us-east-1" when unset.
 */
export const S3_REGION: string | undefined =
  process.env.BLOB_S3_REGION ?? process.env.S3_REGION;

/**
 * AWS/R2 access key ID.
 * When unset the SDK falls back to the standard credential-chain
 * (IAM role, env vars, credential file).
 */
export const S3_ACCESS_KEY_ID: string | undefined =
  process.env.BLOB_S3_ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;

/**
 * AWS/R2 secret access key.
 * When unset the SDK falls back to the standard credential-chain.
 */
export const S3_SECRET_ACCESS_KEY: string | undefined =
  process.env.BLOB_S3_SECRET_ACCESS_KEY ??
  process.env.S3_SECRET_ACCESS_KEY ??
  process.env.AWS_SECRET_ACCESS_KEY;

/**
 * Maximum blob upload size in bytes.
 * Defaults to 100 MB. Reduce on resource-constrained deployments.
 */
export const BLOB_MAX_SIZE_BYTES: number = process.env.BLOB_MAX_SIZE_BYTES
  ? parseInt(process.env.BLOB_MAX_SIZE_BYTES, 10)
  : 100 * 1024 * 1024;

// ── Validation ─────────────────────────────────────────────────

/**
 * Warn at startup when S3 mode is active but no bucket is configured.
 * This avoids a hard crash at import time; errors surface on first blob op.
 */
if (BLOB_STORAGE_MODE === 's3' && !S3_BUCKET) {
  // Intentional console.warn — logger may not be initialised yet.
  // eslint-disable-next-line no-console
  console.warn(
    '[config] BLOB_STORAGE_MODE=s3 but BLOB_S3_BUCKET (or S3_BUCKET) is not set. ' +
    'Blob operations will fail until a bucket is configured.'
  );
}
