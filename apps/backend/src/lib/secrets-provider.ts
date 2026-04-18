/**
 * Secrets provider abstraction — T090: Secret Rotation and KMS Integration.
 *
 * Provides a unified interface for reading versioned secrets from multiple
 * backends: environment variables (dev/test), HashiCorp Vault (KV v2), and
 * AWS KMS / AWS Secrets Manager (prod).
 *
 * The SECRETS_PROVIDER env var selects the backend:
 *   - 'env'     — read from process.env (default, dev/test)
 *   - 'vault'   — HashiCorp Vault KV v2 via HTTP API
 *   - 'aws-kms' — AWS Secrets Manager via AWS SDK
 *
 * No secret value is ever stored in this module or in the database.
 * Only version metadata (current/previous version numbers) is persisted.
 *
 * Grace-window rotation:
 *   When a secret is rotated, the previous version is retained for
 *   SECRETS_GRACE_WINDOW_SECS (default 3600 = 1 h) so that in-flight
 *   tokens / signed URLs continue to validate.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { secretsConfig } from "../db/schema-pg.js";

// ── Provider interface ────────────────────────────────────────────

export interface SecretsProvider {
	/** Read the current value of a named secret. */
	getSecret(name: string): Promise<string>;
	/** Read a specific version of a named secret (for grace-window support). */
	getSecretVersion(name: string, version: number): Promise<string | null>;
}

// ── Env provider (default) ────────────────────────────────────────

/**
 * Environment-variable secrets provider.
 *
 * Supports versioned secrets via env var naming convention:
 *   SIGNING_SECRET        — current version
 *   SIGNING_SECRET_V1     — version 1 (previous, for grace window)
 *   SIGNING_SECRET_V2     — version 2 (current after rotation)
 *
 * Callers MUST set the versioned env vars before rotating the version number.
 */
class EnvSecretsProvider implements SecretsProvider {
	async getSecret(name: string): Promise<string> {
		const val = process.env[name];
		if (!val) {
			throw new Error(
				`[secrets] EnvSecretsProvider: ${name} is not set in process.env`,
			);
		}
		return val;
	}

	async getSecretVersion(
		name: string,
		version: number,
	): Promise<string | null> {
		// Try SIGNING_SECRET_V2 first, fall back to SIGNING_SECRET for v1.
		const versionedName = `${name}_V${version}`;
		const versioned = process.env[versionedName];
		if (versioned) return versioned;
		// Version 1 (initial) falls back to the unversioned name.
		if (version === 1) {
			return process.env[name] ?? null;
		}
		return null;
	}
}

// ── Vault provider (stub — Railway-compatible) ────────────────────

/**
 * HashiCorp Vault KV v2 secrets provider.
 *
 * Environment variables required:
 *   VAULT_ADDR        — Vault server address (e.g. https://vault.example.com)
 *   VAULT_TOKEN       — Vault client token
 *   VAULT_KV_MOUNT    — KV v2 mount path (default: 'secret')
 *
 * Railway deployment: add a Vault service or use external Vault.
 * For Railway-hosted Vault, set VAULT_ADDR to the internal service URL.
 *
 * Secret path convention: <mount>/data/llmtxt/<name>
 * Versioned: <mount>/data/llmtxt/<name>?version=<v>
 */
class VaultSecretsProvider implements SecretsProvider {
	private readonly addr: string;
	private readonly token: string;
	private readonly mount: string;

	constructor() {
		this.addr = process.env.VAULT_ADDR ?? "";
		this.token = process.env.VAULT_TOKEN ?? "";
		this.mount = process.env.VAULT_KV_MOUNT ?? "secret";

		if (!this.addr || !this.token) {
			throw new Error(
				"[secrets] VaultSecretsProvider: VAULT_ADDR and VAULT_TOKEN must be set when SECRETS_PROVIDER=vault",
			);
		}
	}

	private async fetchVault(path: string): Promise<string> {
		const url = `${this.addr}/v1/${this.mount}/data/${path}`;
		const res = await fetch(url, {
			headers: { "X-Vault-Token": this.token },
		});
		if (!res.ok) {
			throw new Error(
				`[secrets] Vault fetch failed: ${res.status} ${res.statusText} — ${url}`,
			);
		}
		const body = (await res.json()) as {
			data?: { data?: Record<string, string> };
		};
		const value = body.data?.data?.value;
		if (!value) {
			throw new Error(`[secrets] Vault secret at ${path} has no 'value' key`);
		}
		return value;
	}

	async getSecret(name: string): Promise<string> {
		return this.fetchVault(`llmtxt/${name}`);
	}

	async getSecretVersion(
		name: string,
		version: number,
	): Promise<string | null> {
		try {
			const url = `${this.addr}/v1/${this.mount}/data/llmtxt/${name}?version=${version}`;
			const res = await fetch(url, {
				headers: { "X-Vault-Token": this.token },
			});
			if (!res.ok) return null;
			const body = (await res.json()) as {
				data?: { data?: Record<string, string> };
			};
			return body.data?.data?.value ?? null;
		} catch {
			return null;
		}
	}
}

// ── AWS Secrets Manager provider (stub) ──────────────────────────

/**
 * AWS Secrets Manager provider.
 *
 * Environment variables required:
 *   AWS_REGION              — AWS region (e.g. us-east-1)
 *   AWS_ACCESS_KEY_ID       — AWS access key (or use IAM role)
 *   AWS_SECRET_ACCESS_KEY   — AWS secret key (or use IAM role)
 *
 * Secret naming convention: llmtxt/<name>
 * Versioned: llmtxt/<name> with AWSCURRENT / AWSPREVIOUS staging labels.
 *
 * Note: This provider uses the AWS SDK v3 dynamically to avoid adding it
 * as a hard dependency when Vault or env providers are used instead.
 */
class AwsKmsSecretsProvider implements SecretsProvider {
	async getSecret(name: string): Promise<string> {
		return this._fetchAws(`llmtxt/${name}`, "AWSCURRENT");
	}

	async getSecretVersion(
		name: string,
		version: number,
	): Promise<string | null> {
		// Version 1 = AWSCURRENT, previous = AWSPREVIOUS (simplified mapping)
		try {
			const label = version === 1 ? "AWSCURRENT" : "AWSPREVIOUS";
			return await this._fetchAws(`llmtxt/${name}`, label);
		} catch {
			return null;
		}
	}

	private async _fetchAws(
		secretId: string,
		versionStage: string,
	): Promise<string> {
		// Dynamic import to avoid hard dep on @aws-sdk/client-secrets-manager.
		// Type: cast to any to avoid requiring the package as a dev/peer dep.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const awsSdk = await import("@aws-sdk/client-secrets-manager" as any).catch(
			() => {
				throw new Error(
					"[secrets] @aws-sdk/client-secrets-manager is not installed. " +
						"Run: pnpm add @aws-sdk/client-secrets-manager",
				);
			},
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { SecretsManagerClient, GetSecretValueCommand } = awsSdk as any;
		const region = process.env.AWS_REGION ?? "us-east-1";
		const client = new SecretsManagerClient({ region });
		const cmd = new GetSecretValueCommand({
			SecretId: secretId,
			VersionStage: versionStage,
		});
		const res = await client.send(cmd);
		const val = res.SecretString;
		if (!val) {
			throw new Error(
				`[secrets] AWS secret ${secretId} has no SecretString value`,
			);
		}
		return val;
	}
}

// ── Provider factory ──────────────────────────────────────────────

let _provider: SecretsProvider | null = null;

/** Get the configured secrets provider singleton. */
export function getSecretsProvider(): SecretsProvider {
	if (_provider) return _provider;

	const providerName = process.env.SECRETS_PROVIDER ?? "env";

	switch (providerName) {
		case "vault":
			_provider = new VaultSecretsProvider();
			break;
		case "aws-kms":
			_provider = new AwsKmsSecretsProvider();
			break;
		case "env":
		default:
			_provider = new EnvSecretsProvider();
			break;
	}

	return _provider;
}

// ── Grace-window secret resolution ───────────────────────────────

/**
 * Resolve the current and (if within grace window) previous secret values.
 *
 * Returns `{ current: string; previous: string | null; graceWindowActive: boolean }`.
 *
 * The caller should try `current` first, then fall back to `previous` when
 * verifying tokens (e.g. signed URL signatures, webhook HMAC).
 */
export async function resolveSigningSecrets(
	secretName = "SIGNING_SECRET",
): Promise<{
	current: string;
	previous: string | null;
	graceWindowActive: boolean;
}> {
	const provider = getSecretsProvider();

	// Load rotation metadata from DB.
	const [config] = await db
		.select()
		.from(secretsConfig)
		.where(eq(secretsConfig.secretName, secretName))
		.limit(1);

	const currentVersion = config?.currentVersion ?? 1;
	const previousVersion = config?.previousVersion ?? null;
	const rotatedAt = config?.rotatedAt
		? new Date(config.rotatedAt).getTime()
		: null;
	const graceWindowMs = (config?.graceWindowSecs ?? 3600) * 1000;

	const current = await provider.getSecret(secretName);

	let previous: string | null = null;
	let graceWindowActive = false;

	if (previousVersion !== null && rotatedAt !== null) {
		const graceEnd = rotatedAt + graceWindowMs;
		graceWindowActive = Date.now() < graceEnd;
		if (graceWindowActive) {
			previous = await provider.getSecretVersion(secretName, previousVersion);
		}
	}

	return { current, previous, graceWindowActive };
}

// ── KEK resolution ────────────────────────────────────────────────

/**
 * Resolve the Key Encrypting Key (KEK) used to wrap/unwrap agent private keys.
 *
 * The KEK is a 32-byte value derived from SIGNING_KEY_KEK env var.
 * MUST be set in production. Falls back to a deterministic dev value only
 * in non-production environments (so wrapped keys can be re-unwrapped across
 * dev restarts).
 *
 * @throws Error in production if SIGNING_KEY_KEK is not set.
 */
export function resolveKek(): Uint8Array {
	const raw = process.env.SIGNING_KEY_KEK;

	if (!raw) {
		if (process.env.NODE_ENV === "production") {
			throw new Error(
				"[FATAL] SIGNING_KEY_KEK is not set. " +
					"Generate with: openssl rand -hex 32. " +
					"Store in Railway secret variables or your KMS.",
			);
		}
		// Dev fallback — deterministic 32-byte zero key (non-production only).
		return new Uint8Array(32).fill(0xde);
	}

	// Accept 64-char hex (32 bytes) or raw base64.
	if (/^[0-9a-fA-F]{64}$/.test(raw)) {
		return Uint8Array.from(Buffer.from(raw, "hex"));
	}

	// Base64 encoded (64 chars → 48 bytes for standard base64 of 32 bytes = 44 chars)
	const decoded = Buffer.from(raw, "base64");
	if (decoded.length !== 32) {
		throw new Error(
			`[FATAL] SIGNING_KEY_KEK must be exactly 32 bytes (64 hex chars or base64). Got ${decoded.length} bytes.`,
		);
	}
	return new Uint8Array(decoded);
}

// ── Boot-time validation ──────────────────────────────────────────

/**
 * Validate secrets configuration at server boot.
 *
 * Extends the existing signing-secret-validator.ts with:
 *   1. Production KEK check (no hardcoded default allowed).
 *   2. Secrets provider connectivity test (Vault/AWS reachable).
 *
 * @throws Error if any validation fails in production.
 */
export async function validateSecretsConfig(): Promise<void> {
	// 1. KEK validation (throws in production if missing).
	resolveKek();

	// 2. Provider reachability (non-fatal in dev, fatal in prod).
	const providerName = process.env.SECRETS_PROVIDER ?? "env";
	if (providerName !== "env" && process.env.NODE_ENV === "production") {
		try {
			const provider = getSecretsProvider();
			await provider.getSecret("SIGNING_SECRET");
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(
				`[FATAL] Secrets provider '${providerName}' is unreachable at boot: ${msg}`,
			);
		}
	}
}
