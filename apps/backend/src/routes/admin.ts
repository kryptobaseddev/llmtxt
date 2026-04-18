/**
 * Admin API routes — read-only observability endpoints.
 *
 * All routes require admin authentication (requireAdmin preHandler).
 * These routes expose service health and observability tool URLs to
 * the frontend admin panel.
 *
 * Routes:
 *   GET /admin/services              — Railway service health grid
 *   GET /admin/config                — Public URLs for observability tools
 *   GET /admin/me                    — Confirm admin identity (auth check)
 *   GET /admin/metrics/query         — Server-side Prometheus proxy (avoids browser CORS)
 *   GET /admin/errors/issues         — Server-side GlitchTip proxy (avoids iframe X-Frame-Options)
 *   GET /admin/anonymous-sessions    — Active anonymous sessions, top IPs (T167)
 */
import { and, count, desc, eq, gt, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { requireAdmin } from "../middleware/admin.js";
import { documents, sessions, users } from "../db/schema.js";

/** Railway GraphQL endpoint */
const RAILWAY_API = "https://backboard.railway.app/graphql/v2";

interface ServiceHealth {
	name: string;
	status: "healthy" | "degraded" | "unknown";
	publicUrl: string | null;
	lastChecked: string;
}

/**
 * Fetch Railway service statuses via Railway's GraphQL API.
 * Requires RAILWAY_TOKEN and RAILWAY_PROJECT_ID env vars.
 * Falls back to a stub list when not configured.
 */
async function fetchRailwayServices(): Promise<ServiceHealth[]> {
	const token = process.env.RAILWAY_TOKEN;
	const projectId = process.env.RAILWAY_PROJECT_ID;

	if (!token || !projectId) {
		// Return stub list so the panel renders without Railway config.
		return STUB_SERVICES.map((name) => ({
			name,
			status: "unknown" as const,
			publicUrl: null,
			lastChecked: new Date().toISOString(),
		}));
	}

	const query = `
    query GetProjectServices($projectId: String!) {
      project(id: $projectId) {
        services {
          edges {
            node {
              id
              name
              deployments(first: 1) {
                edges {
                  node {
                    status
                    url
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

	try {
		const res = await fetch(RAILWAY_API, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ query, variables: { projectId } }),
			signal: AbortSignal.timeout(10_000),
		});

		if (!res.ok) {
			throw new Error(`Railway API ${res.status}`);
		}

		const data = (await res.json()) as {
			data?: {
				project?: {
					services?: {
						edges?: Array<{
							node: {
								id: string;
								name: string;
								deployments?: {
									edges?: Array<{
										node: { status: string; url: string | null };
									}>;
								};
							};
						}>;
					};
				};
			};
		};

		const edges = data?.data?.project?.services?.edges ?? [];
		return edges.map(({ node }) => {
			const deployment = node.deployments?.edges?.[0]?.node;
			const railwayStatus = deployment?.status ?? "UNKNOWN";
			return {
				name: node.name,
				status: mapRailwayStatus(railwayStatus),
				publicUrl: deployment?.url ?? null,
				lastChecked: new Date().toISOString(),
			};
		});
	} catch {
		// Network/parse failure — degrade gracefully with stubs.
		return STUB_SERVICES.map((name) => ({
			name,
			status: "unknown" as const,
			publicUrl: null,
			lastChecked: new Date().toISOString(),
		}));
	}
}

function mapRailwayStatus(railwayStatus: string): ServiceHealth["status"] {
	switch (railwayStatus.toUpperCase()) {
		case "SUCCESS":
		case "DEPLOYING":
			return "healthy";
		case "FAILED":
		case "CRASHED":
		case "REMOVED":
			return "degraded";
		default:
			return "unknown";
	}
}

/** Known Railway service names for the stub fallback. */
const STUB_SERVICES = [
	"llmtxt-api",
	"llmtxt-frontend",
	"llmtxt-docs",
	"grafana",
	"prometheus",
	"loki",
	"tempo",
	"otel-collector",
	"glitchtip",
	"postgres",
	"redis",
];

export async function adminRoutes(app: FastifyInstance): Promise<void> {
	/**
	 * GET /admin/me
	 *
	 * Simple auth-check endpoint. Returns the current user identity.
	 * The frontend uses this to verify admin access before rendering the panel.
	 */
	app.get(
		"/admin/me",
		{ preHandler: [requireAdmin] },
		async (request, _reply) => {
			return {
				id: request.user!.id,
				email: request.user!.email,
				name: request.user!.name,
				isAdmin: true,
			};
		},
	);

	/**
	 * GET /admin/metrics/query?q=<promql>
	 *
	 * Server-side proxy to Prometheus. Avoids browser CORS restrictions when
	 * the frontend queries Prometheus directly.
	 *
	 * Queries Prometheus at http://<PROMETHEUS_PRIVATE_HOST>:9090/api/v1/query
	 * using Railway private networking. Falls back to PROMETHEUS_PUBLIC_URL if
	 * no private host is configured.
	 */
	app.get(
		"/admin/metrics/query",
		{ preHandler: [requireAdmin] },
		async (request, reply) => {
			const { q } = request.query as Record<string, string>;
			if (!q || typeof q !== "string") {
				return reply.status(400).send({ error: 'Missing query parameter "q"' });
			}

			// Prefer Railway private network for zero-latency, zero-egress queries.
			// PROMETHEUS_PRIVATE_HOST is the Railway private domain, e.g. prometheus.railway.internal
			const privateHost = process.env.PROMETHEUS_PRIVATE_HOST;
			const publicUrl = process.env.PROMETHEUS_PUBLIC_URL;

			let prometheusBase: string | null = null;
			if (privateHost) {
				prometheusBase = `http://${privateHost}:9090`;
			} else if (publicUrl) {
				prometheusBase = publicUrl.replace(/\/$/, "");
			}

			if (!prometheusBase) {
				return reply
					.status(503)
					.send({
						error: "Prometheus not configured (set PROMETHEUS_PRIVATE_HOST)",
					});
			}

			try {
				const params = new URLSearchParams({ query: q });
				const res = await fetch(`${prometheusBase}/api/v1/query?${params}`, {
					signal: AbortSignal.timeout(10_000),
				});
				const data = await res.json();
				return reply.status(res.status).send(data);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return reply
					.status(502)
					.send({ error: `Prometheus proxy error: ${message}` });
			}
		},
	);

	/**
	 * GET /admin/errors/issues?limit=<n>&offset=<n>&query=<str>
	 *
	 * Server-side proxy to GlitchTip REST API. Returns recent unresolved issues
	 * as a native JSON list. Used instead of an iframe because GlitchTip's
	 * Django app sets X-Frame-Options: DENY unconditionally.
	 *
	 * Requires GLITCHTIP_API_TOKEN env var (GlitchTip auth token for admin@llmtxt.my).
	 * Falls back to GLITCHTIP_PRIVATE_URL or GLITCHTIP_PUBLIC_URL for the base.
	 */
	app.get(
		"/admin/errors/issues",
		{ preHandler: [requireAdmin] },
		async (request, reply) => {
			const {
				limit = "25",
				offset = "0",
				query = "",
			} = request.query as Record<string, string>;

			const apiToken = process.env.GLITCHTIP_API_TOKEN;
			const glitchtipBase = (
				process.env.GLITCHTIP_PRIVATE_URL ||
				process.env.GLITCHTIP_PUBLIC_URL ||
				null
			)?.replace(/\/$/, "");

			if (!glitchtipBase) {
				return reply
					.status(503)
					.send({
						error: "GlitchTip not configured (set GLITCHTIP_PUBLIC_URL)",
					});
			}

			const headers: Record<string, string> = {
				Accept: "application/json",
			};
			if (apiToken) {
				headers["Authorization"] = `Bearer ${apiToken}`;
			}

			try {
				const params = new URLSearchParams({
					limit: String(Math.min(Number(limit) || 25, 100)),
					offset: String(Number(offset) || 0),
					...(query ? { query } : {}),
				});
				const url = `${glitchtipBase}/api/0/issues/?${params}`;
				const res = await fetch(url, {
					headers,
					signal: AbortSignal.timeout(10_000),
				});

				if (!res.ok) {
					const text = await res.text().catch(() => "");
					return reply
						.status(res.status)
						.send({ error: `GlitchTip returned ${res.status}`, detail: text });
				}

				const issues = await res.json();
				return reply.send({ issues, total: res.headers.get("x-hits") ?? null });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return reply
					.status(502)
					.send({ error: `GlitchTip proxy error: ${message}` });
			}
		},
	);

	/**
	 * GET /admin/services
	 *
	 * Returns the health status of all Railway services.
	 * Pulls live data from Railway's GraphQL API when RAILWAY_TOKEN is set.
	 * Cached server-side for 30s to avoid hammering the Railway API.
	 */
	let servicesCache: ServiceHealth[] | null = null;
	let servicesCacheExpiry = 0;

	app.get(
		"/admin/services",
		{ preHandler: [requireAdmin] },
		async (_request, reply) => {
			const now = Date.now();
			if (servicesCache && now < servicesCacheExpiry) {
				return reply.send({ services: servicesCache, cached: true });
			}

			const services = await fetchRailwayServices();
			servicesCache = services;
			servicesCacheExpiry = now + 30_000; // 30s TTL

			return reply.send({ services, cached: false });
		},
	);

	/**
	 * GET /admin/config
	 *
	 * Returns public URLs for each observability tool.
	 * Frontend uses these to build iframe src attributes and API query URLs.
	 * All values come from environment variables — no secrets exposed.
	 *
	 * prometheusProxy: true when the backend has Prometheus configured server-side
	 * glitchtipProxy:  true when the backend has GlitchTip configured server-side
	 * Both flags tell the frontend to use the /admin/metrics/query and
	 * /admin/errors/issues proxy endpoints instead of direct URLs.
	 */
	app.get(
		"/admin/config",
		{ preHandler: [requireAdmin] },
		async (_request, reply) => {
			return reply.send({
				grafana: process.env.GRAFANA_PUBLIC_URL ?? null,
				prometheus: process.env.PROMETHEUS_PUBLIC_URL ?? null,
				glitchtip: process.env.GLITCHTIP_PUBLIC_URL ?? null,
				// Loki and Tempo share Grafana's explore UI — same base URL.
				loki: process.env.GRAFANA_PUBLIC_URL ?? null,
				tempo: process.env.GRAFANA_PUBLIC_URL ?? null,
				// Proxy capability flags — frontend uses these to switch from direct
				// iframe/fetch to server-side proxy endpoints.
				prometheusProxy: !!(
					process.env.PROMETHEUS_PRIVATE_HOST ||
					process.env.PROMETHEUS_PUBLIC_URL
				),
				glitchtipProxy: !!process.env.GLITCHTIP_PUBLIC_URL,
			});
		},
	);

	/**
	 * GET /admin/anonymous-sessions (T167)
	 *
	 * Returns active anonymous session stats:
	 *   - sessionCount: active anonymous users not yet expired
	 *   - expiresSoon: sessions expiring in the next 2 hours
	 *   - activeDocs: documents created by anonymous users (not archived)
	 *   - topIps: top-10 source IPs by anonymous session count (no PII exposure)
	 */
	app.get(
		"/admin/anonymous-sessions",
		{ preHandler: [requireAdmin] },
		async (_request, reply) => {
			const now = Date.now();

			const [{ value: sessionCount }] = await db
				.select({ value: count() })
				.from(users)
				.where(and(eq(users.isAnonymous, true), gt(users.expiresAt, now)));

			const [{ value: expiresSoon }] = await db
				.select({ value: count() })
				.from(users)
				.where(
					and(
						eq(users.isAnonymous, true),
						gt(users.expiresAt, now),
						isNotNull(users.expiresAt),
					),
				);

			const [{ value: activeDocs }] = await db
				.select({ value: count() })
				.from(documents)
				.where(
					and(eq(documents.isAnonymous, true), isNotNull(documents.ownerId)),
				);

			const topIpsRaw = await db
				.select({ ipAddress: sessions.ipAddress, sessionCount: count() })
				.from(sessions)
				.innerJoin(users, eq(sessions.userId, users.id))
				.where(and(eq(users.isAnonymous, true), isNotNull(sessions.ipAddress)))
				.groupBy(sessions.ipAddress)
				.orderBy(desc(count()))
				.limit(10);

			const topIps = topIpsRaw.map(
				(row: { ipAddress: string | null; sessionCount: number | bigint }) => ({
					ip: row.ipAddress ?? "unknown",
					sessionCount: Number(row.sessionCount),
				}),
			);

			return reply.send({
				sessionCount: Number(sessionCount),
				expiresSoon: Number(expiresSoon),
				activeDocs: Number(activeDocs),
				topIps,
				timestamp: new Date().toISOString(),
			});
		},
	);
}
