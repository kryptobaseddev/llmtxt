/**
 * Unit tests for security headers middleware (T471 — T108.5).
 *
 * Verifies:
 *   1. Content-Security-Policy header is present on every response.
 *   2. The header contains a nonce in the script-src directive.
 *   3. The nonce is base64-encoded (16 bytes = ~24 base64 chars, padded).
 *   4. Two separate requests receive distinct nonces.
 *   5. `unsafe-inline` is NOT present in script-src (nonce replaces it).
 *   6. reply.cspNonce is exposed so view templates can consume it.
 *
 * Run:
 *   pnpm --filter @llmtxt/backend test -- security
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { securityHeaders } from "../middleware/security.js";

/** Build a minimal Fastify app with only the security-headers plugin registered. */
async function buildApp() {
	const app = Fastify({ logger: false });
	await securityHeaders(app);

	// A simple test route that echoes the nonce from reply.cspNonce.
	app.get("/ping", async (_req, reply) => {
		return reply.send({ nonce: reply.cspNonce });
	});

	await app.ready();
	return app;
}

describe("securityHeaders — CSP nonce (T471)", () => {
	it("response has a Content-Security-Policy header", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		assert.ok(
			res.headers["content-security-policy"],
			"Content-Security-Policy header must be present",
		);
		await app.close();
	});

	it("CSP header contains a nonce in script-src", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		const csp = res.headers["content-security-policy"] as string;
		assert.match(
			csp,
			/'nonce-[A-Za-z0-9+/=]+'/,
			`script-src must contain a nonce token; got: ${csp}`,
		);
		await app.close();
	});

	it("nonce is base64-encoded (matches base64 character set)", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		const csp = res.headers["content-security-policy"] as string;
		// Extract the nonce value from `'nonce-<value>'`
		const match = csp.match(/'nonce-([A-Za-z0-9+/=]+)'/);
		assert.ok(match, "Could not extract nonce from CSP header");
		const nonce = match[1];
		// 16 random bytes -> 24 base64 chars (with padding)
		assert.ok(nonce.length >= 16, `Nonce too short: "${nonce}"`);
		assert.match(nonce, /^[A-Za-z0-9+/=]+$/, "Nonce must be valid base64");
		await app.close();
	});

	it("two requests receive different nonces", async () => {
		const app = await buildApp();
		const [r1, r2] = await Promise.all([
			app.inject({ method: "GET", url: "/ping" }),
			app.inject({ method: "GET", url: "/ping" }),
		]);

		const csp1 = r1.headers["content-security-policy"] as string;
		const csp2 = r2.headers["content-security-policy"] as string;

		const m1 = csp1.match(/'nonce-([A-Za-z0-9+/=]+)'/);
		const m2 = csp2.match(/'nonce-([A-Za-z0-9+/=]+)'/);

		assert.ok(m1 && m2, "Both responses must have nonces");
		assert.notEqual(
			m1[1],
			m2[1],
			"Nonces must differ across requests (per-request randomness)",
		);
		await app.close();
	});

	it("unsafe-inline is NOT present in script-src", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		const csp = res.headers["content-security-policy"] as string;

		// Extract the script-src directive only.
		const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/);
		assert.ok(scriptSrcMatch, "script-src directive must be present");
		const scriptSrc = scriptSrcMatch[1];

		assert.ok(
			!scriptSrc.includes("'unsafe-inline'"),
			`script-src must NOT contain 'unsafe-inline'; got: ${scriptSrc}`,
		);
		await app.close();
	});

	it("reply.cspNonce is set and matches the nonce in the CSP header", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		const csp = res.headers["content-security-policy"] as string;
		const body = JSON.parse(res.body) as { nonce?: string };

		const match = csp.match(/'nonce-([A-Za-z0-9+/=]+)'/);
		assert.ok(match, "Could not extract nonce from CSP header");
		const nonceInCsp = match[1];

		assert.ok(body.nonce, "reply.cspNonce must be exposed to route handlers");
		assert.equal(
			body.nonce,
			nonceInCsp,
			"reply.cspNonce must match nonce in CSP header",
		);
		await app.close();
	});

	it("X-Content-Type-Options header is nosniff", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		assert.equal(res.headers["x-content-type-options"], "nosniff");
		await app.close();
	});

	it("X-Frame-Options header is DENY", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		assert.equal(res.headers["x-frame-options"], "DENY");
		await app.close();
	});
});
