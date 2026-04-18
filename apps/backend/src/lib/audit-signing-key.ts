/**
 * T107: Server ed25519 signing key for Merkle root attestation.
 *
 * The server signs each daily Merkle root to provide cryptographic attestation
 * that the server observed this root at checkpoint time. Any party with the
 * public key can verify independently without trusting the server.
 *
 * Key management:
 *   - Production: Set AUDIT_SIGNING_KEY to a 64-char lowercase hex string
 *     (32-byte raw ed25519 private key seed). Store in Railway Secrets.
 *   - Development: Auto-generates an ephemeral key if AUDIT_SIGNING_KEY is
 *     unset. The public key is logged so local testing can verify signatures.
 *     Ephemeral keys do NOT persist across restarts — not suitable for prod.
 *
 * Canonical signed message: `{root_hex}|{date_str}` (ASCII, pipe-separated).
 *
 * Signature format: 128-char lowercase hex (64-byte Ed25519 raw signature).
 * Key ID: first 16 hex chars of SHA-256(pubkey_hex) — deterministic, public-safe.
 */

import crypto from "node:crypto";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

// Noble ed25519 v3 requires setting the hash function in Node.js.
ed.hashes.sha512 = sha512;

// ── Key loading ──────────────────────────────────────────────────────────────

/** 32-byte raw ed25519 private key seed. */
let _signingKeyBytes: Uint8Array | null = null;
/** 32-byte ed25519 public key. */
let _publicKeyBytes: Uint8Array | null = null;
/** 16-char deterministic fingerprint. */
let _keyId: string | null = null;

/**
 * Initialize the server audit signing key from the environment.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 * Must be called before any checkpoint is created.
 */
export function initAuditSigningKey(): void {
	if (_signingKeyBytes !== null) return;

	const envKey = process.env.AUDIT_SIGNING_KEY;
	const isProd = process.env.NODE_ENV === "production";

	if (envKey && envKey.length === 64 && /^[0-9a-f]+$/i.test(envKey)) {
		_signingKeyBytes = Buffer.from(envKey, "hex");
		console.log(
			"[audit-signing-key] loaded AUDIT_SIGNING_KEY from environment",
		);
	} else {
		// Auto-generate ephemeral key.
		if (isProd && !envKey) {
			console.warn(
				"[audit-signing-key] WARNING: AUDIT_SIGNING_KEY is not set in production. " +
					"Generating an ephemeral key — roots will not be independently verifiable " +
					"across restarts. Set AUDIT_SIGNING_KEY in Railway Secrets for durable verification.",
			);
		}
		_signingKeyBytes = crypto.getRandomValues(new Uint8Array(32));
		console.log("[audit-signing-key] generated ephemeral key (dev/test mode)");
	}

	_publicKeyBytes = ed.getPublicKey(_signingKeyBytes);
	const pubkeyHex = Buffer.from(_publicKeyBytes).toString("hex");
	_keyId = crypto
		.createHash("sha256")
		.update(pubkeyHex)
		.digest("hex")
		.slice(0, 16);

	console.log(`[audit-signing-key] pubkey=${pubkeyHex} key_id=${_keyId}`);
}

/**
 * Return the current signing key ID (16-char hex fingerprint).
 * Returns null if the key has not been initialized.
 */
export function getAuditSigningKeyId(): string | null {
	return _keyId;
}

/**
 * Return the public key as 64-char lowercase hex, or null if uninitialized.
 */
export function getAuditPublicKeyHex(): string | null {
	if (!_publicKeyBytes) return null;
	return Buffer.from(_publicKeyBytes).toString("hex");
}

// ── Sign / verify ────────────────────────────────────────────────────────────

/**
 * Sign a Merkle root for a checkpoint date.
 *
 * Canonical message: `"{root_hex}|{date_str}"` (ASCII, pipe-separated).
 *
 * @param rootHex  - 64-char lowercase hex of the 32-byte Merkle root.
 * @param dateStr  - ISO 8601 date string e.g. `"2026-04-18"`.
 * @returns `{ signature: string, keyId: string }` or null if uninitialized.
 */
export async function signMerkleRoot(
	rootHex: string,
	dateStr: string,
): Promise<{ signature: string; keyId: string } | null> {
	if (!_signingKeyBytes || !_keyId) {
		console.warn("[audit-signing-key] sign called before init — skipping");
		return null;
	}

	const message = `${rootHex}|${dateStr}`;
	const messageBytes = Buffer.from(message, "utf8");
	const sigBytes = await ed.signAsync(messageBytes, _signingKeyBytes);
	const signature = Buffer.from(sigBytes).toString("hex");

	return { signature, keyId: _keyId };
}

/**
 * Verify an audit Merkle root signature.
 *
 * @param pubkeyHex  - 64-char hex of the ed25519 public key.
 * @param rootHex    - 64-char hex Merkle root.
 * @param dateStr    - ISO 8601 date string.
 * @param sigHex     - 128-char hex signature.
 * @returns `true` when the signature is valid.
 */
export async function verifyMerkleRootSignature(
	pubkeyHex: string,
	rootHex: string,
	dateStr: string,
	sigHex: string,
): Promise<boolean> {
	try {
		const pubkeyBytes = Buffer.from(pubkeyHex, "hex");
		const sigBytes = Buffer.from(sigHex, "hex");
		const message = Buffer.from(`${rootHex}|${dateStr}`, "utf8");
		return await ed.verifyAsync(sigBytes, message, pubkeyBytes);
	} catch {
		return false;
	}
}
