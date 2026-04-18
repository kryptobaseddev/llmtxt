/**
 * Security headers test suite (T162).
 *
 * Verifies:
 *   1. CSP header present and well-formed (COEP, COOP, CORP, HSTS all present)
 *   2. HSTS max-age >= 63072000 (2 years) with includeSubDomains + preload
 *   3. Cross-Origin-Embedder-Policy: require-corp
 *   4. Cross-Origin-Opener-Policy: same-origin
 *   5. Cross-Origin-Resource-Policy: same-origin
 *   6. Referrer-Policy: strict-origin-when-cross-origin
 *   7. Permissions-Policy disables camera, microphone, geolocation
 *   8. CSP connect-src includes wss://api.llmtxt.my
 *   9. CSP frame-ancestors: 'none'
 *  10. CSP upgrade-insecure-requests
 *  11. X-Frame-Options: DENY
 *  12. X-Content-Type-Options: nosniff
 *
 * Run:
 *   pnpm --filter @llmtxt/backend test -- security-headers
 */

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import Fastify from "fastify";
import { securityHeaders } from "../middleware/security.js";

/** Build a minimal Fastify app with only the security-headers plugin. */
async function buildApp(isProduction = false) {
	const originalEnv = process.env.NODE_ENV;
	if (isProduction) {
		process.env.NODE_ENV = "production";
	}

	const app = Fastify({ logger: false });
	await securityHeaders(app);

	app.get("/ping", async (_req, reply) => {
		return reply.send({ nonce: reply.cspNonce });
	});

	await app.ready();

	if (isProduction) {
		process.env.NODE_ENV = originalEnv;
	}

	return app;
}

describe("securityHeaders — full header suite (T162)", () => {
	// ── CSP (inherited from T471 + extended for T162) ─────────────────────────

	it("response has Content-Security-Policy header", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		assert.ok(
			res.headers["content-security-policy"],
			"Content-Security-Policy header must be present",
		);
		await app.close();
	});

	it("CSP script-src contains nonce and no unsafe-inline", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		const csp = res.headers["content-security-policy"] as string;

		assert.match(csp, /'nonce-[A-Za-z0-9+/=]+'/, "CSP must contain a nonce");

		const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/);
		assert.ok(scriptSrcMatch, "script-src directive must be present");
		assert.ok(
			!scriptSrcMatch[1].includes("'unsafe-inline'"),
			"script-src must NOT contain unsafe-inline",
		);
		await app.close();
	});

	it("CSP connect-src includes wss://api.llmtxt.my", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		const csp = res.headers["content-security-policy"] as string;

		const connectSrcMatch = csp.match(/connect-src\s+([^;]+)/);
		assert.ok(connectSrcMatch, "connect-src directive must be present");
		assert.ok(
			connectSrcMatch[1].includes("wss://api.llmtxt.my"),
			`connect-src must include wss://api.llmtxt.my; got: ${connectSrcMatch[1]}`,
		);
		await app.close();
	});

	it("CSP connect-src includes https://api.llmtxt.my", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		const csp = res.headers["content-security-policy"] as string;

		const connectSrcMatch = csp.match(/connect-src\s+([^;]+)/);
		assert.ok(connectSrcMatch, "connect-src directive must be present");
		assert.ok(
			connectSrcMatch[1].includes("https://api.llmtxt.my"),
			`connect-src must include https://api.llmtxt.my; got: ${connectSrcMatch[1]}`,
		);
		await app.close();
	});

	it("CSP contains frame-ancestors 'none'", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		const csp = res.headers["content-security-policy"] as string;
		assert.ok(
			csp.includes("frame-ancestors 'none'"),
			`CSP must contain frame-ancestors 'none'; got: ${csp}`,
		);
		await app.close();
	});

	it("CSP contains form-action 'self'", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		const csp = res.headers["content-security-policy"] as string;
		assert.ok(
			csp.includes("form-action 'self'"),
			`CSP must contain form-action 'self'; got: ${csp}`,
		);
		await app.close();
	});

	it("CSP contains upgrade-insecure-requests", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		const csp = res.headers["content-security-policy"] as string;
		assert.ok(
			csp.includes("upgrade-insecure-requests"),
			`CSP must contain upgrade-insecure-requests; got: ${csp}`,
		);
		await app.close();
	});

	// ── Cross-Origin isolation headers (T162) ─────────────────────────────────

	it("Cross-Origin-Embedder-Policy is require-corp", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		assert.equal(
			res.headers["cross-origin-embedder-policy"],
			"require-corp",
			"COEP must be require-corp",
		);
		await app.close();
	});

	it("Cross-Origin-Opener-Policy is same-origin", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		assert.equal(
			res.headers["cross-origin-opener-policy"],
			"same-origin",
			"COOP must be same-origin",
		);
		await app.close();
	});

	it("Cross-Origin-Resource-Policy is same-origin", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		assert.equal(
			res.headers["cross-origin-resource-policy"],
			"same-origin",
			"CORP must be same-origin",
		);
		await app.close();
	});

	// ── HSTS (T162 — production only, 2 years + preload) ─────────────────────

	it("HSTS header is absent in non-production", async () => {
		const savedEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "development";
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		process.env.NODE_ENV = savedEnv;
		assert.equal(
			res.headers["strict-transport-security"],
			undefined,
			"HSTS must NOT be sent in non-production",
		);
		await app.close();
	});

	it("HSTS header in production has max-age >= 63072000, includeSubDomains, preload", async () => {
		const savedEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";
		const app = Fastify({ logger: false });
		const { securityHeaders: sh } = await import("../middleware/security.js");
		await sh(app);
		app.get("/ping", async (_req, reply) => reply.send({}));
		await app.ready();
		const res = await app.inject({ method: "GET", url: "/ping" });
		process.env.NODE_ENV = savedEnv;
		await app.close();

		const hsts = res.headers["strict-transport-security"] as string;
		assert.ok(hsts, "HSTS must be present in production");

		const maxAgeMatch = hsts.match(/max-age=(\d+)/);
		assert.ok(maxAgeMatch, "HSTS must contain max-age");
		const maxAge = parseInt(maxAgeMatch[1], 10);
		assert.ok(
			maxAge >= 63072000,
			`HSTS max-age must be >= 63072000 (2 years); got ${maxAge}`,
		);

		assert.ok(
			hsts.includes("includeSubDomains"),
			"HSTS must include includeSubDomains",
		);
		assert.ok(hsts.includes("preload"), "HSTS must include preload");
	});

	// ── Other headers ─────────────────────────────────────────────────────────

	it("Referrer-Policy is strict-origin-when-cross-origin", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		assert.equal(
			res.headers["referrer-policy"],
			"strict-origin-when-cross-origin",
		);
		await app.close();
	});

	it("Permissions-Policy disables camera, microphone, geolocation", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		const pp = res.headers["permissions-policy"] as string;
		assert.ok(pp, "Permissions-Policy must be present");
		assert.ok(pp.includes("camera=()"), "Permissions-Policy must disable camera");
		assert.ok(pp.includes("microphone=()"), "Permissions-Policy must disable microphone");
		assert.ok(pp.includes("geolocation=()"), "Permissions-Policy must disable geolocation");
		await app.close();
	});

	it("X-Frame-Options is DENY", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		assert.equal(res.headers["x-frame-options"], "DENY");
		await app.close();
	});

	it("X-Content-Type-Options is nosniff", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		assert.equal(res.headers["x-content-type-options"], "nosniff");
		await app.close();
	});

	it("X-XSS-Protection is 0 (disabled per OWASP)", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/ping" });
		assert.equal(res.headers["x-xss-protection"], "0");
		await app.close();
	});
});
