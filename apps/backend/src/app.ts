/**
 * app.ts — Fastify application factory.
 *
 * Extracts the Fastify app construction from index.ts so that integration
 * tests can build an isolated app instance without the production startup
 * side-effects (fail-fast env validation, Redis connection, background jobs).
 *
 * Usage:
 *   const app = await buildFastifyApp({ logger: false });
 *   await app.listen({ port: 0, host: '127.0.0.1' });
 *
 * The factory wires:
 *   - PostgresBackend (requires DATABASE_URL env var)
 *   - All v1 routes (compress, documents, versions, events, BFT, etc.)
 *   - API key auth middleware
 *
 * For production startup, see index.ts which also wires Redis, metrics,
 * background jobs, and the CORS/security middleware stack.
 *
 * T701 (SSE version events integration test)
 */

import compress from "@fastify/compress";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { registerPostgresBackendPlugin } from "./plugins/postgres-backend-plugin.js";
import { apiRoutes } from "./routes/api.js";
import { documentEventRoutes } from "./routes/document-events.js";
import { lifecycleRoutes } from "./routes/lifecycle.js";
import { v1Routes } from "./routes/v1/index.js";
import { versionRoutes } from "./routes/versions.js";

export interface BuildFastifyAppOptions {
	logger?: boolean;
}

/**
 * Build and configure a Fastify app instance suitable for integration tests.
 *
 * Does NOT call app.listen() — the caller is responsible for that.
 * Does NOT register background jobs, Redis, or production metrics.
 *
 * @param opts - Options (logger: false for test quietness)
 */
export async function buildFastifyApp(
	opts: BuildFastifyAppOptions = {},
): Promise<FastifyInstance> {
	const app = Fastify({
		logger: opts.logger ?? false,
	});

	// PostgresBackend (SDK-first adapter) — wires backendCore + eventBus
	await registerPostgresBackendPlugin(app);

	// Standard plugins
	await app.register(cors, { origin: true });
	await app.register(compress);
	await app.register(websocket);

	// Register the routes that the SSE integration test exercises.
	// Scoped under /api/v1 to match the production URL prefix used by the test.
	await app.register(
		async (scope) => {
			await scope.register(apiRoutes);
			await scope.register(versionRoutes);
			await scope.register(lifecycleRoutes);
			await scope.register(documentEventRoutes);
		},
		{ prefix: "/api/v1" },
	);

	// Also register the full v1 route bundle so all paths work.
	await app.register(v1Routes, { prefix: "/api/v1" });

	return app;
}
